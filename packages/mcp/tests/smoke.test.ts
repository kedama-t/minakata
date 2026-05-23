import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ArchiveProposalService,
  ArticleService,
  AuditService,
  CommentService,
  GitService,
  MaintenanceService,
  MessageService,
  PolicyService,
  ReviewService,
  SearchService,
  SkillProposalService,
  TaskService,
  openTestDb,
} from '@minakata/core'
import { Hono } from 'hono'
import { type McpServices, mountMcp } from '../src/index.ts'

function buildServices(): { services: McpServices; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'minakata-mcp-'))
  const db = openTestDb()
  const git = new GitService(dir)
  const articles = new ArticleService(db, dir, git)
  const tasks = new TaskService(db)
  const services: McpServices = {
    articles,
    search: new SearchService(db),
    messages: new MessageService(db),
    tasks,
    audit: new AuditService(db),
    maintenance: new MaintenanceService(db),
    reviews: new ReviewService(db, articles, tasks),
    policy: new PolicyService(db),
    comments: new CommentService(db),
    skills: new SkillProposalService(db, join(dir, 'skills')),
    archives: new ArchiveProposalService(db, articles),
  }
  return { services, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('mountMcp', () => {
  test('token なしは 401', async () => {
    const { services, cleanup } = buildServices()
    const app = new Hono()
    mountMcp(app, { token: 't', services })
    const res = await app.request('/mcp', { method: 'POST' })
    expect(res.status).toBe(401)
    cleanup()
  })

  test('initialize → list_tools で Phase 1 ツールが見える', async () => {
    const { services, cleanup } = buildServices()
    const app = new Hono()
    mountMcp(app, { token: 't', services })

    // 1) initialize
    const init = await app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer t',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'test', version: '0.0.1' },
          capabilities: {},
        },
      }),
    })
    expect(init.status).toBe(200)

    // 2) tools/list
    const list = await app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer t',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { result?: { tools?: { name: string }[] } }
    const names = body.result?.tools?.map((t) => t.name) ?? []
    expect(names).toContain('minakata.read_article')
    expect(names).toContain('minakata.fulltext_search')
    expect(names).toContain('minakata.enqueue_task')
    expect(names).toContain('minakata.poll_messages')
    cleanup()
  })

  test('update_article は 30% 超変更時に pending_approval で保留する(US-6.2)', async () => {
    const { services, cleanup } = buildServices()
    const app = new Hono()
    mountMcp(app, { token: 't', services })
    const call = async (method: string, params: unknown, id: number) => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer t',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      })
      return (await res.json()) as { result?: { structuredContent?: Record<string, unknown> } }
    }
    await call(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'test', version: '0.0.1' },
        capabilities: {},
      },
      0,
    )

    const created = await call(
      'tools/call',
      {
        name: 'minakata.create_article',
        arguments: {
          title: 'T',
          slug: 'gate-test',
          body: 'short original',
          author: 'agent:researcher',
        },
      },
      1,
    )
    const newId = (created.result?.structuredContent as { id: string }).id

    // 大幅書き換え(30% 超)を試す
    const updated = await call(
      'tools/call',
      {
        name: 'minakata.update_article',
        arguments: {
          id: newId,
          body: 'completely different body text that exceeds threshold by far',
          author: 'agent:researcher',
        },
      },
      2,
    )
    const result = updated.result?.structuredContent as {
      id: string
      status: string
      review_id?: string
    }
    expect(result.status).toBe('pending_approval')
    expect(result.review_id).toMatch(/^[0-9A-Z]{26}$/)

    // 記事の本文はまだ書き換わらず、status だけ pending_approval
    const article = services.articles.read(newId)
    expect(article?.body.trim()).toBe('short original')
    expect(article?.frontmatter.status).toBe('pending_approval')

    // 保留中のレビューが 1 件あること
    const pending = services.reviews.listPending()
    expect(pending.length).toBe(1)
    expect(pending[0]?.article_id).toBe(newId)

    cleanup()
  })

  test('create_article / update_article は sources / add_sources を frontmatter に保存する(US-5.1)', async () => {
    const { services, cleanup } = buildServices()
    const app = new Hono()
    mountMcp(app, { token: 't', services })
    const call = async (method: string, params: unknown, id: number) => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer t',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      })
      return (await res.json()) as { result?: { structuredContent?: Record<string, unknown> } }
    }
    await call(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'test', version: '0.0.1' },
        capabilities: {},
      },
      0,
    )

    const created = await call(
      'tools/call',
      {
        name: 'minakata.create_article',
        arguments: {
          title: 'T',
          slug: 'src-mcp',
          body: 'body',
          author: 'agent:researcher',
          sources: [
            {
              url: 'https://example.com/x',
              fetched_at: '2026-05-23T00:00:00.000Z',
              used_in_sections: ['intro'],
            },
          ],
        },
      },
      1,
    )
    const newId = (created.result?.structuredContent as { id: string }).id
    const readAfterCreate = services.articles.read(newId)
    expect(readAfterCreate?.frontmatter.sources).toHaveLength(1)

    await call(
      'tools/call',
      {
        name: 'minakata.update_article',
        arguments: {
          id: newId,
          author: 'agent:researcher',
          add_sources: [
            {
              url: 'https://example.com/y',
              fetched_at: '2026-05-23T01:00:00.000Z',
              used_in_sections: ['details'],
            },
          ],
        },
      },
      2,
    )
    const readAfterUpdate = services.articles.read(newId)
    expect(readAfterUpdate?.frontmatter.sources.map((s) => s.url)).toEqual([
      'https://example.com/x',
      'https://example.com/y',
    ])

    cleanup()
  })

  test('create_article / update_article の audit log は SHA-256 hex で hash を記録する', async () => {
    const { services, cleanup } = buildServices()
    const app = new Hono()
    mountMcp(app, { token: 't', services })

    const call = async (method: string, params: unknown, id: number) => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer t',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      })
      return (await res.json()) as {
        result?: { structuredContent?: Record<string, unknown> }
      }
    }
    await call(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'test', version: '0.0.1' },
        capabilities: {},
      },
      0,
    )

    const created = await call(
      'tools/call',
      {
        name: 'minakata.create_article',
        arguments: { title: 'T', slug: 't1', body: 'body v1', author: 'agent:researcher' },
      },
      1,
    )
    const newId = (created.result?.structuredContent as { id: string }).id
    await call(
      'tools/call',
      {
        name: 'minakata.update_article',
        arguments: { id: newId, body: 'body v2', author: 'agent:researcher' },
      },
      2,
    )

    const audit = services.audit.list()
    const createLog = audit.find((l) => l.tool_name === 'minakata.create_article')
    const updateLog = audit.find((l) => l.tool_name === 'minakata.update_article')
    expect(createLog?.after_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(updateLog?.before_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(updateLog?.after_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(updateLog?.before_hash).not.toBe(updateLog?.after_hash)
    cleanup()
  })
})
