import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
}

export function Button({ variant = 'secondary', className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={clsx(
        'px-4 py-2 text-sm font-medium rounded transition',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'primary' && 'bg-accent text-white hover:opacity-90',
        variant === 'secondary' && 'bg-card border border-line text-ink hover:bg-card-alt',
        variant === 'ghost' && 'text-ink-soft hover:text-ink',
        className,
      )}
      {...rest}
    />
  )
}
