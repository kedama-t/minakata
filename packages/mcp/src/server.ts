import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServices } from './services.ts'
import { registerAllTools } from './tools.ts'

/**
 * Minakata MCP サーバーを作成。
 * Streamable HTTP 用に Transport は呼び出し側でアタッチする。
 */
export function createMinakataMcpServer(
  services: McpServices,
  opts: { agent?: string } = {},
): McpServer {
  const server = new McpServer(
    { name: 'minakata-mcp', version: '0.1.0-mvp' },
    {
      capabilities: { tools: { listChanged: false } },
    },
  )
  registerAllTools(server, services, opts.agent !== undefined ? { agent: opts.agent } : {})
  return server
}
