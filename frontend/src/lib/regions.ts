// Region code → display name. Source: backend/data/region_split.py::REGIONS.
// Unknown codes render as-is so a new backend region doesn't blank the UI.
export const REGIONS = [
  'NA', 'LATAM', 'UK', 'EU-West', 'EU-East', 'Nordics',
  'India', 'SEA', 'Korea', 'Japan', 'China', 'MENA',
  'Africa', 'ANZ', 'Brazil',
] as const

export type RegionCode = (typeof REGIONS)[number]

const REGION_LABELS: Record<string, string> = {
  NA: 'North America',
  LATAM: 'Latin America',
  UK: 'United Kingdom',
  'EU-West': 'Western Europe',
  'EU-East': 'Eastern Europe',
  Nordics: 'Nordics',
  India: 'India',
  SEA: 'South-East Asia',
  Korea: 'Korea',
  Japan: 'Japan',
  China: 'China',
  MENA: 'Middle East & North Africa',
  Africa: 'Sub-Saharan Africa',
  ANZ: 'Australia & New Zealand',
  Brazil: 'Brazil',
}

// 3-char uppercase codes for Region Heat Bar tiles. Multi-char codes (LATAM,
// Nordics, MENA…) get truncated; hyphenated codes keep the prefix.
const REGION_ABBREV: Record<string, string> = {
  NA: 'NAM',
  LATAM: 'LAM',
  UK: 'UKI',
  'EU-West': 'EUW',
  'EU-East': 'EUE',
  Nordics: 'NOR',
  India: 'IND',
  SEA: 'SEA',
  Korea: 'KOR',
  Japan: 'JPN',
  China: 'CHN',
  MENA: 'MEA',
  Africa: 'AFR',
  ANZ: 'ANZ',
  Brazil: 'BRA',
}

export function regionLabel(code: string): string {
  return REGION_LABELS[code] ?? code
}

export function regionAbbrev(code: string): string {
  const abbrev = REGION_ABBREV[code]
  if (abbrev) return abbrev
  // Fallback: strip non-alpha, uppercase, take first 3.
  return code.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3)
}
