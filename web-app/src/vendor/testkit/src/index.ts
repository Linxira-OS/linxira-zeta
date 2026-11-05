/**
 * @linxiraos/studio-testkit
 *
 * Shared semantic transport contract fixtures. Adapter packages build a
 * `ClientTransport` from a `ContractFixtureApi` fake host; the node:test
 * contract suite stays out of this browser-safe build.
 */

export { contractFixtures, createContractFixtureApi } from "./fixtures.js";
export type { ContractFixtureData } from "./fixtures.js";
export type {
  ContractFixtureApi,
  FixtureCalls,
  FixtureSubscription,
  TransportFactory,
} from "./types.js";
export {
  CONVERSATION_FIXTURE_IDS,
  CONVERSATION_FIXTURE_T0,
  CONVERSATION_FIXTURE_T1,
  conversationChangedEvent,
  conversationFaultEvents,
  conversationIdentities,
  conversationInteractions,
  conversationLiveClientEvents,
  conversationLiveSequence,
  conversationLiveToolError,
  conversationLiveParallelToolStarted,
  conversationPages,
  conversationReceipts,
  conversationStudioEnvelope,
  conversationUnsafe,
} from "./conversation-fixtures.js";
export {
  assertConversationPublicSafe,
  CONVERSATION_FORBIDDEN_SUBSTRINGS,
  findConversationSafetyViolations,
} from "./conversation-safety.js";
