import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArticleService, GitService } from '../src/article/index.ts'
import { openTestDb } from '../src/db/index.ts'
import { MaintenanceService } from '../src/maintenance/index.ts'

/** DB の created_at を過去日に書き換える(create は now() 固定のため) */
function backdate(db: ReturnType<typeof openTestDb>, id: string, daysAgo: number): void {
  const ts = new Date(Date.now() - daysAgo * 86_400_000).toISOString()
  db.prepare('UPDATE articles SET created_at = ? WHERE id = ?').run(ts, id)
}

describe('MaintenanceService.expireEphemeral', () => {
  test('一過性記事を created_at 7 日経過で強制アーカイブする', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-expire-'))
    const db = openTestDb()
    const articles = new ArticleService(db, dir, new GitService(dir))
    const maintenance = new MaintenanceService(db, join(dir, 'snapshots'))

    const oldChangelog = await articles.create({
      title: 'old changelog',
      slug: 'old-changelog',
      body: 'x',
      author: 'u',
      source: 'agent_changelog',
    })
    const oldDaily = await articles.create({
      title: 'old daily',
      slug: 'old-daily',
      body: 'x',
      author: 'u',
      source: 'agent_daily',
    })
    const freshChangelog = await articles.create({
      title: 'fresh changelog',
      slug: 'fresh-changelog',
      body: 'x',
      author: 'u',
      source: 'agent_changelog',
    })
    const oldResearch = await articles.create({
      title: 'old research',
      slug: 'old-research',
      body: 'x',
      author: 'u',
      source: 'agent_research',
    })

    backdate(db, oldChangelog.frontmatter.id, 8)
    backdate(db, oldDaily.frontmatter.id, 8)
    backdate(db, freshChangelog.frontmatter.id, 6)
    backdate(db, oldResearch.frontmatter.id, 8)

    const result = await maintenance.expireEphemeral(articles, {
      kinds: ['agent_changelog', 'agent_daily'],
      max_age_days: 7,
      author: 'freshness_checker',
    })

    // 8 日経過の changelog / daily だけがアーカイブされる
    expect(result.archived).toBe(2)
    expect(result.ids.sort()).toEqual([oldChangelog.frontmatter.id, oldDaily.frontmatter.id].sort())

    const statusOf = (id: string) =>
      db.query<{ status: string }, [string]>('SELECT status FROM articles WHERE id = ?').get(id)
        ?.status
    expect(statusOf(oldChangelog.frontmatter.id)).toBe('archived')
    expect(statusOf(oldDaily.frontmatter.id)).toBe('archived')
    // 6 日経過の changelog と一過性でない研究記事は残る
    expect(statusOf(freshChangelog.frontmatter.id)).not.toBe('archived')
    expect(statusOf(oldResearch.frontmatter.id)).not.toBe('archived')

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('既に archived の記事は二重処理しない', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-expire-'))
    const db = openTestDb()
    const articles = new ArticleService(db, dir, new GitService(dir))
    const maintenance = new MaintenanceService(db, join(dir, 'snapshots'))

    const a = await articles.create({
      title: 'a',
      slug: 'a',
      body: 'x',
      author: 'u',
      source: 'agent_daily',
    })
    backdate(db, a.frontmatter.id, 10)

    const first = await maintenance.expireEphemeral(articles, {
      kinds: ['agent_daily'],
      max_age_days: 7,
      author: 'freshness_checker',
    })
    expect(first.archived).toBe(1)

    const second = await maintenance.expireEphemeral(articles, {
      kinds: ['agent_daily'],
      max_age_days: 7,
      author: 'freshness_checker',
    })
    expect(second.archived).toBe(0)
    expect(second.ids).toEqual([])

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
