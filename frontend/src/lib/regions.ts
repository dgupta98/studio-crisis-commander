// Region code → display name. Source: backend/data/region_split.py::REGIONS.
// Unknown codes render as-is so a new backend region doesn't blank the UI.
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

export function regionLabel(code: string): string {
  return REGION_LABELS[code] ?? code
}
