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

// ISO2 country code → dashboard region-family. Used for personalization so
// a browser locale like "en-IN" picks India, "en-GB" picks UK, etc. Unknown
// codes fall back to NA. Kept explicit rather than derived from a lookup
// table so the mapping is auditable and grep-able.
const ISO_TO_DASHBOARD_REGION: Record<string, RegionCode> = {
  US: 'NA', CA: 'NA',
  GB: 'UK',
  DE: 'EU-West', FR: 'EU-West', IT: 'EU-West', ES: 'EU-West',
                 NL: 'EU-West', BE: 'EU-West', IE: 'EU-West', PT: 'EU-West',
  PL: 'EU-East', RU: 'EU-East', UA: 'EU-East', CZ: 'EU-East', RO: 'EU-East',
  SE: 'Nordics', NO: 'Nordics', DK: 'Nordics', FI: 'Nordics', IS: 'Nordics',
  IN: 'India',
  CN: 'China', HK: 'China', TW: 'China',
  JP: 'Japan',
  KR: 'Korea',
  BR: 'Brazil',
  MX: 'LATAM', AR: 'LATAM', CL: 'LATAM', CO: 'LATAM', PE: 'LATAM',
  AU: 'ANZ', NZ: 'ANZ',
  SG: 'SEA', MY: 'SEA', TH: 'SEA', ID: 'SEA', PH: 'SEA', VN: 'SEA',
  ZA: 'Africa', NG: 'Africa', KE: 'Africa', EG: 'MENA',
  AE: 'MENA', SA: 'MENA', IL: 'MENA', TR: 'MENA',
}

export function isoToDashboardRegion(iso: string | null | undefined): RegionCode {
  if (!iso) return 'NA'
  return ISO_TO_DASHBOARD_REGION[iso.toUpperCase()] ?? 'NA'
}

// Detect user's ISO2 country code from the browser locale. Free, no permission
// prompt, works offline. Returns null in non-browser envs (SSR, tests).
export function detectIsoFromLocale(): string | null {
  try {
    if (typeof Intl === 'undefined') return null
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    const iso = locale.split('-')[1]?.toUpperCase()
    return iso && /^[A-Z]{2}$/.test(iso) ? iso : null
  } catch {
    return null
  }
}
