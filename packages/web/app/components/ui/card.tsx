import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

type Props = ComponentProps<'div'>

/** bg-surface + border-border のカードラッパー。 */
export function Card({ className, children, ...props }: Props) {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-xl p-4 transition-all hover:border-border-strong hover:shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
