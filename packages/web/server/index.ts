import { mountMcp } from '@minakata/mcp'
import { createHonoServer } from 'react-router-hono-server/bun'
import { getServices } from '../app/lib/services.ts'

const MCP_TOKEN = process.env.MCP_TOKEN ?? ''

/**
 * Hono サーバーのエントリ。`react-router-hono-server` がプラグイン経由でビルドし、
 * production では `build/server/index.js` 経由で `bun.serve` を起動する。
 * top-level await は esbuild の output 制約で禁止されるため、`createHonoServer` の Promise をそのまま export する。
 */
export default createHonoServer({
  port: Number(process.env.PORT ?? 3000),
  defaultLogger: true,
  configure: (app) => {
    const services = getServices()
    services.maintenance.runMigrations()

    if (!MCP_TOKEN) {
      console.warn('[minakata] MCP_TOKEN is not set — /mcp endpoint will reject all requests')
    }

    app.get('/health', (c) => c.json({ status: 'ok' }))
    mountMcp(app, {
      token: MCP_TOKEN,
      services: {
        articles: services.articles,
        search: services.search,
        messages: services.messages,
        tasks: services.tasks,
        audit: services.audit,
        activity: services.activity,
        maintenance: services.maintenance,
        reviews: services.reviews,
        policy: services.policy,
        comments: services.comments,
        skills: services.skills,
        archives: services.archives,
        topics: services.topics,
      },
      allowedHosts: process.env.MCP_ALLOWED_HOSTS?.split(',').filter(Boolean) ?? [],
    })
  },
})
