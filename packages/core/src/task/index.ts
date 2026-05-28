import { EventEmitter } from 'node:events'
import type { Db } from '../db/index.ts'
import type { TaskPriority, TaskStatus } from '../schema/index.ts'
import { newId, now } from '../util/id.ts'

export interface TaskRow {
  id: string
  type: string
  priority: TaskPriority
  payload: Record<string, unknown>
  status: TaskStatus
  attempts: number
  next_attempt_at: string | null
  claimed_at: string | null
  claimed_by: string | null
  completed_at: string | null
  parent_task_id: string | null
  parent_review_id: string | null
  dedup_key: string | null
  requested_by: string | null
  cost_usd: number
  created_at: string
  updated_at: string
}

export interface EnqueueInput {
  type: string
  priority: TaskPriority
  payload?: Record<string, unknown> | undefined
  dedup_key?: string | null | undefined
  parent_task_id?: string | null | undefined
  parent_review_id?: string | null | undefined
  requested_by?: string | null | undefined
}

const MAX_ATTEMPTS = 3

/**
 * 調査/編集タスクのキュー。Hermes が `poll` でドレインし、`complete`/`fail` を呼ぶ。
 * 同時実行制御は呼び出し側(Hermes セマフォ)と DB の status 列で行う。
 */
export class TaskService extends EventEmitter {
  constructor(private readonly db: Db) {
    super()
    this.setMaxListeners(0)
  }

  enqueue(input: EnqueueInput): TaskRow {
    const id = newId()
    const ts = now()
    const payload = input.payload ?? {}
    try {
      this.db
        .prepare(
          `INSERT INTO tasks (id, type, priority, payload_json, parent_task_id, parent_review_id,
            dedup_key, requested_by, created_at, updated_at)
           VALUES ($id, $type, $prio, $payload, $parent, $review, $dedup, $requested, $ts, $ts)`,
        )
        .run({
          id,
          type: input.type,
          prio: input.priority,
          payload: JSON.stringify(payload),
          parent: input.parent_task_id ?? null,
          review: input.parent_review_id ?? null,
          dedup: input.dedup_key ?? null,
          requested: input.requested_by ?? null,
          ts,
        })
    } catch (err) {
      // UNIQUE 制約違反 = 既存のタスクが取得できるはず → そちらを返す(冪等)
      if (input.dedup_key) {
        const existing = this.findByDedupKey(input.dedup_key)
        if (existing) return existing
      }
      throw err
    }
    const row = this.get(id)
    if (!row) throw new Error('failed to read back enqueued task')
    this.emit('enqueued', row)
    return row
  }

  get(id: string): TaskRow | null {
    const r = this.db.query<TaskRowRaw, [string]>('SELECT * FROM tasks WHERE id = ?').get(id)
    return r ? hydrate(r) : null
  }

  findByDedupKey(key: string): TaskRow | null {
    const r = this.db
      .query<TaskRowRaw, [string]>('SELECT * FROM tasks WHERE dedup_key = ?')
      .get(key)
    return r ? hydrate(r) : null
  }

  /**
   * 次に処理するタスクを claim する。
   * priority(urgent > interactive > scheduled > maintenance)→ created_at の順で `limit` 件取り出す。
   *
   * SELECT 候補取得 → 個別 UPDATE を 1 つの SQLite トランザクションで囲む
   * ことで、複数ワーカーが同時に呼び出した場合の重複 claim を防ぐ。
   * (SQLite はライタが直列化されるため、トランザクション内の UPDATE は
   *  同時に走らず WHERE status='queued' の競合は確実に弾かれる)
   */
  claim(claimedBy: string, limit = 1): TaskRow[] {
    const claimAt = now()
    return this.db.transaction((): TaskRow[] => {
      const rows = this.db
        .query<TaskRowRaw, [string, number]>(
          `SELECT * FROM tasks
           WHERE status = 'queued'
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ORDER BY CASE priority
                WHEN 'urgent' THEN 0
                WHEN 'interactive' THEN 1
                WHEN 'scheduled' THEN 2
                WHEN 'maintenance' THEN 3
              END, created_at
           LIMIT ?`,
        )
        .all(claimAt, limit)
      const claimed: TaskRow[] = []
      for (const r of rows) {
        const res = this.db
          .prepare(
            `UPDATE tasks SET status = 'claimed', claimed_at = ?, claimed_by = ?, updated_at = ?
             WHERE id = ? AND status = 'queued'`,
          )
          .run(claimAt, claimedBy, claimAt, r.id)
        if (res.changes > 0)
          claimed.push(
            hydrate({
              ...r,
              status: 'claimed',
              claimed_at: claimAt,
              claimed_by: claimedBy,
              updated_at: claimAt,
            }),
          )
      }
      return claimed
    })()
  }

  complete(id: string, opts: { cost_usd?: number } = {}): void {
    const ts = now()
    this.db
      .prepare(
        `UPDATE tasks SET status = 'done', completed_at = ?, cost_usd = cost_usd + ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(ts, opts.cost_usd ?? 0, ts, id)
    this.emit('completed', id)
  }

  /** 失敗時、attempts < MAX_ATTEMPTS なら指数バックオフで再 queue、超過したら DLQ へ */
  fail(id: string, reason: string): void {
    const row = this.get(id)
    if (!row) return
    const attempts = row.attempts + 1
    const ts = now()
    if (attempts >= MAX_ATTEMPTS) {
      this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO task_dlq (id, task_id, type, priority, payload_json, attempts, reason, moved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            newId(),
            row.id,
            row.type,
            row.priority,
            JSON.stringify(row.payload),
            attempts,
            reason,
            ts,
          )
        this.db
          .prepare(`UPDATE tasks SET status = 'failed', attempts = ?, updated_at = ? WHERE id = ?`)
          .run(attempts, ts, id)
      })()
      this.emit('dead-lettered', id)
      return
    }
    // 指数バックオフ(秒): 30, 120, ... = 30 * 2^(attempts-1)
    const delaySec = 30 * 2 ** (attempts - 1)
    const next = new Date(Date.now() + delaySec * 1000).toISOString()
    this.db
      .prepare(
        `UPDATE tasks SET status = 'queued', attempts = ?, next_attempt_at = ?, claimed_at = NULL,
            claimed_by = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(attempts, next, ts, id)
    this.emit('retrying', id)
  }

  /**
   * 指定ユーザーが依頼したタスクを `created_at` 降順で返す。
   * `status` / `type` フィルタ、`before` カーソルページングに対応。
   * 編集者が「自分の調査依頼の進捗」を見るための画面 (US-3.2 系) で使う。
   */
  listByUser(opts: {
    user_id: string
    status?: TaskStatus | undefined
    type?: string | undefined
    limit?: number | undefined
    before?: string | undefined
  }): TaskRow[] {
    const limit = opts.limit ?? 50
    const conditions: string[] = ['requested_by = ?']
    const params: Array<string | number> = [opts.user_id]
    if (opts.status) {
      conditions.push('status = ?')
      params.push(opts.status)
    }
    if (opts.type) {
      conditions.push('type = ?')
      params.push(opts.type)
    }
    if (opts.before) {
      conditions.push('created_at < ?')
      params.push(opts.before)
    }
    params.push(limit)
    const rows = this.db
      .query<TaskRowRaw, Array<string | number>>(
        `SELECT * FROM tasks
          WHERE ${conditions.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .all(...params)
    return rows.map(hydrate)
  }

  /** admin 用: 依頼者を問わず全タスクを返す(フィルタ条件は listByUser と同等) */
  listAll(
    opts: {
      status?: TaskStatus | undefined
      type?: string | undefined
      limit?: number | undefined
      before?: string | undefined
    } = {},
  ): TaskRow[] {
    const limit = opts.limit ?? 50
    const conditions: string[] = []
    const params: Array<string | number> = []
    if (opts.status) {
      conditions.push('status = ?')
      params.push(opts.status)
    }
    if (opts.type) {
      conditions.push('type = ?')
      params.push(opts.type)
    }
    if (opts.before) {
      conditions.push('created_at < ?')
      params.push(opts.before)
    }
    params.push(limit)
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db
      .query<TaskRowRaw, Array<string | number>>(
        `SELECT * FROM tasks ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(...params)
    return rows.map(hydrate)
  }

  /** 状態問わず取り消す。`pending_approval` のレビュー差し戻し等で利用 */
  cancel(id: string): void {
    this.db
      .prepare(`UPDATE tasks SET status = 'failed', updated_at = ? WHERE id = ?`)
      .run(now(), id)
  }
}

interface TaskRowRaw {
  id: string
  type: string
  priority: TaskPriority
  payload_json: string
  status: TaskStatus
  attempts: number
  next_attempt_at: string | null
  claimed_at: string | null
  claimed_by: string | null
  completed_at: string | null
  parent_task_id: string | null
  parent_review_id: string | null
  dedup_key: string | null
  requested_by: string | null
  cost_usd: number
  created_at: string
  updated_at: string
}

function hydrate(r: TaskRowRaw): TaskRow {
  return {
    id: r.id,
    type: r.type,
    priority: r.priority,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    status: r.status,
    attempts: r.attempts,
    next_attempt_at: r.next_attempt_at,
    claimed_at: r.claimed_at,
    claimed_by: r.claimed_by,
    completed_at: r.completed_at,
    parent_task_id: r.parent_task_id,
    parent_review_id: r.parent_review_id,
    dedup_key: r.dedup_key,
    requested_by: r.requested_by,
    cost_usd: r.cost_usd,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}
