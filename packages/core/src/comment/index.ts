import type { Db } from '../db/index.ts'
import { newId, now } from '../util/id.ts'

export interface ArticleComment {
  id: string
  article_id: string
  anchor: string | null
  body: string
  author_id: string
  status: 'open' | 'resolved'
  created_at: string
}

/**
 * 記事への行/セクションコメント(US-3.2)。
 * 解決済みコメントは UI で折りたためる。
 */
export class CommentService {
  constructor(private readonly db: Db) {}

  add(input: {
    article_id: string
    author_id: string
    body: string
    anchor?: string | null
  }): string {
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO article_comments (id, article_id, anchor, body, author_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.article_id, input.anchor ?? null, input.body, input.author_id, now())
    return id
  }

  resolve(id: string): void {
    this.db.prepare("UPDATE article_comments SET status = 'resolved' WHERE id = ?").run(id)
  }

  listByArticle(article_id: string): ArticleComment[] {
    return this.db
      .query<ArticleComment, [string]>(
        `SELECT id, article_id, anchor, body, author_id, status, created_at
         FROM article_comments WHERE article_id = ? ORDER BY created_at`,
      )
      .all(article_id)
  }
}
