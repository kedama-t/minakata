import { type KeyboardEvent, isValidElement, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { useFetcher, useRevalidator } from 'react-router'
import remarkGfm from 'remark-gfm'
import { Avatar, UserAvatar } from '../components/ui/avatar.tsx'
import { getAgentProfile } from '../lib/agent-profiles.ts'
import { requireEditor, requireUser } from '../lib/auth.ts'
import { HighlightedCode } from '../lib/markdown.tsx'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/global.ts'

interface DisplayMessage {
  id: string
  author_type: 'user' | 'agent'
  author_name: string
  content: string
  is_final: boolean
  created_at: string
  streaming?: boolean
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireUser(request)
  const services = getServices()
  const messages = services.globalChat.list({ limit: 100 })
  return { messages, userEmail: user.email, userRole: user.role }
}

export async function action({ request }: Route.ActionArgs) {
  const user = requireEditor(request)
  const form = await request.formData()
  const content = String(form.get('content') ?? '').trim()
  if (!content) return { error: '空のメッセージは送信できません' }
  const services = getServices()
  services.globalChat.post({
    author_type: 'user',
    author_id: user.id,
    author_name: user.email,
    content,
  })
  return { ok: true }
}

const chatMdComponents: Components = {
  h1: ({ node: _n, children, ...p }) => (
    <h1 {...p} className="text-base font-bold mt-3 mb-1 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ node: _n, children, ...p }) => (
    <h2 {...p} className="text-sm font-bold mt-3 mb-1 first:mt-0 border-b border-white/20 pb-0.5">
      {children}
    </h2>
  ),
  h3: ({ node: _n, children, ...p }) => (
    <h3 {...p} className="text-sm font-semibold mt-2 mb-1 first:mt-0">
      {children}
    </h3>
  ),
  p: ({ node: _n, children, ...p }) => (
    <p {...p} className="my-1.5 leading-relaxed first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ node: _n, children, ...p }) => (
    <ul {...p} className="list-disc list-outside pl-4 my-1.5 space-y-0.5">
      {children}
    </ul>
  ),
  ol: ({ node: _n, children, ...p }) => (
    <ol {...p} className="list-decimal list-outside pl-4 my-1.5 space-y-0.5">
      {children}
    </ol>
  ),
  li: ({ node: _n, children, ...p }) => (
    <li {...p} className="leading-relaxed">
      {children}
    </li>
  ),
  blockquote: ({ node: _n, children, ...p }) => (
    <blockquote {...p} className="border-l-2 border-white/30 pl-3 my-1.5 opacity-80 italic">
      {children}
    </blockquote>
  ),
  code: ({ node: _n, className, children, ...p }) => {
    const isBlock = typeof className === 'string' && className.startsWith('language-')
    if (isBlock) {
      return (
        <code {...p} className={className}>
          {children}
        </code>
      )
    }
    return (
      <code {...p} className="bg-white/15 rounded px-1 py-0.5 text-xs font-mono">
        {children}
      </code>
    )
  },
  pre: ({ node: _n, children }) => {
    if (isValidElement(children)) {
      const props = (children as React.ReactElement<{ className?: string; children?: unknown }>)
        .props
      if (typeof props.className === 'string' && props.className.includes('language-')) {
        const lang = props.className.match(/language-(\S+)/)?.[1] ?? 'text'
        const code = String(props.children ?? '').replace(/\n$/, '')
        return (
          <HighlightedCode
            code={code}
            lang={lang}
            fallbackClassName="bg-black/30 rounded p-3 my-2 overflow-x-auto text-xs font-mono leading-relaxed"
            wrapperClassName="my-2 [&>pre]:rounded [&>pre]:p-3 [&>pre]:overflow-x-auto [&>pre]:text-xs [&>pre]:leading-relaxed"
          />
        )
      }
    }
    return (
      <pre className="bg-black/30 rounded p-3 my-2 overflow-x-auto text-xs font-mono leading-relaxed">
        {children}
      </pre>
    )
  },
  a: ({ node: _n, href, children, ...p }) => (
    <a
      {...p}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline opacity-90 hover:opacity-100"
    >
      {children}
    </a>
  ),
  table: ({ node: _n, children, ...p }) => (
    <div className="overflow-x-auto my-2">
      <table {...p} className="border-collapse text-xs w-full">
        {children}
      </table>
    </div>
  ),
  thead: ({ node: _n, children, ...p }) => (
    <thead {...p} className="border-b border-white/30">
      {children}
    </thead>
  ),
  th: ({ node: _n, children, ...p }) => (
    <th {...p} className="px-2 py-1 text-left font-semibold bg-white/10 border border-white/20">
      {children}
    </th>
  ),
  td: ({ node: _n, children, ...p }) => (
    <td {...p} className="px-2 py-1 border border-white/15">
      {children}
    </td>
  ),
  hr: ({ node: _n, ...p }) => <hr {...p} className="my-3 border-white/20" />,
  strong: ({ node: _n, children, ...p }) => (
    <strong {...p} className="font-bold">
      {children}
    </strong>
  ),
}

function ChatMarkdown({ source }: { source: string }) {
  return (
    <div className="text-sm leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMdComponents}>
        {source}
      </ReactMarkdown>
    </div>
  )
}

export default function GlobalChat({ loaderData }: Route.ComponentProps) {
  const { messages: initialMessages, userEmail, userRole } = loaderData
  const canPost = userRole !== 'viewer'
  const fetcher = useFetcher<typeof action>()
  const revalidator = useRevalidator()
  const [liveMessages, setLiveMessages] = useState<DisplayMessage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const source = new EventSource('/global/stream')
    const activeAgentIds = new Map<string, string>()

    source.onmessage = (event) => {
      let payload: {
        type: string
        id?: string
        author_type?: string
        author_name?: string
        content?: string
        is_final?: boolean
        created_at?: string
      }
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      if (payload.type !== 'global' || !payload.id) return
      const id = payload.id
      const authorType = (payload.author_type ?? 'agent') as 'user' | 'agent'
      const authorName = payload.author_name ?? ''
      const content = payload.content ?? ''
      const isFinal = payload.is_final ?? false
      const createdAt = payload.created_at ?? new Date().toISOString()

      setLiveMessages((prev) => {
        if (!isFinal && authorType === 'agent') {
          const activeId = activeAgentIds.get(authorName)
          if (activeId) {
            return prev.map((m) => (m.id === activeId ? { ...m, content: m.content + content } : m))
          }
        }
        const existing = prev.find((m) => m.id === id)
        if (existing) {
          return prev.map((m) =>
            m.id === id
              ? { ...m, content: m.content + content, is_final: isFinal, streaming: !isFinal }
              : m,
          )
        }
        if (!isFinal && authorType === 'agent') activeAgentIds.set(authorName, id)
        return [
          ...prev,
          {
            id,
            author_type: authorType,
            author_name: authorName,
            content,
            is_final: isFinal,
            created_at: createdAt,
            streaming: !isFinal,
          },
        ]
      })
      if (isFinal && authorType === 'agent') {
        activeAgentIds.delete(authorName)
        revalidator.revalidate()
      }
    }

    source.onerror = () => {
      console.warn('[global-chat] SSE connection error; browser will retry')
    }

    return () => {
      source.close()
    }
  }, [revalidator])

  const merged = useMemo<DisplayMessage[]>(() => {
    const loaderIds = new Set(initialMessages.map((m) => m.id))
    const fromLoader: DisplayMessage[] = initialMessages.map((m) => ({
      id: m.id,
      author_type: m.author_type,
      author_name: m.author_name,
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

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      if (fetcher.state !== 'idle') return
      formRef.current?.requestSubmit()
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 flex flex-col h-[calc(100vh-80px)]">
      {/* ヘッダー */}
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-base-300">
        <span className="text-lg">💬</span>
        <div className="font-semibold text-sm">グローバルチャット</div>
        <span className="text-xs text-base-content/40 ml-auto">
          チームとエージェントの共有チャンネル
        </span>
        {!canPost && <span className="badge badge-ghost badge-sm">閲覧のみ</span>}
      </div>

      {/* メッセージ一覧 */}
      <div ref={containerRef} className="flex-1 overflow-y-auto space-y-1 pb-2">
        {merged.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-base-content/50">
            <span className="text-4xl">💬</span>
            <p className="text-sm text-center">まだメッセージがありません</p>
          </div>
        )}
        {merged.map((m) => {
          if (m.author_type === 'agent') {
            const profile = getAgentProfile(m.author_name)
            return (
              <div key={m.id} className="chat chat-start">
                <div className="chat-image">
                  <Avatar profile={profile} size="sm" />
                </div>
                <div className="chat-header text-xs text-base-content/50 mb-0.5">
                  {profile.displayName}
                </div>
                <div className="chat-bubble chat-bubble-neutral max-w-[85%] text-sm">
                  {m.is_final ? (
                    <ChatMarkdown source={m.content} />
                  ) : (
                    <span className="whitespace-pre-wrap">
                      {m.content}
                      {m.streaming && (
                        <span className="text-base-content/40 animate-pulse"> ▍</span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            )
          }
          const isOwnMessage = m.author_name === userEmail
          return (
            <div key={m.id} className={`chat ${isOwnMessage ? 'chat-end' : 'chat-start'}`}>
              <div className="chat-image">
                <UserAvatar email={m.author_name} size="sm" />
              </div>
              <div className="chat-header text-xs text-base-content/50 mb-0.5">{m.author_name}</div>
              <div
                className={`chat-bubble max-w-[85%] text-sm whitespace-pre-wrap ${
                  isOwnMessage ? 'chat-bubble-primary' : 'chat-bubble-secondary'
                }`}
              >
                {m.content}
              </div>
            </div>
          )
        })}
      </div>

      {/* 入力エリア(editor以上のみ) */}
      {canPost ? (
        <>
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
              placeholder="メッセージを入力…（Shift+Enter で送信、Enter で改行）"
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
        </>
      ) : (
        <div className="mt-3 text-center text-xs text-base-content/40 py-2">
          投稿するには editor 以上の権限が必要です
        </div>
      )}
    </div>
  )
}
