import { Avatar } from '../components/ui/avatar.tsx'
import { getAgentProfile } from '../lib/agent-profiles.ts'
import { requireEditor } from '../lib/auth.ts'
import { formatDateTime, useTimezone } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/chats.ts'

const PAGE_SIZE = 30

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireEditor(request)
  const url = new URL(request.url)
  const before = url.searchParams.get('before') ?? undefined
  const services = getServices()
  const sessions = services.messages.listSessionsByUser({
    user_id: user.id,
    limit: PAGE_SIZE,
    before,
  })
  const nextCursor =
    sessions.length === PAGE_SIZE ? sessions[sessions.length - 1]?.updated_at : null
  return { sessions, nextCursor }
}

function previewOf(content: string | null): string {
  if (!content) return ''
  const trimmed = content.trim().replace(/\s+/g, ' ')
  return trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed
}

export default function Chats({ loaderData }: Route.ComponentProps) {
  const { sessions, nextCursor } = loaderData
  const tz = useTimezone()
  const mimyProfile = getAgentProfile('dialogue')
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-5">
        <Avatar profile={mimyProfile} size="sm" />
        <h1 className="text-2xl font-bold">チャット履歴</h1>
        <div className="ml-auto">
          <a className="btn btn-primary btn-sm" href="/chat/new">
            + 新規チャット
          </a>
        </div>
      </div>

      <ul className="space-y-2">
        {sessions.map((s) => (
          <li key={s.id}>
            <a
              href={`/chat/${s.id}`}
              className="flex items-start gap-3 bg-base-100 hover:bg-base-200 border border-base-300 hover:border-base-content/20 rounded-xl p-3 transition-colors"
            >
              <div className="shrink-0 mt-0.5">
                <Avatar profile={mimyProfile} size="sm" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-sm font-medium text-base-content/80 truncate flex-1">
                    {s.title || <span className="text-base-content/40 italic">タイトルなし</span>}
                  </span>
                  <span className="text-xs text-base-content/40 shrink-0">
                    {formatDateTime(s.updated_at, tz)}
                  </span>
                </div>
                <p className="text-xs text-base-content/50 truncate">
                  {s.last_message_role === 'user' && <span className="mr-1">あなた:</span>}
                  {s.last_message_role === 'agent' && <span className="mr-1">ミミー:</span>}
                  {previewOf(s.last_message) || <span className="italic">メッセージなし</span>}
                </p>
              </div>
            </a>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="flex flex-col items-center gap-3 py-12 text-base-content/40">
            <div className="opacity-50">
              <Avatar profile={mimyProfile} size="lg" />
            </div>
            <p className="text-sm">まだチャット履歴がありません</p>
          </li>
        )}
      </ul>

      {nextCursor && (
        <div className="mt-4 text-center">
          <a
            href={`/chats?before=${encodeURIComponent(nextCursor)}`}
            className="btn btn-ghost btn-sm"
          >
            さらに読み込む
          </a>
        </div>
      )}
    </div>
  )
}
