import { Form, redirect } from 'react-router'
import { requireEditor } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/chat.ts'

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = requireEditor(request)
  const services = getServices()
  if (!params.sessionId) throw new Response('Bad Request', { status: 400 })
  if (params.sessionId === 'new') {
    const url = new URL(request.url)
    const kind = url.searchParams.get('kind') === 'knowledge' ? 'knowledge' : 'dialogue'
    const created = services.messages.createSession({ user_id: user.id, kind })
    throw redirect(`/chat/${created.id}`)
  }
  const session = services.messages.getSession(params.sessionId)
  if (!session || session.user_id !== user.id) throw new Response('Not Found', { status: 404 })
  const messages = services.messages.listBySession(session.id)
  return { session, messages }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = requireEditor(request)
  const form = await request.formData()
  const content = String(form.get('content') ?? '').trim()
  if (!content) return { error: '空のメッセージは送信できません' }
  const services = getServices()
  const session = services.messages.getSession(params.sessionId ?? '')
  if (!session || session.user_id !== user.id) throw new Response('Not Found', { status: 404 })
  services.messages.postUser(session.id, content)
  return { ok: true }
}

export default function Chat({ loaderData }: Route.ComponentProps) {
  const { session, messages } = loaderData
  return (
    <div className="max-w-3xl mx-auto p-6 flex flex-col h-[calc(100vh-80px)]">
      <h1 className="text-xl font-bold mb-2">
        {session.kind === 'knowledge' ? 'ナレッジ質問' : '対話'}: {session.id.slice(-8)}
        <span
          className={`ml-2 text-xs px-2 py-0.5 rounded ${
            session.kind === 'knowledge'
              ? 'bg-purple-100 text-purple-700'
              : 'bg-blue-100 text-blue-700'
          }`}
        >
          {session.kind}
        </span>
      </h1>
      <div className="flex-1 overflow-y-auto bg-white rounded border p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">
            メッセージはまだありません。下のフォームから依頼を送信してください。
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : ''}>
            <span
              className={`inline-block px-3 py-2 rounded ${
                m.role === 'user' ? 'bg-blue-100' : 'bg-slate-100'
              }`}
            >
              {m.content}
            </span>
          </div>
        ))}
        <p className="text-xs text-slate-400">
          ※
          エージェント応答はバックグラウンドで届きます。ページをリロードしてください(リアルタイム反映は
          SSE で実装予定)。
        </p>
      </div>
      <Form method="post" className="mt-3 flex gap-2">
        <input
          name="content"
          required
          className="flex-1 px-3 py-2 border rounded"
          placeholder="例: React Router v7 framework mode について調べて"
        />
        <button type="submit" className="bg-blue-600 text-white px-4 rounded">
          送信
        </button>
      </Form>
    </div>
  )
}
