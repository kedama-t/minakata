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
}

const MAX_ATTEMPTS = 3

/**
 * 調査/編集タスクのキュー。Hermes が `poll` でドレインし、`complete`/`fail` を呼ぶ。
 * 同時実行制御は呼び出し側(Hermes セマフォ)と DB の status 列で行う。
 */
export class TaskService extends EventEmitter {
  constructor(private readonly db: Db) {
    super()
  }

  enqueue(input: EnqueueInput): TaskRow {
    const id = newId()
    const ts = now()
    const payload = input.payload ?? {}
    try {
      this.db
        .prepare(
          `INSERT INTO tasks (id, type, priority, payload_json, parent_task_id, parent_review_id,
            dedup_key, created_at, updated_at)
           VALUES ($id, $type, $prio, $payload, $parent, $review, $dedup, $ts, $ts)`,
        )
        .run({
          id,
          type: input.type,
          prio: input.priority,
          payload: JSON.stringify(payload),
          parent: input.parent_task_id ?? null,
          review: input.parent_review_id ?? null,
          dedup: input.dedup_key ?? null,
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
   * priority(urgent > interactive > scheduled > maintenance)→ created_at の順で 1 件取り出す。
   */
  claim(claimedBy: string, limit = 1): TaskRow[] {
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
      .all(now(), limit)
    const ts = now()
    const claimed: TaskRow[] = []
    for (const r of rows) {
      const res = this.db
        .prepare(
          `UPDATE tasks SET status = 'claimed', claimed_at = ?, claimed_by = ?, updated_at = ?
           WHERE id = ? AND status = 'queued'`,
        )
        .run(ts, claimedBy, ts, r.id)
      if (res.changes > 0)
        claimed.push(
          hydrate({
            ...r,
            status: 'claimed',
            claimed_at: ts,
            claimed_by: claimedBy,
            updated_at: ts,
          }),
        )
    }
    return claimed
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
    cost_usd: r.cost_usd,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}
