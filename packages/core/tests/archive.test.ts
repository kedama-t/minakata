import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArchiveProposalService } from '../src/archive/index.ts'
import { ArticleService, GitService } from '../src/article/index.ts'
import { AuthService } from '../src/auth/index.ts'
import { openTestDb } from '../src/db/index.ts'

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'minakata-archive-'))
  const db = openTestDb()
  const git = new GitService(dir)
  const articles = new ArticleService(db, dir, git)
  const archives = new ArchiveProposalService(db, articles)
  const auth = new AuthService(db)
  const admin = await auth.createAdminInitial('admin@x', 'pw_admin1')
  return {
    db,
    articles,
    archives,
    admin,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

describe('ArchiveProposalService', () => {
  test('propose は即時 archive せず提案行を残す', async () => {
    const { articles, archives, db, cleanup } = await setup()
    const a = await articles.create({
      title: 'T',
      slug: 'arch-1',
      body: 'body',
      author: 'agent:researcher',
    })
    const p = archives.propose({
      article_id: a.frontmatter.id,
      proposed_by: 'agent:freshness',
      reason: '30 日未アクセス',
    })
    expect(p.status).toBe('proposed')
    const reread = articles.read(a.frontmatter.id)
    expect(reread?.frontmatter.status).toBe('published') // まだ archived ではない
    db.close()
    cleanup()
  })

  test('同じ記事への重複 propose は既存提案を返す(冪等)', async () => {
    const { articles, archives, db, cleanup } = await setup()
    const a = await articles.create({
      title: 'T',
      slug: 'arch-2',
      body: 'body',
      author: 'agent:researcher',
    })
    const p1 = archives.propose({ article_id: a.frontmatter.id, proposed_by: 'agent:freshness' })
    const p2 = archives.propose({ article_id: a.frontmatter.id, proposed_by: 'agent:freshness' })
    expect(p2.id).toBe(p1.id)
    db.close()
    cleanup()
  })

  test('approve で記事が archived になる', async () => {
    const { articles, archives, admin, db, cleanup } = await setup()
    const a = await articles.create({
      title: 'T',
      slug: 'arch-3',
      body: 'body',
      author: 'agent:researcher',
    })
    const p = archives.propose({ article_id: a.frontmatter.id, proposed_by: 'agent:freshness' })
    await archives.approve(p.id, admin.id)
    const reread = articles.read(a.frontmatter.id)
    expect(reread?.frontmatter.status).toBe('archived')
    const got = archives.get(p.id)
    expect(got?.status).toBe('approved')
    db.close()
    cleanup()
  })

  test('reject で archived には遷移せず、決定理由が残る', async () => {
    const { articles, archives, admin, db, cleanup } = await setup()
    const a = await articles.create({
      title: 'T',
      slug: 'arch-4',
      body: 'body',
      author: 'agent:researcher',
    })
    const p = archives.propose({ article_id: a.frontmatter.id, proposed_by: 'agent:freshness' })
    await archives.reject(p.id, admin.id, 'まだ使う')
    const reread = articles.read(a.frontmatter.id)
    expect(reread?.frontmatter.status).toBe('published')
    const got = archives.get(p.id)
    expect(got?.status).toBe('rejected')
    expect(got?.decided_reason).toBe('まだ使う')
    // reject で last_accessed_at が更新され、再提案クールダウンが効く(#221)
    const accessed = db
      .query<{ last_accessed_at: string | null }, [string]>(
        'SELECT last_accessed_at FROM articles WHERE id = ?',
      )
      .get(a.frontmatter.id)
    expect(accessed?.last_accessed_at).not.toBeNull()
    // 却下後は再度 propose できる
    const p2 = archives.propose({ article_id: a.frontmatter.id, proposed_by: 'agent:freshness' })
    expect(p2.id).not.toBe(p.id)
    db.close()
    cleanup()
  })
})
