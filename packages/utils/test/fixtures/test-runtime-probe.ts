import { isBunTestRuntime } from "@zeta/pi-utils/env";

process.stdout.write(JSON.stringify(isBunTestRuntime()));
