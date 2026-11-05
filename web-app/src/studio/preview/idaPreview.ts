import type { StudioIdaStatus } from "@linxiraos/studio-protocol";
export const PREVIEW_IDA: StudioIdaStatus = { enabled: true, available: true, installDir: "", python: "", databases: [
  { id: "demo-database", name: "zeta.ida.demo", ref: "sample.exe", path: "sample.i64", state: "open", module: "sample.exe", format: "PE", arch: "x86", bitness: 64, busy: false, dirty: false },
] };
