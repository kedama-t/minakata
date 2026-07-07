import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityService,
  ArchiveProposalService,
  ArticleService,
  AuditService,
  BackupService,
  CommentService,
  DocumentService,
  FeedbackService,
  GitService,
  MaintenanceService,
  MessageService,
  PolicyService,
  ReviewService,
  SearchService,
  SkillProposalService,
  TaskService,
  TopicService,
  openTestDb,
} from '@minakata/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServices } from '../src/index.ts'
import { registerAllTools } from '../src/tools.ts'

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'minakata-updategate-'))
  const db = openTestDb()
  const git = new GitService(dir)
  const articles = new ArticleService(db, dir, git)
  const tasks = new TaskService(db)
  const archives = new ArchiveProposalService(db, articles)
  const services: McpServices = {
    articles,
    search: new SearchService(db),
    messages: new MessageService(db),
    tasks,
    audit: new AuditService(db),
    activity: new ActivityService(db),
    maintenance: new MaintenanceService(db, join(dir, 'snapshots')),
    backup: new BackupService(db, { backupDir: join(dir, 'backup'), articlesRoot: dir }),
    reviews: new ReviewService(db, articles, tasks),
    policy: new PolicyService(db),
    comments: new CommentService(db),
    feedback: new FeedbackService(db),
    skills: new SkillProposalService(db, join(dir, 'skills')),
    archives,
    topics: new TopicService(db),
    documents: new DocumentService(db, join(dir, 'documents')),
  }
  const server = new McpServer({ name: 'test', version: '0.0.1' })
  registerAllTools(server, services)
  const client = new Client({ name: 'test-client', version: '0.0.1' })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(st), client.connect(ct)])
  return {
    client,
    articles,
    archives,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function parse(res: unknown): Record<string, unknown> {
  const content = (res as { content: { text: string }[] }).content
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>
}

describe('update_article の status 承認ゲート回避防止 (H2)', () => {
  test('status=archived は即時反映せずアーカイブ提案に変換される', async () => {
    const { client, articles, archives, cleanup } = await setup()
    try {
      const created = await articles.create({
        title: 'T',
        slug: 'gate-arch',
        body: '本文',
        author: 'researcher',
      })
      const id = created.frontmatter.id

      const res = await client.callTool({
        name: 'minakata.update_article',
        arguments: { id, status: 'archived', author: 'researcher' },
      })
      const out = parse(res)

      // 提案止まりで pending_approval を返す
      expect(out.status).toBe('pending_approval')
      expect(typeof out.proposal_id).toBe('string')
      // 記事自体は archived になっていない(即時反映されない)
      expect(articles.read(id)?.frontmatter.status).not.toBe('archived')
      // アーカイブ提案が 1 件登録されている
      expect(archives.list('proposed').some((p) => p.article_id === id)).toBe(true)
    } finally {
      cleanup()
    }
  })

  test('status=published/draft はエージェントから設定できない(拒否)', async () => {
    const { client, articles, cleanup } = await setup()
    try {
      const created = await articles.create({
        title: 'T2',
        slug: 'gate-pub',
        body: '本文',
        status: 'draft',
        author: 'researcher',
      })
      const id = created.frontmatter.id

      for (const status of ['published', 'pending_approval', 'draft'] as const) {
        const res = await client.callTool({
          name: 'minakata.update_article',
          arguments: { id, status, author: 'researcher' },
        })
        expect((res as { isError?: boolean }).isError).toBe(true)
      }
      // 記事の status は draft のまま(変更されていない)
      expect(articles.read(id)?.frontmatter.status).toBe('draft')
    } finally {
      cleanup()
    }
  })

  test('status を伴わないメタデータ更新は従来どおり反映される', async () => {
    const { client, articles, cleanup } = await setup()
    try {
      const created = await articles.create({
        title: 'T3',
        slug: 'gate-meta',
        body: '本文',
        author: 'researcher',
      })
      const id = created.frontmatter.id

      const res = await client.callTool({
        name: 'minakata.update_article',
        arguments: { id, tags: ['x', 'y'], author: 'researcher' },
      })
      expect(parse(res).status).toBe('applied')
      expect(articles.read(id)?.frontmatter.tags).toEqual(['x', 'y'])
    } finally {
      cleanup()
    }
  })
})
