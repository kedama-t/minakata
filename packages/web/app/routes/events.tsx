import type { AuditLogRow, MessageRow, TaskRow } from '@minakata/core'
import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/events.ts'

const HEARTBEAT_INTERVAL_MS = 15_000
const ALL_TOPICS = ['messages', 'tasks', 'audit'] as const
type Topic = (typeof ALL_TOPICS)[number]

/**
 * 汎用 SSE バス。`/events?topics=messages,tasks,audit` で購読する。
 * `core` の各 EventEmitter (MessageService / TaskService / AuditService) を listen し、
 * topic 名を `event:` フィールドに乗せて push する。
 *
 * P10: Web ↔ Agent は SQLite + EventEmitter + SSE で接続(WebSocket 不採用)。
 */
export async function loader({ request }: Route.LoaderArgs) {
  requireUser(request)
  const services = getServices()
  const url = new URL(request.url)
  const requested = (url.searchParams.get('topics') ?? ALL_TOPICS.join(','))
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is Topic => (ALL_TOPICS as readonly string[]).includes(t))
  const topics = new Set<Topic>(requested.length > 0 ? requested : ALL_TOPICS)

  const abortCtrl = new AbortController()
  request.signal.addEventListener('abort', () => abortCtrl.abort(), { once: true })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false

      const safeEnqueue = (chunk: string): boolean => {
        if (closed) return false
        try {
          controller.enqueue(encoder.encode(chunk))
          return true
        } catch {
          closed = true
          return false
        }
      }
      const sendEvent = (event: string, data: unknown): void => {
        safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }
      const sendPing = (): void => {
        safeEnqueue(': ping\n\n')
      }

      const handlers: Array<{
        emitter: { off: (event: string, listener: (...args: unknown[]) => void) => void }
        event: string
        listener: (...args: unknown[]) => void
      }> = []
      const register = (
        emitter: {
          on: (event: string, listener: (...args: unknown[]) => void) => void
          off: (event: string, listener: (...args: unknown[]) => void) => void
        },
        event: string,
        listener: (...args: unknown[]) => void,
      ): void => {
        emitter.on(event, listener)
        handlers.push({ emitter, event, listener })
      }

      if (topics.has('messages')) {
        register(services.messages, 'user-posted', (row) =>
          sendEvent('messages', { kind: 'user-posted', row: row as MessageRow }),
        )
        register(services.messages, 'agent-response', (row) =>
          sendEvent('messages', { kind: 'agent-response', row: row as MessageRow }),
        )
      }
      if (topics.has('tasks')) {
        register(services.tasks, 'enqueued', (row) =>
          sendEvent('tasks', { kind: 'enqueued', row: row as TaskRow }),
        )
        register(services.tasks, 'completed', (id) =>
          sendEvent('tasks', { kind: 'completed', id: id as string }),
        )
        register(services.tasks, 'retrying', (id) =>
          sendEvent('tasks', { kind: 'retrying', id: id as string }),
        )
        register(services.tasks, 'dead-lettered', (id) =>
          sendEvent('tasks', { kind: 'dead-lettered', id: id as string }),
        )
      }
      if (topics.has('audit')) {
        register(services.audit, 'audit-logged', (row) =>
          sendEvent('audit', { kind: 'logged', row: row as AuditLogRow }),
        )
      }

      sendEvent('open', { topics: [...topics] })

      const heartbeat = setInterval(sendPing, HEARTBEAT_INTERVAL_MS)

      const cleanup = (): void => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        for (const { emitter, event, listener } of handlers) {
          emitter.off(event, listener)
        }
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      abortCtrl.signal.addEventListener('abort', cleanup, { once: true })
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}
