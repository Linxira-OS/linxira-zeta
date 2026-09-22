The todo tool just reported that phase "{phase}" is fully completed.

Before continuing with the next phase, call `tracking_update` with
`op: "sync_todo"`, `current_phase` set to the phase you are starting next,
and `phases` set to the ordered list of remaining phase names. This mirrors
phase progress into the project tracking documents so a compacted or resumed
session keeps a durable record of where the work stands.
