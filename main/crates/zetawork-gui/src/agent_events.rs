// SPDX-License-Identifier: AGPL-3.0-only
//! SSE transport for one agent session — std only, no new dependencies.
//!
//! Same shape as `notify.rs`: a hand-written HTTP/1.1 request on a loopback
//! `TcpStream`, then the event stream. Bun answers `ReadableStream` with
//! `Transfer-Encoding: chunked`, so the decoder here handles chunked bodies and
//! falls back to read-to-EOF for a plain one.
//!
//! The thread owns one connection: it streams frames until the server ends the
//! stream, then sends [`Event::Closed`] and exits. A connection that cannot be
//! made (or breaks mid-read) sends [`Event::Failed`] with the transport's own
//! message instead, so the pane can name the reason. Reconnect/backoff belongs
//! to the pane's tick (it can tell Closed from a live stream), so this module
//! never sleeps.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::thread;

use crate::agent::Frame;

/// What the reader saw.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
	Frame(Frame),
	/// The stream ended after the request was accepted (server close or a
	/// non-200 answer). The pane treats this as "disconnected".
	Closed,
	/// The connection itself failed — refused, unresolvable, or cut mid-flight.
	/// Carries the transport's own message so the pane can show a reason.
	Failed(String),
}

/// A live per-session event stream.
pub struct AgentEvents {
	events: Receiver<Event>,
}

impl AgentEvents {
	/// Start reading `{origin}/api/agent/{session}/events`.
	///
	/// `origin` is the loopback URL `stats.rs` already reads from
	/// `~/.zeta/serve.json` (`http://127.0.0.1:PORT`). Only `http://` is
	/// accepted: the shell talks to its own loopback gateway, never TLS.
	pub fn connect(origin: &str, session: &str) -> Result<Self, String> {
		let address = origin
			.strip_prefix("http://")
			.ok_or_else(|| format!("not a loopback origin: {origin}"))?
			.trim_end_matches('/')
			.to_owned();
		let (sender, events) = channel();
		let session = session.to_owned();
		thread::spawn(move || {
			match stream(&address, &session, &sender) {
				Ok(()) => {
					// A closed receiver means the pane is gone; nothing to report then.
					let _ = sender.send(Event::Closed);
				},
				Err(error) => {
					let _ = sender.send(Event::Failed(error.to_string()));
				},
			}
		});
		Ok(Self { events })
	}

	/// Everything that arrived since the last tick.
	pub fn drain(&self) -> Vec<Event> {
		self.events.try_iter().collect()
	}
}

/// One connection: request, headers, body, frames.
fn stream(address: &str, session: &str, sender: &Sender<Event>) -> std::io::Result<()> {
	let mut socket = TcpStream::connect(address)?;
	write!(
		socket,
		"GET /api/agent/{session}/events HTTP/1.1\r\n\
		 Host: {address}\r\n\
		 Accept: text/event-stream\r\n\
		 Connection: keep-alive\r\n\r\n"
	)?;
	let mut reader = BufReader::new(socket);

	// Response head.
	let mut status = String::new();
	reader.read_line(&mut status)?;
	if !status.starts_with("HTTP/1.1 200") && !status.starts_with("HTTP/1.0 200") {
		return Ok(());
	}
	let mut chunked = false;
	loop {
		let mut line = String::new();
		if reader.read_line(&mut line)? == 0 {
			return Ok(());
		}
		let line = line.trim_end_matches(['\r', '\n']);
		if line.is_empty() {
			break;
		}
		if let Some((name, value)) = line.split_once(':') {
			if name.eq_ignore_ascii_case("transfer-encoding")
				&& value.to_ascii_lowercase().contains("chunked")
			{
				chunked = true;
			}
		}
	}

	let mut body: Box<dyn BufRead> = if chunked {
		Box::new(BufReader::new(Chunked::new(reader)))
	} else {
		Box::new(reader)
	};

	// SSE frames: accumulate `data:` lines until a blank line.
	let mut payload = String::new();
	loop {
		let mut line = String::new();
		if body.read_line(&mut line)? == 0 {
			break;
		}
		let line = line.trim_end_matches(['\r', '\n']);
		if line.is_empty() {
			if !payload.is_empty() {
				if let Some(frame) = crate::agent::parse_frame(&payload) {
					if sender.send(Event::Frame(frame)).is_err() {
						return Ok(());
					}
				}
				payload.clear();
			}
			continue;
		}
		if let Some(data) = line.strip_prefix("data:") {
			if !payload.is_empty() {
				payload.push('\n');
			}
			payload.push_str(data.trim_start());
		}
		// `id:` and `:comment` lines carry nothing this pane needs.
	}
	Ok(())
}

/// A `Read` over an HTTP/1.1 chunked body.
struct Chunked<R: BufRead> {
	inner: R,
	remaining: usize,
	done: bool,
}

impl<R: BufRead> Chunked<R> {
	fn new(inner: R) -> Self {
		Self { inner, remaining: 0, done: false }
	}
}

impl<R: BufRead> Read for Chunked<R> {
	/// Reads are line-oriented here: the SSE consumer only asks for lines, so a
	/// chunk boundary inside a line is handled by returning what is available.
	fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
		if self.done || out.is_empty() {
			return Ok(0);
		}
		if self.remaining == 0 {
			let mut size_line = String::new();
			if self.inner.read_line(&mut size_line)? == 0 {
				self.done = true;
				return Ok(0);
			}
			let size = usize::from_str_radix(size_line.trim().split(';').next().unwrap_or("0"), 16)
				.unwrap_or(0);
			if size == 0 {
				// Trailer section, then EOF.
				let mut trailer = String::new();
				let _ = self.inner.read_line(&mut trailer);
				self.done = true;
				return Ok(0);
			}
			self.remaining = size;
		}
		let take = out.len().min(self.remaining);
		let read = self.inner.read(&mut out[..take])?;
		self.remaining = self.remaining.saturating_sub(read);
		if self.remaining == 0 {
			// Consume the CRLF that ends the chunk.
			let mut crlf = String::new();
			let _ = self.inner.read_line(&mut crlf);
		}
		Ok(read)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::Read;
	use std::net::TcpListener;
	use std::time::{Duration, Instant};

	/// One fake SSE endpoint: answers the request with a chunked stream carrying
	/// `frames`, then closes.
	fn serve_once(frames: &'static str) -> String {
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
		let address = listener.local_addr().expect("addr").to_string();
		thread::spawn(move || {
			let (mut socket, _) = listener.accept().expect("accept");
			let mut request = [0u8; 1024];
			let _ = socket.read(&mut request);
			let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n";
			socket.write_all(head.as_bytes()).expect("head");
			let chunk = format!("{:x}\r\n{frames}\r\n0\r\n\r\n", frames.len());
			socket.write_all(chunk.as_bytes()).expect("chunk");
			// Let the bytes reach the client before the socket goes away: a bare
			// drop on Windows resets the connection and the frames are lost.
			let _ = socket.shutdown(std::net::Shutdown::Write);
			thread::sleep(std::time::Duration::from_millis(200));
		});
		address
	}

	fn collect(address: &str) -> Vec<Event> {
		let events = AgentEvents::connect(&format!("http://{address}"), "s1").expect("connect");
		let deadline = Instant::now() + Duration::from_secs(3);
		let mut seen = Vec::new();
		while Instant::now() < deadline {
			seen.extend(events.drain());
			if seen.contains(&Event::Closed) {
				break;
			}
			thread::sleep(Duration::from_millis(10));
		}
		seen
	}

	#[test]
	fn a_chunked_stream_yields_its_frames_and_then_closes() {
		let address = serve_once(
			"data: {\"type\":\"connected\",\"sessionId\":\"s1\"}\n\ndata: {\"type\":\"running\"}\n\n",
		);
		let seen = collect(&address);
		assert!(seen.contains(&Event::Frame(Frame::Connected)), "{seen:?}");
		assert!(seen.contains(&Event::Frame(Frame::Running(true))), "{seen:?}");
		assert_eq!(seen.last(), Some(&Event::Closed), "{seen:?}");
	}

	#[test]
	fn a_non_200_answer_closes_without_frames() {
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
		let address = listener.local_addr().expect("addr").to_string();
		thread::spawn(move || {
			let (mut socket, _) = listener.accept().expect("accept");
			let mut request = [0u8; 1024];
			let _ = socket.read(&mut request);
			socket
				.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
				.expect("answer");
			// Keep the socket alive long enough for the client to read the
			// answer: a bare drop on Windows can reset the connection first.
			let _ = socket.shutdown(std::net::Shutdown::Write);
			thread::sleep(std::time::Duration::from_millis(200));
		});
		let seen = collect(&address);
		assert_eq!(seen, vec![Event::Closed]);
	}
}
