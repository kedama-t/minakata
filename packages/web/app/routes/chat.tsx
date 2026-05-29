import { useEffect, useMemo, useRef, useState } from 'react'
import { redirect, useFetcher, useRevalidator } from 'react-router'
import { requireEditor } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/chat.ts'

interface DisplayMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  is_final: boolean
  created_at: string
  /** SSE で受信したストリーミング中フラグ。loader 由来は false */
  streaming?: boolean
}

function draftKind(request: Request): 'dialogue' | 'knowledge' {
  const url = new URL(request.url)
  return url.searchParams.get('kind') === 'knowledge' ? 'knowledge' : 'dialogue'
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = requireEditor(request)
  const services = getServices()
  if (!params.sessionId) throw new Response('Bad Request', { status: 400 })
  // 空セッションを残さないため /chat/new ではセッションを作らず draft 状態で開く。
  // 実体は初回メッセージ送信時に action 側で作成する。
  if (params.sessionId === 'new') {
    const messages: ReturnType<typeof services.messages.listBySession> = []
    return { session: null, messages, kind: draftKind(request) }
  }
  const session = services.messages.getSession(params.sessionId)
  if (!session || session.user_id !== user.id) throw new Response('Not Found', { status: 404 })
  const messages = services.messages.listBySession(session.id)
  return { session, messages, kind: session.kind }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = requireEditor(request)
  const form = await request.formData()
  const content = String(form.get('content') ?? '').trim()
  if (!content) return { error: '空のメッセージは送信できません' }
  const services = getServices()
  // draft からの初回送信時にセッションを実体化して即リダイレクト。
  // kind はフォームの hidden input で受け取る(POST では search params が落ちるため)
  if (params.sessionId === 'new') {
    const kind = String(form.get('kind') ?? '') === 'knowledge' ? 'knowledge' : 'dialogue'
    const created = services.messages.createSession({ user_id: user.id, kind })
    services.messages.postUser(created.id, content)
    throw redirect(`/chat/${created.id}`)
  }
  const session = services.messages.getSession(params.sessionId ?? '')
  if (!session || session.user_id !== user.id) throw new Response('Not Found', { status: 404 })
  services.messages.postUser(session.id, content)
  return { ok: true }
}

export default function Chat({ loaderData }: Route.ComponentProps) {
  const { session, messages: initialMessages, kind } = loaderData
  const sessionId = session?.id ?? null
  const fetcher = useFetcher<typeof action>()
  const revalidator = useRevalidator()
  const [liveMessages, setLiveMessages] = useState<DisplayMessage[]>([])
  const formRef = useRef<HTMLFormElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 入力中チャンクは agent message id をキーに連結する。draft (未作成) では購読しない
  useEffect(() => {
    if (!sessionId) return
    const source = new EventSource(`/chat/${sessionId}/stream`)
    let activeAgentId: string | null = null

    source.onmessage = (event) => {
      let payload: {
        type: string
        id?: string
        content?: string
        is_final?: boolean
        created_at?: string
      }
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      if (payload.type !== 'agent' || !payload.id) return
      const id = payload.id
      const content = payload.content ?? ''
      const isFinal = payload.is_final ?? false
      const createdAt = payload.created_at ?? new Date().toISOString()

      setLiveMessages((prev) => {
        // ストリーミング中の同じ論理応答(activeAgentId)に追加チャンクを連結する
        if (!isFinal && activeAgentId) {
          return prev.map((m) =>
            m.id === activeAgentId ? { ...m, content: m.content + content } : m,
          )
        }
        // 新しい論理応答の最初のチャンク or is_final=true の単発応答
        const existing = prev.find((m) => m.id === id)
        if (existing) {
          return prev.map((m) =>
            m.id === id
              ? { ...m, content: m.content + content, is_final: isFinal, streaming: !isFinal }
              : m,
          )
        }
        return [
          ...prev,
          {
            id,
            role: 'agent',
            content,
            is_final: isFinal,
            created_at: createdAt,
            streaming: !isFinal,
          },
        ]
      })
      if (isFinal) {
        activeAgentId = null
        // 確定したのを機にサーバ側の messages テーブルからも再取得しておく(整合性のため)
        revalidator.revalidate()
      } else if (!activeAgentId) {
        activeAgentId = id
      }
    }

    source.onerror = () => {
      // ブラウザは EventSource の自動再接続を行う。明示的にログだけ残す
      console.warn('[chat] SSE connection error; browser will retry')
    }

    return () => {
      source.close()
    }
  }, [sessionId, revalidator])

  // loader メッセージ + SSE 経由のメッセージをマージ(id 衝突は loader 側を優先)
  const merged = useMemo<DisplayMessage[]>(() => {
    const loaderIds = new Set(initialMessages.map((m) => m.id))
    const fromLoader: DisplayMessage[] = initialMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      is_final: m.is_final,
      created_at: m.created_at,
    }))
    const fromSse = liveMessages.filter((m) => !loaderIds.has(m.id))
    return [...fromLoader, ...fromSse].sort((a, b) => a.created_at.localeCompare(b.created_at))
  }, [initialMessages, liveMessages])

  // 新着メッセージ / ストリーミングチャンク到着で一番下にスクロール
  // biome-ignore lint/correctness/useExhaustiveDependencies: merged の更新タイミングがそのままスクロール契機
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [merged])

  // ユーザー送信が完了したらフォームをクリア
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data && 'ok' in fetcher.data && fetcher.data.ok) {
      formRef.current?.reset()
    }
  }, [fetcher.state, fetcher.data])

  return (
    <div className="max-w-3xl mx-auto p-6 flex flex-col h-[calc(100vh-80px)]">
      <h1 className="text-xl font-bold mb-2">
        {kind === 'knowledge' ? 'ナレッジ質問' : '対話'}: {session ? session.id.slice(-8) : '新規'}
        <span
          className={`ml-2 text-xs px-2 py-0.5 rounded ${
            kind === 'knowledge'
              ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
          }`}
        >
          {kind}
        </span>
      </h1>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto bg-surface rounded border p-4 space-y-3"
      >
        {merged.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500">
            メッセージはまだありません。下のフォームから依頼を送信してください。
          </p>
        )}
        {merged.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : ''}>
            <span
              className={`inline-block px-3 py-2 rounded whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-blue-100 dark:bg-blue-900/40'
                  : 'bg-slate-100 dark:bg-slate-700'
              }`}
            >
              {m.content}
              {m.streaming && (
                <span className="text-slate-400 dark:text-slate-500 animate-pulse"> ▍</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <fetcher.Form ref={formRef} method="post" className="mt-3 flex gap-2">
        {!session && <input type="hidden" name="kind" value={kind} />}
        <input
          name="content"
          required
          className="flex-1 px-3 py-2 border rounded"
          placeholder="例: React Router v7 framework mode について調べて"
          disabled={fetcher.state !== 'idle'}
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 rounded disabled:opacity-50"
          disabled={fetcher.state !== 'idle'}
        >
          送信
        </button>
      </fetcher.Form>
      {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
        <p className="text-red-600 dark:text-red-400 text-xs mt-1">{fetcher.data.error}</p>
      )}
    </div>
  )
}
