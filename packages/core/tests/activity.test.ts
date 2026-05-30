import { describe, expect, test } from 'bun:test'
import { type ActivityLogRow, ActivityService } from '../src/activity/index.ts'
import { AuditService } from '../src/audit/index.ts'
import { openTestDb } from '../src/db/index.ts'

describe('ActivityService', () => {
  test('log を 1 件残し、list で取得できる', () => {
    const db = openTestDb()
    const activity = new ActivityService(db)
    const id = activity.log({
      actor: 'agent:researcher',
      phase: '調査中',
      detail: 'AI 最新動向',
      target_article_id: '01HXYZ',
    })
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    const list = activity.list()
    expect(list.length).toBe(1)
    expect(list[0]?.phase).toBe('調査中')
    expect(list[0]?.detail).toBe('AI 最新動向')
    expect(list[0]?.actor).toBe('agent:researcher')
    db.close()
  })

  test('log で activity-logged イベントが発火する', () => {
    const db = openTestDb()
    const activity = new ActivityService(db)
    const received: ActivityLogRow[] = []
    activity.on('activity-logged', (row: ActivityLogRow) => received.push(row))
    const id = activity.log({ actor: 'agent:dialogue', phase: '応答中' })
    expect(received.length).toBe(1)
    expect(received[0]?.id).toBe(id)
    expect(received[0]?.phase).toBe('応答中')
    db.close()
  })

  test('list は actor / since フィルタが効く', async () => {
    const db = openTestDb()
    const activity = new ActivityService(db)
    const tick = () => new Promise<void>((r) => setTimeout(r, 3))
    activity.log({ actor: 'agent:researcher', phase: '調査中' })
    await tick()
    activity.log({ actor: 'agent:dialogue', phase: '応答中' })
    await tick()
    activity.log({ actor: 'agent:researcher', phase: '記事執筆中' })

    const byActor = activity.list({ actor: 'agent:researcher' })
    expect(byActor.length).toBe(2)
    expect(byActor.every((r) => r.actor === 'agent:researcher')).toBe(true)

    const sinceFuture = activity.list({ since: new Date(Date.now() + 60_000).toISOString() })
    expect(sinceFuture.length).toBe(0)
    db.close()
  })

  test('latestByActor は actor ごとの最新1件を返す', async () => {
    const db = openTestDb()
    const activity = new ActivityService(db)
    const tick = () => new Promise<void>((r) => setTimeout(r, 3))
    activity.log({ actor: 'agent:researcher', phase: '調査中' })
    await tick()
    activity.log({ actor: 'agent:researcher', phase: '記事執筆中' })
    await tick()
    activity.log({ actor: 'agent:dialogue', phase: '応答中' })

    const latest = activity.latestByActor()
    expect(latest.size).toBe(2)
    expect(latest.get('agent:researcher')?.phase).toBe('記事執筆中')
    expect(latest.get('agent:dialogue')?.phase).toBe('応答中')
    db.close()
  })

  test('同 actor の件数が MAX_PER_ACTOR を超えたとき古い行が削除される', async () => {
    const db = openTestDb()
    const activity = new ActivityService(db)
    const tick = () => new Promise<void>((r) => setTimeout(r, 2))
    // MAX_PER_ACTOR = 50 を超えて 55 件追加する(timestamp 区別のため tick を入れる)
    for (let i = 0; i < 55; i++) {
      activity.log({ actor: 'agent:researcher', phase: `step-${i}` })
      if (i % 10 === 9) await tick()
    }
    const list = activity.list({ actor: 'agent:researcher', limit: 200 })
    // 50 件以内に間引かれている
    expect(list.length).toBeLessThanOrEqual(50)
    // 直近 step-54 が保持されている
    const phases = list.map((r) => r.phase)
    expect(phases).toContain('step-54')
    db.close()
  })

  test('audit_log には report_progress が記録されない(分離の確認)', () => {
    const db = openTestDb()
    const activity = new ActivityService(db)
    const audit = new AuditService(db)
    activity.log({ actor: 'agent:researcher', phase: '調査中' })
    const auditList = audit.list()
    expect(auditList.length).toBe(0)
    db.close()
  })
})
