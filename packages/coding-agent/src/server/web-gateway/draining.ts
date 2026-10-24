/**
 * Process-wide drain gate for the gateway.
 *
 * `zetacode backend off` flips this before waiting for active turns. While it
 * is on, new prompts/steers/follow-ups and new sessions are refused; state
 * reads and aborts remain available so running work can finish or be stopped.
 */
let draining = false;

export function isGatewayDraining(): boolean {
	return draining;
}

export function setGatewayDraining(value: boolean): void {
	draining = value;
}
