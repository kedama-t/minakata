import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArticleService, GitService } from '../src/article/index.ts'
import { openTestDb } from '../src/db/index.ts'
import { SearchService } from '../src/search/index.ts'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'minakata-article-'))
  const db = openTestDb()
  const git = new GitService(dir)
  const articles = new ArticleService(db, dir, git)
  const search = new SearchService(db)
  return { dir, db, articles, search, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('ArticleService', () => {
  test('create → read で frontmatter と body が往復する', async () => {
    const { db, articles, cleanup } = setup()
    const created = await articles.create({
      title: 'React Router v7',
      slug: 'react-router-v7',
      body: '# Hello\n\nBody',
      tags: ['react'],
      author: 'agent:researcher',
    })
    const read = articles.read(created.frontmatter.id)
    expect(read?.frontmatter.title).toBe('React Router v7')
    expect(read?.body.trim()).toBe('# Hello\n\nBody')
    db.close()
    cleanup()
  })

  test('FTS5 全文検索でヒットする', async () => {
    const { db, articles, search, cleanup } = setup()
    await articles.create({
      title: 'Bun runtime',
      slug: 'bun-runtime',
      body: 'Bun is a fast JavaScript runtime.',
      author: 'agent:researcher',
    })
    const hits = search.fulltext({ q: 'JavaScript' })
    expect(hits.length).toBe(1)
    expect(hits[0]?.slug).toBe('bun-runtime')
    expect(hits[0]?.snippet).toContain('<mark>')
    db.close()
    cleanup()
  })

  test('update で frontmatter のタイトルと updated_at が更新される', async () => {
    const { db, articles, cleanup } = setup()
    const a = await articles.create({
      title: 'old',
      slug: 'x',
      body: 'old body',
      author: 'agent:researcher',
    })
    const before = a.frontmatter.updated_at
    await Bun.sleep(5)
    await articles.update({
      id: a.frontmatter.id,
      title: 'new',
      body: 'new body',
      author: 'user:editor',
    })
    const after = articles.read(a.frontmatter.id)
    expect(after).not.toBeNull()
    expect(after?.frontmatter.title).toBe('new')
    expect(after && after.frontmatter.updated_at > before).toBe(true)
    db.close()
    cleanup()
  })

  test('create / update / read は SHA-256 hex(64文字)の content_hash を返す', async () => {
    const { db, articles, cleanup } = setup()
    const created = await articles.create({
      title: 'hashed',
      slug: 'hashed',
      body: 'body v1',
      author: 'agent:researcher',
    })
    expect(created.content_hash).toMatch(/^[0-9a-f]{64}$/)

    const read = articles.read(created.frontmatter.id)
    expect(read?.content_hash).toBe(created.content_hash)

    const updated = await articles.update({
      id: created.frontmatter.id,
      body: 'body v2',
      author: 'agent:researcher',
    })
    expect(updated.content_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(updated.content_hash).not.toBe(created.content_hash)
    db.close()
    cleanup()
  })
})
