import { useEffect, useRef, useState } from 'react'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import type { CrisisType } from '@/api/contracts'

const OPTIONS: { value: CrisisType | ''; label: string }[] = [
  { value: '', label: 'Random crisis' },
  { value: 'regional_sentiment_collapse', label: 'Regional sentiment collapse' },
  { value: 'negative_social_virality', label: 'Negative social virality' },
  { value: 'trailer_variant_underperformance', label: 'Trailer underperformance' },
  { value: 'competitor_release_impact', label: 'Competitor release' },
  { value: 'marketing_overspend_low_roi', label: 'Marketing overspend' },
  { value: 'streaming_completion_drop', label: 'Streaming completion drop' },
  { value: 'refund_spike', label: 'Refund spike' },
  { value: 'review_score_divergence', label: 'Review-score divergence' },
]

export function InjectControls() {
  const inject = useRunStore((s) => s.inject)
  const runId = useRunStore((s) => s.runId)
  const streamState = useRunStore((s) => s.streamState)
  // `runId !== null` is not a reliable in-flight signal — it can persist after
  // a closed/errored run. Key off the stream state directly.
  const inFlight = streamState === 'connecting' || streamState === 'streaming'
  const [choice, setChoice] = useState<CrisisType | ''>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Synchronous guard against rapid double-click; setBusy(true) won't reflect
  // until the next render, so a second click races past the state check.
  const inFlightRef = useRef(false)

  // Clear stale error when a new run starts so it doesn't linger under a
  // successful subsequent inject.
  useEffect(() => { setErr(null) }, [runId])

  const fire = async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true); setErr(null)
    try {
      await inject(choice ? { crisisType: choice } : undefined)
    } catch (e) {
      setErr(String(e))
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">Inject Crisis</div>
      <div className="flex gap-2">
        <select
          aria-label="Crisis type"
          className="border border-line rounded px-2 py-1 text-sm bg-white text-ink flex-1"
          value={choice}
          onChange={(e) => setChoice(e.target.value as CrisisType | '')}
          disabled={inFlight || busy}
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button variant="primary" onClick={fire} disabled={inFlight || busy}>
          {busy ? '...' : 'Inject'}
        </Button>
      </div>
      {err && <div role="alert" className="text-xs text-accent mt-2">{err}</div>}
    </Card>
  )
}
