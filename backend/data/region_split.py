"""Deterministic regional share weights per (genre, region).

Anchors on rough real-world film-market share (NA + China + EU dominate)
adjusted by genre affinity (anime skews Japan/Korea, superhero skews NA,
Bollywood skews India, etc.). Returns a dict summing to 1.0.
"""

from __future__ import annotations

REGIONS = [
    "NA", "LATAM", "UK", "EU-West", "EU-East", "Nordics",
    "India", "SEA", "Korea", "Japan", "China", "MENA",
    "Africa", "ANZ", "Brazil",
]

# Baseline share of global box office, rough industry consensus.
BASE_WEIGHTS: dict[str, float] = {
    "NA": 0.30, "LATAM": 0.05, "UK": 0.06, "EU-West": 0.11, "EU-East": 0.03,
    "Nordics": 0.02, "India": 0.06, "SEA": 0.04, "Korea": 0.04, "Japan": 0.06,
    "China": 0.12, "MENA": 0.02, "Africa": 0.02, "ANZ": 0.03, "Brazil": 0.04,
}

# Genre affinity multipliers per region. Missing entries default to 1.0.
GENRE_MULT: dict[str, dict[str, float]] = {
    "Animation": {"Japan": 2.0, "Korea": 1.5, "NA": 1.3, "EU-West": 1.2},
    "Action":    {"NA": 1.3, "China": 1.4, "Korea": 1.3, "LATAM": 1.2},
    "Romance":   {"India": 1.6, "SEA": 1.3, "LATAM": 1.4, "Korea": 1.4},
    "Horror":    {"NA": 1.4, "LATAM": 1.3, "Brazil": 1.3, "SEA": 1.2},
    "Drama":     {"EU-West": 1.3, "UK": 1.2, "India": 1.2},
    "Science Fiction": {"NA": 1.4, "China": 1.3, "Japan": 1.3, "Korea": 1.2},
    "Comedy":    {"NA": 1.2, "UK": 1.3, "India": 1.3, "Brazil": 1.3},
    "Thriller":  {"Korea": 1.4, "NA": 1.2, "EU-West": 1.2},
    "Documentary": {"EU-West": 1.5, "NA": 1.3, "UK": 1.4},
    "Family":    {"NA": 1.3, "China": 1.3, "India": 1.2, "LATAM": 1.2},
}


def weights_for(genre: str) -> dict[str, float]:
    """Return normalized share weights for `genre` across the 15 regions."""
    mults = GENRE_MULT.get(genre, {})
    raw = {r: BASE_WEIGHTS[r] * mults.get(r, 1.0) for r in REGIONS}
    total = sum(raw.values())
    return {r: v / total for r, v in raw.items()}


def verify() -> None:
    for g in list(GENRE_MULT) + ["Unknown"]:
        w = weights_for(g)
        assert abs(sum(w.values()) - 1.0) < 1e-6, f"{g} not normalized"
        assert all(v > 0 for v in w.values()), f"{g} has zero weight"
    print(f"region_split OK: {len(REGIONS)} regions, {len(GENRE_MULT)} + 1 genres normalized.")


if __name__ == "__main__":
    verify()
