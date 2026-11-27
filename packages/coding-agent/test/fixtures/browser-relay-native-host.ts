import { runNativeHost } from "@linxiraos/zeta/tools/browser/relay/native-host";

await runNativeHost(Number(process.argv[2] ?? 0));
