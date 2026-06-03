import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArticleService, GitService } from '../src/article/index.ts'
import { openTestDb } from '../src/db/index.ts'
import { EmbeddingService } from '../src/embedding/index.ts'
import { MaintenanceService } from '../src/maintenance/index.ts'
import { SearchService } from '../src/search/index.ts'

describe('MaintenanceService.reindexEmbeddings', () => {
  test('本文も含めて再埋め込みすることで類似検索が機能する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-reidx-'))
    const db = openTestDb()
    const git = new GitService(dir)
    const embedding = new EmbeddingService()
    // モック extractor:本文に含まれる数字を「軸」にする(タイトルだけでは差が出ない設計)
    embedding.setExtractor(async (text) => {
      const vec = new Float32Array(768)
      const digits = text.match(/\d+/g) ?? []
      for (const d of digits) {
        const idx = Number(d) % 768
        vec[idx] = 1
      }
      let norm = 0
      for (let i = 0; i < vec.length; i++) {
        const v = vec[i] ?? 0
        norm += v * v
      }
      const denom = Math.sqrt(norm) || 1
      for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / denom
      return vec
    })
    const articles = new ArticleService(db, dir, git, embedding)
    const search = new SearchService(db)
    const maintenance = new MaintenanceService(db, join(dir, 'snapshots'))

    // 全部同じタイトル。区別は本文中の数字のみ
    const a = await articles.create({ title: 'T', slug: 'a', body: 'mentions 1', author: 'u' })
    const b = await articles.create({ title: 'T', slug: 'b', body: 'related 1', author: 'u' })
    const c = await articles.create({ title: 'T', slug: 'c', body: 'unrelated 99', author: 'u' })

    // 既存埋め込みを破棄して再構築
    const result = await maintenance.reindexEmbeddings(articles)
    expect(result.reindexed).toBe(3)
    expect(result.failed).toBe(0)

    // a に対して similar は b を含み c を含まない
    // (タイトルだけだと a/b/c は同一の埋め込みになる → 本文を使えていれば区別がつく)
    const sim = search.similar(a.frontmatter.id, 5)
    expect(sim.map((s) => s.id)).toContain(b.frontmatter.id)
    expect(sim.map((s) => s.id)).not.toContain(a.frontmatter.id)
    void c

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
