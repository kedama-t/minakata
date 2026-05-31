import { requireEditor } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/chats.ts'

const PAGE_SIZE = 30

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireEditor(request)
  const url = new URL(request.url)
  const kindParam = url.searchParams.get('kind')
  const kind =
    kindParam === 'knowledge' ? 'knowledge' : kindParam === 'all' ? undefined : 'dialogue'
  const before = url.searchParams.get('before') ?? undefined
  const services = getServices()
  const sessions = services.messages.listSessionsByUser({
    user_id: user.id,
    kind,
    limit: PAGE_SIZE,
    before,
  })
  const nextCursor =
    sessions.length === PAGE_SIZE ? sessions[sessions.length - 1]?.updated_at : null
  return { sessions, kind: kind ?? 'all', nextCursor }
}

function previewOf(content: string | null): string {
  if (!content) return ''
  const trimmed = content.trim().replace(/\s+/g, ' ')
  return trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed
}

function tabClass(active: boolean): string {
  return active
    ? 'px-3 py-1 rounded-t border-b-2 border-primary text-primary font-medium'
    : 'px-3 py-1 text-base-content/60 hover:text-primary'
}

export default function Chats({ loaderData }: Route.ComponentProps) {
  const { sessions, kind, nextCursor } = loaderData
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">チャット履歴</h1>
      <div className="flex gap-2 mb-4 border-b">
        <a className={tabClass(kind === 'dialogue')} href="/chats?kind=dialogue">
          対話
        </a>
        <a className={tabClass(kind === 'knowledge')} href="/chats?kind=knowledge">
          ナレッジ質問
        </a>
        <a className={tabClass(kind === 'all')} href="/chats?kind=all">
          すべて
        </a>
        <div className="ml-auto flex items-center gap-3">
          <a className="text-sm text-primary hover:underline" href="/chat/new">
            + 新規対話
          </a>
          <a className="text-sm text-primary hover:underline" href="/chat/new?kind=knowledge">
            + ナレッジ質問
          </a>
        </div>
      </div>
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="bg-surface p-3 rounded-lg border transition-colors hover:border-border-strong"
          >
            <a href={`/chat/${s.id}`} className="block">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    s.kind === 'knowledge'
                      ? 'bg-accent/15 text-accent'
                      : 'bg-primary/15 text-primary'
                  }`}
                >
                  {s.kind}
                </span>
                <span className="text-xs text-base-content/60">
                  {new Date(s.updated_at).toLocaleString('ja-JP')}
                </span>
              </div>
              <p className="text-sm mt-1 text-base-content/80">
                {s.last_message_role === 'user' && (
                  <span className="text-base-content/40">あなた: </span>
                )}
                {s.last_message_role === 'agent' && (
                  <span className="text-base-content/40">エージェント: </span>
                )}
                {previewOf(s.last_message) || (
                  <span className="text-base-content/40">（メッセージなし）</span>
                )}
              </p>
            </a>
          </li>
        ))}
        {sessions.length === 0 && (
          <p className="text-sm text-base-content/60">対話履歴がまだありません。</p>
        )}
      </ul>
      {nextCursor && (
        <div className="mt-4">
          <a
            href={`/chats?kind=${kind}&before=${encodeURIComponent(nextCursor)}`}
            className="text-sm text-primary hover:underline"
          >
            さらに読み込む
          </a>
        </div>
      )}
    </div>
  )
}
