import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArticleService, GitService } from '../src/article/index.ts'
import { AuthService } from '../src/auth/index.ts'
import { openTestDb } from '../src/db/index.ts'
import { FeedbackService } from '../src/feedback/index.ts'

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'minakata-feedback-'))
  const db = openTestDb()
  const git = new GitService(dir)
  const articles = new ArticleService(db, dir, git)
  const auth = new AuthService(db)
  const feedback = new FeedbackService(db)
  const user = await auth.createAdminInitial('a@x', 'p123pass')
  return {
    db,
    articles,
    auth,
    feedback,
    user,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

describe('FeedbackService', () => {
  test('toggle でいいねが付き、再度 toggle で外れる', async () => {
    const { db, articles, feedback, user, cleanup } = await setup()
    const a = await articles.create({
      title: 'Bun',
      slug: 'bun',
      body: 'x',
      status: 'published',
      author: 'researcher',
    })
    const id = a.frontmatter.id

    const r1 = feedback.toggle(id, user.id)
    expect(r1.liked).toBe(true)
    expect(r1.count).toBe(1)
    expect(feedback.isLikedBy(id, user.id)).toBe(true)

    const r2 = feedback.toggle(id, user.id)
    expect(r2.liked).toBe(false)
    expect(r2.count).toBe(0)
    expect(feedback.isLikedBy(id, user.id)).toBe(false)
    db.close()
    cleanup()
  })

  test('countsFor で複数記事のいいね数をまとめて引ける', async () => {
    const { db, articles, feedback, user, cleanup } = await setup()
    const a = await articles.create({ title: 'A', slug: 'a', body: 'x', author: 'r' })
    const b = await articles.create({ title: 'B', slug: 'b', body: 'x', author: 'r' })
    feedback.toggle(a.frontmatter.id, user.id)
    const counts = feedback.countsFor([a.frontmatter.id, b.frontmatter.id])
    expect(counts[a.frontmatter.id]).toBe(1)
    expect(counts[b.frontmatter.id]).toBeUndefined()
    db.close()
    cleanup()
  })

  test('insights は更新後に往復する', async () => {
    const { db, feedback, user, cleanup } = await setup()
    expect(feedback.getInsights().body_md).toBe('')
    feedback.updateInsights('# 傾向\n- 短い記事が好まれる', `user:${user.id}`)
    const got = feedback.getInsights()
    expect(got.body_md).toContain('短い記事')
    expect(got.updated_by).toBe(`user:${user.id}`)
    db.close()
    cleanup()
  })

  test('signals は published のいいね記事と未いいね記事を分けて返す', async () => {
    const { db, articles, feedback, user, cleanup } = await setup()
    const liked = await articles.create({
      title: 'Liked',
      slug: 'liked',
      body: 'x',
      status: 'published',
      author: 'r',
    })
    await articles.create({
      title: 'Cold',
      slug: 'cold',
      body: 'x',
      status: 'published',
      author: 'r',
    })
    feedback.toggle(liked.frontmatter.id, user.id)

    const s = feedback.signals({ limit: 10 })
    expect(s.total_likes).toBe(1)
    expect(s.top_liked.map((a) => a.slug)).toEqual(['liked'])
    expect(s.top_liked[0]?.like_count).toBe(1)
    expect(s.unliked.map((a) => a.slug)).toContain('cold')
    expect(s.unliked.map((a) => a.slug)).not.toContain('liked')
    db.close()
    cleanup()
  })
})
