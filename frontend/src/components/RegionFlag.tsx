const FLAGS: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', JP: '🇯🇵', KR: '🇰🇷',
  CN: '🇨🇳', IN: '🇮🇳', BR: '🇧🇷', MX: '🇲🇽', AU: '🇦🇺', CA: '🇨🇦',
  IT: '🇮🇹', ES: '🇪🇸', RU: '🇷🇺',
}

export function RegionFlag({ region }: { region: string }) {
  const flag = FLAGS[region]
  if (flag) return <span aria-label={region} title={region}>{flag}</span>
  return <span className="font-mono text-[10px]">{region}</span>
}
