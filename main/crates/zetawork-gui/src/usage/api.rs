// SPDX-License-Identifier: AGPL-3.0-only
//! The JSON the stats server answers, and the one HTTP call that fetches it.
//!
//! # What the live server actually answers (observed 2026-10-18)
//!
//! `zetacode serve` was listening on `http://127.0.0.1:3847` while this module
//! was written, and the three requests below were captured verbatim into
//! `src/usage/fixtures/`. Their shape is also the shape
//! `packages/stats/src/aggregator.ts` + `rollup.ts` produce, so a future
//! server keeps decoding even if the checked-in fixture goes stale:
//!
//! ```text
//! GET /api/status
//! {"version":4,"sync":{"phase":"idle","current":158,"total":158,"processed":0,
//!  "lastSyncedAt":1792306827469,"error":null},"indexingHours":0}
//!
//! GET /api/stats/overview?range=24h
//! {"overall":{"totalRequests":2,"successfulRequests":2,"failedRequests":0,
//!  "errorRate":0,"totalInputTokens":2000000,"totalOutputTokens":0,
//!  "totalCacheReadTokens":0,"totalCacheWriteTokens":0,"cacheRate":0,
//!  "cacheSavings":0,"totalCost":6,"unpricedRequests":0,
//!  "totalPremiumRequests":0,"avgDuration":1000,"avgTtft":100,"avgTokensPerSecond":0,
//!  "firstTimestamp":1796111999999,"lastTimestamp":1796112000000},
//!  "byAgentType":[{"agentType":"main","totalRequests":2,"totalInputTokens":2000000,
//!  "totalOutputTokens":0,"totalCacheReadTokens":0,"totalCacheWriteTokens":0,
//!  "totalCost":6}],
//!  "timeSeries":[{"timestamp":1796108400000,"requests":1,"errors":0,
//!  "tokens":1000000,"cost":2},{"timestamp":1796112000000,"requests":1,
//!  "errors":0,"tokens":1000000,"cost":4}]}
//!
//! GET /api/stats/costs?range=24h
//! {"costSeries":[{"timestamp":1796083200000,"model":"dated-card-model",
//!  "provider":"google-antigravity","cost":6,"unpricedRequests":0,"costInput":6,
//!  "costOutput":0,"costCacheRead":0,"costCacheWrite":0,"requests":2}]}
//! ```
//!
//! `range` is one of `1h`, `24h`, `7d`, `30d`, `90d`, `all`
//! (`getTimeRangeConfig` in `aggregator.ts`); the panel offers 24h / 7d / 30d.
//! `timeSeries` carries only buckets that have rows, so the chart closes the
//! gaps itself (see [`crate::usage::bars`]).
//!
//! # Fetching
//!
//! This crate has no HTTP client, and one loopback `GET` does not justify
//! adding one — the same trade [`crate::stats`] makes for `serve.json` and
//! [`crate::notify`] for its gateway `POST`. [`get`] speaks HTTP/1.1 over
//! `std::net::TcpStream`, accepts only `http` on a loopback host (the same
//! addresses [`crate::stats::StatsEndpoint::is_loopback`] allows), and reads to
//! EOF because every request sends `Connection: close`.
//!
//! Nothing here invents a value: a missing field decodes to its zero/`None`,
//! a non-JSON body is an error, and [`FetchError::Connect`] is the one outcome
//! the panel renders as “stats 服务未启动”.

use crate::t;
use std::{
	io::{Read as _, Write as _},
	net::ToSocketAddrs as _,
	time::{Duration, SystemTime},
};

use serde_json::{Map, Value};

/// The server's sync status.
pub const STATUS_PATH: &str = "/api/status";
/// The aggregate the panel's cards, chart and table read.
pub const OVERVIEW_PATH: &str = "/api/stats/overview";
/// The per-model cost breakdown.
pub const COSTS_PATH: &str = "/api/stats/costs";

/// How long one loopback request may take, including connect.
const TIMEOUT: Duration = Duration::from_secs(2);

/// The range selector's three windows, mapped to the query values
/// `getTimeRangeConfig` understands.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Range {
	/// `?range=24h` — hour buckets.
	#[default]
	Today,
	/// `?range=7d` — day buckets.
	SevenDays,
	/// `?range=30d` — day buckets.
	ThirtyDays,
}

impl Range {
	/// Selector order.
	pub const ALL: [Range; 3] = [Range::Today, Range::SevenDays, Range::ThirtyDays];

	/// The button label.
	pub fn label(self) -> &'static str {
		match self {
			Range::Today => t!("今天"),
			Range::SevenDays => t!("7 天"),
			Range::ThirtyDays => t!("30 天"),
		}
	}

	/// The `range` query value.
	pub fn query(self) -> &'static str {
		match self {
			Range::Today => "24h",
			Range::SevenDays => "7d",
			Range::ThirtyDays => "30d",
		}
	}

	/// The window in words, for the chart's title.
	pub fn window(self) -> &'static str {
		match self {
			Range::Today => t!("近 24 小时"),
			Range::SevenDays => t!("近 7 天"),
			Range::ThirtyDays => t!("近 30 天"),
		}
	}

	/// The bucket width the server groups with (`TIME_RANGES` in
	/// `aggregator.ts`): one hour for 24h, one day for 7d and 30d.
	pub fn bucket_ms(self) -> i64 {
		match self {
			Range::Today => 3_600_000,
			Range::SevenDays | Range::ThirtyDays => 86_400_000,
		}
	}
}

/// The aggregate behind the cards, the table (per agent type) and the chart.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Overview {
	pub overall: Overall,
	pub by_agent_type: Vec<AgentTypeRow>,
	pub time_series: Vec<SeriesPoint>,
}

impl Overview {
	/// True when the range has no rows at all; the panel then draws the
	/// server's zeros and says the range is empty instead of inventing a row.
	pub fn is_empty(&self) -> bool {
		self.overall.total_requests == 0
			&& self.by_agent_type.is_empty()
			&& self.time_series.is_empty()
	}
}

/// `overall` in `/api/stats/overview` (`AggregatedStats` in `shared-types.ts`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Overall {
	pub total_requests: u64,
	pub successful_requests: u64,
	pub failed_requests: u64,
	pub error_rate: f64,
	pub total_input_tokens: u64,
	pub total_output_tokens: u64,
	pub total_cache_read_tokens: u64,
	pub total_cache_write_tokens: u64,
	pub total_cost: f64,
	pub unpriced_requests: u64,
	pub avg_duration_ms: Option<f64>,
	pub avg_ttft_ms: Option<f64>,
	pub avg_tokens_per_second: Option<f64>,
	pub first_timestamp: Option<i64>,
	pub last_timestamp: Option<i64>,
}

/// One row of `byAgentType`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AgentTypeRow {
	pub agent_type: String,
	pub total_requests: u64,
	pub total_input_tokens: u64,
	pub total_output_tokens: u64,
	pub total_cache_read_tokens: u64,
	pub total_cache_write_tokens: u64,
	pub total_cost: f64,
}

/// One bucket of `timeSeries`. The server only returns buckets that have rows.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SeriesPoint {
	pub timestamp: i64,
	pub requests: u64,
	pub errors: u64,
	pub tokens: u64,
	pub cost: f64,
}

/// `/api/stats/costs`: one day per model and provider.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Costs {
	pub rows: Vec<CostRow>,
}

/// One row of `costSeries`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CostRow {
	pub timestamp: i64,
	pub model: String,
	pub provider: String,
	pub cost: f64,
	pub unpriced_requests: u64,
	pub cost_input: f64,
	pub cost_output: f64,
	pub cost_cache_read: f64,
	pub cost_cache_write: f64,
	pub requests: u64,
}

/// `/api/status`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ServiceStatus {
	pub version: u64,
	pub sync: SyncState,
	pub indexing_hours: f64,
}

/// The `sync` object of `/api/status`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SyncState {
	pub phase: String,
	pub current: u64,
	pub total: u64,
	pub last_synced_at: Option<i64>,
	pub error: Option<String>,
}

/// One complete answer: the three payloads read together, the range they
/// describe, and when they landed.
#[derive(Clone, Debug)]
pub struct Snapshot {
	pub overview: Overview,
	pub costs: Option<Costs>,
	pub status: Option<ServiceStatus>,
	pub range: Range,
	pub fetched_at: SystemTime,
}

/// Why a fetch produced no answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FetchError {
	/// The address is not an `http` loopback origin this client may read.
	Address(String),
	/// `TcpStream` could not reach the listener — the server is not running.
	Connect(String),
	/// The connection opened but the exchange failed.
	Io(String),
	/// A non-200 answer, with the status code and the start of its body.
	Status(u16, String),
	/// A 200 whose body is not the expected JSON.
	Decode(String),
}

impl FetchError {
	/// True when nothing is listening: the panel's single “服务未启动” line.
	pub fn is_absent(&self) -> bool {
		matches!(self, Self::Connect(_))
	}

	/// One line naming the failure without inventing a reason.
	pub fn message(&self) -> String {
		match self {
			Self::Address(why) => t!("地址不可读取：{}", why),
			Self::Connect(why) => t!("连接失败：{}", why),
			Self::Io(why) => t!("读取应答失败：{}", why),
			Self::Status(code, body) if body.is_empty() => t!("stats 返回 HTTP {}", code),
			Self::Status(code, body) => t!("stats 返回 HTTP {}：{}", code, body),
			Self::Decode(why) => t!("stats 应答无法解析：{}", why),
		}
	}
}

/// Fetch the three endpoints for `range`, waiting at most [`TIMEOUT`] each.
///
/// The overview is required; `/api/status` and `/api/stats/costs` only add
/// detail, so their failure does not blank the panel.
pub fn load(origin: &str, range: Range) -> Result<Snapshot, FetchError> {
	let overview_body = get(origin, &query_path(OVERVIEW_PATH, range.query()))?;
	let overview = decode_overview(&overview_body).map_err(FetchError::Decode)?;
	let costs = get(origin, &query_path(COSTS_PATH, range.query()))
		.ok()
		.and_then(|body| decode_costs(&body).ok());
	let status = get(origin, STATUS_PATH)
		.ok()
		.and_then(|body| decode_status(&body).ok());
	Ok(Snapshot { overview, costs, status, range, fetched_at: SystemTime::now() })
}

/// `path?range=value`.
fn query_path(path: &str, range: &str) -> String {
	format!("{path}?range={range}")
}

/// One HTTP/1.1 `GET`, hand-rolled over `TcpStream`.
pub fn get(origin: &str, path: &str) -> Result<String, FetchError> {
	let (host, port, authority) = endpoint(origin)?;
	if !path.starts_with('/') {
		return Err(FetchError::Address(t!("{} 不是以 / 开头的路径", path)));
	}
	let addresses: Vec<std::net::SocketAddr> = (host, port)
		.to_socket_addrs()
		.map_err(|error| FetchError::Connect(t!("解析 {}:{} 失败：{}", host, port, error)))?
		.collect();
	if addresses.is_empty() {
		return Err(FetchError::Connect(t!("{}:{} 没有可用地址", host, port)));
	}
	// `localhost` can resolve to `::1` first while the server binds
	// `127.0.0.1`; try each address before calling the server absent.
	let mut stream = None;
	let mut last = None;
	for address in addresses {
		match std::net::TcpStream::connect_timeout(&address, TIMEOUT) {
			Ok(connected) => {
				stream = Some(connected);
				break;
			},
			Err(error) => last = Some(error),
		}
	}
	let mut stream = stream.ok_or_else(|| {
		let error = last.map(|error| error.to_string()).unwrap_or_default();
		FetchError::Connect(t!("连接 {}:{} 失败：{}", host, port, error))
	})?;
	stream
		.set_read_timeout(Some(TIMEOUT))
		.map_err(|error| FetchError::Io(t!("设置读超时失败：{}", error)))?;
	stream
		.set_write_timeout(Some(TIMEOUT))
		.map_err(|error| FetchError::Io(t!("设置写超时失败：{}", error)))?;
	let request = format!(
		"GET {path} HTTP/1.1\r\nHost: {authority}\r\nAccept: application/json\r\nConnection: \
		 close\r\n\r\n"
	);
	stream
		.write_all(request.as_bytes())
		.map_err(|error| FetchError::Io(t!("发送请求失败：{}", error)))?;
	let mut bytes = Vec::new();
	stream
		.read_to_end(&mut bytes)
		.map_err(|error| FetchError::Io(t!("读取应答失败：{}", error)))?;
	let Some((head, body)) = split_response(&bytes) else {
		return Err(FetchError::Io(t!("应答没有空行分隔的头部与正文").to_owned()));
	};
	let head = String::from_utf8_lossy(head);
	let code = status_of(&head).ok_or_else(|| FetchError::Io(t!("应答没有状态行").to_owned()))?;
	let body = if head
		.to_ascii_lowercase()
		.contains("transfer-encoding: chunked")
	{
		dechunk(body)?
	} else {
		body.to_vec()
	};
	if code != 200 {
		let text = String::from_utf8_lossy(&body);
		return Err(FetchError::Status(code, snippet(text.trim())));
	}
	String::from_utf8(body).map_err(|error| FetchError::Decode(t!("应答不是 UTF-8：{}", error)))
}

/// `(host, port, authority)` for a loopback `http` origin; anything else —
/// `https`, a remote host, a missing port — is refused before a socket opens.
fn endpoint(origin: &str) -> Result<(&str, u16, &str), FetchError> {
	let scheme = crate::stats::scheme_of(origin)
		.ok_or_else(|| FetchError::Address(t!("{} 没有 scheme", origin)))?;
	if !scheme.eq_ignore_ascii_case("http") {
		return Err(FetchError::Address(t!("{} 不是 http 地址", origin)));
	}
	let authority = crate::stats::authority_of(origin)
		.ok_or_else(|| FetchError::Address(t!("{} 没有主机名", origin)))?;
	let host = crate::stats::host_of(authority);
	if !(host == "127.0.0.1" || host == "::1" || host.eq_ignore_ascii_case("localhost")) {
		return Err(FetchError::Address(t!("{} 不是本机回环地址", host)));
	}
	let port = authority
		.rsplit_once(':')
		.and_then(|(_, port)| port.parse::<u16>().ok())
		.ok_or_else(|| FetchError::Address(t!("{} 没有端口", authority)))?;
	Ok((host, port, authority))
}

/// The status code on an HTTP response's first line.
fn status_of(head: &str) -> Option<u16> {
	head.lines().next()?.split_whitespace().nth(1)?.parse().ok()
}

/// Split a raw response at the blank line between its head and its body.
fn split_response(bytes: &[u8]) -> Option<(&[u8], &[u8])> {
	let at = find(bytes, b"\r\n\r\n")?;
	Some((&bytes[..at], &bytes[at + 4..]))
}

/// The first occurrence of `needle`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
	haystack
		.windows(needle.len())
		.position(|window| window == needle)
}

/// Decode a `Transfer-Encoding: chunked` body. The server answers with
/// `Content-Length`, but a proxy in front of it may not.
fn dechunk(mut rest: &[u8]) -> Result<Vec<u8>, FetchError> {
	let mut out = Vec::new();
	loop {
		let line_end =
			find(rest, b"\r\n").ok_or_else(|| FetchError::Io(t!("分块应答缺少长度行").to_owned()))?;
		let line = &rest[..line_end];
		let hex = line.split(|byte| *byte == b';').next().unwrap_or(b"");
		let hex = std::str::from_utf8(hex)
			.map_err(|_| FetchError::Io(t!("分块长度不是 ASCII").to_owned()))?;
		let size = usize::from_str_radix(hex.trim(), 16)
			.map_err(|_| FetchError::Io(t!("分块长度 {} 无效", format!("{hex:?}"))))?;
		rest = &rest[line_end + 2..];
		if size == 0 {
			return Ok(out);
		}
		if rest.len() < size {
			return Err(FetchError::Io(t!("分块比声明的长度短").to_owned()));
		}
		out.extend_from_slice(&rest[..size]);
		rest = &rest[size..];
		rest = rest.strip_prefix(b"\r\n".as_slice()).unwrap_or(rest);
	}
}

/// At most this many characters of an error body, so one HTML page cannot
/// become a whole line of UI.
fn snippet(text: &str) -> String {
	let mut end = text.len().min(160);
	while end > 0 && !text.is_char_boundary(end) {
		end -= 1;
	}
	text[..end].to_owned()
}

/// Decode `/api/stats/overview`.
pub fn decode_overview(body: &str) -> Result<Overview, String> {
	let value: Value =
		serde_json::from_str(body).map_err(|error| t!("overview 不是 JSON：{}", error))?;
	let root = value.as_object().ok_or(t!("overview 的顶层不是对象"))?;
	let overall = root
		.get("overall")
		.and_then(Value::as_object)
		.ok_or(t!("overview 缺少 overall 对象"))?;
	Ok(Overview {
		overall: Overall {
			total_requests: uint(overall, "totalRequests"),
			successful_requests: uint(overall, "successfulRequests"),
			failed_requests: uint(overall, "failedRequests"),
			error_rate: float(overall, "errorRate"),
			total_input_tokens: uint(overall, "totalInputTokens"),
			total_output_tokens: uint(overall, "totalOutputTokens"),
			total_cache_read_tokens: uint(overall, "totalCacheReadTokens"),
			total_cache_write_tokens: uint(overall, "totalCacheWriteTokens"),
			total_cost: float(overall, "totalCost"),
			unpriced_requests: uint(overall, "unpricedRequests"),
			avg_duration_ms: opt_float(overall, "avgDuration"),
			avg_ttft_ms: opt_float(overall, "avgTtft"),
			avg_tokens_per_second: opt_float(overall, "avgTokensPerSecond"),
			first_timestamp: opt_uint(overall, "firstTimestamp").map(|value| value as i64),
			last_timestamp: opt_uint(overall, "lastTimestamp").map(|value| value as i64),
		},
		by_agent_type: array(root, "byAgentType")
			.iter()
			.filter_map(decode_agent)
			.collect(),
		time_series: array(root, "timeSeries")
			.iter()
			.filter_map(decode_series)
			.collect(),
	})
}

/// Decode `/api/stats/costs`.
pub fn decode_costs(body: &str) -> Result<Costs, String> {
	let value: Value =
		serde_json::from_str(body).map_err(|error| t!("costs 不是 JSON：{}", error))?;
	let root = value.as_object().ok_or(t!("costs 的顶层不是对象"))?;
	Ok(Costs {
		rows: array(root, "costSeries")
			.iter()
			.filter_map(decode_cost_row)
			.collect(),
	})
}

/// Decode `/api/status`.
pub fn decode_status(body: &str) -> Result<ServiceStatus, String> {
	let value: Value =
		serde_json::from_str(body).map_err(|error| t!("status 不是 JSON：{}", error))?;
	let root = value.as_object().ok_or(t!("status 的顶层不是对象"))?;
	let sync = root.get("sync").and_then(Value::as_object);
	Ok(ServiceStatus {
		version: uint(root, "version"),
		sync: SyncState {
			phase: sync
				.and_then(|sync| text(sync, "phase"))
				.unwrap_or_default(),
			current: sync.map(|sync| uint(sync, "current")).unwrap_or(0),
			total: sync.map(|sync| uint(sync, "total")).unwrap_or(0),
			last_synced_at: sync
				.and_then(|sync| opt_uint(sync, "lastSyncedAt"))
				.map(|at| at as i64),
			error: sync.and_then(|sync| match sync.get("error") {
				Some(Value::String(error)) if !error.is_empty() => Some(error.clone()),
				_ => None,
			}),
		},
		indexing_hours: float(root, "indexingHours"),
	})
}

fn decode_agent(value: &Value) -> Option<AgentTypeRow> {
	let map = value.as_object()?;
	Some(AgentTypeRow {
		agent_type: text(map, "agentType").unwrap_or_default(),
		total_requests: uint(map, "totalRequests"),
		total_input_tokens: uint(map, "totalInputTokens"),
		total_output_tokens: uint(map, "totalOutputTokens"),
		total_cache_read_tokens: uint(map, "totalCacheReadTokens"),
		total_cache_write_tokens: uint(map, "totalCacheWriteTokens"),
		total_cost: float(map, "totalCost"),
	})
}

fn decode_series(value: &Value) -> Option<SeriesPoint> {
	let map = value.as_object()?;
	Some(SeriesPoint {
		timestamp: opt_uint(map, "timestamp")? as i64,
		requests: uint(map, "requests"),
		errors: uint(map, "errors"),
		tokens: uint(map, "tokens"),
		cost: float(map, "cost"),
	})
}

fn decode_cost_row(value: &Value) -> Option<CostRow> {
	let map = value.as_object()?;
	Some(CostRow {
		timestamp: opt_uint(map, "timestamp")? as i64,
		model: text(map, "model").unwrap_or_default(),
		provider: text(map, "provider").unwrap_or_default(),
		cost: float(map, "cost"),
		unpriced_requests: uint(map, "unpricedRequests"),
		cost_input: float(map, "costInput"),
		cost_output: float(map, "costOutput"),
		cost_cache_read: float(map, "costCacheRead"),
		cost_cache_write: float(map, "costCacheWrite"),
		requests: uint(map, "requests"),
	})
}

fn array<'a>(map: &'a Map<String, Value>, key: &str) -> &'a [Value] {
	map.get(key)
		.and_then(Value::as_array)
		.map(Vec::as_slice)
		.unwrap_or(&[])
}

fn text(map: &Map<String, Value>, key: &str) -> Option<String> {
	map.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn opt_float(map: &Map<String, Value>, key: &str) -> Option<f64> {
	map.get(key)
		.and_then(Value::as_f64)
		.filter(|value| value.is_finite())
}

fn float(map: &Map<String, Value>, key: &str) -> f64 {
	opt_float(map, key).unwrap_or(0.0)
}

fn opt_uint(map: &Map<String, Value>, key: &str) -> Option<u64> {
	opt_float(map, key).map(|value| value.max(0.0) as u64)
}

fn uint(map: &Map<String, Value>, key: &str) -> u64 {
	opt_uint(map, key).unwrap_or(0)
}

#[cfg(test)]
mod tests {
	use std::{
		io::{Read, Write},
		net::{TcpListener, TcpStream},
	};

	use super::*;

	const OVERVIEW: &str = include_str!("fixtures/overview-24h.json");
	const COSTS: &str = include_str!("fixtures/costs-24h.json");
	const STATUS: &str = include_str!("fixtures/status.json");

	#[test]
	fn overview_fixture_decodes_the_live_answer() {
		let overview = decode_overview(OVERVIEW).expect("the captured body decodes");
		assert_eq!(overview.overall.total_requests, 2);
		assert_eq!(overview.overall.successful_requests, 2);
		assert_eq!(overview.overall.total_input_tokens, 2_000_000);
		assert_eq!(overview.overall.total_output_tokens, 0);
		assert!((overview.overall.total_cost - 6.0).abs() < f64::EPSILON);
		assert_eq!(overview.overall.avg_tokens_per_second, Some(0.0));
		assert_eq!(overview.overall.avg_ttft_ms, Some(100.0));
		assert_eq!(overview.by_agent_type.len(), 1);
		assert_eq!(overview.by_agent_type[0].agent_type, "main");
		assert_eq!(overview.by_agent_type[0].total_requests, 2);
		assert_eq!(overview.time_series.len(), 2);
		assert_eq!(overview.time_series[1].tokens, 1_000_000);
		assert!(!overview.is_empty());
	}

	#[test]
	fn cost_and_status_fixtures_decode_the_live_answer() {
		let costs = decode_costs(COSTS).expect("the captured body decodes");
		assert_eq!(costs.rows.len(), 1);
		assert_eq!(costs.rows[0].model, "dated-card-model");
		assert_eq!(costs.rows[0].provider, "google-antigravity");
		assert!((costs.rows[0].cost - 6.0).abs() < f64::EPSILON);
		assert_eq!(costs.rows[0].requests, 2);

		let status = decode_status(STATUS).expect("the captured body decodes");
		assert_eq!(status.version, 4);
		assert_eq!(status.sync.phase, "idle");
		assert_eq!(status.sync.current, 158);
		assert_eq!(status.sync.total, 158);
		assert_eq!(status.sync.last_synced_at, Some(1_792_306_827_469));
		assert_eq!(status.sync.error, None);
	}

	#[test]
	fn a_zero_overview_is_the_empty_state() {
		let body = r#"{"overall":{"totalRequests":0},"byAgentType":[],"timeSeries":[]}"#;
		let overview = decode_overview(body).expect("decodes");
		assert!(overview.is_empty());
		assert_eq!(overview.overall.total_input_tokens, 0);
	}

	#[test]
	fn a_body_without_overall_is_an_error() {
		assert!(decode_overview("{}").is_err());
		assert!(decode_overview("not json").is_err());
		assert!(decode_costs("[]").is_err());
		assert!(decode_status("null").is_err());
	}

	#[test]
	fn the_range_maps_to_the_servers_query_values() {
		assert_eq!(Range::Today.label(), "今天");
		assert_eq!(Range::SevenDays.label(), "7 天");
		assert_eq!(Range::ThirtyDays.label(), "30 天");
		assert_eq!(Range::Today.query(), "24h");
		assert_eq!(Range::SevenDays.query(), "7d");
		assert_eq!(Range::ThirtyDays.query(), "30d");
		assert_eq!(Range::Today.bucket_ms(), 3_600_000);
		assert_eq!(Range::SevenDays.bucket_ms(), 86_400_000);
		assert_eq!(Range::ThirtyDays.bucket_ms(), 86_400_000);
	}

	#[test]
	fn only_a_loopback_http_origin_is_accepted() {
		assert!(endpoint("http://127.0.0.1:3847").is_ok());
		assert!(endpoint("http://localhost:1").is_ok());
		assert_eq!(endpoint("http://127.0.0.1:3847/api").unwrap().1, 3847);
		assert!(endpoint("https://127.0.0.1:3847").is_err());
		assert!(endpoint("http://10.0.0.2:3847").is_err());
		assert!(endpoint("http://127.0.0.1").is_err());
		assert!(endpoint("127.0.0.1:3847").is_err());
	}

	#[test]
	fn chunked_bodies_are_decoded() {
		assert_eq!(dechunk(b"4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n").unwrap(), b"Wikipedia");
		assert!(dechunk(b"9\r\nshort").is_err());
	}

	/// A listener answering `requests` connections with `body` and then
	/// stopping, so the test never leaves a thread blocked on `accept`.
	fn serve(
		body: &'static [u8],
		status: &'static str,
		requests: usize,
	) -> (String, std::thread::JoinHandle<usize>) {
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
		let port = listener.local_addr().unwrap().port();
		let handle = std::thread::spawn(move || {
			let mut served = 0;
			for stream in listener.incoming().take(requests) {
				let Ok(mut stream) = stream else { break };
				if read_request(&mut stream).is_none() {
					break;
				}
				served += 1;
				let response = format!(
					"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: \
					 {}\r\nConnection: close\r\n\r\n",
					body.len()
				);
				let _ = stream.write_all(response.as_bytes());
				let _ = stream.write_all(body);
			}
			served
		});
		(format!("http://127.0.0.1:{port}"), handle)
	}

	/// Answer a canned body for `200` on `/api/stats/overview` and `404` on
	/// everything else, for `requests` connections.
	fn serve_overview_only(
		body: &'static [u8],
		requests: usize,
	) -> (String, std::thread::JoinHandle<usize>) {
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
		let port = listener.local_addr().unwrap().port();
		let handle = std::thread::spawn(move || {
			let mut served = 0;
			for stream in listener.incoming().take(requests) {
				let Ok(mut stream) = stream else { break };
				let Some(request) = read_request(&mut stream) else {
					break;
				};
				served += 1;
				let (status, body) = if request.starts_with("GET /api/stats/overview") {
					("200 OK", body)
				} else {
					("404 Not Found", b"{\"error\":\"not found\"}".as_slice())
				};
				let response = format!(
					"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: \
					 {}\r\nConnection: close\r\n\r\n",
					body.len()
				);
				let _ = stream.write_all(response.as_bytes());
				let _ = stream.write_all(body);
			}
			served
		});
		(format!("http://127.0.0.1:{port}"), handle)
	}

	/// The request line, read until the blank line.
	fn read_request(stream: &mut TcpStream) -> Option<String> {
		let mut request = Vec::new();
		let mut byte = [0_u8; 1];
		while stream.read(&mut byte).ok()? == 1 {
			request.push(byte[0]);
			if request.ends_with(b"\r\n\r\n") {
				break;
			}
		}
		String::from_utf8(request).ok()
	}

	#[test]
	fn get_reads_a_canned_response_from_a_local_socket() {
		let (origin, server) = serve(OVERVIEW.as_bytes(), "200 OK", 1);
		let body = get(&origin, &query_path(OVERVIEW_PATH, Range::Today.query())).expect("GET");
		assert_eq!(body, OVERVIEW);
		assert!(decode_overview(&body).is_ok());
		assert_eq!(server.join().expect("listener stops"), 1);
	}

	#[test]
	fn a_non_200_answer_names_the_status() {
		let (origin, server) = serve(b"{\"error\":\"nope\"}", "500 Internal Server Error", 1);
		let error = get(&origin, STATUS_PATH).expect_err("500 is an error");
		assert_eq!(error, FetchError::Status(500, "{\"error\":\"nope\"}".to_owned()));
		assert!(!error.is_absent());
		assert_eq!(server.join().expect("listener stops"), 1);
	}

	#[test]
	fn a_refused_port_is_the_absent_state() {
		// Bind and drop, so the port is certainly closed without guessing one.
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
		let port = listener.local_addr().unwrap().port();
		drop(listener);
		let error =
			get(&format!("http://127.0.0.1:{port}"), STATUS_PATH).expect_err("nothing listens");
		assert!(error.is_absent(), "{error:?}");
	}

	#[test]
	fn load_reads_overview_and_the_optional_payloads() {
		// The overview is required; the 404s for costs/status must not fail it.
		let (origin, server) = serve_overview_only(OVERVIEW.as_bytes(), 3);
		let snapshot = load(&origin, Range::SevenDays).expect("the overview decodes");
		assert_eq!(snapshot.range, Range::SevenDays);
		assert_eq!(snapshot.overview.overall.total_requests, 2);
		assert!(snapshot.costs.is_none());
		assert!(snapshot.status.is_none());
		assert_eq!(server.join().expect("listener stops"), 3);
	}

	#[test]
	fn the_absent_line_names_the_url() {
		let line = super::super::absent_line("http://127.0.0.1:3847");
		assert_eq!(line, "stats 服务未启动：zetacode serve 未在监听 http://127.0.0.1:3847");
	}
}
