import { Form, Links, Meta, Outlet, Scripts, ScrollRestoration, redirect } from 'react-router'
import type { Route } from './+types/root.ts'
import { getCurrentUser } from './lib/auth.ts'
import { getServices } from './lib/services.ts'
import { THEME_INIT_SCRIPT, type Theme, readThemeCookie } from './lib/theme.ts'
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
      <body className="bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-screen">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

function ThemeToggle({ current }: { current: Theme }) {
  const cls = (active: boolean) =>
    `px-2 py-0.5 text-xs rounded ${
      active
        ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
        : 'text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400'
    }`
  return (
    <Form
      method="post"
      action="/theme"
      className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded"
    >
      <button type="submit" name="theme" value="light" className={cls(current === 'light')}>
        Light
      </button>
      <button type="submit" name="theme" value="system" className={cls(current === 'system')}>
        Auto
      </button>
      <button type="submit" name="theme" value="dark" className={cls(current === 'dark')}>
        Dark
      </button>
    </Form>
  )
}

export default function App({ loaderData }: Route.ComponentProps) {
  const user = loaderData?.user ?? null
  const theme = loaderData?.theme ?? 'system'
  return (
    <div className="flex flex-col min-h-screen">
      {user && (
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6 text-sm">
            <a href="/" className="font-bold text-base">
              Minakata
            </a>
            <a href="/search" className="hover:text-blue-600 dark:hover:text-blue-400">
              検索
            </a>
            <a href="/topics" className="hover:text-blue-600 dark:hover:text-blue-400">
              購読
            </a>
            <a href="/chat/new" className="hover:text-blue-600 dark:hover:text-blue-400">
              チャット
            </a>
            <a
              href="/chat/new?kind=knowledge"
              className="hover:text-blue-600 dark:hover:text-blue-400"
            >
              ナレッジ質問
            </a>
            <a href="/monitor" className="hover:text-blue-600">
              モニター
            <a href="/reviews" className="hover:text-blue-600 dark:hover:text-blue-400">
            <a href="/tasks" className="hover:text-blue-600">
              タスク
            <a href="/chats" className="hover:text-blue-600">
              チャット履歴
            </a>
            <a href="/reviews" className="hover:text-blue-600">
              レビュー
            </a>
            <div className="ml-auto flex items-center gap-3">
              {user.role === 'admin' && (
                <>
                  <a
                    href="/settings/members"
                    className="hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    メンバー管理
                  </a>
                  <a
                    href="/settings/policy"
                    className="hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    リサーチ方針
                  </a>
                  <a href="/admin/skills" className="hover:text-blue-600 dark:hover:text-blue-400">
                    スキル
                  </a>
                  <a
                    href="/admin/archives"
                    className="hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    アーカイブ承認
                  </a>
                </>
              )}
              <ThemeToggle current={theme} />
              <span className="text-slate-500 dark:text-slate-400">
                {user.email} ({user.role})
              </span>
              <form method="post" action="/logout">
                <button
                  type="submit"
                  className="text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  ログアウト
                </button>
              </form>
            </div>
          </nav>
        </header>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
