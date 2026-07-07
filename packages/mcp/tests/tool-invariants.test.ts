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

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'minakata-invariants-'))
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
    activity: new ActivityService(db),
    maintenance: new MaintenanceService(db, join(dir, 'snapshots')),
    backup: new BackupService(db, { backupDir: join(dir, 'backup'), articlesRoot: dir }),
    reviews: new ReviewService(db, articles, tasks),
    policy: new PolicyService(db),
    comments: new CommentService(db),
    feedback: new FeedbackService(db),
    skills: new SkillProposalService(db, join(dir, 'skills')),
    archives: new ArchiveProposalService(db, articles),
    topics: new TopicService(db),
    documents: new DocumentService(db, join(dir, 'documents')),
  }
  const server = new McpServer({ name: 'test', version: '0.0.1' })
  registerAllTools(server, services)
  const client = new Client({ name: 'test-client', version: '0.0.1' })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(st), client.connect(ct)])
  try {
    return await fn(client)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('MCP ツール登録の不変条件 (L1)', () => {
  test('承認/却下(approve_/reject_)は MCP ツールとして公開されない', async () => {
    // 破壊的操作の human-in-the-loop 境界の要: 承認/却下は WebUI から core を直接
    // 呼ぶ設計で、エージェント(MCP)には決して公開しない。将来 approve_* ツールが
    // 誤って追加されると承認ゲートが崩れるため回帰テストで固定する(tech-stack §6/§8.1)。
    const names = await withClient(async (c) => (await c.listTools()).tools.map((t) => t.name))
    expect(names.filter((n) => /(approve|reject)/i.test(n))).toEqual([])
  })

  test('全ツールが minakata. 名前空間で登録される', async () => {
    const names = await withClient(async (c) => (await c.listTools()).tools.map((t) => t.name))
    expect(names.length).toBeGreaterThan(0)
    expect(names.every((n) => n.startsWith('minakata.'))).toBe(true)
  })

  test('破壊系ツールは未知キーを拒否する(.strict())', async () => {
    // propose_skill は admin 承認で SKILL.md として実行可能ファイルになる特権ツール。
    // 未知キーの混入(引数スマグリング)を拒否することを確認する。
    await withClient(async (client) => {
      const res = await client.callTool({
        name: 'minakata.propose_skill',
        arguments: { name: 'x', description: 'd', code: 'c', unexpected_field: 'evil' },
      })
      expect((res as { isError?: boolean }).isError).toBe(true)
      const text = (res as { content: { text: string }[] }).content[0]?.text ?? ''
      expect(text).toContain('nrecognized')
    })
  })
})
