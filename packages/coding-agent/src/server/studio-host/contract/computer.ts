import type { ComputerWorkspaceQuery, ComputerWorkspaceResultMap } from "../protocol/contracts/computer-workspace.js";

export type ComputerQueryInputMap = {
	[K in ComputerWorkspaceQuery["kind"]]: Omit<Extract<ComputerWorkspaceQuery, { kind: K }>, "kind">;
};
export type ComputerQueryResultMap = Pick<ComputerWorkspaceResultMap, ComputerWorkspaceQuery["kind"]>;
