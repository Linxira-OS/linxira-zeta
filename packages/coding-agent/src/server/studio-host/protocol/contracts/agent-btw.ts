/** Child BTW is bound to an opaque Runtime target incarnation, never the main BTW slot. */
export type AgentBtwOperation =
	| { kind: "agent.btw.read"; sessionId: string; agentId: string; binding?: string; topicId?: string }
	| { kind: "agent.btw.ask"; sessionId: string; agentId: string; binding: string; question: string; topicId?: string }
	| { kind: "agent.btw.abort"; sessionId: string; agentId: string; binding: string; ephemeralId: string };
export interface AgentBtwState {
	binding: string;
	agentId: string;
	targetSessionId: string;
	snapshot: null | {
		ephemeralId: string;
		topicId?: string;
		question?: string;
		status: "running" | "completed" | "failed" | "aborted";
		text: string;
		error?: { code: "INTERNAL_ERROR" | "OUTPUT_LIMIT"; message: string };
	};
	topics: Array<{ topicId: string; question: string; status: string; updatedAt: number; turnCount: number }>;
	turns: Array<{
		question: string;
		answer: string;
		status: string;
		createdAt: number;
		updatedAt: number;
		error?: string;
	}>;
}
export interface AgentBtwResultMap {
	"agent.btw.read": AgentBtwState;
	"agent.btw.ask": AgentBtwState;
	"agent.btw.abort": AgentBtwState;
}
export const AGENT_BTW_KINDS = ["agent.btw.read", "agent.btw.ask", "agent.btw.abort"] as const;
export function isAgentBtwKind(kind: string): kind is AgentBtwOperation["kind"] {
	return (AGENT_BTW_KINDS as readonly string[]).includes(kind);
}




