"""Layer 2 — Detection.

Rollup materialized views + on-demand SQL detectors that produce
the `detections` stream consumed by Layer 3's Investigation Agent.

BOUNDARY: This package imports `data.ch_client` directly. It must
never be imported from `backend/agents/` or `backend/mcp/`.
"""
