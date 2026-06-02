import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/global-stream.ts'

/**
 * グローバルチャット SSE エンドポイント。
 * viewer 含む全ロールが購読できる(セッション本人確認不要)。
 */
export async function loader({ request }: Route.LoaderArgs) {
  requireUser(request)
  const services = getServices()

  const abortCtrl = new AbortController()
  request.signal.addEventListener('abort', () => abortCtrl.abort(), { once: true })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      send(JSON.stringify({ type: 'open' }))
      try {
        for await (const msg of services.globalChat.subscribe(abortCtrl.signal)) {
          send(
            JSON.stringify({
              type: 'global',
              id: msg.id,
              author_type: msg.author_type,
              author_name: msg.author_name,
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
