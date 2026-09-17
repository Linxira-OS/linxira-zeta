import { isBunTestRuntime } from "@linxiraos/pi-utils/env";

process.stdout.write(JSON.stringify(isBunTestRuntime()));
