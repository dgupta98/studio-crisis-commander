-- Studio Crisis Commander — Layer 1 schema.
-- All telemetry tables: MergeTree, partitioned monthly, ordered by (film_id, region, ts).

------------------------------------------------------------
-- Dimension
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS films (
    film_id       UInt64,
    tmdb_id       UInt64,
    title         String,
    genre         LowCardinality(String),
    language      LowCardinality(String),
    release_date  Date,
    runtime_min   UInt16,
    budget_usd    UInt64,
    revenue_usd   UInt64,
    popularity    Float32,
    vote_average  Float32
) ENGINE = ReplacingMergeTree()
ORDER BY film_id;

------------------------------------------------------------
-- Numeric telemetry — 9 tables
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS box_office_revenue (
    film_id      UInt64,
    region       LowCardinality(String),
    date         Date,
    revenue_usd  UInt64,
    tickets_sold UInt32,
    refunds      UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (film_id, region, date);

CREATE TABLE IF NOT EXISTS streaming_watch_minutes (
    film_id        UInt64,
    region         LowCardinality(String),
    ts             DateTime,
    watch_minutes  UInt64,
    completions    UInt32,
    drops          UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS trailer_analytics (
    trailer_id       UInt64,
    film_id          UInt64,
    variant          LowCardinality(String),
    region           LowCardinality(String),
    ts               DateTime,
    views            UInt32,
    completion_rate  Float32,
    sentiment_score  Float32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS marketing_spend (
    film_id     UInt64,
    region      LowCardinality(String),
    channel     LowCardinality(String),
    date        Date,
    spend_usd   UInt64,
    impressions UInt64,
    clicks      UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (film_id, region, channel, date);

CREATE TABLE IF NOT EXISTS audience_sentiment (
    film_id  UInt64,
    region   LowCardinality(String),
    ts       DateTime,
    platform LowCardinality(String),
    score    Float32,
    volume   UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS social_trends (
    film_id   UInt64,
    region    LowCardinality(String),
    ts        DateTime,
    platform  LowCardinality(String),
    mentions  UInt32,
    sentiment Float32,
    virality  Float32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS ticket_refunds (
    film_id        UInt64,
    region         LowCardinality(String),
    ts             DateTime,
    refund_count   UInt32,
    refund_reason  LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS review_scores (
    film_id      UInt64,
    source       LowCardinality(String),
    ts           DateTime,
    score        Float32,
    review_count UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, source, ts);

CREATE TABLE IF NOT EXISTS campaign_performance (
    campaign_id UInt64,
    film_id     UInt64,
    region      LowCardinality(String),
    channel     LowCardinality(String),
    date        Date,
    spend_usd   UInt64,
    conversions UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (film_id, region, channel, date);

------------------------------------------------------------
-- Temporal / context
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitor_releases (
    film_id            UInt64,
    region             LowCardinality(String),
    release_date       Date,
    competitor_film_id UInt64
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(release_date)
ORDER BY (film_id, region, release_date);

------------------------------------------------------------
-- Text
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews_text (
    film_id         UInt64,
    region          LowCardinality(String),
    ts              DateTime,
    source          LowCardinality(String),
    raw_text        String,
    sentiment_score Float32,
    themes          Array(LowCardinality(String))
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

------------------------------------------------------------
-- Ground truth (eval harness answer key)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crisis_ground_truth (
    crisis_id                 UUID,
    injection_timestamp       DateTime64(3),
    is_live                   UInt8,
    type                      LowCardinality(String),
    affected_film_id          UInt64,
    affected_region           LowCardinality(String),
    magnitude                 Float32,
    affected_tables           Array(String),
    true_root_cause           String,
    expected_recommendation   String,
    resolution_window_hours   UInt16
) ENGINE = ReplacingMergeTree(injection_timestamp)
ORDER BY crisis_id;
