-- Studio Crisis Commander — Layer 2 DDL.
-- Rollup tables (SummingMergeTree), materialized views,
-- film_region_weight reference table, and detections table.

------------------------------------------------------------
-- Rollup tables — hourly
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roll_sentiment_hourly (
    film_id             UInt64,
    region              LowCardinality(String),
    ts                  DateTime,
    sum_score_weighted  Float64,
    sum_volume          UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS roll_social_hourly (
    film_id        UInt64,
    region         LowCardinality(String),
    ts             DateTime,
    sum_sentiment  Float64,
    sum_virality   Float64,
    sum_mentions   UInt64,
    n              UInt32
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS roll_trailer_hourly (
    trailer_id                 UInt64,
    film_id                    UInt64,
    region                     LowCardinality(String),
    variant                    LowCardinality(String),
    ts                         DateTime,
    sum_views                  UInt64,
    sum_completion_x_views     Float64,
    sum_sentiment_x_views      Float64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, variant, ts);

CREATE TABLE IF NOT EXISTS roll_streaming_hourly (
    film_id          UInt64,
    region           LowCardinality(String),
    ts               DateTime,
    sum_watch        UInt64,
    sum_completions  UInt64,
    sum_drops        UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

------------------------------------------------------------
-- Rollup tables — daily
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roll_marketing_daily (
    film_id          UInt64,
    region           LowCardinality(String),
    channel          LowCardinality(String),
    day              Date,
    sum_spend        UInt64,
    sum_impressions  UInt64,
    sum_clicks       UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (film_id, region, channel, day);

CREATE TABLE IF NOT EXISTS roll_campaign_daily (
    film_id          UInt64,
    region           LowCardinality(String),
    channel          LowCardinality(String),
    day              Date,
    sum_spend        UInt64,
    sum_conversions  UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (film_id, region, channel, day);

------------------------------------------------------------
-- Reference: per-film per-region business weight (250 * 15 = 3,750 rows).
-- Populated by apply.py from data.region_split.weights_for(genre).
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS film_region_weight (
    film_id  UInt64,
    region   LowCardinality(String),
    weight   Float32
) ENGINE = ReplacingMergeTree()
ORDER BY (film_id, region);

------------------------------------------------------------
-- Detections — ReplacingMergeTree so re-runs collapse on natural key.
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detections (
    detection_id     UUID DEFAULT generateUUIDv4(),
    fired_at         DateTime64(3) DEFAULT now64(3),
    metric_ts        DateTime,
    metric           LowCardinality(String),
    film_id          UInt64,
    region           LowCardinality(String),
    detector         LowCardinality(String),
    baseline_value   Float64,
    actual_value     Float64,
    magnitude        Float32,
    business_impact  Float32,
    severity         Float32,
    dedup_key        String
) ENGINE = ReplacingMergeTree(fired_at)
ORDER BY (metric, film_id, region, metric_ts, detector);
