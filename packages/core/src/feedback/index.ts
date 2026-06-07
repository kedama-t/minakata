import type { Db } from '../db/index.ts'
import { now } from '../util/id.ts'

/** 集計シグナルの 1 記事分。feedback_analyst が分析に使う */
export interface ArticleFeedbackStat {
  id: string
  slug: string
  title: string
  status: string
  tags: string[]
  source: string
  like_count: number
  comment_count: number
  updated_at: string
}

/** いいね/コメントの集計シグナル。自己改善ループの入力 */
export interface FeedbackSignals {
  generated_at: string
  total_likes: number
  /** いいねが多い順の上位記事 */
  top_liked: ArticleFeedbackStat[]
  /** published だがいいねが付いていない記事(対照群) */
  unliked: ArticleFeedbackStat[]
}

/** エージェントが自己改善ループで維持する執筆インサイト */
export interface FeedbackInsights {
  id: string
  body_md: string
  updated_at: string
  updated_by: string | null
}

interface StatRow {
  id: string
  slug: string
  title: string
  status: string
  tags_json: string
  source: string
  like_count: number
  comment_count: number
  updated_at: string
}

const STAT_SELECT = `
  SELECT a.id, a.slug, a.title, a.status, a.tags_json, a.source, a.updated_at,
         (SELECT COUNT(*) FROM article_likes l WHERE l.article_id = a.id) AS like_count,
         (SELECT COUNT(*) FROM article_comments c WHERE c.article_id = a.id) AS comment_count
  FROM articles a`

/**
 * フィードバックループ(#194)のドメインサービス。
 * - 記事いいねの付与/取消/集計(ユーザーからの非テキストフィードバック)
 * - feedback_insights の読み書き(エージェントの自己改善メモリ)
 * - feedback_analyst 向けの集計シグナル生成
 *
 * P4: いいね/集計/インサイトのロジックはここに一元化し、Web / MCP はこれを呼ぶだけ。
 */
export class FeedbackService {
  constructor(private readonly db: Db) {}

  // --- いいね ---

  /** いいねをトグルする。返り値は最新状態 */
  toggle(article_id: string, user_id: string): { liked: boolean; count: number } {
    const existing = this.db
      .query<{ n: number }, [string, string]>(
        'SELECT COUNT(*) AS n FROM article_likes WHERE article_id = ? AND user_id = ?',
      )
      .get(article_id, user_id)
    if (existing && existing.n > 0) {
      this.db
        .prepare('DELETE FROM article_likes WHERE article_id = ? AND user_id = ?')
        .run(article_id, user_id)
      return { liked: false, count: this.countByArticle(article_id) }
    }
    this.db
      .prepare(
        'INSERT OR IGNORE INTO article_likes (user_id, article_id, created_at) VALUES (?, ?, ?)',
      )
      .run(user_id, article_id, now())
    return { liked: true, count: this.countByArticle(article_id) }
  }

  countByArticle(article_id: string): number {
    return (
      this.db
        .query<{ n: number }, [string]>(
          'SELECT COUNT(*) AS n FROM article_likes WHERE article_id = ?',
        )
        .get(article_id)?.n ?? 0
    )
  }

  isLikedBy(article_id: string, user_id: string): boolean {
    const r = this.db
      .query<{ n: number }, [string, string]>(
        'SELECT COUNT(*) AS n FROM article_likes WHERE article_id = ? AND user_id = ?',
      )
      .get(article_id, user_id)
    return (r?.n ?? 0) > 0
  }

  /** 記事 ID → いいね数。一覧画面でまとめて引くため */
  countsFor(article_ids: string[]): Record<string, number> {
    const out: Record<string, number> = {}
    if (article_ids.length === 0) return out
    const placeholders = article_ids.map(() => '?').join(',')
    const rows = this.db
      .query<{ article_id: string; n: number }, string[]>(
        `SELECT article_id, COUNT(*) AS n FROM article_likes
         WHERE article_id IN (${placeholders}) GROUP BY article_id`,
      )
      .all(...article_ids)
    for (const r of rows) out[r.article_id] = r.n
    return out
  }

  // --- 自己改善インサイト ---

  getInsights(): FeedbackInsights {
    const r = this.db
      .query<FeedbackInsights, []>(
        "SELECT id, body_md, updated_at, updated_by FROM feedback_insights WHERE id = 'default'",
      )
      .get()
    return (
      r ?? { id: 'default', body_md: '', updated_at: '1970-01-01T00:00:00.000Z', updated_by: null }
    )
  }

  updateInsights(body_md: string, updated_by: string): void {
    this.db
      .prepare(
        "UPDATE feedback_insights SET body_md = ?, updated_at = ?, updated_by = ? WHERE id = 'default'",
      )
      .run(body_md, now(), updated_by)
  }

  // --- 集計シグナル ---

  /**
   * feedback_analyst 向けの集計シグナルを返す。
   * いいねが多い記事(成功例)と published だがいいねが付かない記事(対照例)を
   * それぞれ返し、エージェントが両者を読み比べて傾向を抽出できるようにする。
   */
  signals(opts: { limit?: number } = {}): FeedbackSignals {
    const limit = opts.limit ?? 10
    const total =
      this.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM article_likes').get()?.n ?? 0

    const topRows = this.db
      .query<StatRow, [number]>(
        `${STAT_SELECT}
         WHERE a.status = 'published'
         ORDER BY like_count DESC, a.updated_at DESC
         LIMIT ?`,
      )
      .all(limit)
      .filter((r) => r.like_count > 0)

    const unlikedRows = this.db
      .query<StatRow, [number]>(
        `${STAT_SELECT}
         WHERE a.status = 'published'
           AND (SELECT COUNT(*) FROM article_likes l WHERE l.article_id = a.id) = 0
         ORDER BY a.updated_at DESC
         LIMIT ?`,
      )
      .all(limit)

    return {
      generated_at: now(),
      total_likes: total,
      top_liked: topRows.map(toStat),
      unliked: unlikedRows.map(toStat),
    }
  }
}

function toStat(r: StatRow): ArticleFeedbackStat {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(r.tags_json)
    if (Array.isArray(parsed)) tags = parsed.map(String)
  } catch {
    // tags_json が壊れていても集計は続行する
  }
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    tags,
    source: r.source,
    like_count: r.like_count,
    comment_count: r.comment_count,
    updated_at: r.updated_at,
  }
}
