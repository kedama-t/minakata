import { describe, expect, test } from 'bun:test'
import { openTestDb } from '../src/db/index.ts'

describe('openDb', () => {
  test('マイグレーションが適用され、主要テーブルが存在する', () => {
    const db = openTestDb()
    const rows = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' OR type='virtual table' ORDER BY name",
      )
      .all()
    const names = rows.map((r) => r.name)
    expect(names).toContain('users')
    expect(names).toContain('articles')
    expect(names).toContain('articles_fts')
    expect(names).toContain('articles_vec')
    expect(names).toContain('messages')
    expect(names).toContain('tasks')
    expect(names).toContain('audit_log')
    db.close()
  })

  test('sqlite-vec が機能する(コサイン類似度クエリ)', () => {
    const db = openTestDb()
    const v1 = new Float32Array(768).fill(0.1)
    const v2 = new Float32Array(768).fill(0.2)
    db.prepare('INSERT INTO articles_vec(rowid, embedding) VALUES (?, ?)').run(
      1,
      Buffer.from(v1.buffer),
    )
    db.prepare('INSERT INTO articles_vec(rowid, embedding) VALUES (?, ?)').run(
      2,
      Buffer.from(v2.buffer),
    )
    const probe = new Float32Array(768).fill(0.1)
    const rows = db
      .query<{ rowid: number; distance: number }, [Buffer]>(
        'SELECT rowid, distance FROM articles_vec WHERE embedding MATCH ? AND k = 2 ORDER BY distance',
      )
      .all(Buffer.from(probe.buffer))
    expect(rows.length).toBe(2)
    expect(rows[0]?.rowid).toBe(1) // 完全一致が先頭
    db.close()
  })

  test('research_policy のデフォルト行が挿入されている', () => {
    const db = openTestDb()
    const row = db.query<{ id: string }, []>('SELECT id FROM research_policy').get()
    expect(row?.id).toBe('default')
    db.close()
  })
})
