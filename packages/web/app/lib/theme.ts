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
 * cookie が `system` のときは light を仮置きし、クライアント inline script が
 * `prefers-color-scheme` を読んで上書きする(FOUC 防止)。
 */
export function resolvedThemeAttr(theme: Theme): 'light' | 'dark' {
  return theme === 'dark' ? 'dark' : 'light'
}

/**
 * クライアントで Theme(system 含む)を実際の light/dark に解決する。
 * SSR では window が無いため呼ばない。
 */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

/**
 * head に差し込む inline script。初期表示の FOUC を防ぐため、Cookie +
 * `prefers-color-scheme` から data-theme を「初回だけ」確定する。
 * 切替後のライブ同期と system 追従は root の ThemeManager(effect)が担うため、
 * ここでは永続リスナーを張らない(切替後に古いリスナーが残る不具合を避ける)。
 */
export const THEME_INIT_SCRIPT = `(() => {
  try {
    const c = document.cookie.split('; ').find((x) => x.startsWith('minakata_theme='));
    const pref = c ? decodeURIComponent(c.slice('minakata_theme='.length)) : 'system';
    const resolved = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', resolved);
  } catch {}
})();`
