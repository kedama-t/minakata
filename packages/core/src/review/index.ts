import type { ArticleService } from '../article/index.ts'
import type { Db } from '../db/index.ts'
import type { ArticleStatus } from '../schema/index.ts'
import type { TaskService } from '../task/index.ts'
import { sha256Hex } from '../util/hash.ts'
import { newId, now } from '../util/id.ts'

export interface ReviewRow {
  id: string
  article_id: string
  change_pct: number
  status: 'pending' | 'approved' | 'rejected'
  reviewer_id: string | null
  before_hash: string
  after_hash: string
  proposed_body: string
  /** 提案時点での記事 status(pending_approval にする前)。reject 時の復元先 */
  before_status: ArticleStatus | null
  created_at: string
  decided_at: string | null
}

export interface ReviewCommentRow {
  id: string
  review_id: string
  line_anchor: string | null
  body: string
  author_id: string
  resolved: boolean
  created_at: string
}

/**
 * 30% 超変更しきい値による承認ゲート(US-6.1, 6.2)。
 * - propose_update: 変更率を計測し、しきい値超なら reviews に保留、未満は直接反映
 * - approve: 保留中の proposed_body を実反映
 * - reject: 修正タスク(`revise`)をキューに投入し、reviewer フィードバックを伝える
 */
export class ReviewService {
  static readonly DEFAULT_THRESHOLD = 0.3

  constructor(
    private readonly db: Db,
    private readonly articles: ArticleService,
    private readonly tasks: TaskService,
  ) {}

  /**
   * 変更率(0..1)を計算する。
   * 複数行: 行単位 LCS で未変更行を除外してから比率を算出。
   * 1行: 文字単位のプレフィックス/サフィックス比較。
   */
  static computeChangePct(before: string, after: string): number {
    if (before === after) return 0
    const maxLen = Math.max(before.length, after.length)
    if (maxLen === 0) return 0

    const bLines = before.trimEnd().split('\n')
    const aLines = after.trimEnd().split('\n')

    if (bLines.length === 1 && aLines.length === 1) {
      return charChangePct(before, after)
    }

    const lcs = lineLCSLength(bLines, aLines)
    const maxLines = Math.max(bLines.length, aLines.length)
    return (maxLines - lcs) / maxLines
  }

  /**
   * 記事更新提案。しきい値以下なら即時反映、それ超なら review を保留する。
   * `proposed_body` には新しい本文を渡す。タイトル等は別途 articles.update で更新可能。
   */
  async proposeUpdate(input: {
    article_id: string
    proposed_body: string
    author: string
    /** デフォルト 0.3。0 なら常に保留(テスト用)、1 なら常に直接反映 */
    threshold?: number
    cost_usd?: number
  }): Promise<
    | { kind: 'applied'; article_id: string }
    | { kind: 'pending'; review_id: string; change_pct: number }
  > {
    const existing = this.articles.read(input.article_id)
    if (!existing) throw new Error(`article not found: ${input.article_id}`)
    const before = existing.body
    const after = input.proposed_body
    const changePct = ReviewService.computeChangePct(before, after)
    const threshold = input.threshold ?? ReviewService.DEFAULT_THRESHOLD
    if (changePct <= threshold) {
      await this.articles.update({
        id: input.article_id,
        body: after,
        author: input.author,
        ...(input.cost_usd !== undefined && { cost_usd: input.cost_usd }),
      })
      return { kind: 'applied', article_id: input.article_id }
    }
    const beforeHash = await sha256Hex(before)
    const afterHash = await sha256Hex(after)
    const beforeStatus = existing.frontmatter.status
    const id = newId()
    const ts = now()
    this.db
      .prepare(
        `INSERT INTO reviews (id, article_id, change_pct, status, before_hash, after_hash,
            proposed_body, before_status, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .run(id, input.article_id, changePct, beforeHash, afterHash, after, beforeStatus, ts)
    // 記事 status を pending_approval に立てる(UI で「保留中」を可視化)。
    // reject 時はこの beforeStatus に戻すことで「反映前の状態が source of truth」を維持(US-6.2)
    await this.articles.update({
      id: input.article_id,
      status: 'pending_approval',
      author: input.author,
      ...(input.cost_usd !== undefined && { cost_usd: input.cost_usd }),
    })
    return { kind: 'pending', review_id: id, change_pct: changePct }
  }

  async approve(review_id: string, reviewer_id: string): Promise<void> {
    const review = this.get(review_id)
    if (!review) throw new Error(`review not found: ${review_id}`)
    if (review.status !== 'pending') throw new Error(`review already decided: ${review.status}`)
    await this.articles.update({
      id: review.article_id,
      body: review.proposed_body,
      status: 'published',
      author: `user:${reviewer_id}`,
    })
    this.db
      .prepare(
        `UPDATE reviews SET status = 'approved', reviewer_id = ?, decided_at = ? WHERE id = ?`,
      )
      .run(reviewer_id, now(), review_id)
  }

  /** 差し戻し:status を rejected にし、修正タスクをキューに投入 */
  async reject(
    review_id: string,
    reviewer_id: string,
    comment: string,
  ): Promise<{ task_id: string }> {
    const review = this.get(review_id)
    if (!review) throw new Error(`review not found: ${review_id}`)
    if (review.status !== 'pending') throw new Error(`review already decided: ${review.status}`)
    const ts = now()
    this.db
      .prepare(
        `UPDATE reviews SET status = 'rejected', reviewer_id = ?, decided_at = ? WHERE id = ?`,
      )
      .run(reviewer_id, ts, review_id)
    // 記事 status を pending 前の状態に戻す。古い review レコードで before_status が
    // 無ければ 'published' にフォールバックする
    const restoredStatus: ArticleStatus = review.before_status ?? 'published'
    await this.articles.update({
      id: review.article_id,
      status: restoredStatus,
      author: `user:${reviewer_id}`,
    })
    const task = this.tasks.enqueue({
      type: 'revise',
      priority: 'interactive',
      payload: {
        article_id: review.article_id,
        reviewer_comment: comment,
        original_review_id: review_id,
      },
      parent_review_id: review_id,
    })
    return { task_id: task.id }
  }

  get(id: string): ReviewRow | null {
    const r = this.db
      .query<RawReview, [string]>(
        `SELECT id, article_id, change_pct, status, reviewer_id, before_hash, after_hash,
                proposed_body, before_status, created_at, decided_at
         FROM reviews WHERE id = ?`,
      )
      .get(id)
    return r ?? null
  }

  listPending(): ReviewRow[] {
    const rows = this.db
      .query<RawReview, []>(
        `SELECT id, article_id, change_pct, status, reviewer_id, before_hash, after_hash,
                proposed_body, before_status, created_at, decided_at
         FROM reviews WHERE status = 'pending' ORDER BY created_at DESC`,
      )
      .all()
    return rows
  }

  addComment(input: {
    review_id: string
    author_id: string
    body: string
    line_anchor?: string | null
  }): string {
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO review_comments (id, review_id, line_anchor, body, author_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.review_id, input.line_anchor ?? null, input.body, input.author_id, now())
    return id
  }

  listComments(review_id: string): ReviewCommentRow[] {
    const rows = this.db
      .query<RawComment, [string]>(
        `SELECT id, review_id, line_anchor, body, author_id, resolved, created_at
         FROM review_comments WHERE review_id = ? ORDER BY created_at`,
      )
      .all(review_id)
    return rows.map((r) => ({ ...r, resolved: r.resolved === 1 }))
  }
}

/** 文字単位のプレフィックス/サフィックス比較による変更率 */
function charChangePct(before: string, after: string): number {
  const max = Math.max(before.length, after.length)
  const min = Math.min(before.length, after.length)
  let common = 0
  for (let i = 0; i < min; i++) {
    if (before[i] !== after[i]) break
    common++
  }
  let tail = 0
  for (let i = 1; i <= min - common; i++) {
    if (before[before.length - i] !== after[after.length - i]) break
    tail++
  }
  return Math.max((max - common - tail) / max, (max - min) / max)
}

/** 行配列の LCS 長を O(m×n) DP・O(n) 空間で計算 */
function lineLCSLength(a: string[], b: string[]): number {
  const m = a.length
  const n = b.length
  let prev = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1).fill(0)
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, curr[j - 1] ?? 0)
    }
    prev = curr
  }
  return prev[n] ?? 0
}

interface RawReview {
  id: string
  article_id: string
  change_pct: number
  status: 'pending' | 'approved' | 'rejected'
  reviewer_id: string | null
  before_hash: string
  after_hash: string
  proposed_body: string
  before_status: ArticleStatus | null
  created_at: string
  decided_at: string | null
}

interface RawComment {
  id: string
  review_id: string
  line_anchor: string | null
  body: string
  author_id: string
  resolved: number
  created_at: string
}
