import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Hono } from 'hono'
import { createMinakataMcpServer } from './server.ts'
import type { McpServices } from './services.ts'

export interface McpMountOptions {
  /** Bearer Token。Hermes 側にも同じ値を共有する */
  token: string
  /** マウントパス。デフォルトは /mcp */
  path?: string
  /**
   * 許可する Host ヘッダ(DNS rebinding 対策)。
   * 未設定または空配列の場合は localhost / 127.0.0.1 のみ許可(fail-close)。
   * 本番では MCP_ALLOWED_HOSTS に実ホスト名を必ず設定すること。
   */
  allowedHosts?: string[]
  services: McpServices
}

/**
 * Hono アプリに Minakata MCP を Streamable HTTP として 1 ルートでマウントする。
 *
 * - stateless モード(セッション無しの 1 RPC 単位)
 * - Bearer Token 認証 + Host ヘッダ検証
 * - tech-stack.md §5.3, §8.2 に対応
 */
export function mountMcp(app: Hono, options: McpMountOptions): void {
  const path = options.path ?? '/mcp'

  const handle = async (req: Request): Promise<Response> => {
    // 認証
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${options.token}`) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    // Host 検証(DNS rebinding 対策): 未設定時は localhost のみ許可(fail-close)
    const allowed =
      options.allowedHosts && options.allowedHosts.length > 0
        ? options.allowedHosts
        : ['localhost', '127.0.0.1']
    const host = req.headers.get('host') ?? ''
    if (!allowed.includes(host)) {
      return new Response(JSON.stringify({ error: 'forbidden_host' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    }

    // stateless 構造:リクエストごとに transport を作って即破棄
    // sessionIdGenerator を省略すれば stateless モード(undefined を明示的に渡すと型が合わない)
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    const server = createMinakataMcpServer(options.services)
    await server.connect(transport)
    try {
      return await transport.handleRequest(req)
    } finally {
      await transport.close()
      await server.close()
    }
  }

  app.all(path, async (c) => handle(c.req.raw))
}
