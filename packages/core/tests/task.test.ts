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
