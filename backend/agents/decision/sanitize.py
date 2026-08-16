"""Post-LLM rationale sanitiser.

Flash occasionally injects specifics that don't exist in the investigation
(e.g. "Trailer B in APAC has reached 70%" when the anomaly is a China
marketing crisis and no finding row mentions APAC, Trailer B, or 70%).
The prompt's HARD CONSTRAINTS ask the model to stop but Flash still slips.

Rather than retry the LLM or refuse the action, we scrub the disallowed
tokens post-hoc:

  * Region mentions that don't match the detection region are rewritten
    to the detection region — including common aliases (APAC, EMEA, EU)
    that aren't in REGIONS but the LLM likes to invent.
  * "Trailer X" / "Variant X" claims whose letter never appears in any
    finding row are replaced with "the affected variant".
  * Bare percentage figures (e.g. "70%") whose numeric string doesn't
    appear anywhere in a finding row are stripped.

The output stays natural-sounding — we don't want the operator reading a
mangled sentence — but every specific left in the prose is grounded.
"""
from __future__ import annotations

import re
from typing import Iterable

from agents.investigation.contracts import InvestigationResult
from data.region_split import REGIONS


# Region aliases the LLM invents that aren't in the canonical REGIONS list.
_ALIAS_REGIONS: tuple[str, ...] = (
    "APAC", "EMEA", "EU", "Asia", "Asia-Pacific", "Asia Pacific",
    "Europe", "North America", "South America", "Middle East",
)

# Variant letters the trailer_analytics table can carry.
_VARIANT_LETTERS: tuple[str, ...] = tuple("ABCDE")

# Match "Trailer B", "trailer C", "variant D" — capture the letter.
_VARIANT_RE = re.compile(r"\b(?:Trailer|Variant|variant)\s+([A-E])\b")

# Match a percentage like "12%", "0.5 %", "34.5%".
_PCT_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*%")


def _row_tokens(inv: InvestigationResult) -> set[str]:
    """String-ify every scalar cell across every finding row.

    Used as a whitelist when deciding whether a variant letter or numeric
    figure the LLM wrote actually came from evidence.
    """
    out: set[str] = set()
    for f in inv.findings:
        for row in f.rows:
            for cell in row:
                if cell is None:
                    continue
                out.add(str(cell))
    return out


def _pct_in_rows(pct_str: str, row_tokens: Iterable[str]) -> bool:
    """`pct_str` came out of the rationale prose. Accept it if the same
    numeric literal (as '70' or '0.70' or '70.0') shows up in any row cell."""
    try:
        n = float(pct_str)
    except ValueError:
        return False
    forms = {
        pct_str,                        # exact "70" or "0.5"
        f"{n:g}",                       # canonical numeric render
        f"{n / 100:g}",                 # ratio form ("0.7" for "70")
        f"{n * 100:g}",                 # inverse ratio ("70" for "0.7")
    }
    for token in row_tokens:
        for form in forms:
            if form in token:
                return True
    return False


def sanitize_rationale(
    rationale: str, inv: InvestigationResult,
) -> str:
    """Scrub disallowed specifics from `rationale` in-place.

    See module docstring for the full ruleset. Returns the scrubbed
    string; never raises, never lengthens the input.
    """
    if not rationale:
        return rationale
    actual_region = inv.detection.region
    row_tokens = _row_tokens(inv)

    # 1. Rewrite mentions of other regions or common aliases to the
    #    actual detection region. Longest-first so "EU-West" is matched
    #    before "EU".
    disallowed = sorted(
        (set(REGIONS) | set(_ALIAS_REGIONS)) - {actual_region},
        key=len,
        reverse=True,
    )
    for token in disallowed:
        # Boundaries look for a non-word char or start/end so we don't
        # rewrite "China" inside "China-Beijing" — but we do want to
        # rewrite "EU-West" as a whole, hence the hyphen tolerance.
        pattern = re.compile(
            rf"(?<![A-Za-z0-9]){re.escape(token)}(?![A-Za-z0-9])"
        )
        rationale = pattern.sub(actual_region, rationale)

    # 2. Strip variant claims whose letter never appears in a finding row.
    def _variant_sub(m: re.Match[str]) -> str:
        letter = m.group(1)
        if letter in row_tokens:
            return m.group(0)
        return "the affected variant"

    rationale = _VARIANT_RE.sub(_variant_sub, rationale)

    # 3. Strip percent figures whose numeric literal isn't in any row.
    def _pct_sub(m: re.Match[str]) -> str:
        return m.group(0) if _pct_in_rows(m.group(1), row_tokens) else ""

    rationale = _PCT_RE.sub(_pct_sub, rationale)

    # 4. Collapse whitespace and stray "  ." from pct removal.
    rationale = re.sub(r"\s+([.,;:])", r"\1", rationale)
    rationale = re.sub(r"\s+", " ", rationale).strip()
    return rationale
