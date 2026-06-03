import { mountMcp } from '@minakata/mcp'
import type { Hono } from 'hono'
import { createHonoServer } from 'react-router-hono-server/bun'
import { z } from 'zod'
import { getServices } from '../app/lib/services.ts'
import { scrapeUrl } from './scraper.ts'

const MCP_TOKEN = process.env.MCP_TOKEN ?? ''
// Hermes は FIRECRAWL_API_KEY を Bearer token として送ってくるため、優先して使用する
const SCRAPER_TOKEN = process.env.FIRECRAWL_API_KEY ?? process.env.SCRAPER_TOKEN ?? MCP_TOKEN

const scrapeBodySchema = z.object({
  url: z.string().url(),
  formats: z.array(z.string()).optional(),
  onlyMainContent: z.boolean().optional(),
  timeout: z.number().optional(),
})

/** Firecrawl /v1/scrape 互換エンドポイントをマウントする */
function mountScraper(app: Hono) {
  app.post('/v1/scrape', async (c) => {
    // Bearer トークン認証
    if (SCRAPER_TOKEN) {
      const auth = c.req.header('Authorization') ?? ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
      if (token !== SCRAPER_TOKEN) {
        return c.json({ success: false, error: 'Unauthorized' }, 401)
      }
    }

    const body = await c.req.json().catch(() => null)
    const parsed = scrapeBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400)
    }

    const { url, onlyMainContent, timeout } = parsed.data
    try {
      const result = await scrapeUrl(url, {
        ...(onlyMainContent !== undefined && { onlyMainContent }),
        ...(timeout !== undefined && { timeout }),
      })
      return c.json({ success: true, data: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ success: false, error: message }, 500)
    }
  })
}

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
      // MCP_TOKEN 未設定でも hono.ts の Bearer 検証で全拒否になるが、明示的に通知する
      console.error('[minakata] MCP_TOKEN is not set — all /mcp requests will be rejected with 401')
    }

    app.get('/health', (c) => c.json({ status: 'ok' }))
    mountScraper(app)
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
