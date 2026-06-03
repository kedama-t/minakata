import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ArticleService } from '../article/index.ts'
import type { Db } from '../db/index.ts'
import { runMigrations } from '../db/index.ts'
import type { EmbeddingService } from '../embedding/index.ts'
import { newId, now } from '../util/id.ts'

/**
 * メンテナンス系操作。Hermes が定期 cron で呼ぶ想定。
 * - runMigrations: 起動時の冪等マイグレーション(db/index.ts のラッパ)
 * - snapshot: SQLite の VACUUM INTO で別ファイルに退避(US-1.1 受け入れ条件)
 * - reindex: FTS5 + sqlite-vec の再インデックス(モデル変更時)
 */
export class MaintenanceService {
  private readonly snapshotDir: string

  constructor(
    private readonly db: Db,
    snapshotDir: string,
  ) {
    this.snapshotDir = resolve(snapshotDir)
    mkdirSync(this.snapshotDir, { recursive: true })
  }

  runMigrations(): void {
    runMigrations(this.db)
  }

  /** SQLite を固定ディレクトリ配下にファイル名指定で VACUUM INTO する。Hermes の `minakata.snapshot_db` から呼ぶ */
  snapshot(filename: string): { path: string; created_at: string } {
    if (!/^[a-z0-9_-]+\.sqlite$/.test(filename)) {
      throw new Error(
        'Invalid snapshot filename. Use lowercase letters, digits, hyphens, underscores, and .sqlite extension.',
      )
    }
    const toPath = join(this.snapshotDir, filename)
    // resolve 後もsnapshotDir配下であることを確認(パストラバーサル防止)
    if (
      !resolve(toPath).startsWith(`${this.snapshotDir}/`) &&
      resolve(toPath) !== this.snapshotDir
    ) {
      throw new Error('Snapshot path traversal detected.')
    }
    this.db.prepare('VACUUM INTO ?').run(toPath)
    return { path: toPath, created_at: now() }
  }

  /** 鮮度ランクの再計算(Hermes の freshness_checker から呼ぶ) */
  recomputeFreshness(thresholds: { aging_h: number; stale_h: number; very_stale_h: number }): {
    updated: number
  } {
    const ts = now()
    const ms = Date.parse(ts)
    const agingCut = new Date(ms - thresholds.aging_h * 3_600_000).toISOString()
    const staleCut = new Date(ms - thresholds.stale_h * 3_600_000).toISOString()
    const veryStaleCut = new Date(ms - thresholds.very_stale_h * 3_600_000).toISOString()
    let total = 0
    // 古い順から更新(very_stale → stale → aging → fresh)
    total += this.db
      .prepare(
        `UPDATE articles SET freshness_rank = 'very_stale'
         WHERE last_researched_at IS NOT NULL AND last_researched_at < ? AND freshness_rank != 'very_stale'`,
      )
      .run(veryStaleCut).changes
    total += this.db
      .prepare(
        `UPDATE articles SET freshness_rank = 'stale'
         WHERE last_researched_at IS NOT NULL AND last_researched_at < ? AND last_researched_at >= ?
           AND freshness_rank != 'stale'`,
      )
      .run(staleCut, veryStaleCut).changes
    total += this.db
      .prepare(
        `UPDATE articles SET freshness_rank = 'aging'
         WHERE last_researched_at IS NOT NULL AND last_researched_at < ? AND last_researched_at >= ?
           AND freshness_rank != 'aging'`,
      )
      .run(agingCut, staleCut).changes
    return { updated: total }
  }

  /** スナップショット用に新しい ID 付きのファイル名を生成する補助 */
  newSnapshotName(): string {
    return `${newId()}.db`
  }

  /**
   * 全記事の埋め込みを再生成する。モデル変更時に走らせる(M3-1)。
   * - 既存の articles_vec / article_vec_map は破棄して作り直す
   * - 各記事は ArticleService.recomputeEmbedding を経由して `${title}\n\n${body}`
   *   を passage として再インデックス(本文不在の近似ではなく実本文を使う)
   *
   * @param articles 本文を読み出すための ArticleService
   * @param _embedding 引数互換のために残す(ArticleService 経由で利用されるため未使用)
   */
  async reindexEmbeddings(
    articles: ArticleService,
    _embedding?: EmbeddingService,
  ): Promise<{ reindexed: number; failed: number }> {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS article_vec_map (article_id TEXT PRIMARY KEY, rowid INTEGER UNIQUE)',
    )
    this.db.exec('DELETE FROM articles_vec')
    this.db.exec('DELETE FROM article_vec_map')
    const rows = this.db.query<{ id: string }, []>('SELECT id FROM articles').all()
    let reindexed = 0
    let failed = 0
    for (const r of rows) {
      const ok = await articles.recomputeEmbedding(r.id)
      if (ok) reindexed += 1
      else failed += 1
    }
    return { reindexed, failed }
  }
}
