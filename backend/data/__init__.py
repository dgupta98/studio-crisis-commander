"""Layer 1 data foundation package.

All modules here use clickhouse-connect directly. This is intentional and
scoped: Layers 1 (seeding) and 2 (materialized views) may use the direct
client; Layer 3 (agents) MUST use mcp-clickhouse instead.
"""
