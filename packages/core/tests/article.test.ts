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

  test('FTS5 全文検索でヒットする(snippet は HTML ではなく SnippetSegment[])', async () => {
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
    // 生 HTML 文字列を返さず、mark 区間が SnippetSegment として分解されていること
    const segments = hits[0]?.snippet ?? []
    expect(Array.isArray(segments)).toBe(true)
    expect(segments.some((s) => s.mark && /JavaScript/i.test(s.text))).toBe(true)
    expect(segments.every((s) => !s.text.includes('<mark>'))).toBe(true)
    db.close()
    cleanup()
  })

  test('snippet に <script> 等の HTML がある本文でも、出力にタグが含まれない(XSS 防止)', async () => {
    const { db, articles, search, cleanup } = setup()
    await articles.create({
      title: 'X',
      slug: 'xss-test',
      body: 'innocuous <script>alert(1)</script> JavaScript attack',
      author: 'agent:researcher',
    })
    const hits = search.fulltext({ q: 'JavaScript' })
    const concat = (hits[0]?.snippet ?? []).map((s) => s.text).join('')
    // 区間テキストには raw タグ文字が含まれていても、`SnippetSegment` の text プロパティ
    // はそのまま React テキストノードとして渡るので JSX レンダリング時に自動エスケープされる
    expect(concat).toContain('<script>')
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

  test('create で sources を受け、frontmatter / Markdown に反映される', async () => {
    const { db, articles, cleanup } = setup()
    const created = await articles.create({
      title: 'with-sources',
      slug: 'with-sources',
      body: 'body',
      author: 'agent:researcher',
      sources: [
        {
          url: 'https://example.com/a',
          fetched_at: '2026-05-23T00:00:00.000Z',
          archive_url: null,
          used_in_sections: ['intro'],
        },
      ],
    })
    expect(created.frontmatter.sources).toHaveLength(1)
    expect(created.frontmatter.sources[0]?.url).toBe('https://example.com/a')
    // 再読み込みでも frontmatter から復元されること
    const read = articles.read(created.frontmatter.id)
    expect(read?.frontmatter.sources).toHaveLength(1)
    db.close()
    cleanup()
  })

  test('update で add_sources を append できる', async () => {
    const { db, articles, cleanup } = setup()
    const created = await articles.create({
      title: 't',
      slug: 'src-update',
      body: 'body',
      author: 'agent:researcher',
      sources: [
        {
          url: 'https://example.com/a',
          fetched_at: '2026-05-23T00:00:00.000Z',
          archive_url: null,
          used_in_sections: ['intro'],
        },
      ],
    })
    await articles.update({
      id: created.frontmatter.id,
      author: 'agent:researcher',
      add_sources: [
        {
          url: 'https://example.com/b',
          fetched_at: '2026-05-23T01:00:00.000Z',
          archive_url: null,
          used_in_sections: ['details'],
        },
      ],
    })
    const read = articles.read(created.frontmatter.id)
    expect(read?.frontmatter.sources).toHaveLength(2)
    expect(read?.frontmatter.sources[1]?.url).toBe('https://example.com/b')
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
