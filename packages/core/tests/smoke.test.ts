import { describe, expect, test } from 'bun:test'
import { ArticleFrontmatterSchema, VERSION } from '../src/index.ts'

describe('@minakata/core', () => {
  test('VERSION is exposed', () => {
    expect(VERSION).toBe('0.1.0-mvp')
  })

  test('ArticleFrontmatterSchema accepts a minimal valid record', () => {
    const now = new Date().toISOString()
    const parsed = ArticleFrontmatterSchema.parse({
      id: '01HXYZABCDEFGHJKMNPQRSTVWX',
      title: 'Hello',
      slug: 'hello',
      status: 'draft',
      source: 'manual',
      created_at: now,
      updated_at: now,
      created_by: 'user:admin',
      last_modified_by: 'user:admin',
    })
    expect(parsed.tags).toEqual([])
    expect(parsed.freshness_rank).toBe('fresh')
    expect(parsed.cost_usd).toBe(0)
  })

  test('ArticleFrontmatterSchema rejects bogus status', () => {
    expect(() =>
      ArticleFrontmatterSchema.parse({
        id: '01HXYZABCDEFGHJKMNPQRSTVWX',
        title: 'x',
        slug: 'x',
        status: 'bogus',
        source: 'manual',
        created_at: '2026-05-22T00:00:00.000Z',
        updated_at: '2026-05-22T00:00:00.000Z',
        created_by: 'a',
        last_modified_by: 'a',
      }),
    ).toThrow()
  })
})
