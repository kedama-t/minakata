import { Links, Meta, Outlet, Scripts, ScrollRestoration, redirect } from 'react-router'
import type { Route } from './+types/root.ts'
import { getCurrentUser } from './lib/auth.ts'
import { getServices } from './lib/services.ts'
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
  return { user: getCurrentUser(request) }
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Minakata</title>
        <Meta />
        <Links />
      </head>
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App({ loaderData }: Route.ComponentProps) {
  const user = loaderData?.user ?? null
  return (
    <div className="flex flex-col min-h-screen">
      {user && (
        <header className="bg-white border-b border-slate-200">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6 text-sm">
            <a href="/" className="font-bold text-base">
              Minakata
            </a>
            <a href="/search" className="hover:text-blue-600">
              検索
            </a>
            <a href="/topics" className="hover:text-blue-600">
              購読
            </a>
            <a href="/chat/new" className="hover:text-blue-600">
              チャット
            </a>
            <a href="/chat/new?kind=knowledge" className="hover:text-blue-600">
              ナレッジ質問
            </a>
            <a href="/reviews" className="hover:text-blue-600">
              レビュー
            </a>
            <div className="ml-auto flex items-center gap-3">
              {user.role === 'admin' && (
                <>
                  <a href="/settings/members" className="hover:text-blue-600">
                    メンバー管理
                  </a>
                  <a href="/settings/policy" className="hover:text-blue-600">
                    リサーチ方針
                  </a>
                  <a href="/admin/skills" className="hover:text-blue-600">
                    スキル
                  </a>
                </>
              )}
              <span className="text-slate-500">
                {user.email} ({user.role})
              </span>
              <form method="post" action="/logout">
                <button type="submit" className="text-slate-500 hover:text-red-600">
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
