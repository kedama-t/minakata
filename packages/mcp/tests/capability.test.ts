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
import { Hono } from 'hono'
import { type McpServices, mountMcp } from '../src/index.ts'
import { isToolAllowed } from '../src/tools.ts'

function buildServices(): { services: McpServices; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'minakata-cap-'))
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
  }
  return { services, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** initialize 後に tools/list を呼び、公開ツール名の配列を返す */
async function listTools(app: Hono, bearer: string): Promise<string[]> {
  const req = (id: number, method: string, params: unknown) =>
    app.request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        host: 'localhost',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
  await req(0, 'initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'test', version: '0.0.1' },
    capabilities: {},
  })
  const res = await req(1, 'tools/list', {})
  const body = (await res.json()) as { result?: { tools?: { name: string }[] } }
  return body.result?.tools?.map((t) => t.name) ?? []
}

describe('capability 分離 (#208)', () => {
  test('isToolAllowed: 未指定 agent / 未登録 agent は全許可', () => {
    expect(isToolAllowed(undefined, 'minakata.create_article')).toBe(true)
    expect(isToolAllowed(undefined, 'minakata.archive_article')).toBe(true)
    // backup_agent は CAPABILITIES 未登録 → 当面全許可
    expect(isToolAllowed('backup_agent', 'minakata.backup')).toBe(true)
  })

  test('isToolAllowed: reviser は読み取り + 軽微修正のみ許可', () => {
    // 許可: 読み取り + update_article + タスク + コメント返信
    expect(isToolAllowed('reviser', 'minakata.read_article')).toBe(true)
    expect(isToolAllowed('reviser', 'minakata.update_article')).toBe(true)
    expect(isToolAllowed('reviser', 'minakata.poll_tasks')).toBe(true)
    expect(isToolAllowed('reviser', 'minakata.enqueue_task')).toBe(true)
    expect(isToolAllowed('reviser', 'minakata.reply_article_comment')).toBe(true)
    // 不許可: 新規作成・破壊的操作・スキル・保守
    expect(isToolAllowed('reviser', 'minakata.create_article')).toBe(false)
    expect(isToolAllowed('reviser', 'minakata.archive_article')).toBe(false)
    expect(isToolAllowed('reviser', 'minakata.propose_skill')).toBe(false)
    expect(isToolAllowed('reviser', 'minakata.backup')).toBe(false)
    expect(isToolAllowed('reviser', 'minakata.update_feedback_insights')).toBe(false)
  })

  test('isToolAllowed: dialogue は記事の書き込みができない', () => {
    expect(isToolAllowed('dialogue', 'minakata.poll_messages')).toBe(true)
    expect(isToolAllowed('dialogue', 'minakata.fulltext_search')).toBe(true)
    expect(isToolAllowed('dialogue', 'minakata.create_article')).toBe(false)
    expect(isToolAllowed('dialogue', 'minakata.update_article')).toBe(false)
  })

  test('レガシー共有トークンは全ツールが見える(後方互換)', async () => {
    const { services, cleanup } = buildServices()
    const app = new Hono()
    mountMcp(app, { token: 'legacy', services })
    const names = await listTools(app, 'legacy')
    expect(names).toContain('minakata.create_article')
    expect(names).toContain('minakata.archive_article')
    expect(names).toContain('minakata.update_article')
    cleanup()
  })

  test('reviser トークンでは制限ツールが tools/list から消える', async () => {
    const { services, cleanup } = buildServices()
    const app = new Hono()
    mountMcp(app, {
      token: 'legacy',
      agentTokens: { 'reviser-secret': 'reviser' },
      services,
    })
    const names = await listTools(app, 'reviser-secret')
    // 許可ツールは見える
    expect(names).toContain('minakata.read_article')
    expect(names).toContain('minakata.update_article')
    expect(names).toContain('minakata.poll_tasks')
    // 制限ツールは公開されない
    expect(names).not.toContain('minakata.create_article')
    expect(names).not.toContain('minakata.archive_article')
    expect(names).not.toContain('minakata.propose_skill')
    expect(names).not.toContain('minakata.backup')
    cleanup()
  })

  test('未知のトークンは 401', async () => {
    const { services, cleanup } = buildServices()
    const app = new Hono()
    mountMcp(app, {
      token: 'legacy',
      agentTokens: { 'reviser-secret': 'reviser' },
      services,
    })
    const res = await app.request('http://localhost/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', host: 'localhost' },
    })
    expect(res.status).toBe(401)
    cleanup()
  })
})
