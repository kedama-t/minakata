import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { redirect, useFetcher, useRevalidator } from 'react-router'
import remarkGfm from 'remark-gfm'
import { Avatar, UserAvatar } from '../components/ui/avatar.tsx'
import { getAgentProfile } from '../lib/agent-profiles.ts'
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

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = requireEditor(request)
  const services = getServices()
  if (!params.sessionId) throw new Response('Bad Request', { status: 400 })
  if (params.sessionId === 'new') {
    const messages: ReturnType<typeof services.messages.listBySession> = []
    return { session: null, messages, userEmail: user.email }
  }
  const session = services.messages.getSession(params.sessionId)
  if (!session || session.user_id !== user.id) throw new Response('Not Found', { status: 404 })
  const messages = services.messages.listBySession(session.id)
  return { session, messages, userEmail: user.email }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = requireEditor(request)
  const form = await request.formData()
  const content = String(form.get('content') ?? '').trim()
  if (!content) return { error: '空のメッセージは送信できません' }
  const services = getServices()
  if (params.sessionId === 'new') {
    const created = services.messages.createSession({ user_id: user.id })
    services.messages.postUser(created.id, content)
    throw redirect(`/chat/${created.id}`)
  }
  const session = services.messages.getSession(params.sessionId ?? '')
  if (!session || session.user_id !== user.id) throw new Response('Not Found', { status: 404 })
  services.messages.postUser(session.id, content)
  return { ok: true }
}

/** チャット内 Markdown レンダラ（article より軽量） */
function ChatMarkdown({ source }: { source: string }) {
  return (
    <div className="prose prose-sm max-w-none text-inherit [&_a]:text-primary [&_a]:underline [&_pre]:bg-black/20 [&_pre]:rounded [&_pre]:p-2 [&_code]:bg-black/15 [&_code]:rounded [&_code]:px-1 [&_code]:text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  )
}

export default function Chat({ loaderData }: Route.ComponentProps) {
  const { session, messages: initialMessages, userEmail } = loaderData
  const sessionId = session?.id ?? null
  const fetcher = useFetcher<typeof action>()
  const revalidator = useRevalidator()
  const [liveMessages, setLiveMessages] = useState<DisplayMessage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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
        if (!isFinal && activeAgentId) {
          return prev.map((m) =>
            m.id === activeAgentId ? { ...m, content: m.content + content } : m,
          )
        }
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
        revalidator.revalidate()
      } else if (!activeAgentId) {
        activeAgentId = id
      }
    }

    source.onerror = () => {
      console.warn('[chat] SSE connection error; browser will retry')
    }

    return () => {
      source.close()
    }
  }, [sessionId, revalidator])

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: merged の更新タイミングがスクロール契機
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [merged])

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data && 'ok' in fetcher.data && fetcher.data.ok) {
      if (textareaRef.current) textareaRef.current.value = ''
    }
  }, [fetcher.state, fetcher.data])

  /** Shift+Enter 送信、Enter 改行 */
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      if (fetcher.state !== 'idle') return
      formRef.current?.requestSubmit()
    }
  }

  const mimyProfile = getAgentProfile('dialogue')

  return (
    <div className="max-w-3xl mx-auto p-4 flex flex-col h-[calc(100vh-80px)]">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-base-300">
        <Avatar profile={mimyProfile} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{session?.title || 'ミミー'}</div>
          {session?.title && <div className="text-xs text-base-content/40">ミミーが承ります‼️</div>}
        </div>
        <span className="text-xs text-base-content/40 shrink-0">
          {session ? `#${session.id.slice(-8)}` : '新規'}
        </span>
      </div>

      {/* メッセージ一覧 */}
      <div ref={containerRef} className="flex-1 overflow-y-auto space-y-1 pb-2">
        {merged.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-base-content/50">
            <Avatar profile={mimyProfile} size="lg" />
            <p className="text-sm text-center">こんにちは！何でも聞いてください。</p>
          </div>
        )}
        {merged.map((m) =>
          m.role === 'agent' ? (
            <div key={m.id} className="chat chat-start">
              <div className="chat-image">
                <Avatar profile={mimyProfile} size="sm" />
              </div>
              <div className="chat-header text-xs text-base-content/50 mb-0.5">ミミー</div>
              <div className="chat-bubble chat-bubble-neutral max-w-[85%] text-sm">
                {m.is_final ? (
                  <ChatMarkdown source={m.content} />
                ) : (
                  <span className="whitespace-pre-wrap">
                    {m.content}
                    {m.streaming && <span className="text-base-content/40 animate-pulse"> ▍</span>}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div key={m.id} className="chat chat-end">
              <div className="chat-image">
                <UserAvatar email={userEmail} size="sm" />
              </div>
              <div className="chat-bubble chat-bubble-primary max-w-[85%] text-sm whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ),
        )}
      </div>

      {/* 入力エリア */}
      <fetcher.Form
        ref={formRef}
        method="post"
        className="mt-3 flex gap-2 items-end"
        onSubmit={(e) => {
          if (!textareaRef.current?.value.trim()) e.preventDefault()
        }}
      >
        <textarea
          ref={textareaRef}
          name="content"
          required
          rows={1}
          className="textarea textarea-bordered flex-1 resize-none text-sm leading-relaxed"
          placeholder="依頼や質問を入力…（Shift+Enter で送信、Enter で改行）"
          disabled={fetcher.state !== 'idle'}
          onKeyDown={handleKeyDown}
          onInput={(e) => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`
          }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm self-end"
          disabled={fetcher.state !== 'idle'}
        >
          {fetcher.state !== 'idle' ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            '送信'
          )}
        </button>
      </fetcher.Form>
      {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
        <p className="text-error text-xs mt-1">{fetcher.data.error}</p>
      )}
    </div>
  )
}
