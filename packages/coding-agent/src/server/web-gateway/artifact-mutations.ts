/** A session's artifact writes must settle before its existing trash move. */
const mutations = new Map<string, Promise<void>>();

export async function withSessionArtifactMutation<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
	const previous = mutations.get(sessionId) ?? Promise.resolve();
	const work = previous.then(action);
	const settled = work.then(
		() => {},
		() => {},
	);
	mutations.set(sessionId, settled);
	try {
		return await work;
	} finally {
		if (mutations.get(sessionId) === settled) mutations.delete(sessionId);
	}
}
