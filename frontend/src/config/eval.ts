// UI badge for the eval harness result. Update `verified` after running
// `./scripts/eval_replay.py` — set to null while the number is stale so the
// TopBar chip shows "pending" instead of claiming a score we can't back up.

export interface EvalSummary {
  verified: number | null   // scenarios where the primary root cause matched ground truth
  total: number             // scenarios in the harness
  runDate: string | null    // ISO date of the run these numbers came from
}

export const EVAL: EvalSummary = {
  verified: 21,
  total: 30,
  runDate: '2026-08-23',
}
