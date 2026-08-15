import clsx from 'clsx'
import type { HTMLAttributes } from 'react'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('bg-card border border-line rounded shadow-sm', className)}
      {...rest}
    />
  )
}
