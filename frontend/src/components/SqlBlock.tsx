import { useState } from 'react'
import { Button } from './Button'

export function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false)
  const doCopy = () => {
    void navigator.clipboard.writeText(sql).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <div className="relative bg-card-alt rounded p-3">
      <pre className="font-mono text-xs text-ink whitespace-pre-wrap break-words">
        {sql}
      </pre>
      <Button
        variant="ghost"
        onClick={doCopy}
        className="!absolute top-1 right-1 !p-1 !text-[10px]"
      >
        {copied ? 'copied ✓' : 'copy'}
      </Button>
    </div>
  )
}
