import { EventEmitter } from 'node:events'
import type { Db } from '../db/index.ts'
import { newId, now } from '../util/id.ts'

export type GlobalMessageAuthorType = 'user' | 'agent'

export interface GlobalMessageRow {
  id: string
  author_type: GlobalMessageAuthorType
  author_id: string | null
  author_name: string
  content: string
  is_final: boolean
  created_at: string
  claimed_at: string | null
  claimed_by: string | null
}

/**
 * グローバルチャットバス。
 * - user 投稿 → DB 保存 → Hermes(dialogue) が poll_messages で取得・応答
 * - agent 投稿 → DB 保存 + EventEmitter で `global-message` を emit → SSE 転送
 */
export class GlobalChatService extends EventEmitter {
  constructor(private readonly db: Db) {
    super()
    this.setMaxListeners(0)
  }

  /** ユーザーまたはエージェントがグローバルチャットに投稿する */
  post(input: {
    author_type: GlobalMessageAuthorType
    author_id?: string | null
    author_name: string
    content: string
    is_final?: boolean
  }): GlobalMessageRow {
    const id = newId()
    const created_at = now()
    const is_final = input.is_final ?? true
    this.db
      .prepare(
        `INSERT INTO global_messages
           (id, author_type, author_id, author_name, content, is_final, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.author_type,
        input.author_id ?? null,
        input.author_name,
        input.content,
        is_final ? 1 : 0,
        created_at,
      )
    const row: GlobalMessageRow = {
      id,
      author_type: input.author_type,
      author_id: input.author_id ?? null,
      author_name: input.author_name,
      content: input.content,
      is_final,
      created_at,
      claimed_at: null,
      claimed_by: null,
    }
    this.emit('global-message', row)
    return row
  }

  /** Hermes が未取得のユーザー発言を取り出す */
  pollUnclaimed(limit = 20): GlobalMessageRow[] {
    const rows = this.db
      .query<RawRow, [number]>(
        `SELECT id, author_type, author_id, author_name, content, is_final,
                created_at, claimed_at, claimed_by
         FROM global_messages
         WHERE author_type = 'user' AND claimed_at IS NULL
         ORDER BY created_at
         LIMIT ?`,
      )
      .all(limit)
    return rows.map(hydrate)
  }

  /** メッセージを claim する */
  claim(id: string, claimedBy: string): { claimed: boolean } {
    const ts = now()
    const res = this.db
      .prepare(
        `UPDATE global_messages SET claimed_at = ?, claimed_by = ?
         WHERE id = ? AND claimed_at IS NULL`,
      )
      .run(ts, claimedBy, id)
    return { claimed: res.changes > 0 }
  }

  /** カーソルページングで新着順に取得 */
  list(opts: { limit?: number; before?: string } = {}): GlobalMessageRow[] {
    const limit = opts.limit ?? 50
    const conditions: string[] = ['is_final = 1']
    const params: Array<string | number> = []
    if (opts.before) {
      conditions.push('created_at < ?')
      params.push(opts.before)
    }
    params.push(limit)
    const rows = this.db
      .query<RawRow, Array<string | number>>(
        `SELECT id, author_type, author_id, author_name, content, is_final,
                created_at, claimed_at, claimed_by
         FROM global_messages
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params)
    return rows.map(hydrate).reverse()
  }

  /**
   * SSE ハンドラ用: `global-message` イベントを listen する AsyncIterable を返す。
   * セッションに紐づかないため signal のみ受け取る。
   */
  subscribe(signal?: AbortSignal): AsyncIterable<GlobalMessageRow> {
    const emitter = this
    return {
      [Symbol.asyncIterator]() {
        const queue: GlobalMessageRow[] = []
        let resolver: ((v: IteratorResult<GlobalMessageRow>) => void) | null = null
        let done = false
        const onMsg = (row: GlobalMessageRow) => {
          if (resolver) {
            const r = resolver
            resolver = null
            r({ value: row, done: false })
          } else {
            queue.push(row)
          }
        }
        const stop = () => {
          if (done) return
          done = true
          emitter.off('global-message', onMsg)
          if (resolver) {
            const r = resolver
            resolver = null
            r({ value: undefined as unknown as GlobalMessageRow, done: true })
          }
        }
        emitter.on('global-message', onMsg)
        signal?.addEventListener('abort', stop, { once: true })
        return {
          next(): Promise<IteratorResult<GlobalMessageRow>> {
            if (done)
              return Promise.resolve({
                value: undefined as unknown as GlobalMessageRow,
                done: true,
              })
            if (queue.length > 0) {
              const v = queue.shift() as GlobalMessageRow
              return Promise.resolve({ value: v, done: false })
            }
            return new Promise((res) => {
              resolver = res
            })
          },
          return(): Promise<IteratorResult<GlobalMessageRow>> {
            stop()
            return Promise.resolve({
              value: undefined as unknown as GlobalMessageRow,
              done: true,
            })
          },
        }
      },
    }
  }
}

interface RawRow {
  id: string
  author_type: GlobalMessageAuthorType
  author_id: string | null
  author_name: string
  content: string
  is_final: number
  created_at: string
  claimed_at: string | null
  claimed_by: string | null
}

function hydrate(r: RawRow): GlobalMessageRow {
  return {
    id: r.id,
    author_type: r.author_type,
    author_id: r.author_id,
    author_name: r.author_name,
    content: r.content,
    is_final: r.is_final === 1,
    created_at: r.created_at,
    claimed_at: r.claimed_at,
    claimed_by: r.claimed_by,
  }
}
