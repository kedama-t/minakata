import { useEffect } from 'react'
import { Links, Meta, Outlet, Scripts, ScrollRestoration, redirect } from 'react-router'
import type { Route } from './+types/root.ts'
import { CommandPalette } from './components/command-palette.tsx'
import { Sidebar } from './components/sidebar.tsx'
import { getCurrentUser } from './lib/auth.ts'
import { getServices } from './lib/services.ts'
import { THEME_INIT_SCRIPT, type Theme, readThemeCookie, resolveTheme } from './lib/theme.ts'
import './styles.css'

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const services = getServices()

  // 初回セットアップ画面の強制誘導
  if (services.auth.isInitialSetup() && url.pathname !== '/setup') {
    throw redirect('/setup')
  }
  if (!services.auth.isInitialSetup() && url.pathname === '/setup') {
    throw redirect('/')
  }
  return { user: getCurrentUser(request), theme: readThemeCookie(request) }
}

export function Layout({ children }: { children: React.ReactNode }) {
  // Layout は loader データを直接受け取れないため、root は通常レンダリング側で利用する。
  // ここでは SSR 時の data-theme を中立(light)にしておき、inline script で確定させる。
  return (
    <html lang="ja" data-theme="light">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Minakata</title>
        <Meta />
        <Links />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: theme init script is a static constant */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-canvas text-slate-900 dark:text-slate-100 min-h-screen antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

/**
 * 永続化された theme(cookie 由来)を `<html data-theme>` にライブ同期する。
 * テーマ切替は /theme への POST → クライアントナビ(再検証)で行われ、`<head>` の
 * inline script は再実行されない。そのため loader が返す theme の変化を effect で
 * 捕捉して属性を更新し、切替を即時反映する。system のときは OS の配色変更にも追従。
 */
function ThemeManager({ theme }: { theme: Theme }) {
  useEffect(() => {
    const apply = () => {
      document.documentElement.setAttribute('data-theme', resolveTheme(theme))
    }
    apply()
    if (theme === 'system') {
      const m = window.matchMedia('(prefers-color-scheme: dark)')
      m.addEventListener('change', apply)
      return () => m.removeEventListener('change', apply)
    }
  }, [theme])
  return null
}

export default function App({ loaderData }: Route.ComponentProps) {
  const user = loaderData?.user ?? null
  const theme = loaderData?.theme ?? 'system'

  // 未ログイン (login / setup / invitation 画面) はサイドバーなしで全幅レンダリング
  if (!user) {
    return (
      <>
        <ThemeManager theme={theme} />
        <main className="min-h-screen">
          <Outlet />
        </main>
      </>
    )
  }

  return (
    <div className="min-h-screen">
      <ThemeManager theme={theme} />
      <Sidebar user={user} theme={theme} />
      <main className="lg:ml-64 min-h-screen">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  )
}
