// E2E launcher: standalone runtime web gateway from the worktree sources.
process.env.ZETA_CODING_AGENT_DIR =
	"C:\\Users\\ETPau\\Documents\\GITHUB\\zeta-slash\\.tmp-e2e\\agent";
process.env.ZETA_WEB_GATEWAY_PORT = "30145";

const { startWebGateway } = await import(
	"../packages/coding-agent/src/server/web-gateway"
);

const instance = await startWebGateway();
console.log(`e2e gateway ready on ${instance.url}`);
