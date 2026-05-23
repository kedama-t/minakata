import type { ArticleService } from '../article/index.ts'
import type { Db } from '../db/index.ts'
import { newId, now } from '../util/id.ts'

export interface ArchiveProposalRow {
  id: string
  article_id: string
  reason: string
  status: 'proposed' | 'approved' | 'rejected'
  proposed_by: string
  reviewer_id: string | null
  decided_reason: string | null
  created_at: string
  decided_at: string | null
}

/**
 * アーカイブ承認ゲート(tech-stack.md §6 / US-7.2)。
 * Hermes の freshness_checker や agent が archive を要求する場合、ここに proposed 行を残す。
 * admin が approve すると初めて ArticleService.archive で実 status を変える。
 * 既に proposed 中の記事に重複 propose した場合は既存行を返す(UNIQUE 部分インデックスで保証)。
 */
export class ArchiveProposalService {
  constructor(
    private readonly db: Db,
    private readonly articles: ArticleService,
  ) {}

  propose(input: { article_id: string; reason?: string; proposed_by: string }): ArchiveProposalRow {
    const existing = this.findActive(input.article_id)
    if (existing) return existing
    const id = newId()
    const ts = now()
    this.db
      .prepare(
        `INSERT INTO archive_proposals (id, article_id, reason, proposed_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.article_id, input.reason ?? '', input.proposed_by, ts)
    const row = this.get(id)
    if (!row) throw new Error('failed to read back archive proposal')
    return row
  }

  async approve(id: string, reviewer_id: string): Promise<void> {
    const row = this.get(id)
    if (!row) throw new Error(`archive proposal not found: ${id}`)
    if (row.status !== 'proposed')
      throw new Error(`archive proposal already decided: ${row.status}`)
    // 実 archive 反映は ArticleService 経由(Markdown + DB + Git)
    await this.articles.archive(row.article_id, `user:${reviewer_id}`)
    this.db
      .prepare(
        `UPDATE archive_proposals SET status = 'approved', reviewer_id = ?, decided_at = ?
         WHERE id = ?`,
      )
      .run(reviewer_id, now(), id)
  }

  reject(id: string, reviewer_id: string, reason: string): void {
    const row = this.get(id)
    if (!row) throw new Error(`archive proposal not found: ${id}`)
    if (row.status !== 'proposed')
      throw new Error(`archive proposal already decided: ${row.status}`)
    this.db
      .prepare(
        `UPDATE archive_proposals SET status = 'rejected', reviewer_id = ?, decided_reason = ?,
            decided_at = ?
         WHERE id = ?`,
      )
      .run(reviewer_id, reason, now(), id)
  }

  get(id: string): ArchiveProposalRow | null {
    const r = this.db
      .query<ArchiveProposalRow, [string]>(
        `SELECT id, article_id, reason, status, proposed_by, reviewer_id, decided_reason,
                created_at, decided_at
         FROM archive_proposals WHERE id = ?`,
      )
      .get(id)
    return r ?? null
  }

  findActive(article_id: string): ArchiveProposalRow | null {
    const r = this.db
      .query<ArchiveProposalRow, [string]>(
        `SELECT id, article_id, reason, status, proposed_by, reviewer_id, decided_reason,
                created_at, decided_at
         FROM archive_proposals WHERE article_id = ? AND status = 'proposed'`,
      )
      .get(article_id)
    return r ?? null
  }

  list(status?: ArchiveProposalRow['status']): ArchiveProposalRow[] {
    const sql = status
      ? `SELECT id, article_id, reason, status, proposed_by, reviewer_id, decided_reason,
                created_at, decided_at
         FROM archive_proposals WHERE status = ? ORDER BY created_at DESC`
      : `SELECT id, article_id, reason, status, proposed_by, reviewer_id, decided_reason,
                created_at, decided_at
         FROM archive_proposals ORDER BY created_at DESC`
    return status
      ? this.db.query<ArchiveProposalRow, [string]>(sql).all(status)
      : this.db.query<ArchiveProposalRow, []>(sql).all()
  }
}
