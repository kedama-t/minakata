import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArticleService, GitService } from '../src/article/index.ts'
import { AuthService } from '../src/auth/index.ts'
import { openTestDb } from '../src/db/index.ts'
import { ReviewService } from '../src/review/index.ts'
import { TaskService } from '../src/task/index.ts'

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'minakata-review-'))
  const db = openTestDb()
  const git = new GitService(dir)
  const articles = new ArticleService(db, dir, git)
  const tasks = new TaskService(db)
  const reviews = new ReviewService(db, articles, tasks)
  const auth = new AuthService(db)
  const reviewer = await auth.createAdminInitial('r@x', 'p1passwd')
  return {
    db,
    articles,
    tasks,
    reviews,
    reviewer,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

describe('ReviewService.computeChangePct', () => {
  test('完全一致なら 0', () => {
    expect(ReviewService.computeChangePct('abc', 'abc')).toBe(0)
  })
  test('完全に異なるなら 1', () => {
    expect(ReviewService.computeChangePct('abcdefghij', 'xxxxxxxxxx')).toBe(1)
  })
  test('一部変更', () => {
    expect(ReviewService.computeChangePct('hello world', 'hello WORLD')).toBeGreaterThan(0)
  })
  test('複数行: 末尾 1 行変更は低変更率', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const changed = lines.replace('line 99', 'line 99 updated')
    expect(ReviewService.computeChangePct(lines, changed)).toBeLessThan(0.3)
  })
  test('複数行: 散在する 5 行変更は低変更率', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const changedLines = lines
      .split('\n')
      .map((l, i) => ([10, 20, 50, 70, 90].includes(i) ? `${l} updated` : l))
      .join('\n')
    expect(ReviewService.computeChangePct(lines, changedLines)).toBeLessThan(0.3)
  })
  test('複数行: 過半数変更は高変更率', () => {
    const before = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const after = Array.from({ length: 100 }, (_, i) => `different ${i}`).join('\n')
    expect(ReviewService.computeChangePct(before, after)).toBeGreaterThan(0.3)
  })
})

describe('ReviewService.proposeUpdate', () => {
  test('しきい値以下なら直接 applied', async () => {
    const { articles, reviews, cleanup, db } = await setup()
    const a = await articles.create({
      title: 'T',
      slug: 't',
      body: 'aaaaaaaaaaaaaaaaaaaa', // 20 chars
      author: 'user:editor',
    })
    const result = await reviews.proposeUpdate({
      article_id: a.frontmatter.id,
      proposed_body: 'aaaaaaaaaaaaaaaaaaab', // 1 char 違い → 5%
      author: 'user:editor',
    })
    expect(result.kind).toBe('applied')
    db.close()
    cleanup()
  })

  test('しきい値超なら pending を返す', async () => {
    const { articles, reviews, cleanup, db } = await setup()
    const a = await articles.create({
      title: 'T',
      slug: 't2',
      body: 'aaaaaaaaaa', // 10 chars
      author: 'user:editor',
    })
    const result = await reviews.proposeUpdate({
      article_id: a.frontmatter.id,
      proposed_body: 'completely different content here',
      author: 'agent:researcher',
    })
    expect(result.kind).toBe('pending')
    const after = articles.read(a.frontmatter.id)
    expect(after?.frontmatter.status).toBe('pending_approval')
    db.close()
    cleanup()
  })

  test('approve で記事が更新される', async () => {
    const { articles, reviews, reviewer, cleanup, db } = await setup()
    const a = await articles.create({
      title: 'T',
      slug: 't3',
      body: 'short',
      author: 'user:editor',
    })
    const r = await reviews.proposeUpdate({
      article_id: a.frontmatter.id,
      proposed_body: 'a totally different body text',
      author: 'agent:researcher',
    })
    if (r.kind !== 'pending') throw new Error('expected pending')
    await reviews.approve(r.review_id, reviewer.id)
    const after = articles.read(a.frontmatter.id)
    expect(after?.body.trim()).toBe('a totally different body text')
    expect(after?.frontmatter.status).toBe('published')
    db.close()
    cleanup()
  })

  test('reject で revise タスクが投入される', async () => {
    const { articles, tasks, reviews, reviewer, cleanup, db } = await setup()
    const a = await articles.create({
      title: 'T',
      slug: 't4',
      body: 'short',
      author: 'user:editor',
    })
    const r = await reviews.proposeUpdate({
      article_id: a.frontmatter.id,
      proposed_body: 'a totally different body text',
      author: 'agent:researcher',
    })
    if (r.kind !== 'pending') throw new Error('expected pending')
    const { task_id } = await reviews.reject(r.review_id, reviewer.id, 'もっと出典を増やして')
    const task = tasks.get(task_id)
    expect(task?.type).toBe('revise')
    expect(task?.parent_review_id).toBe(r.review_id)
    const after = articles.read(a.frontmatter.id)
    expect(after?.frontmatter.status).toBe('published')
    db.close()
    cleanup()
  })

  test('reject は proposeUpdate 前の status (draft) に復元する', async () => {
    const { articles, reviews, reviewer, cleanup, db } = await setup()
    // 元が draft の記事
    const a = await articles.create({
      title: 'T',
      slug: 't5',
      body: 'short',
      status: 'draft',
      author: 'user:editor',
    })
    const r = await reviews.proposeUpdate({
      article_id: a.frontmatter.id,
      proposed_body: 'a totally different body text',
      author: 'agent:researcher',
    })
    if (r.kind !== 'pending') throw new Error('expected pending')
    // 中間状態は pending_approval
    expect(articles.read(a.frontmatter.id)?.frontmatter.status).toBe('pending_approval')

    await reviews.reject(r.review_id, reviewer.id, '修正してから出して')
    // reject で 'published' に上書きせず、元の draft に戻ること
    expect(articles.read(a.frontmatter.id)?.frontmatter.status).toBe('draft')
    db.close()
    cleanup()
  })
})
