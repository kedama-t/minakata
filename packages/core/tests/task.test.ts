import { describe, expect, test } from 'bun:test'
import { openTestDb } from '../src/db/index.ts'
import { TaskService } from '../src/task/index.ts'

describe('TaskService', () => {
  test('enqueue → claim → complete', () => {
    const db = openTestDb()
    const tasks = new TaskService(db)
    const t = tasks.enqueue({ type: 'research', priority: 'urgent', payload: { topic: 'bun' } })
    expect(t.status).toBe('queued')
    const claimed = tasks.claim('hermes:researcher', 5)
    expect(claimed.length).toBe(1)
    expect(claimed[0]?.id).toBe(t.id)
    expect(claimed[0]?.status).toBe('claimed')
    tasks.complete(t.id, { cost_usd: 0.02 })
    const after = tasks.get(t.id)
    expect(after?.status).toBe('done')
    expect(after?.cost_usd).toBeCloseTo(0.02)
    db.close()
  })

  test('priority 順に取り出される', () => {
    const db = openTestDb()
    const tasks = new TaskService(db)
    tasks.enqueue({ type: 't', priority: 'maintenance' })
    const interactive = tasks.enqueue({ type: 't', priority: 'interactive' })
    tasks.enqueue({ type: 't', priority: 'scheduled' })
    const urgent = tasks.enqueue({ type: 't', priority: 'urgent' })
    const order = tasks.claim('w', 4).map((t) => t.id)
    expect(order[0]).toBe(urgent.id)
    expect(order[1]).toBe(interactive.id)
    db.close()
  })

  test('dedup_key で冪等性が確保される', () => {
    const db = openTestDb()
    const tasks = new TaskService(db)
    const a = tasks.enqueue({ type: 't', priority: 'scheduled', dedup_key: 'topic:bun:2026-05-22' })
    const b = tasks.enqueue({ type: 't', priority: 'scheduled', dedup_key: 'topic:bun:2026-05-22' })
    expect(a.id).toBe(b.id)
    db.close()
  })

  test('claim は同じタスクを 2 度返さない(トランザクション化済み)', () => {
    const db = openTestDb()
    const tasks = new TaskService(db)
    tasks.enqueue({ type: 't', priority: 'urgent' })
    tasks.enqueue({ type: 't', priority: 'urgent' })
    // 連続して claim を 2 回呼んでも、各タスクは 1 度しか claim されない
    const first = tasks.claim('worker-a', 5).map((t) => t.id)
    const second = tasks.claim('worker-b', 5).map((t) => t.id)
    expect(first.length).toBe(2)
    expect(second.length).toBe(0)
    expect(new Set([...first, ...second]).size).toBe(first.length)
    db.close()
  })

  test('listByUser は requested_by で絞り込み、status / type フィルタが効く', async () => {
    const db = openTestDb()
    const tasks = new TaskService(db)
    const tick = () => new Promise<void>((r) => setTimeout(r, 3))
    const t1 = tasks.enqueue({
      type: 'research_followup',
      priority: 'interactive',
      requested_by: 'user-a',
    })
    await tick()
    const t2 = tasks.enqueue({ type: 'refresh', priority: 'urgent', requested_by: 'user-a' })
    await tick()
    tasks.enqueue({ type: 'research_followup', priority: 'scheduled', requested_by: 'user-b' })
    tasks.enqueue({ type: 'refresh', priority: 'urgent' }) // requested_by: null

    const ownAll = tasks.listByUser({ user_id: 'user-a' })
    expect(ownAll.map((t) => t.id)).toEqual([t2.id, t1.id])

    const ownRefresh = tasks.listByUser({ user_id: 'user-a', type: 'refresh' })
    expect(ownRefresh.length).toBe(1)
    expect(ownRefresh[0]?.id).toBe(t2.id)

    tasks.complete(t1.id)
    const ownDone = tasks.listByUser({ user_id: 'user-a', status: 'done' })
    expect(ownDone.length).toBe(1)
    expect(ownDone[0]?.id).toBe(t1.id)

    const all = tasks.listAll({})
    expect(all.length).toBe(4)
    db.close()
  })

  test('fail で attempts が増え、3 回目で DLQ に入る', () => {
    const db = openTestDb()
    const tasks = new TaskService(db)
    const t = tasks.enqueue({ type: 't', priority: 'urgent' })
    tasks.fail(t.id, 'first')
    expect(tasks.get(t.id)?.attempts).toBe(1)
    tasks.fail(t.id, 'second')
    expect(tasks.get(t.id)?.attempts).toBe(2)
    tasks.fail(t.id, 'third')
    expect(tasks.get(t.id)?.status).toBe('failed')
    const dlq = db
      .query<{ task_id: string; reason: string }, []>('SELECT task_id, reason FROM task_dlq')
      .all()
    expect(dlq[0]?.task_id).toBe(t.id)
    db.close()
  })
})
