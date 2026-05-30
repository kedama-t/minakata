export type Theme = 'system' | 'light' | 'dark'

const COOKIE_NAME = 'minakata_theme'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function readThemeCookie(req: Request): Theme {
  const raw = req.headers.get('cookie') ?? ''
  for (const part of raw.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k === COOKIE_NAME && v) {
      const value = decodeURIComponent(v)
      if (value === 'light' || value === 'dark' || value === 'system') return value
    }
  }
  return 'system'
}

export function serializeThemeCookie(theme: Theme): string {
  return `${COOKIE_NAME}=${theme}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`
}

/**
 * SSR で `<html data-theme>` に書き出す値を決める。
 * `system` のときは属性を付けず(undefined)、CSS の `@media (prefers-color-scheme)`
 * に初期テーマを委ねる。これにより JS の実行タイミングに依存せず FOUC が起きない。
 * 明示 `light`/`dark` のときだけ属性を出して media query を上書きする。
 */
export function resolvedThemeAttr(theme: Theme): 'light' | 'dark' | undefined {
  return theme === 'system' ? undefined : theme
}
