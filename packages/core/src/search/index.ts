import type { SQLQueryBindings } from 'bun:sqlite'
import type { Db } from '../db/index.ts'
import type { ArticleSourceKind, ArticleStatus } from '../schema/index.ts'

export interface SearchHit {
  id: string
  slug: string
  title: string
  status: ArticleStatus
  source: ArticleSourceKind
  tags: string[]
  snippet: string
  updated_at: string
}

export interface FulltextOptions {
  q: string
  status?: ArticleStatus | undefined
  /** archived を除外するか(デフォルト false = 含める) */
  excludeArchived?: boolean | undefined
  limit?: number | undefined
}

/**
 * 全文・タグ検索。FTS5 ベース、ベクトル類似度(`similar`)は M3 で実装。
 */
export class SearchService {
  constructor(private readonly db: Db) {}

  fulltext(opts: FulltextOptions): SearchHit[] {
    const limit = opts.limit ?? 20
    // articles_fts は article_id を持つので JOIN で articles と紐付ける
    const conditions: string[] = ['articles_fts MATCH ?']
    const params: SQLQueryBindings[] = [escapeFts5(opts.q)]
    if (opts.status) {
      conditions.push('a.status = ?')
      params.push(opts.status)
    } else if (opts.excludeArchived) {
      conditions.push("a.status != 'archived'")
    }
    params.push(limit)
    const rows = this.db
      .query<RawHit, SQLQueryBindings[]>(
        `SELECT a.id, a.slug, a.title, a.status, a.source, a.tags_json, a.updated_at,
                snippet(articles_fts, 2, '<mark>', '</mark>', '...', 16) AS snippet
         FROM articles_fts
         JOIN articles a ON a.id = articles_fts.article_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY a.updated_at DESC
         LIMIT ?`,
      )
      .all(...params)
    return rows.map(toHit)
  }

  /**
   * 類似記事(US-5.3)。`article_vec_map` 経由で対象記事の埋め込みを取り、KNN を回す。
   * 自身は除外して最大 `limit` 件返す。
   */
  similar(article_id: string, limit = 5): SearchHit[] {
    // article_vec_map が存在しなければ空(まだ埋め込み未生成)
    const exists = this.db
      .query<{ c: number }, []>(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE name='article_vec_map'",
      )
      .get()
    if (!exists || exists.c === 0) return []
    const own = this.db
      .query<{ rowid: number; embedding: Buffer }, [string]>(
        `SELECT m.rowid AS rowid, v.embedding AS embedding
         FROM article_vec_map m
         JOIN articles_vec v ON v.rowid = m.rowid
         WHERE m.article_id = ?`,
      )
      .get(article_id)
    if (!own) return []
    const neighbors = this.db
      .query<{ rowid: number; distance: number }, [Buffer, number]>(
        `SELECT rowid, distance FROM articles_vec
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`,
      )
      .all(own.embedding, limit + 1)
    const otherRowids = neighbors
      .filter((n) => n.rowid !== own.rowid)
      .slice(0, limit)
      .map((n) => n.rowid)
    if (otherRowids.length === 0) return []
    const placeholders = otherRowids.map(() => '?').join(',')
    return this.db
      .query<RawHit, number[]>(
        `SELECT a.id, a.slug, a.title, a.status, a.source, a.tags_json, a.updated_at,
                '' AS snippet
         FROM article_vec_map m JOIN articles a ON a.id = m.article_id
         WHERE m.rowid IN (${placeholders})`,
      )
      .all(...otherRowids)
      .map(toHit)
  }

  byTag(tag: string, limit = 50): SearchHit[] {
    // tags_json は JSON 文字列。全件読んで JS 側でフィルタ(MVP の規模なら問題なし)
    const rows = this.db
      .query<RawHit, []>(
        `SELECT id, slug, title, status, source, tags_json, updated_at,
                '' AS snippet
         FROM articles ORDER BY updated_at DESC`,
      )
      .all()
    return rows
      .map(toHit)
      .filter((h) => h.tags.includes(tag))
      .slice(0, limit)
  }
}

interface RawHit {
  id: string
  slug: string
  title: string
  status: ArticleStatus
  source: ArticleSourceKind
  tags_json: string
  snippet: string
  updated_at: string
}

function toHit(r: RawHit): SearchHit {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    source: r.source,
    tags: JSON.parse(r.tags_json) as string[],
    snippet: r.snippet,
    updated_at: r.updated_at,
  }
}

/** FTS5 の特殊文字をエスケープ。シンプルにダブルクオートで括る */
function escapeFts5(q: string): string {
  return `"${q.replace(/"/g, '""')}"`
}
