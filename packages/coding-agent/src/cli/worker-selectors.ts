/**
 * Bootstrap-only worker selectors dispatched by the shared CLI entrypoint.
 *
 * Keep these strings independent of each worker's protocol module: the CLI must
 * recognize a worker before importing protocol/runtime graphs whose top-level
 * evaluation is unnecessary in an ordinary interactive process.
 */
/** Background self-update selector shared by the CLI dispatcher and `cli/auto-update.ts`. */
export const AUTO_UPDATE_WORKER_ARG = "__zeta_worker_auto_update";
/** Computer-worker selector shared by the CLI dispatcher and worker launcher. */
export const COMPUTER_WORKER_ARG = "__zeta_worker_computer";
/** Parent-death watchdog thread selector shared by the CLI dispatcher and `startParentWatchdog`. */
export const PARENT_WATCHDOG_WORKER_ARG = "__zeta_worker_parent_watchdog";
/** Subagent host worker selector shared by the CLI dispatcher and `SubagentWorker`. */
export const SUBAGENT_WORKER_ARG = "__zeta_worker_subagent";
/** Activity-worker selector shared by the CLI dispatcher and worker launcher. */
export const STATS_ACTIVITY_WORKER_ARG = "__zeta_worker_stats_activity";
/** Daemon broker worker selector shared by the launch client and CLI dispatcher. */
export const DAEMON_BROKER_WORKER_ARG = "__zeta_worker_daemon_broker";
/** Terminal-output worker selector shared by the CLI dispatcher and the launch client. */
export const TERMINAL_OUTPUT_WORKER_ARG = "__zeta_worker_terminal_output";
/** Text-prediction worker selector shared by the CLI dispatcher and predict client. */
export const TEXT_PREDICT_WORKER_ARG = "__zeta_worker_text_predict";
