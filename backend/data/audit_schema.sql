-- Layer 3b — Decision audit trail.
-- ReplacingMergeTree(updated_at): approve/deny INSERTs a new row with the
-- same decision_id and later updated_at. SELECT ... FINAL returns latest.
-- created_at is IMMUTABLE — never modified. updated_at is the version key.
CREATE TABLE IF NOT EXISTS decision_audit (
  decision_id         String,
  investigation_id    String,
  detection_dedup_key String,
  film_id             UInt32,
  region              LowCardinality(String),
  actions_json        String,
  status              LowCardinality(String),
  threshold_usd       Float64,
  agent_run_json      String,
  report_json         String DEFAULT '',
  investigation_json  String DEFAULT '',
  approval_status     LowCardinality(String) DEFAULT 'pending_approval',
  approver            String DEFAULT '',
  approval_note       String DEFAULT '',
  approved_at         Nullable(DateTime),
  created_at          DateTime DEFAULT now(),
  updated_at          DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (decision_id, created_at);
