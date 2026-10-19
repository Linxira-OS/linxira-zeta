// SPDX-License-Identifier: AGPL-3.0-only
//! A minimal WebSocket client over `std::net::TcpStream` — no new dependencies.
//!
//! The gateway's terminal data plane is a WebSocket (`GET
//! /api/terminal/:id/ws`), and this crate already speaks HTTP/1.1 by hand for
//! SSE ([`crate::agent_events`]) and the notification POST. A full client crate
//! would be a large tree for one loopback socket, so this module implements the
//! minimum the terminal pane needs:
//!
//! * the HTTP/1.1 upgrade (`Sec-WebSocket-Key`, a checked `101` answer and the
//!   `Sec-WebSocket-Accept` hash; SHA-1 and base64 are written out here too);
//! * client frames, always masked, for text (stdin);
//! * server frames — text, binary, continuation, ping, pong and close — with
//!   fragmented messages reassembled and pings answered from the reader;
//! * a reader thread that reports [`Event::Opened`], [`Event::Binary`],
//!   [`Event::Closed`] and [`Event::Failed`] over an `mpsc` channel, exactly
//!   the shape [`crate::agent_events`] uses.
//!
//! The thread owns one connection. A handshake that cannot be made is a
//! `Failed` with the transport's own message, so the pane can name the reason
//! and fall back to its in-process PTY. Loopback only: the gateway holds the
//! PTY, and this client never speaks TLS.

use crate::t;
use std::{
	io::{BufRead, BufReader, Read, Write},
	net::{SocketAddr, TcpStream, ToSocketAddrs},
	sync::{
		Arc, Mutex,
		atomic::{AtomicU64, Ordering},
		mpsc::{Receiver, Sender, channel},
	},
	thread,
	time::{Duration, SystemTime, UNIX_EPOCH},
};

/// How long the upgrade may take before it is a fallback, not a terminal.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);
/// A write to the loopback gateway that takes longer than this is wedged.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
/// Client payloads larger than this are not a terminal's stdin.
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

/// The RFC 6455 GUID appended to `Sec-WebSocket-Key`.
const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// What the reader saw.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
	/// The upgrade succeeded; the socket is live.
	Opened,
	/// One complete data message (text or binary). The terminal protocol sends
	/// binary, and a text answer is returned as its UTF-8 bytes unchanged.
	Binary(Vec<u8>),
	/// The server closed the socket (or EOF arrived) after it was live.
	Closed,
	/// The connection itself failed — refused, unresolvable, a non-101 answer,
	/// a bad frame, or a cut mid-read. Carries the transport's reason.
	Failed(String),
}

/// The sending half. Cloned cheaply; all writes share one socket.
#[derive(Clone)]
pub struct Client {
	writer: Arc<Mutex<TcpStream>>,
}

impl Client {
	/// Send `text` as one masked text frame (the terminal protocol's stdin).
	pub fn send_text(&self, text: &str) -> Result<(), String> {
		let frame = client_frame(0x1, text.as_bytes());
		let mut stream = self
			.writer
			.lock()
			.map_err(|_| t!("WebSocket 写锁已中毒").to_owned())?;
		stream
			.write_all(&frame)
			.map_err(|error| t!("写入 WebSocket 失败：{}", error))
	}

	/// Close the socket: a close frame when the stream still accepts it, then
	/// `shutdown` so the reader thread's blocking read returns instead of
	/// keeping a closed pane's connection alive.
	pub fn close(&self) -> Result<(), String> {
		let mut stream = self
			.writer
			.lock()
			.map_err(|_| t!("WebSocket 写锁已中毒").to_owned())?;
		let _ = stream.write_all(&client_frame(0x8, &[]));
		stream
			.shutdown(std::net::Shutdown::Both)
			.map_err(|error| t!("关闭 WebSocket 失败：{}", error))
	}
}

/// Dial `origin` (`http://127.0.0.1:PORT`) and upgrade to `path`.
///
/// The handshake runs on the calling thread; the caller (the terminal attach
/// thread) is what keeps it off the UI thread. On success the reader thread is
/// already running and the channel's first event is [`Event::Opened`].
pub fn connect(origin: &str, path: &str) -> Result<(Client, Receiver<Event>), String> {
	let (host, port, authority) = origin_endpoint(origin)?;
	let mut stream = dial(&host, port, HANDSHAKE_TIMEOUT)?;
	stream
		.set_read_timeout(Some(HANDSHAKE_TIMEOUT))
		.map_err(|error| t!("设置握手读超时失败：{}", error))?;
	stream
		.set_write_timeout(Some(HANDSHAKE_TIMEOUT))
		.map_err(|error| t!("设置握手写超时失败：{}", error))?;

	let key = base64(&random_key());
	let request = format!(
		"GET {path} HTTP/1.1\r\nHost: {authority}\r\nUpgrade: websocket\r\nConnection: \
		 Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
	);
	stream
		.write_all(request.as_bytes())
		.map_err(|error| t!("发送 WebSocket 握手失败：{}", error))?;
	let mut reader = BufReader::new(
		stream
			.try_clone()
			.map_err(|error| t!("复制 WebSocket 套接字失败：{}", error))?,
	);
	handshake(&mut reader, &key)?;

	// The reader blocks until the gateway speaks; a read timeout here would
	// turn an idle terminal into a stream of failures.
	stream
		.set_read_timeout(None)
		.map_err(|error| t!("清除读超时失败：{}", error))?;
	stream
		.set_write_timeout(Some(WRITE_TIMEOUT))
		.map_err(|error| t!("设置写超时失败：{}", error))?;

	let writer = Arc::new(Mutex::new(stream));
	let (sender, events) = channel();
	// The pane treats `Opened` as "the socket is live"; sending before the
	// reader starts means it can never be missed.
	let _ = sender.send(Event::Opened);
	spawn_reader(reader, Arc::clone(&writer), sender);
	Ok((Client { writer }, events))
}

/// `(host, port, authority)` for an `http://` origin. Only plain HTTP: the
/// gateway is loopback and this crate has no TLS client.
pub(crate) fn origin_endpoint(origin: &str) -> Result<(String, u16, String), String> {
	let rest = origin
		.strip_prefix("http://")
		.ok_or_else(|| t!("{} 不是 http:// 地址（本机网关不走 TLS）", origin))?;
	let authority = rest.trim_end_matches('/').split('/').next().unwrap_or(rest);
	if authority.is_empty() {
		return Err(t!("{} 没有主机名", origin));
	}
	let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
		let (host, tail) = inner
			.split_once(']')
			.ok_or_else(|| t!("{} 的 IPv6 地址不完整", origin))?;
		let port = match tail.strip_prefix(':') {
			Some(port) => port.parse().map_err(|_| t!("{} 的端口不是数字", origin))?,
			None => 80,
		};
		(host.to_owned(), port)
	} else if let Some((host, port)) = authority.rsplit_once(':') {
		let port = port.parse().map_err(|_| t!("{} 的端口不是数字", origin))?;
		(host.to_owned(), port)
	} else {
		(authority.to_owned(), 80)
	};
	Ok((host, port, authority.to_owned()))
}

/// Connect to the first address the name resolves to that accepts, within
/// `timeout`.
pub(crate) fn dial(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, String> {
	let addresses: Vec<SocketAddr> = (host, port)
		.to_socket_addrs()
		.map_err(|error| t!("解析 {}:{} 失败：{}", host, port, error))?
		.collect();
	if addresses.is_empty() {
		return Err(t!("{}:{} 没有可用地址", host, port));
	}
	let mut last = None;
	for address in addresses {
		match TcpStream::connect_timeout(&address, timeout) {
			Ok(stream) => return Ok(stream),
			Err(error) => last = Some(error),
		}
	}
	let error = last.map(|error| error.to_string()).unwrap_or_default();
	Err(t!("连接 {}:{} 失败：{}", host, port, error))
}

/// Validate the `101` answer and the accept hash; a `403`/`404` is reported
/// with its status line so the pane can say what serve answered.
fn handshake(reader: &mut BufReader<TcpStream>, key: &str) -> Result<(), String> {
	let mut status = String::new();
	reader
		.read_line(&mut status)
		.map_err(|error| t!("读取 WebSocket 握手应答失败：{}", error))?;
	if status.is_empty() {
		return Err(t!("WebSocket 握手没有应答").to_owned());
	}
	if !status.contains(" 101 ") {
		return Err(t!("serve 拒绝 WebSocket 升级：{}", status.trim()));
	}
	let expected = accept_for(key);
	let mut upgrade = false;
	let mut connection = false;
	let mut accept = None;
	loop {
		let mut line = String::new();
		if reader
			.read_line(&mut line)
			.map_err(|error| t!("读取 WebSocket 握手头失败：{}", error))?
			== 0
		{
			return Err(t!("WebSocket 握手头提前结束").to_owned());
		}
		let line = line.trim_end_matches(['\r', '\n']);
		if line.is_empty() {
			break;
		}
		if let Some((name, value)) = line.split_once(':') {
			let value = value.trim();
			if name.eq_ignore_ascii_case("upgrade") {
				upgrade = value.eq_ignore_ascii_case("websocket");
			} else if name.eq_ignore_ascii_case("connection") {
				connection = value
					.split(',')
					.any(|token| token.trim().eq_ignore_ascii_case("upgrade"));
			} else if name.eq_ignore_ascii_case("sec-websocket-accept") {
				accept = Some(value.to_owned());
			}
		}
	}
	if !upgrade {
		return Err(t!("serve 的握手应答缺少 Upgrade: websocket").to_owned());
	}
	if !connection {
		return Err(t!("serve 的握手应答缺少 Connection: Upgrade").to_owned());
	}
	match accept {
		Some(accept) if accept == expected => Ok(()),
		Some(_) => Err(t!("serve 的 Sec-WebSocket-Accept 与客户端密钥不匹配").to_owned()),
		None => Err(t!("serve 的握手应答缺少 Sec-WebSocket-Accept").to_owned()),
	}
}

/// The reader thread: pump frames until the socket ends.
fn spawn_reader(
	mut reader: BufReader<TcpStream>,
	writer: Arc<Mutex<TcpStream>>,
	sender: Sender<Event>,
) {
	thread::spawn(move || {
		let outcome = pump(&mut reader, &writer, &sender);
		let event = match outcome {
			Ok(()) => Event::Closed,
			Err(reason) => Event::Failed(reason),
		};
		let _ = sender.send(event);
	});
}

/// One connection's frame loop. A close frame is echoed and ends the stream;
/// a ping is answered; a fragmented data message is reassembled before it is
/// handed to the pane.
fn pump(
	reader: &mut BufReader<TcpStream>,
	writer: &Arc<Mutex<TcpStream>>,
	sender: &Sender<Event>,
) -> Result<(), String> {
	let mut fragment: Option<(u8, Vec<u8>)> = None;
	loop {
		if reader
			.fill_buf()
			.map_err(|error| t!("读取 WebSocket 失败：{}", error))?
			.is_empty()
		{
			return Ok(());
		}
		let frame = parse_server_frame(reader)?;
		match frame.opcode {
			// Continuation: append to the message being assembled.
			0 => {
				let Some((start, mut payload)) = fragment.take() else {
					return Err(t!("收到没有起始帧的 continuation").to_owned());
				};
				payload.extend_from_slice(&frame.payload);
				if frame.fin {
					if sender.send(Event::Binary(payload)).is_err() {
						return Ok(());
					}
				} else {
					fragment = Some((start, payload));
				}
			},
			1 | 2 => {
				if fragment.is_some() {
					return Err(t!("上一条分片消息尚未结束").to_owned());
				}
				if frame.fin {
					if sender.send(Event::Binary(frame.payload)).is_err() {
						return Ok(());
					}
				} else {
					fragment = Some((frame.opcode, frame.payload));
				}
			},
			8 => {
				let _ = write_frame(writer, 0x8, &frame.payload);
				return Ok(());
			},
			9 => write_frame(writer, 0xa, &frame.payload)?,
			10 => {},
			other => return Err(t!("不支持的 WebSocket opcode {}", other)),
		}
	}
}

/// One parsed frame; the payload still carries the server's (normally absent)
/// mask removed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Frame {
	pub fin: bool,
	pub opcode: u8,
	pub payload: Vec<u8>,
}

/// Parse one frame from `reader`, rejecting opcodes with no meaning here.
pub(crate) fn parse_server_frame<R: Read>(reader: &mut R) -> Result<Frame, String> {
	let mut head = [0u8; 2];
	reader
		.read_exact(&mut head)
		.map_err(|error| t!("读取 WebSocket 帧头失败：{}", error))?;
	let fin = head[0] & 0x80 != 0;
	let opcode = head[0] & 0x0f;
	let masked = head[1] & 0x80 != 0;
	let len = u64::from(head[1] & 0x7f);
	let len = match len {
		126 => {
			let mut bytes = [0u8; 2];
			reader
				.read_exact(&mut bytes)
				.map_err(|error| t!("读取 WebSocket 帧长失败：{}", error))?;
			u64::from(u16::from_be_bytes(bytes))
		},
		127 => {
			let mut bytes = [0u8; 8];
			reader
				.read_exact(&mut bytes)
				.map_err(|error| t!("读取 WebSocket 帧长失败：{}", error))?;
			u64::from_be_bytes(bytes)
		},
		len => len,
	};
	if len > MAX_FRAME_BYTES as u64 {
		return Err(t!("WebSocket 帧过大：{} 字节", len));
	}
	if !matches!(opcode, 0 | 1 | 2 | 8 | 9 | 10) {
		return Err(t!("不支持的 WebSocket opcode {}", opcode));
	}
	let mask = if masked {
		let mut mask = [0u8; 4];
		reader
			.read_exact(&mut mask)
			.map_err(|error| t!("读取 WebSocket 掩码失败：{}", error))?;
		Some(mask)
	} else {
		None
	};
	let mut payload = vec![0u8; len as usize];
	reader
		.read_exact(&mut payload)
		.map_err(|error| t!("读取 WebSocket 载荷失败：{}", error))?;
	if let Some(mask) = mask {
		for (index, byte) in payload.iter_mut().enumerate() {
			*byte ^= mask[index % 4];
		}
	}
	Ok(Frame { fin, opcode, payload })
}

/// One masked client frame (RFC 6455 §5.3): a client MUST mask.
pub(crate) fn client_frame(opcode: u8, payload: &[u8]) -> Vec<u8> {
	let mask = mask_key();
	let mut frame = Vec::with_capacity(payload.len() + 14);
	frame.push(0x80 | opcode);
	let len = payload.len();
	if len < 126 {
		frame.push(0x80 | len as u8);
	} else if len <= u16::MAX as usize {
		frame.push(0x80 | 126);
		frame.extend_from_slice(&(len as u16).to_be_bytes());
	} else {
		frame.push(0x80 | 127);
		frame.extend_from_slice(&(len as u64).to_be_bytes());
	}
	frame.extend_from_slice(&mask);
	frame.extend(
		payload
			.iter()
			.enumerate()
			.map(|(index, byte)| byte ^ mask[index % 4]),
	);
	frame
}

/// Write one masked frame under the shared writer lock, so a pong answered by
/// the reader cannot interleave with stdin from the writer thread.
fn write_frame(writer: &Arc<Mutex<TcpStream>>, opcode: u8, payload: &[u8]) -> Result<(), String> {
	let frame = client_frame(opcode, payload);
	let mut stream = writer
		.lock()
		.map_err(|_| t!("WebSocket 写锁已中毒").to_owned())?;
	stream
		.write_all(&frame)
		.map_err(|error| t!("写入 WebSocket 失败：{}", error))
}

/// `Sec-WebSocket-Accept` for a client key (RFC 6455 §4.2.2).
pub(crate) fn accept_for(key: &str) -> String {
	base64(&sha1(format!("{key}{WS_GUID}").as_bytes()))
}

/// 16 bytes of key material. A handshake nonce needs uniqueness, not secrecy:
/// the mask and the accept hash only defend against cross-protocol caches.
fn random_key() -> [u8; 16] {
	static COUNTER: AtomicU64 = AtomicU64::new(0);
	let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
	let now = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_nanos() as u64)
		.unwrap_or(0);
	let seed = now ^ counter.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ u64::from(std::process::id());
	let mut key = [0u8; 16];
	for (index, byte) in key.iter_mut().enumerate() {
		let shift = (index % 8) * 8;
		*byte = (seed.rotate_left((index as u32) * 7) >> shift) as u8;
	}
	key
}

/// The per-frame mask key. Randomness is not a security property here — the
/// socket is loopback — but the form the RFC requires is a non-zero-looking
/// 32-bit value, and the time/counter mix gives that without a `rand` crate.
fn mask_key() -> [u8; 4] {
	static COUNTER: AtomicU64 = AtomicU64::new(0);
	let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
	let now = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_nanos() as u64)
		.unwrap_or(0);
	let seed = now ^ counter.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ u64::from(std::process::id());
	let folded = (seed as u32) ^ (seed >> 32) as u32;
	let folded = if folded == 0 { 1 } else { folded };
	folded.to_le_bytes()
}

/// Base64 (RFC 4648, padded) for the key and the accept hash.
fn base64(bytes: &[u8]) -> String {
	const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
	for chunk in bytes.chunks(3) {
		let first = u32::from(chunk[0]);
		let second = chunk.get(1).copied().map(u32::from);
		let third = chunk.get(2).copied().map(u32::from);
		let triple = (first << 16) | (second.unwrap_or(0) << 8) | third.unwrap_or(0);
		out.push(TABLE[(triple >> 18) as usize & 0x3f] as char);
		out.push(TABLE[(triple >> 12) as usize & 0x3f] as char);
		if second.is_some() {
			out.push(TABLE[(triple >> 6) as usize & 0x3f] as char);
		} else {
			out.push('=');
		}
		if third.is_some() {
			out.push(TABLE[triple as usize & 0x3f] as char);
		} else {
			out.push('=');
		}
	}
	out
}

/// SHA-1 (FIPS 180-1), written out because the accept hash is the only use.
fn sha1(data: &[u8]) -> [u8; 20] {
	let mut state = [0x6745_2301u32, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476, 0xc3d2_e1f0];
	let mut message = data.to_vec();
	let bit_len = (data.len() as u64) * 8;
	message.push(0x80);
	while message.len() % 64 != 56 {
		message.push(0);
	}
	message.extend_from_slice(&bit_len.to_be_bytes());

	for chunk in message.chunks(64) {
		let mut words = [0u32; 80];
		for (index, word) in words.iter_mut().take(16).enumerate() {
			let at = index * 4;
			*word = u32::from_be_bytes([chunk[at], chunk[at + 1], chunk[at + 2], chunk[at + 3]]);
		}
		for index in 16..80 {
			words[index] =
				(words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16])
					.rotate_left(1);
		}
		let [mut a, mut b, mut c, mut d, mut e] = state;
		for (index, word) in words.iter().enumerate() {
			let (f, k) = match index {
				0..=19 => ((b & c) | ((!b) & d), 0x5a82_7999),
				20..=39 => (b ^ c ^ d, 0x6ed9_eba1),
				40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1b_bcdc),
				_ => (b ^ c ^ d, 0xca62_c1d6),
			};
			let temp = a
				.rotate_left(5)
				.wrapping_add(f)
				.wrapping_add(e)
				.wrapping_add(k)
				.wrapping_add(*word);
			e = d;
			d = c;
			c = b.rotate_left(30);
			b = a;
			a = temp;
		}
		state[0] = state[0].wrapping_add(a);
		state[1] = state[1].wrapping_add(b);
		state[2] = state[2].wrapping_add(c);
		state[3] = state[3].wrapping_add(d);
		state[4] = state[4].wrapping_add(e);
	}

	let mut digest = [0u8; 20];
	for (index, word) in state.iter().enumerate() {
		digest[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
	}
	digest
}

#[cfg(test)]
mod tests {
	use std::io::Cursor;

	use super::*;

	#[test]
	fn a_masked_client_frame_round_trips_through_the_parser() {
		let payload = b"ls -la\r";
		let frame = client_frame(0x1, payload);
		assert_eq!(frame[1] & 0x80, 0x80, "a client frame is masked");
		assert_ne!(
			&frame[frame.len() - payload.len()..],
			payload,
			"the payload is masked on the wire"
		);
		let parsed = parse_server_frame(&mut Cursor::new(frame)).expect("parse a client frame");
		assert!(parsed.fin);
		assert_eq!(parsed.opcode, 1);
		assert_eq!(parsed.payload, payload);
	}

	#[test]
	fn server_text_binary_ping_and_close_parse() {
		let server_frame = |fin: bool, opcode: u8, payload: &[u8]| {
			let mut frame = Vec::new();
			frame.push(if fin { 0x80 | opcode } else { opcode });
			assert!(payload.len() < 126);
			frame.push(payload.len() as u8);
			frame.extend_from_slice(payload);
			frame
		};

		let text = parse_server_frame(&mut Cursor::new(server_frame(true, 1, b"hi"))).expect("text");
		assert_eq!((text.opcode, text.payload.as_slice()), (1, b"hi".as_slice()));
		let binary =
			parse_server_frame(&mut Cursor::new(server_frame(true, 2, b"\x00{}"))).expect("binary");
		assert_eq!((binary.opcode, binary.payload.as_slice()), (2, b"\x00{}".as_slice()));
		let ping = parse_server_frame(&mut Cursor::new(server_frame(true, 9, b"p"))).expect("ping");
		assert_eq!((ping.opcode, ping.payload.as_slice()), (9, b"p".as_slice()));
		let close = parse_server_frame(&mut Cursor::new(server_frame(true, 8, b""))).expect("close");
		assert_eq!(close.opcode, 8);
		let fragment =
			parse_server_frame(&mut Cursor::new(server_frame(false, 2, b"part"))).expect("fragment");
		assert!(!fragment.fin, "a continuation start says so");
	}

	#[test]
	fn an_unknown_opcode_is_rejected() {
		// Opcode 3 has no meaning in RFC 6455 and must never reach the pane.
		let frame = [0x83, 0x00];
		let error = parse_server_frame(&mut Cursor::new(frame)).expect_err("bad opcode");
		assert!(error.contains("opcode"), "{error}");
	}

	#[test]
	fn the_accept_hash_matches_the_rfc_6455_example() {
		// RFC 6455 §1.3: the sample key and its SHA-1/base64 answer.
		assert_eq!(accept_for("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
	}

	#[test]
	fn an_origin_needs_plain_http_and_a_port_is_defaulted() {
		assert_eq!(
			origin_endpoint("http://127.0.0.1:30141").expect("loopback"),
			("127.0.0.1".to_owned(), 30141, "127.0.0.1:30141".to_owned())
		);
		assert_eq!(
			origin_endpoint("http://localhost:30141/").expect("trailing slash"),
			("localhost".to_owned(), 30141, "localhost:30141".to_owned())
		);
		assert_eq!(
			origin_endpoint("http://[::1]:30141").expect("ipv6"),
			("::1".to_owned(), 30141, "[::1]:30141".to_owned())
		);
		assert!(origin_endpoint("https://127.0.0.1:30141").is_err());
	}
}
