import { Links, Meta, Outlet, Scripts, ScrollRestoration, redirect } from 'react-router'
import type { Route } from './+types/root.ts'
import { CommandPalette } from './components/command-palette.tsx'
import { Sidebar } from './components/sidebar.tsx'
import { getCurrentUser } from './lib/auth.ts'
import { getServices } from './lib/services.ts'
import { THEME_INIT_SCRIPT, readThemeCookie } from './lib/theme.ts'
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

export default function App({ loaderData }: Route.ComponentProps) {
  const user = loaderData?.user ?? null
  const theme = loaderData?.theme ?? 'system'

  // 未ログイン (login / setup / invitation 画面) はサイドバーなしで全幅レンダリング
  if (!user) {
    return (
      <main className="min-h-screen">
        <Outlet />
      </main>
    )
  }

  return (
    <div className="min-h-screen">
      <Sidebar user={user} theme={theme} />
      <main className="lg:ml-64 min-h-screen">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  )
}
