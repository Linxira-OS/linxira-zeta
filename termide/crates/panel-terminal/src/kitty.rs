//! Kitty graphics protocol: the direct-placement subset the workbench renders.
//!
//! Hosted TUIs (zetacode) advertise images through APC sequences
//! `ESC _ G <control> ; <payload> ESC \`. The workbench is its client's own
//! terminal, so it owns the pixel surface: it decodes the transmitted raster,
//! keeps it per image id, and hands the renderer a placement in screen cells.
//! This module is that store plus the scanner that reassembles the chunks a
//! payload arrives in — no painting happens here.
//!
//! Supported, on the protocol's direct-placement path:
//!
//! * actions `t` (transmit), `T` (transmit and display), `p` (place a
//!   transmitted image), `d` (delete) and `q` (query);
//! * chunked transmission (`m=1`) across any number of APCs;
//! * formats `f=100` (PNG), `f=32` (raw RGBA) and `f=24` (raw RGB);
//! * `i`/`p` ids, `c`/`r` cell extents, source crops `x`/`y`/`w`/`h`, `z`, and
//!   the three quiet levels.
//!
//! `C=1` is accepted and is what this emulator does unconditionally: a
//! placement anchors at the cursor cell and never moves it, so a client that
//! keeps its own row accounting (ours does) is never surprised.
//!
//! Unicode placeholders (`U=1`) are deliberately left out. The client probes
//! for them through the marks probe and falls back to a direct placement when
//! the terminal does not answer, and a direct placement is what this emulator
//! paints. File, temporary-file and shared-memory transmission media are out
//! of scope too: a pane never sees a filesystem its child wrote.

use std::collections::HashMap;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// Longest APC payload kept: one chunked transmission, base64 included.
///
/// The client rasterizes at the terminal's own cell density and caps its edge
/// at 4096 px, so a 4096² RGBA image — 64 MiB raw, 85 MiB in base64 — is the
/// worst a well-behaved client can send. The cap sits far below that, which
/// keeps a runaway emitter from pinning a pane's memory.
pub const MAX_APC_BYTES: usize = 32 * 1024 * 1024;
/// Longest image edge accepted.
pub const MAX_IMAGE_EDGE: u32 = 8192;
/// Most pixels accepted in one image (64 MiB of RGBA at the edge cap).
pub const MAX_IMAGE_PIXELS: u64 = 16 * 1024 * 1024;
/// Leading bytes of an oversized APC kept so its parameters still parse.
const OVERFLOW_HEAD: usize = 512;

/// One decoded image, addressed by its protocol id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Image {
    /// Image id (`i=`), or the id the terminal allocated when the client sent none.
    pub id: u32,
    /// Bumped every time this id is (re)transmitted, so a renderer holding a
    /// texture knows when to upload again without hashing the pixels.
    pub revision: u64,
    pub width: u32,
    pub height: u32,
    /// Straight (unpremultiplied) RGBA8, row-major, `width * height * 4` bytes.
    pub rgba: Vec<u8>,
}

/// Source rectangle of an image, in image pixels. A zero width or height means
/// "the whole image", which is what an absent `x`/`y`/`w`/`h` asks for.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Crop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// A device-pixel rectangle, origin at the top-left of the pane's grid.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// One on-screen placement of an image.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placement {
    /// Image id this placement shows.
    pub image: u32,
    /// Placement id (`p=`); repeated placements under one id replace each other.
    pub id: u32,
    /// Left column and top row of the placement, in screen cells.
    pub column: usize,
    pub row: usize,
    /// Cell extents (`c=`/`r=`); 0 means "as many cells as the image is wide/tall".
    pub columns: usize,
    pub rows: usize,
    pub crop: Crop,
    /// Stacking order: negative paints behind the text, everything else above it.
    pub z: i32,
}

impl Placement {
    /// The placement's device-pixel rectangle for a `cell` measured in device
    /// pixels: `column`/`row` cells in, `c`/`r` cells across.
    ///
    /// Without cell extents the image's own pixel size is the box (what kitty
    /// places at `a=p` with no `c`/`r`), so a 480×720 PNG lands on exactly
    /// 480×720 device pixels whatever the cell size is.
    pub fn rect(&self, image: &Image, cell: (u16, u16)) -> Rect {
        let cell_w = u32::from(cell.0);
        let cell_h = u32::from(cell.1);
        Rect {
            x: self.column as u32 * cell_w,
            y: self.row as u32 * cell_h,
            width: if self.columns > 0 {
                self.columns as u32 * cell_w
            } else {
                image.width
            },
            height: if self.rows > 0 {
                self.rows as u32 * cell_h
            } else {
                image.height
            },
        }
    }
}

/// What a caller must write back to the child after one APC, if anything.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reply {
    /// Image id the reply names, when the command named or allocated one.
    pub id: Option<u32>,
    /// Protocol error code (`EINVAL`, `ENOENT`, `ENOTSUP`), `None` for `OK`.
    pub error: Option<&'static str>,
    /// Human-readable detail appended after the code.
    pub detail: Option<String>,
    /// `q=` level: 0 replies always, 1 suppresses `OK`, 2 suppresses everything.
    pub quiet: u8,
}

impl Reply {
    fn ok(id: Option<u32>, quiet: u8) -> Self {
        Self {
            id,
            error: None,
            detail: None,
            quiet,
        }
    }

    fn error(id: Option<u32>, quiet: u8, code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            id,
            error: Some(code),
            detail: Some(detail.into()),
            quiet,
        }
    }

    /// The reply sequence, or `None` when the quiet level suppresses it.
    pub(crate) fn sequence(&self) -> Option<Vec<u8>> {
        if self.quiet >= 2 || (self.quiet == 1 && self.error.is_none()) {
            return None;
        }
        let mut out = String::from("\x1b_G");
        if let Some(id) = self.id {
            out.push_str("i=");
            out.push_str(&id.to_string());
            out.push(';');
        }
        match self.error {
            None => out.push_str("OK"),
            Some(code) => {
                out.push_str(code);
                if let Some(detail) = &self.detail {
                    out.push(':');
                    out.push_str(detail);
                }
            }
        }
        out.push_str("\x1b\\");
        Some(out.into_bytes())
    }
}

/// Parameters of one kitty command (the `key=value` block before the payload).
#[derive(Clone, Debug, Default)]
struct Params {
    action: Option<u8>,
    format: Option<u32>,
    id: Option<u32>,
    placement: Option<u32>,
    columns: Option<usize>,
    rows: Option<usize>,
    z: i32,
    quiet: u8,
    more: bool,
    medium: Option<u8>,
    /// Source image pixel size for the raw formats (`s`/`v`).
    width: Option<u32>,
    height: Option<u32>,
    crop: Crop,
    delete: Option<u8>,
}

/// A transmission waiting for its `m=0` chunk.
#[derive(Clone, Debug)]
struct Pending {
    params: Params,
    payload: Vec<u8>,
    overflowed: bool,
}

/// Per-screen image store and placement list.
#[derive(Clone, Debug)]
pub struct Graphics {
    images: HashMap<u32, Arc<Image>>,
    placements: Vec<Placement>,
    next_id: u32,
    next_revision: u64,
    pending: Option<Pending>,
}

impl Default for Graphics {
    fn default() -> Self {
        Self {
            images: HashMap::new(),
            placements: Vec::new(),
            next_id: 1,
            next_revision: 1,
            pending: None,
        }
    }
}

impl Graphics {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every live placement with its image, in the order the child made them.
    ///
    /// The `Arc` is shared with the store, so a renderer can hold an image
    /// across frames without copying the pixels.
    pub fn placements(&self) -> Vec<(Placement, Arc<Image>)> {
        self.placements
            .iter()
            .filter_map(|p| {
                self.images
                    .get(&p.image)
                    .map(|image| (p.clone(), Arc::clone(image)))
            })
            .collect()
    }

    /// Drop every image and placement.
    pub fn clear(&mut self) {
        self.images.clear();
        self.placements.clear();
        self.pending = None;
    }

    /// Whether anything would be painted.
    pub fn is_empty(&self) -> bool {
        self.placements.is_empty()
    }

    /// Move every placement in `top..=bottom` up one row, dropping the one that
    /// leaves the region.
    ///
    /// Kitty graphics ride the text: a screen scroll carries the image with its
    /// anchor row, and an image scrolled past the top of the region is gone
    /// (the client re-places whatever it still wants). [`TerminalScreen::scroll_up`]
    /// calls this, so a transcript that scrolls under an image cannot leave the
    /// image floating over unrelated rows.
    ///
    /// [`TerminalScreen::scroll_up`]: crate::TerminalScreen::scroll_up
    pub fn scroll_up(&mut self, top: usize, bottom: usize) {
        if self.placements.is_empty() {
            return;
        }
        self.placements.retain_mut(|placement| {
            if placement.row < top || placement.row > bottom {
                return true;
            }
            if placement.row == top {
                return false;
            }
            placement.row -= 1;
            true
        });
    }

    /// Handle one completed APC payload (`ESC _ <payload> ESC \`), including
    /// the leading `G` of the graphics protocol.
    ///
    /// `cursor` is the screen cell the command anchors a placement to. Returns
    /// the reply the child asked for, if any; a chunked transmission that is
    /// still incomplete returns `None`.
    pub fn apc(&mut self, payload: &[u8], cursor: (usize, usize)) -> Option<Reply> {
        let body = payload.strip_prefix(b"G")?;
        let (control, data) = match body.iter().position(|b| *b == b';') {
            Some(at) => (&body[..at], &body[at + 1..]),
            None => (body, &body[body.len()..]),
        };
        let params = match parse_params(control) {
            Ok(params) => params,
            Err(code) => {
                let quiet = quiet_of(control);
                return Some(Reply::error(None, quiet, code, "malformed control data"));
            }
        };

        // A pending transmission swallows this chunk whatever it claims to be:
        // kitty only allows `m`/`q` on a continuation, and a stray command in
        // the middle of a payload is the client's bug, not a new command.
        if let Some(pending) = self.pending.as_mut() {
            let quiet = pending.params.quiet;
            if data.len() + pending.payload.len() <= MAX_APC_BYTES {
                pending.payload.extend_from_slice(data);
            } else {
                pending.overflowed = true;
            }
            if params.more {
                return None;
            }
            let done = self.pending.take().expect("checked above");
            if done.overflowed {
                return Some(Reply::error(
                    done.params.id,
                    quiet,
                    "EINVAL",
                    format!("payload over {MAX_APC_BYTES} bytes"),
                ));
            }
            return Some(self.finish(&done.params, &done.payload, cursor));
        }

        if params.more {
            let overflowed = data.len() > MAX_APC_BYTES;
            let payload = if overflowed {
                Vec::new()
            } else {
                data.to_vec()
            };
            let quiet = params.quiet;
            let id = params.id;
            self.pending = Some(Pending {
                params,
                payload,
                overflowed,
            });
            return if overflowed {
                self.pending = None;
                Some(Reply::error(
                    id,
                    quiet,
                    "EINVAL",
                    format!("payload over {MAX_APC_BYTES} bytes"),
                ))
            } else {
                None
            };
        }

        Some(self.finish(&params, data, cursor))
    }

    /// Handle an APC the scanner refused as oversized: its leading bytes are
    /// still enough to name the image and honour the quiet level, so the child
    /// gets a protocol error instead of silence.
    pub fn oversized(&mut self, head: &[u8]) -> Option<Reply> {
        let body = head.strip_prefix(b"G")?;
        let control = body.split(|b| *b == b';').next().unwrap_or(body);
        let quiet = quiet_of(control);
        let id = std::str::from_utf8(control).ok().and_then(|text| {
            text.split(',').find_map(|field| {
                field
                    .strip_prefix("i=")
                    .and_then(|value| value.parse().ok())
            })
        });
        // A transmission cut off by the cap can never be completed.
        self.pending = None;
        Some(Reply::error(
            id,
            quiet,
            "EINVAL",
            format!("payload over {MAX_APC_BYTES} bytes"),
        ))
    }

    /// Run a complete (unchunked) command.
    fn finish(&mut self, params: &Params, payload: &[u8], cursor: (usize, usize)) -> Reply {
        let quiet = params.quiet;
        // The protocol's default action is "transmit".
        match params.action.unwrap_or(b't') {
            b't' | b'T' => match self.transmit(params, payload) {
                Ok(id) => {
                    if params.action == Some(b'T') {
                        self.place(params, id, cursor);
                    }
                    Reply::ok(Some(id), quiet)
                }
                Err(code) => Reply::error(params.id, quiet, code, "transmission rejected"),
            },
            b'p' => {
                let Some(id) = params.id else {
                    return Reply::error(None, quiet, "EINVAL", "a=p needs an image id");
                };
                if !self.images.contains_key(&id) {
                    return Reply::error(Some(id), quiet, "ENOENT", format!("no image {id}"));
                }
                self.place(params, id, cursor);
                Reply::ok(Some(id), quiet)
            }
            b'd' => {
                if let Err(code) = self.delete(params) {
                    return Reply::error(params.id, quiet, code, "delete rejected");
                }
                Reply::ok(params.id, quiet)
            }
            // "Is the protocol supported?" — we would not parse this otherwise.
            b'q' => Reply::ok(params.id, quiet),
            _ => Reply::error(params.id, quiet, "EINVAL", "unknown action"),
        }
    }

    /// Decode and store an image; returns the id it is stored under.
    fn transmit(&mut self, params: &Params, payload: &[u8]) -> Result<u32, &'static str> {
        if let Some(medium) = params.medium {
            if medium != b'd' {
                // Only direct transmission: a pane has no shared filesystem to
                // read from and no temporary directory of the child's.
                return Err("ENOTSUP");
            }
        }
        let bytes = BASE64.decode(payload).map_err(|_| "EINVAL")?;
        let (width, height, rgba) = decode_image(params, &bytes)?;
        let id = match params.id {
            Some(id) => id,
            None => self.allocate_id(),
        };
        let revision = self.next_revision;
        self.next_revision = self.next_revision.wrapping_add(1).max(1);
        self.images.insert(
            id,
            Arc::new(Image {
                id,
                revision,
                width,
                height,
                rgba,
            }),
        );
        Ok(id)
    }

    /// A fresh id that no live image holds.
    fn allocate_id(&mut self) -> u32 {
        let mut candidate = self.next_id;
        while self.images.contains_key(&candidate) {
            candidate = candidate.wrapping_add(1).max(1);
        }
        self.next_id = candidate.wrapping_add(1).max(1);
        candidate
    }

    /// Attach a placement to the image at the cursor, replacing one with the
    /// same (image, placement) pair so a repaint moves the graphic instead of
    /// stacking a duplicate.
    fn place(&mut self, params: &Params, image: u32, cursor: (usize, usize)) {
        let placement = Placement {
            image,
            id: params.placement.unwrap_or(0),
            column: cursor.1,
            row: cursor.0,
            columns: params.columns.unwrap_or(0),
            rows: params.rows.unwrap_or(0),
            crop: params.crop,
            z: params.z,
        };
        match self
            .placements
            .iter_mut()
            .find(|p| p.image == image && p.id == placement.id)
        {
            Some(existing) => *existing = placement,
            None => self.placements.push(placement),
        }
    }

    /// Apply an `a=d` command. Deletion values outside the direct-placement
    /// subset (scrollback ranges, animation frames) are ignored rather than
    /// failed: a client that does not know them gets a no-op, not an error loop.
    fn delete(&mut self, params: &Params) -> Result<(), &'static str> {
        match params.delete.unwrap_or(b'a') {
            b'a' => self.clear(),
            b'A' => self.placements.clear(),
            b'i' | b'I' => {
                let id = params.id.ok_or("EINVAL")?;
                self.images.remove(&id);
                self.placements.retain(|p| p.image != id);
            }
            b'p' | b'P' => {
                let id = params.id.ok_or("EINVAL")?;
                let placement = params.placement.ok_or("EINVAL")?;
                self.placements
                    .retain(|p| !(p.image == id && p.id == placement));
                // `d=P` frees the data once nothing shows it; `d=p` keeps it so
                // a later `a=p` needs no retransmit.
                if params.delete == Some(b'P') && !self.placements.iter().any(|p| p.image == id) {
                    self.images.remove(&id);
                }
            }
            _ => {}
        }
        Ok(())
    }
}

/// Best-effort `q=` from control data, so an error reply still honours the
/// client's quiet level even when the rest of the block does not parse.
fn quiet_of(control: &[u8]) -> u8 {
    let text = String::from_utf8_lossy(control);
    text.split(',')
        .find_map(|field| {
            field
                .strip_prefix("q=")
                .and_then(|value| value.parse::<u8>().ok())
        })
        .unwrap_or(0)
}

fn parse_params(control: &[u8]) -> Result<Params, &'static str> {
    if control.iter().any(|b| !b.is_ascii()) {
        return Err("EINVAL");
    }
    let text = std::str::from_utf8(control).map_err(|_| "EINVAL")?;
    let mut params = Params::default();
    for field in text.split(',').filter(|f| !f.is_empty()) {
        let Some((key, value)) = field.split_once('=') else {
            // A bare flag is not part of the protocol; ignore it.
            continue;
        };
        let number = |value: &str| -> Result<u32, &'static str> {
            value.parse::<u32>().map_err(|_| "EINVAL")
        };
        match key {
            "a" => params.action = value.bytes().next(),
            "f" => params.format = Some(number(value)?),
            "i" => params.id = Some(number(value)?),
            "p" => params.placement = Some(number(value)?),
            "c" => params.columns = Some(number(value)? as usize),
            "r" => params.rows = Some(number(value)? as usize),
            // `C=1` asks for the only behaviour a placement has here.
            "C" => {}
            "z" => params.z = value.parse::<i32>().map_err(|_| "EINVAL")?,
            "q" => params.quiet = value.parse::<u8>().map_err(|_| "EINVAL")?.min(2),
            "m" => params.more = value == "1",
            "t" => params.medium = value.bytes().next(),
            "s" => params.width = Some(number(value)?),
            "v" => params.height = Some(number(value)?),
            "x" => params.crop.x = number(value)?,
            "y" => params.crop.y = number(value)?,
            "w" => params.crop.width = number(value)?,
            "h" => params.crop.height = number(value)?,
            "d" => params.delete = value.bytes().next(),
            // Unknown keys stay ignored: the protocol grows by addition, and a
            // client ahead of this snapshot must still get its image drawn.
            _ => {}
        }
    }
    Ok(params)
}

fn check_size(width: u32, height: u32) -> Result<(), &'static str> {
    if width == 0 || height == 0 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE {
        return Err("EINVAL");
    }
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err("EINVAL");
    }
    Ok(())
}

fn decode_image(params: &Params, bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), &'static str> {
    match params.format.unwrap_or(32) {
        100 => {
            let read = || {
                image::ImageReader::with_format(
                    std::io::Cursor::new(bytes),
                    image::ImageFormat::Png,
                )
            };
            // Dimensions first: an oversized PNG is refused before its pixels
            // are allocated.
            let (width, height) = read().into_dimensions().map_err(|_| "EINVAL")?;
            check_size(width, height)?;
            let decoded = read().decode().map_err(|_| "EINVAL")?;
            let rgba = decoded.to_rgba8();
            Ok((rgba.width(), rgba.height(), rgba.into_raw()))
        }
        32 => {
            let (width, height) = raw_extent(params)?;
            if bytes.len() != width as usize * height as usize * 4 {
                return Err("EINVAL");
            }
            Ok((width, height, bytes.to_vec()))
        }
        24 => {
            let (width, height) = raw_extent(params)?;
            if bytes.len() != width as usize * height as usize * 3 {
                return Err("EINVAL");
            }
            let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
            for pixel in bytes.chunks_exact(3) {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 0xff]);
            }
            Ok((width, height, rgba))
        }
        _ => Err("ENOTSUP"),
    }
}

fn raw_extent(params: &Params) -> Result<(u32, u32), &'static str> {
    let width = params.width.ok_or("EINVAL")?;
    let height = params.height.ok_or("EINVAL")?;
    check_size(width, height)?;
    Ok((width, height))
}

/// How an APC scanner wants one byte treated.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Not inside an APC: the caller's own parser handles the byte.
    Forward,
    /// The byte is `ESC`, which may open an APC: hold it. The next [`feed`]
    /// answers [`Step::Replay`] (ESC and the new byte are ordinary) or
    /// [`Step::Start`] (an APC opened, and neither byte reaches the parser).
    ///
    /// [`feed`]: ApcScanner::feed
    Hold,
    /// Not an APC after all: feed `ESC` and then this byte to the parser.
    Replay,
    /// The `ESC _` that opened an APC was consumed: there is nothing to paint
    /// yet, and the caller's parser stays where it was (it never saw the ESC).
    Start,
    /// Inside an APC: the caller must not parse the byte.
    Swallowed,
    /// The APC closed: [`ApcScanner::payload`] holds the complete payload.
    Payload,
    /// The APC closed but exceeded the limit: [`ApcScanner::head`] holds its
    /// leading bytes (enough to parse the parameters and answer the client).
    TooLarge,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum State {
    #[default]
    Ground,
    Escape,
    Body,
    BodyEscape,
}

/// Reassembles APC payloads from a byte stream.
///
/// The scanner runs beside the VT parser, not instead of it: it only says which
/// bytes belong to an APC, so the caller can keep feeding its own parser (which
/// must ignore APC bodies — vte's `SosPmApcString` state already does) while the
/// inline graphics arrive in arbitrary read-sized pieces.
#[derive(Clone, Debug)]
pub struct ApcScanner {
    state: State,
    buffer: Vec<u8>,
    head: Vec<u8>,
    limit: usize,
    overflowed: bool,
}

impl Default for ApcScanner {
    fn default() -> Self {
        Self::with_limit(MAX_APC_BYTES)
    }
}

impl ApcScanner {
    pub fn new() -> Self {
        Self::default()
    }

    /// A scanner that refuses payloads longer than `limit` (tests use a small
    /// one so the overflow path does not need a 32 MiB buffer).
    pub fn with_limit(limit: usize) -> Self {
        Self {
            state: State::Ground,
            buffer: Vec::new(),
            head: Vec::new(),
            limit,
            overflowed: false,
        }
    }

    /// The payload of the APC that just closed (valid on [`Step::Payload`]).
    pub fn payload(&self) -> &[u8] {
        &self.buffer
    }

    /// The leading bytes of an APC that was too large (valid on [`Step::TooLarge`]).
    pub fn head(&self) -> &[u8] {
        &self.head
    }

    /// Consume one byte and report how the caller should treat it.
    pub fn feed(&mut self, byte: u8) -> Step {
        match self.state {
            State::Ground => {
                if byte == 0x1b {
                    self.state = State::Escape;
                    Step::Hold
                } else {
                    Step::Forward
                }
            }
            State::Escape => {
                if byte == b'_' {
                    self.state = State::Body;
                    self.buffer.clear();
                    self.head.clear();
                    self.overflowed = false;
                    Step::Start
                } else {
                    self.state = State::Ground;
                    Step::Replay
                }
            }
            State::Body => {
                if byte == 0x1b {
                    self.state = State::BodyEscape;
                } else {
                    self.push(byte);
                }
                Step::Swallowed
            }
            State::BodyEscape => {
                if byte == b'\\' {
                    self.state = State::Ground;
                    if self.overflowed {
                        self.buffer = Vec::new();
                        Step::TooLarge
                    } else {
                        Step::Payload
                    }
                } else {
                    // A stray ESC is payload, not a terminator: keep it and
                    // carry on, so a truncated sequence cannot wedge the parser.
                    self.push(0x1b);
                    self.state = if byte == 0x1b {
                        State::BodyEscape
                    } else {
                        self.push(byte);
                        State::Body
                    };
                    Step::Swallowed
                }
            }
        }
    }

    fn push(&mut self, byte: u8) {
        if self.buffer.len() < self.limit {
            self.buffer.push(byte);
            if self.head.len() < OVERFLOW_HEAD {
                self.head.push(byte);
            }
        } else {
            self.overflowed = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 2×2 PNG (red, green / blue, white), committed as
    /// `testdata/kitty-2x2.png`.
    const PNG_2X2: &[u8] = include_bytes!("../testdata/kitty-2x2.png");

    fn b64(bytes: &[u8]) -> String {
        BASE64.encode(bytes)
    }

    /// One APC payload as the scanner delivers it: `G` + control + `;` + data.
    fn command(control: &str, data: &[u8]) -> Vec<u8> {
        let mut out = b"G".to_vec();
        out.extend_from_slice(control.as_bytes());
        out.push(b';');
        out.extend_from_slice(data);
        out
    }

    /// Wrap `G<control>;<data>` in the APC delimiters.
    fn framed(control: &str, data: &[u8]) -> Vec<u8> {
        let mut out = b"\x1b_".to_vec();
        out.extend_from_slice(&command(control, data));
        out.extend_from_slice(b"\x1b\\");
        out
    }

    /// Feed a byte stream through a scanner, collecting every completed payload.
    fn scan(bytes: &[u8]) -> Vec<Vec<u8>> {
        let mut scanner = ApcScanner::new();
        let mut payloads = Vec::new();
        for byte in bytes {
            if scanner.feed(*byte) == Step::Payload {
                payloads.push(scanner.payload().to_vec());
            }
        }
        payloads
    }

    #[test]
    fn scanner_reassembles_one_apc_from_any_chunking() {
        // Byte-at-a-time is the worst case the PTY reader can deliver.
        assert_eq!(
            scan(&framed("a=t,f=100,i=7", b"AAAA")),
            vec![command("a=t,f=100,i=7", b"AAAA")]
        );
        // And an APC that follows text is found without eating the text.
        let mut mixed = b"hi".to_vec();
        mixed.extend_from_slice(&framed("a=t,f=100,i=7", b"AAAA"));
        mixed.extend_from_slice(b"there");
        assert_eq!(scan(&mixed).len(), 1);
    }

    #[test]
    fn scanner_keeps_escape_sequences_transparent() {
        let mut scanner = ApcScanner::new();
        let mut forwarded = Vec::new();
        for byte in b"\x1b[1;2mx\x1b_abc\x1b\\y" {
            match scanner.feed(*byte) {
                Step::Forward => forwarded.push(*byte),
                Step::Hold => {}
                Step::Replay => {
                    forwarded.push(0x1b);
                    forwarded.push(*byte);
                }
                _ => {}
            }
        }
        // The CSI survives intact; the APC and its terminator do not; the text
        // after it does.
        assert_eq!(forwarded, b"\x1b[1;2mxy");
    }

    #[test]
    fn scanner_reports_oversized_payloads_with_their_head() {
        let mut scanner = ApcScanner::with_limit(32);
        let mut oversized = b"\x1b_".to_vec();
        oversized.extend_from_slice(b"Ga=t,f=100,i=2;");
        oversized.extend(std::iter::repeat_n(b'A', 64));
        oversized.extend_from_slice(b"\x1b\\");
        let mut steps = Vec::new();
        for byte in &oversized {
            let step = scanner.feed(*byte);
            if !matches!(
                step,
                Step::Forward | Step::Hold | Step::Swallowed | Step::Replay
            ) {
                steps.push(step);
            }
        }
        assert_eq!(steps, vec![Step::Start, Step::TooLarge]);
        assert!(scanner.head().starts_with(b"Ga=t,f=100,i=2;"));

        // The store answers from that prefix, honouring q.
        let mut graphics = Graphics::new();
        let reply = graphics.oversized(scanner.head()).unwrap();
        assert_eq!(reply.error, Some("EINVAL"));
        assert_eq!(reply.id, Some(2));
        assert!(reply.sequence().is_some());
        let mut quiet = graphics.oversized(scanner.head());
        quiet = quiet.map(|mut reply| {
            reply.quiet = 2;
            reply
        });
        assert!(quiet.unwrap().sequence().is_none());
    }

    #[test]
    fn png_transmit_stores_pixels_and_replies_ok() {
        let mut graphics = Graphics::new();
        let reply = graphics
            .apc(&command("a=t,f=100,i=3", b64(PNG_2X2).as_bytes()), (0, 0))
            .expect("a complete command replies");
        assert_eq!(reply.error, None);
        assert_eq!(reply.id, Some(3));
        assert_eq!(reply.sequence().unwrap(), b"\x1b_Gi=3;OK\x1b\\");
        let placements = graphics.placements();
        assert!(placements.is_empty(), "a=t transmits without displaying");
        // The stored pixels are the PNG's own RGBA.
        let reply = graphics.apc(b"Ga=p,i=3,x=0,y=0,w=1,h=1", (0, 0)).unwrap();
        assert_eq!(reply.error, None);
        let (placement, image) = graphics.placements().pop().unwrap();
        assert_eq!((image.width, image.height), (2, 2));
        assert_eq!(&image.rgba[0..4], &[255, 0, 0, 255], "top-left is red");
        assert_eq!(
            placement.crop,
            Crop {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            }
        );
    }

    #[test]
    fn chunked_transmission_reassembles_across_m_1() {
        let data = b64(PNG_2X2);
        let (first, rest) = data.split_at(12);
        let (second, third) = rest.split_at(8);
        let mut sequence = framed("a=T,f=100,i=9,c=10,r=5,m=1", first.as_bytes());
        sequence.extend_from_slice(&framed("m=1", second.as_bytes()));
        sequence.extend_from_slice(&framed("m=0", third.as_bytes()));
        let payloads = scan(&sequence);
        assert_eq!(payloads.len(), 3, "three APCs, one transmission");

        let mut graphics = Graphics::new();
        assert!(
            graphics.apc(&payloads[0], (2, 3)).is_none(),
            "m=1 holds the payload open"
        );
        assert!(graphics.apc(&payloads[1], (2, 3)).is_none());
        let reply = graphics
            .apc(&payloads[2], (2, 3))
            .expect("the last chunk completes");
        assert_eq!(reply.error, None);
        let placements = graphics.placements();
        assert_eq!(placements.len(), 1, "a=T placed the image once");
        let (placement, image) = &placements[0];
        assert_eq!((placement.column, placement.row), (3, 2));
        assert_eq!((placement.columns, placement.rows), (10, 5));
        assert_eq!(
            placement.rect(image, (12, 24)),
            Rect {
                x: 36,
                y: 48,
                width: 120,
                height: 120
            }
        );
    }

    #[test]
    fn placement_rects_are_exact_cell_multiples() {
        let image = Image {
            id: 1,
            revision: 1,
            width: 480,
            height: 720,
            rgba: vec![],
        };
        let placement = Placement {
            image: 1,
            id: 0,
            column: 2,
            row: 3,
            columns: 40,
            rows: 30,
            crop: Crop::default(),
            z: 0,
        };
        assert_eq!(
            placement.rect(&image, (12, 24)),
            Rect {
                x: 24,
                y: 72,
                width: 480,
                height: 720
            }
        );
        // No extents: the image's own pixel size is the box.
        let natural = Placement {
            columns: 0,
            rows: 0,
            ..placement.clone()
        };
        assert_eq!(natural.rect(&image, (12, 24)).width, 480);
        assert_eq!(natural.rect(&image, (12, 24)).height, 720);
    }

    #[test]
    fn placement_replaces_by_id_and_stacks_otherwise() {
        let mut graphics = Graphics::new();
        graphics.apc(&command("a=t,f=100,i=4", b64(PNG_2X2).as_bytes()), (0, 0));
        let reply = graphics.apc(b"Ga=p,i=4,p=2,c=3,r=2", (5, 4)).unwrap();
        assert_eq!(reply.error, None);
        let placements = graphics.placements();
        assert_eq!(placements.len(), 1);
        assert_eq!((placements[0].0.row, placements[0].0.column), (5, 4));
        // A different placement id stacks rather than replaces.
        graphics.apc(b"Ga=p,i=4,p=3,c=3,r=2", (7, 4));
        assert_eq!(graphics.placements().len(), 2);
        // The same id replaces, which is what a repaint relies on.
        graphics.apc(b"Ga=p,i=4,p=3,c=3,r=2", (9, 4));
        let placements = graphics.placements();
        assert_eq!(placements.len(), 2);
        assert_eq!(placements[1].0.row, 9);
    }

    #[test]
    fn placements_ride_the_text_when_the_screen_scrolls() {
        let mut graphics = Graphics::new();
        for (row, id) in [(1usize, 1u32), (3, 2), (4, 3)] {
            graphics.apc(
                &command(&format!("a=T,f=32,i={id},c=2,r=1,s=1,v=1"), b"/wAA/w=="),
                (row, 0),
            );
        }
        // A full-screen scroll: every row moves up, the top one falls off.
        graphics.scroll_up(0, 9);
        let rows: Vec<usize> = graphics.placements().iter().map(|(p, _)| p.row).collect();
        assert_eq!(rows, vec![0, 2, 3]);
        graphics.scroll_up(0, 9);
        let rows: Vec<usize> = graphics.placements().iter().map(|(p, _)| p.row).collect();
        assert_eq!(rows, vec![1, 2], "the image at row 0 left the screen");
        // A scroll region only moves what is inside it.
        graphics.scroll_up(0, 1);
        let rows: Vec<usize> = graphics.placements().iter().map(|(p, _)| p.row).collect();
        assert_eq!(rows, vec![0, 2], "only the row inside the region moved");
    }

    #[test]
    fn placing_an_unknown_image_is_enoent() {
        let mut graphics = Graphics::new();
        let reply = graphics.apc(b"Ga=p,i=77", (0, 0)).unwrap();
        assert_eq!(reply.error, Some("ENOENT"));
        assert_eq!(
            reply.sequence().unwrap(),
            b"\x1b_Gi=77;ENOENT:no image 77\x1b\\"
        );
    }

    #[test]
    fn an_id_less_transmission_reports_the_allocated_id() {
        let mut graphics = Graphics::new();
        let reply = graphics
            .apc(&command("a=t,f=100", b64(PNG_2X2).as_bytes()), (0, 0))
            .unwrap();
        let id = reply.id.expect("the terminal allocates an id");
        assert_eq!(
            reply.sequence().unwrap(),
            format!("\x1b_Gi={id};OK\x1b\\").into_bytes()
        );
        assert!(graphics.apc(b"Ga=p,i=1", (0, 0)).is_some());
    }

    #[test]
    fn delete_removes_placements_and_data() {
        let mut graphics = Graphics::new();
        graphics.apc(
            &command("a=T,f=100,i=5,c=2,r=2", b64(PNG_2X2).as_bytes()),
            (0, 0),
        );
        assert_eq!(graphics.placements().len(), 1);
        // d=i drops that image and its placements.
        graphics.apc(b"Ga=d,d=i,i=5", (0, 0));
        assert!(graphics.placements().is_empty());
        // d=A clears placements but keeps the data for a later a=p.
        graphics.apc(
            &command("a=T,f=100,i=6,c=2,r=2", b64(PNG_2X2).as_bytes()),
            (0, 0),
        );
        graphics.apc(b"Ga=d,d=A", (0, 0));
        assert!(graphics.placements().is_empty());
        assert!(graphics
            .apc(b"Ga=p,i=6,p=1", (0, 0))
            .unwrap()
            .error
            .is_none());
        // d=p removes one placement and keeps the data; d=a frees everything.
        graphics.apc(b"Ga=d,d=p,i=6,p=1", (0, 0));
        assert!(graphics.placements().is_empty());
        assert!(graphics
            .apc(b"Ga=p,i=6,p=1", (0, 0))
            .unwrap()
            .error
            .is_none());
        graphics.apc(b"Ga=d", (0, 0));
        assert!(graphics.placements().is_empty());
        assert_eq!(
            graphics.apc(b"Ga=p,i=6", (0, 0)).unwrap().error,
            Some("ENOENT")
        );
    }

    #[test]
    fn quiet_modes_suppress_replies() {
        let mut graphics = Graphics::new();
        let raw = b64(&[0, 0, 0, 255]);
        let mut reply = |quiet: u8| {
            graphics
                .apc(
                    &command(&format!("a=t,f=32,i=8,s=1,v=1,q={quiet}"), raw.as_bytes()),
                    (0, 0),
                )
                .unwrap()
        };
        assert!(reply(0).sequence().is_some(), "q=0 answers");
        assert!(reply(1).sequence().is_none(), "q=1 suppresses OK");
        assert!(reply(2).sequence().is_none(), "q=2 suppresses everything");
        // An error still reports at q=1, and q=2 stays silent.
        let mut error =
            |quiet: u8| graphics.apc(format!("Ga=p,i=404,q={quiet}").as_bytes(), (0, 0));
        assert_eq!(error(1).unwrap().error, Some("ENOENT"));
        assert!(error(1).unwrap().sequence().is_some(), "q=1 keeps errors");
        assert!(error(2).unwrap().sequence().is_none());
    }

    #[test]
    fn malformed_and_unsupported_commands_are_rejected() {
        let mut graphics = Graphics::new();
        assert_eq!(
            graphics.apc(b"Ga=t,f=100,i=1;!!!!", (0, 0)).unwrap().error,
            Some("EINVAL")
        );
        assert_eq!(
            graphics.apc(b"Ga=t,f=99,i=1;AAAA", (0, 0)).unwrap().error,
            Some("ENOTSUP")
        );
        assert_eq!(
            graphics
                .apc(b"Ga=t,f=100,i=1,t=f;AAAA", (0, 0))
                .unwrap()
                .error,
            Some("ENOTSUP")
        );
        assert_eq!(graphics.apc(b"Ga=x", (0, 0)).unwrap().error, Some("EINVAL"));
        assert_eq!(
            graphics
                .apc(b"Ga=t,f=32,i=1,s=0,v=1;AA==", (0, 0))
                .unwrap()
                .error,
            Some("EINVAL")
        );
    }

    #[test]
    fn raw_rgba_transmission_is_accepted() {
        let mut graphics = Graphics::new();
        let pixels = [255u8, 0, 0, 255, 0, 255, 0, 255];
        let reply = graphics
            .apc(
                &command("a=T,f=32,i=12,c=2,r=1,s=2,v=1", b64(&pixels).as_bytes()),
                (0, 0),
            )
            .unwrap();
        assert_eq!(reply.error, None);
        let (placement, image) = graphics.placements().pop().unwrap();
        assert_eq!((image.width, image.height), (2, 1));
        assert_eq!(image.rgba, pixels);
        assert_eq!(placement.rect(&image, (12, 24)).width, 24);
    }

    #[test]
    fn png_that_decodes_to_the_wrong_size_is_not_trusted() {
        // Truncated PNG: dimensions parse no further than the header, decode fails.
        let mut graphics = Graphics::new();
        let truncated = &PNG_2X2[..8];
        let reply = graphics
            .apc(
                &command("a=t,f=100,i=20", b64(truncated).as_bytes()),
                (0, 0),
            )
            .unwrap();
        assert_eq!(reply.error, Some("EINVAL"));
        assert!(graphics.placements().is_empty());
    }
}
