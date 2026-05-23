import { requireEditor } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/chat-stream.ts'

/**
 * SSE エンドポイント:`MessageService.subscribe()` で agent 応答を listen し、
 * `data:` イベントとしてブラウザに転送する。
 * P10: Web ↔ Agent の対話は MCP メッセージバス経由(WebSocket 不採用)。
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = requireEditor(request)
  const services = getServices()
  const sessionId = params.sessionId
  const session = sessionId ? services.messages.getSession(sessionId) : null
  if (!session || session.user_id !== user.id) throw new Response('Not Found', { status: 404 })

  const abortCtrl = new AbortController()
  request.signal.addEventListener('abort', () => abortCtrl.abort(), { once: true })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      send(JSON.stringify({ type: 'open' }))
      try {
        for await (const msg of services.messages.subscribe(session.id, abortCtrl.signal)) {
          send(
            JSON.stringify({
              type: 'agent',
              id: msg.id,
              content: msg.content,
              is_final: msg.is_final,
              created_at: msg.created_at,
            }),
          )
        }
      } catch {
        // listener が中断された場合
      } finally {
        controller.close()
      }
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
