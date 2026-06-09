import { timingSafeEqual } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Hono } from 'hono'
import { createMinakataMcpServer } from './server.ts'
import type { McpServices } from './services.ts'

/** タイミング攻撃を防ぐ定数時間 Bearer トークン比較 */
function safeCompareBearer(auth: string, token: string): boolean {
  if (!token) return false
  const expected = `Bearer ${token}`
  if (auth.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
}

export interface McpMountOptions {
  /**
   * レガシー共有 Bearer Token。一致したリクエストは agent 未指定 = 全ツール許可
   * として扱う(後方互換)。空文字なら無効。
   */
  token: string
  /**
   * subagent ごとの Bearer Token → agent 名のマップ(#208 capability 分離)。
   * 一致したリクエストは該当 agent の allowlist に絞られる。
   */
  agentTokens?: Record<string, string>
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
    // 認証(定数時間比較でタイミング攻撃を防ぐ)。
    // まずレガシー共有トークン(全許可)、次に per-agent トークンを順に照合する。
    const auth = req.headers.get('authorization') ?? ''
    let agent: string | undefined
    let authed = safeCompareBearer(auth, options.token)
    if (!authed && options.agentTokens) {
      for (const [tok, name] of Object.entries(options.agentTokens)) {
        if (safeCompareBearer(auth, tok)) {
          authed = true
          agent = name
          break
        }
      }
    }
    if (!authed) {
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
    const server = createMinakataMcpServer(options.services, agent ? { agent } : {})
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
