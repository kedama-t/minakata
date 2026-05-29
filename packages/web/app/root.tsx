import { useEffect } from 'react'
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  redirect,
  useRouteLoaderData,
} from 'react-router'
import type { Route } from './+types/root.ts'
import { CommandPalette } from './components/command-palette.tsx'
import { Sidebar } from './components/sidebar.tsx'
import { getCurrentUser } from './lib/auth.ts'
import { getServices } from './lib/services.ts'
import { type Theme, readThemeCookie, resolvedThemeAttr } from './lib/theme.ts'
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
  // root loader の theme(cookie 由来)から SSR 段階で data-theme を確定する。
  // explicit な light/dark は属性で確定。system は属性を出さず CSS の
  // @media (prefers-color-scheme) に委ねるため、初期テーマは CSS だけで決まり
  // JS の実行タイミングに依存せず FOUC が起きない。
  const data = useRouteLoaderData('root') as { theme?: Theme } | undefined
  const themeAttr = resolvedThemeAttr(data?.theme ?? 'system')
  return (
    <html lang="ja" data-theme={themeAttr}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Minakata</title>
        <Meta />
        <Links />
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
 * テーマ切替は /theme への POST → クライアントナビ(再検証)で行われるため、
 * loader が返す theme の変化を effect で捕捉して属性を更新し即時反映する。
 * system のときは属性を外して CSS の @media に委ねる(OS の配色変更にも自動追従)。
 */
function ThemeManager({ theme }: { theme: Theme }) {
  useEffect(() => {
    const el = document.documentElement
    if (theme === 'system') {
      el.removeAttribute('data-theme')
    } else {
      el.setAttribute('data-theme', theme)
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
