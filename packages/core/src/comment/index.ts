import type { Db } from '../db/index.ts'
import { newId, now } from '../util/id.ts'

export interface ArticleComment {
  id: string
  article_id: string
  anchor: string | null
  body: string
  author_id: string
  status: 'open' | 'resolved'
  agent_reply: string | null
  agent_replied_at: string | null
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

  /** エージェントからの返信を記録する */
  agentReply(id: string, body: string): void {
    this.db
      .prepare('UPDATE article_comments SET agent_reply = ?, agent_replied_at = ? WHERE id = ?')
      .run(body, now(), id)
  }

  /** エージェント未返信のオープンコメントを返す(dialogue の poll 用) */
  pollOpen(limit = 20): ArticleComment[] {
    return this.db
      .query<ArticleComment, [number]>(
        `SELECT id, article_id, anchor, body, author_id, status,
                agent_reply, agent_replied_at, created_at
         FROM article_comments
         WHERE status = 'open' AND agent_reply IS NULL
         ORDER BY created_at
         LIMIT ?`,
      )
      .all(limit)
  }

  listByArticle(article_id: string): ArticleComment[] {
    return this.db
      .query<ArticleComment, [string]>(
        `SELECT id, article_id, anchor, body, author_id, status,
                agent_reply, agent_replied_at, created_at
         FROM article_comments WHERE article_id = ? ORDER BY created_at`,
      )
      .all(article_id)
  }
}
