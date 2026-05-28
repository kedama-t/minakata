import { describe, expect, test } from 'bun:test'
import { type AuditLogRow, AuditService } from '../src/audit/index.ts'
import { openTestDb } from '../src/db/index.ts'

describe('AuditService', () => {
  test('log を 1 件残し、list で取得できる', () => {
    const db = openTestDb()
    const audit = new AuditService(db)
    const id = audit.log({
      actor: 'user:admin',
      tool_name: 'minakata.update_article',
      target_article_id: '01HXYZ',
      before_hash: 'aaa',
      after_hash: 'bbb',
      cost_usd: 0.01,
      metadata: { reason: 'test' },
    })
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    const list = audit.list()
    expect(list.length).toBe(1)
    expect(list[0]?.tool_name).toBe('minakata.update_article')
    expect(list[0]?.metadata).toEqual({ reason: 'test' })
    db.close()
  })

  test('list は agent_name / tool_name / since フィルタが効く', async () => {
    const db = openTestDb()
    const audit = new AuditService(db)
    const tick = () => new Promise<void>((r) => setTimeout(r, 3))
    audit.log({
      actor: 'agent:researcher',
      agent_name: 'researcher',
      tool_name: 'minakata.create_article',
    })
    await tick()
    audit.log({
      actor: 'agent:dialogue',
      agent_name: 'dialogue',
      tool_name: 'minakata.post_agent_response',
    })
    await tick()
    audit.log({
      actor: 'agent:researcher',
      agent_name: 'researcher',
      tool_name: 'minakata.complete_task',
    })

    const byAgent = audit.list({ agent_name: 'researcher' })
    expect(byAgent.length).toBe(2)
    expect(byAgent.every((e) => e.agent_name === 'researcher')).toBe(true)

    const byTool = audit.list({ tool_name: 'minakata.complete_task' })
    expect(byTool.length).toBe(1)
    expect(byTool[0]?.tool_name).toBe('minakata.complete_task')

    const sinceFuture = audit.list({ since: new Date(Date.now() + 60_000).toISOString() })
    expect(sinceFuture.length).toBe(0)

    expect(audit.distinctAgents()).toEqual(['dialogue', 'researcher'])
    expect(audit.distinctTools().length).toBe(3)
  test('log で audit-logged イベントが発火する', () => {
    const db = openTestDb()
    const audit = new AuditService(db)
    const received: AuditLogRow[] = []
    audit.on('audit-logged', (row: AuditLogRow) => received.push(row))
    const id = audit.log({
      actor: 'agent:researcher',
      agent_name: 'researcher',
      tool_name: 'minakata.create_article',
      cost_usd: 0.02,
      metadata: { topic: 'foo' },
    })
    expect(received.length).toBe(1)
    expect(received[0]?.id).toBe(id)
    expect(received[0]?.tool_name).toBe('minakata.create_article')
    expect(received[0]?.agent_name).toBe('researcher')
    expect(received[0]?.metadata).toEqual({ topic: 'foo' })
    db.close()
  })
})
