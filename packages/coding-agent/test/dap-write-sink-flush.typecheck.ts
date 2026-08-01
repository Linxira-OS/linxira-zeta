import type { DapClient } from "@zeta/pi-coding-agent/dap/client";

// Type-only import forces standard TypeScript to check src/dap/client.ts,
// including the socketToSink() implementation against DapWriteSink.flush().
type _CheckDapClient = DapClient;
