import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

type Props = ComponentProps<'span'>

/** インラインのバッジ。bgClass / textClass を外から注入して使う。 */
export function Badge({ className, children, ...props }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
