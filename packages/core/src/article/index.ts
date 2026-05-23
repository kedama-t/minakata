import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import matter from 'gray-matter'
import type { Db } from '../db/index.ts'
import type { EmbeddingService } from '../embedding/index.ts'
import {
  type ArticleFrontmatter,
  ArticleFrontmatterSchema,
  type ArticleSourceKind,
  type ArticleStatus,
} from '../schema/index.ts'
import { sha256Hex } from '../util/hash.ts'
import { newId, now } from '../util/id.ts'
import { GitService } from './git.ts'

export interface Article {
  frontmatter: ArticleFrontmatter
  body: string
  path: string
  /** Markdown 全体(frontmatter 含む)の SHA-256 hex。audit_log の before/after_hash に渡す */
  content_hash: string
}

export interface ArticleListItem {
  id: string
  slug: string
  title: string
  status: ArticleStatus
  source: ArticleSourceKind
  tags: string[]
  freshness_rank: string
  updated_at: string
  summary: string
}

export interface CreateArticleInput {
  title: string
  slug: string
  body: string
  status?: ArticleStatus | undefined
  source?: ArticleSourceKind | undefined
  tags?: string[] | undefined
  topic_id?: string | null | undefined
  summary?: string | undefined
  /** 出典(US-5.1 横断要件)。新規作成時から含めることが推奨 */
  sources?: ArticleFrontmatter['sources'] | undefined
  author: string
}

export interface UpdateArticleInput {
  id: string
  body?: string | undefined
  title?: string | undefined
  tags?: string[] | undefined
  status?: ArticleStatus | undefined
  summary?: string | undefined
  add_sources?: ArticleFrontmatter['sources'] | undefined
  last_researched_at?: string | undefined
  author: string
  /** LLM 呼び出しコスト(USD)を累計に加算 */
  cost_usd?: number | undefined
}

/**
 * 記事の CRUD。P3: Markdown が source of truth、SQLite は更新の都度再構築可能なインデックス。
 * 書き込み手順: frontmatter 構築 → Markdown 書き込み → DB トランザクション(articles + FTS5)→ Git commit。
 */
export class ArticleService {
  constructor(
    private readonly db: Db,
    private readonly articlesRoot: string,
    private readonly git: GitService,
    private readonly embedding?: EmbeddingService,
  ) {
    if (!existsSync(articlesRoot)) mkdirSync(articlesRoot, { recursive: true })
  }

  // --- 読み取り ---

  read(slugOrId: string): Article | null {
    const row = this.db
      .query<{ path: string; slug: string; content_hash: string }, [string, string]>(
        'SELECT path, slug, content_hash FROM articles WHERE id = ? OR slug = ? LIMIT 1',
      )
      .get(slugOrId, slugOrId)
    if (!row) return null
    const fullPath = join(this.articlesRoot, row.path)
    if (!existsSync(fullPath)) return null
    const raw = readFileSync(fullPath, 'utf8')
    const parsed = matter(raw)
    const frontmatter = ArticleFrontmatterSchema.parse(parsed.data)
    return { frontmatter, body: parsed.content, path: row.path, content_hash: row.content_hash }
  }

  list(
    opts: {
      status?: ArticleStatus | undefined
      limit?: number | undefined
      offset?: number | undefined
    } = {},
  ): ArticleListItem[] {
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0
    const status = opts.status
    const sql = status
      ? `SELECT id, slug, title, status, source, tags_json, freshness_rank, updated_at, summary
         FROM articles WHERE status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      : `SELECT id, slug, title, status, source, tags_json, freshness_rank, updated_at, summary
         FROM articles ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    const rows = status
      ? this.db.query<RawListRow, [string, number, number]>(sql).all(status, limit, offset)
      : this.db.query<RawListRow, [number, number]>(sql).all(limit, offset)
    return rows.map(toListItem)
  }

  // --- 書き込み ---

  async create(input: CreateArticleInput): Promise<Article> {
    const id = newId()
    const ts = now()
    const status = input.status ?? 'published'
    const source = input.source ?? 'agent_research'
    const frontmatter: ArticleFrontmatter = {
      id,
      title: input.title,
      slug: input.slug,
      status,
      source,
      tags: input.tags ?? [],
      topic_id: input.topic_id ?? null,
      sources: input.sources ?? [],
      created_at: ts,
      updated_at: ts,
      last_researched_at: ts,
      last_accessed_at: null,
      created_by: input.author,
      last_modified_by: input.author,
      summary: input.summary ?? '',
      related_to: [],
      cost_usd: 0,
      freshness_rank: 'fresh',
    }
    const relativePath = `${input.slug}.md`
    const { hash } = await this.persist(
      frontmatter,
      input.body,
      relativePath,
      input.author,
      'create',
    )
    return { frontmatter, body: input.body, path: relativePath, content_hash: hash }
  }

  async update(input: UpdateArticleInput): Promise<Article> {
    const existing = this.read(input.id)
    if (!existing) throw new Error(`article not found: ${input.id}`)
    const ts = now()
    const merged: ArticleFrontmatter = {
      ...existing.frontmatter,
      title: input.title ?? existing.frontmatter.title,
      tags: input.tags ?? existing.frontmatter.tags,
      status: input.status ?? existing.frontmatter.status,
      summary: input.summary ?? existing.frontmatter.summary,
      sources: input.add_sources
        ? [...existing.frontmatter.sources, ...input.add_sources]
        : existing.frontmatter.sources,
      last_researched_at: input.last_researched_at ?? existing.frontmatter.last_researched_at,
      last_modified_by: input.author,
      updated_at: ts,
      cost_usd: existing.frontmatter.cost_usd + (input.cost_usd ?? 0),
      freshness_rank: 'fresh',
    }
    const body = input.body ?? existing.body
    const { hash } = await this.persist(merged, body, existing.path, input.author, 'update')
    return { frontmatter: merged, body, path: existing.path, content_hash: hash }
  }

  async archive(id: string, author: string): Promise<void> {
    const existing = this.read(id)
    if (!existing) throw new Error(`article not found: ${id}`)
    await this.update({ id, status: 'archived', author })
  }

  /** アーカイブ解除(US-7.3)。再開後の urgent な再調査投入は呼び出し側で行う */
  async unarchive(id: string, author: string): Promise<void> {
    const existing = this.read(id)
    if (!existing) throw new Error(`article not found: ${id}`)
    if (existing.frontmatter.status !== 'archived') return
    await this.update({ id, status: 'published', author })
  }

  async touchAccessed(id: string): Promise<void> {
    const ts = now()
    this.db.prepare('UPDATE articles SET last_accessed_at = ? WHERE id = ?').run(ts, id)
  }

  // --- 内部 ---

  private async persist(
    fm: ArticleFrontmatter,
    body: string,
    relativePath: string,
    author: string,
    op: 'create' | 'update',
  ): Promise<{ hash: string }> {
    const fullPath = join(this.articlesRoot, relativePath)
    if (!existsSync(dirname(fullPath))) mkdirSync(dirname(fullPath), { recursive: true })
    const md = matter.stringify(body, fm)
    writeFileSync(fullPath, md, 'utf8')
    const hash = await sha256Hex(md)

    this.db.transaction(() => {
      if (op === 'create') {
        this.db
          .prepare(
            `INSERT INTO articles (id, slug, path, title, status, source, tags_json, topic_id,
              freshness_rank, last_researched_at, last_accessed_at, created_at, updated_at,
              content_hash, cost_usd, summary)
             VALUES ($id, $slug, $path, $title, $status, $source, $tags, $topic,
                     $rank, $researched, $accessed, $created, $updated, $hash, $cost, $summary)`,
          )
          .run({
            id: fm.id,
            slug: fm.slug,
            path: relativePath,
            title: fm.title,
            status: fm.status,
            source: fm.source,
            tags: JSON.stringify(fm.tags),
            topic: fm.topic_id ?? null,
            rank: fm.freshness_rank,
            researched: fm.last_researched_at ?? null,
            accessed: fm.last_accessed_at ?? null,
            created: fm.created_at,
            updated: fm.updated_at,
            hash,
            cost: fm.cost_usd,
            summary: fm.summary,
          })
      } else {
        this.db
          .prepare(
            `UPDATE articles SET title = $title, status = $status, tags_json = $tags,
              freshness_rank = $rank, last_researched_at = $researched,
              updated_at = $updated, content_hash = $hash, cost_usd = $cost, summary = $summary
             WHERE id = $id`,
          )
          .run({
            id: fm.id,
            title: fm.title,
            status: fm.status,
            tags: JSON.stringify(fm.tags),
            rank: fm.freshness_rank,
            researched: fm.last_researched_at ?? null,
            updated: fm.updated_at,
            hash,
            cost: fm.cost_usd,
            summary: fm.summary,
          })
      }
      // FTS5 再構築:rowid を articles.id に紐づける(string rowid は使えないので article_id カラムで参照)
      this.db.prepare('DELETE FROM articles_fts WHERE article_id = ?').run(fm.id)
      this.db
        .prepare('INSERT INTO articles_fts (article_id, title, body, tags) VALUES (?, ?, ?, ?)')
        .run(fm.id, fm.title, body, fm.tags.join(' '))
    })()

    // 埋め込み更新(EmbeddingService が注入されていれば)
    // sqlite-vec の articles_vec は rowid (INTEGER) を要求するため、article_vec_map で articles.id ↔ rowid を結びつける
    if (this.embedding) {
      try {
        await this.upsertEmbedding(fm.id, `${fm.title}\n\n${body}`)
      } catch (e) {
        // 埋め込み生成失敗は致命でない(後で reindex で復旧可能)
        console.warn('[ArticleService] embedding failed for', fm.id, e)
      }
    }

    await this.git.commitFile({
      relativePath,
      message: `${op}: ${fm.title}`,
      author,
    })
    return { hash }
  }

  private async upsertEmbedding(article_id: string, passageText: string): Promise<void> {
    if (!this.embedding) return
    const vec = await this.embedding.embedPassage(passageText)
    // article_id (TEXT) → articles_vec の rowid (INTEGER) を結びつける補助テーブル
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS article_vec_map (article_id TEXT PRIMARY KEY, rowid INTEGER NOT NULL UNIQUE)',
    )
    const buf = Buffer.from(vec.buffer as ArrayBuffer)
    const existing = this.db
      .query<{ rowid: number }, [string]>('SELECT rowid FROM article_vec_map WHERE article_id = ?')
      .get(article_id)
    if (existing) {
      this.db.prepare('DELETE FROM articles_vec WHERE rowid = ?').run(existing.rowid)
      this.db
        .prepare('INSERT INTO articles_vec(rowid, embedding) VALUES (?, ?)')
        .run(existing.rowid, buf)
      return
    }
    const next = this.db
      .query<{ next: number }, []>(
        'SELECT COALESCE(MAX(rowid), 0) + 1 AS next FROM article_vec_map',
      )
      .get()
    const rowid = next?.next ?? 1
    this.db.prepare('INSERT INTO articles_vec(rowid, embedding) VALUES (?, ?)').run(rowid, buf)
    this.db
      .prepare('INSERT INTO article_vec_map (article_id, rowid) VALUES (?, ?)')
      .run(article_id, rowid)
  }
}

interface RawListRow {
  id: string
  slug: string
  title: string
  status: ArticleStatus
  source: ArticleSourceKind
  tags_json: string
  freshness_rank: string
  updated_at: string
  summary: string
}

function toListItem(r: RawListRow): ArticleListItem {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    source: r.source,
    tags: JSON.parse(r.tags_json) as string[],
    freshness_rank: r.freshness_rank,
    updated_at: r.updated_at,
    summary: r.summary,
  }
}

export { GitService }
