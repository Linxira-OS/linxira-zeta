/**
 * Channel facade — re-exports the extracted `@linxiraos/pi-channels` runtime
 * (WeChat / Feishu / Telegram adapters, ChannelHost, QR/status state bridge,
 * `startChannels`) plus the zeta-owned routing/approval helpers that live
 * beside it. External consumers keep importing `../channels` unchanged.
 */

export * from "@linxiraos/pi-channels";
export {
	type ImControlDeps,
	type ImControlOperation,
	type ImControlParams,
	type ImControlResult,
	runImControl,
} from "./im-control";
export {
	approveRemotePlan,
	type PlanApprovalRequest,
	type PlanApprovalResult,
	type PlanApproveMode,
} from "./plan-approval";
export { type PlanImageResult, renderPlanToPng } from "./plan-image";
export { COORDINATOR_ALIAS, languageDirectiveLine, SessionRouter } from "./session-router";
export {
	normalizeFullWidth,
	resolveBotSession,
	resolvePath,
	routeWorkspaceCommand,
	type WorkspaceRouterDeps,
} from "./workspace-router";
