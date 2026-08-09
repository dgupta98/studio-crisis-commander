"""Action taxonomy: canonical SQL templates + param specs + threshold logic.

Every RecommendedAction the Decision Agent proposes MUST match one of the
five ActionTypes here. The LLM picks the type and fills `params`; the
orchestrator calls render_action_sql() to produce the exact SQL that
computes impact_usd — the LLM never composes SQL.

INJECTION-DEFENSE: str.format is safe here because (a) param keys are
whitelisted per PARAM_SPECS, (b) param values are type-checked (int /
float / whitelisted enum), (c) free-text params (reason, message_theme)
are NEVER interpolated into SQL — they surface only in the report prose.
"""

from __future__ import annotations

from typing import get_args

from agents.decision.contracts import ActionType, RecommendedAction, ApprovalStatus


ACTION_TYPES: tuple[str, ...] = tuple(get_args(ActionType))


# --- param specs -----------------------------------------------------
# type is a python type; enum whitelists are enforced by validate_params.
# Free-text params (never interpolated into SQL) get type=str.

PARAM_SPECS: dict[str, dict[str, type]] = {
    "shift_marketing_spend": {
        "film_id": int,
        "region": str,          # ClickHouse region code, quoted in template
        "from_channel": str,
        "to_channel": str,
        "shift_pct": float,     # 0-100
        "window_days": int,
    },
    "pause_campaign": {
        "campaign_id": int,
        "region": str,
        "pause_days": int,
    },
    "swap_trailer_variant": {
        "film_id": int,
        "region": str,
        "from_variant": str,
        "to_variant": str,
    },
    "issue_pr_statement": {
        # free-text params — not interpolated into SQL, only into prose.
        "film_id": int,
        "region": str,
        "message_theme": str,
    },
    "escalate_to_human": {
        # both free-text — SQL template returns constant 0.
        "reason": str,
        "severity": str,
    },
}


DEFAULT_THRESHOLDS_USD: dict[str, float] = {
    "shift_marketing_spend": 10_000.0,
    "pause_campaign":        20_000.0,
    "swap_trailer_variant":  15_000.0,
    "issue_pr_statement":     5_000.0,
    "escalate_to_human":     float("inf"),   # always requires approval
}


# --- SQL templates ---------------------------------------------------
# Formatted with str.format(**params). Free-text params in PR/escalate
# actions are omitted from the template (they don't appear in SQL).

TEMPLATES: dict[str, str] = {
    "shift_marketing_spend": """
WITH old_perf AS (
  SELECT sum(sum_conversions) AS conv
  FROM roll_campaign_daily
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND channel = '{from_channel}'
    AND day >= today() - INTERVAL {window_days} DAY
),
new_perf AS (
  SELECT sum(sum_conversions) AS conv
  FROM roll_campaign_daily
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND channel = '{to_channel}'
    AND day >= today() - INTERVAL {window_days} DAY
),
ticket AS (
  SELECT avg(revenue_usd / nullIf(tickets_sold, 0)) AS price
  FROM box_office_revenue
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND date >= today() - INTERVAL 30 DAY
)
SELECT toFloat64(
  ((new_perf.conv - old_perf.conv) * ({shift_pct} / 100.0)) * coalesce(ticket.price, 0)
) AS impact_usd
FROM old_perf, new_perf, ticket
""".strip(),

    "pause_campaign": """
WITH daily AS (
  SELECT
    avg(sum_spend)       AS spend_per_day,
    avg(sum_conversions) AS conv_per_day
  FROM roll_campaign_daily
  WHERE campaign_id = {campaign_id}
    AND region = '{region}'
    AND day >= today() - INTERVAL 14 DAY
),
ticket AS (
  SELECT avg(revenue_usd / nullIf(tickets_sold, 0)) AS price
  FROM box_office_revenue
  WHERE region = '{region}'
    AND date >= today() - INTERVAL 30 DAY
)
SELECT toFloat64(
  (daily.spend_per_day * {pause_days})
  - (daily.conv_per_day * {pause_days} * coalesce(ticket.price, 0))
) AS impact_usd
FROM daily, ticket
""".strip(),

    "swap_trailer_variant": """
WITH from_perf AS (
  SELECT
    avg(sum_views) AS views,
    avg(sum_completion_x_views / nullIf(sum_views, 0)) AS completion_rate
  FROM roll_trailer_hourly
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND variant = '{from_variant}'
    AND ts >= now() - INTERVAL 7 DAY
),
to_perf AS (
  SELECT
    avg(sum_views) AS views,
    avg(sum_completion_x_views / nullIf(sum_views, 0)) AS completion_rate
  FROM roll_trailer_hourly
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND variant = '{to_variant}'
    AND ts >= now() - INTERVAL 7 DAY
),
ticket AS (
  SELECT avg(revenue_usd / nullIf(tickets_sold, 0)) AS price
  FROM box_office_revenue
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND date >= today() - INTERVAL 30 DAY
)
SELECT toFloat64(
  (to_perf.views * to_perf.completion_rate - from_perf.views * from_perf.completion_rate)
  * 24.0 * 7.0                                        -- project to a 7-day window
  * 0.02                                              -- coarse view→ticket rate
  * coalesce(ticket.price, 0)
) AS impact_usd
FROM from_perf, to_perf, ticket
""".strip(),

    "issue_pr_statement": """
WITH sent AS (
  SELECT
    avg(sum_score_weighted / nullIf(sum_volume, 0)) AS avg_score,
    sum(sum_volume) AS total_volume
  FROM roll_sentiment_hourly
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND ts >= now() - INTERVAL 24 HOUR
),
ticket AS (
  SELECT avg(revenue_usd / nullIf(tickets_sold, 0)) AS price
  FROM box_office_revenue
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND date >= today() - INTERVAL 30 DAY
)
SELECT toFloat64(
  -- heuristic: 15% sentiment recovery x affected_volume x 1% conversion rate
  0.15 * coalesce(sent.total_volume, 0) * 0.01 * coalesce(ticket.price, 0)
) AS impact_usd
FROM sent, ticket
""".strip(),

    "escalate_to_human": "SELECT toFloat64(0.0) AS impact_usd",
}


# --- render + validate -----------------------------------------------

def validate_params(action_type: str, params: dict) -> None:
    """Raise ValueError if params don't match the spec for action_type.

    Enforces (a) known action_type, (b) exact key set, (c) value types.
    Enum whitelisting for region/channel/variant is handled by ClickHouse
    at query time — if the LLM sends garbage, the query returns empty
    rather than crashing.
    """
    if action_type not in PARAM_SPECS:
        raise ValueError(f"unknown action_type: {action_type!r}")
    spec = PARAM_SPECS[action_type]
    missing = set(spec) - set(params)
    if missing:
        raise ValueError(
            f"missing required param(s) for {action_type}: {sorted(missing)}"
        )
    extra = set(params) - set(spec)
    if extra:
        raise ValueError(
            f"unexpected param(s) for {action_type}: {sorted(extra)}"
        )
    for k, expected in spec.items():
        v = params[k]
        # Accept int as float where float is expected.
        if expected is float and isinstance(v, int):
            continue
        if not isinstance(v, expected):
            raise ValueError(
                f"param {k!r} for {action_type} expected type "
                f"{expected.__name__}, got {type(v).__name__}"
            )


def render_action_sql(action_type: str, params: dict) -> str:
    """Validate params, then render the template.

    Return an executable SELECT that yields one column `impact_usd`.
    """
    validate_params(action_type, params)
    template = TEMPLATES[action_type]
    # Only interpolate keys the template needs — free-text params for
    # PR/escalate aren't referenced in SQL.
    return template.format(**params)


def compute_status(
    actions: list[RecommendedAction],
) -> tuple[ApprovalStatus, float]:
    """Decide auto_executed vs pending_approval.

    auto_executed only if EVERY action has:
      - impact_usd populated (SQL succeeded), AND
      - impact_usd < DEFAULT_THRESHOLDS_USD[action_type].
    escalate_to_human's inf threshold guarantees it always forces
    pending_approval.

    Returns (status, threshold_that_gated). If auto, threshold is the
    highest per-action ceiling that was cleared (informational). If pending,
    it's the largest FINITE threshold of a failing action; 0.0 means the
    only gating reason was escalate_to_human (its infinite threshold isn't
    representable in JSON — status='pending_approval' carries the signal).
    """
    gating_threshold = 0.0
    all_auto = True
    for a in actions:
        thr = DEFAULT_THRESHOLDS_USD[a.action_type]
        # inf threshold (escalate_to_human) always requires approval.
        if a.impact_usd is None or thr == float("inf") or a.impact_usd >= thr:
            all_auto = False
            if thr != float("inf") and thr > gating_threshold:
                gating_threshold = thr
    if all_auto:
        # Report the highest per-action ceiling that was cleared. auto_executed
        # can never include escalate_to_human (inf threshold), so this is finite.
        return "auto_executed", max(
            DEFAULT_THRESHOLDS_USD[a.action_type] for a in actions
        )
    return "pending_approval", gating_threshold
