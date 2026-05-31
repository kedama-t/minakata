import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

type Variant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'outline' | 'error'
type Size = 'xs' | 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  accent: 'btn-accent',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
  error: 'btn-error',
}

const SIZE: Record<Size, string> = {
  xs: 'btn-xs',
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
}

type Props = ComponentProps<'button'> & {
  variant?: Variant
  size?: Size
}

/** daisyUI btn を薄くラップした汎用ボタン。 */
export function Button({ variant = 'primary', size = 'md', className, children, ...props }: Props) {
  return (
    <button type="button" className={cn('btn', VARIANT[variant], SIZE[size], className)} {...props}>
      {children}
    </button>
  )
}
