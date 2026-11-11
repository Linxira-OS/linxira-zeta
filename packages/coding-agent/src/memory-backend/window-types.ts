/** A committed discarded region; adapters must never expand it from session history. */
export interface MemoryLearningWindow {
	id: string;
	messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: string }>;
}
