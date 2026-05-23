import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArticleService, GitService } from '../src/article/index.ts'
import { openTestDb } from '../src/db/index.ts'
import { EmbeddingService } from '../src/embedding/index.ts'
import { SearchService } from '../src/search/index.ts'

describe('SearchService.similar', () => {
  test('モック埋め込みで類似順に返す', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-sim-'))
    const db = openTestDb()
    const git = new GitService(dir)
    // モック extractor:タイトルの ASCII コード和を seed にした疑似ベクトル
    const embedding = new EmbeddingService()
    embedding.setExtractor(async (text) => {
      const vec = new Float32Array(768)
      // テキスト内の数字を「軸」にする — 同じ数字を含む passage は同じ次元を立てる
      const digits = text.match(/\d+/g) ?? ['0']
      for (const d of digits) {
        const idx = Number(d) % 768
        vec[idx] = 1
      }
      // 正規化
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

    const a = await articles.create({
      title: 'Article 1',
      slug: 'a1',
      body: 'this mentions 1',
      author: 'u',
    })
    const b = await articles.create({
      title: 'Article 2',
      slug: 'a2',
      body: 'related 1 again',
      author: 'u',
    })
    const c = await articles.create({
      title: 'Article 99',
      slug: 'a3',
      body: 'no overlap 99',
      author: 'u',
    })

    const sim = search.similar(a.frontmatter.id, 5)
    expect(sim.length).toBeGreaterThan(0)
    // a と b は両方とも数字 "1" を共有するので b が含まれるはず
    expect(sim.map((s) => s.id)).toContain(b.frontmatter.id)
    expect(sim.map((s) => s.id)).not.toContain(a.frontmatter.id) // 自身は除外
    // a と c は重なる軸がない → 距離が大きい(返ってきても優先度は低い)
    void c
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
