import { isbot } from 'isbot'
/**
 * Bun 用 SSR エントリ。Web ストリーミング API(renderToReadableStream)を使う。
 * デフォルトの Node 用 entry は `react-dom/server.node` の `renderToPipeableStream` を要求するため、
 * Bun ランタイムでは fallback として明示的にこちらを置く必要がある。
 */
import { renderToReadableStream } from 'react-dom/server'
import { type EntryContext, ServerRouter } from 'react-router'

const STREAM_TIMEOUT = 5_000

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT)

  let status = responseStatusCode
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: controller.signal,
      onError(error) {
        status = 500
        console.error(error)
      },
    },
  )
  clearTimeout(timeout)

  if (isbot(request.headers.get('user-agent') ?? '')) {
    await body.allReady
  }

  responseHeaders.set('content-type', 'text/html')
  return new Response(body, { headers: responseHeaders, status })
}
