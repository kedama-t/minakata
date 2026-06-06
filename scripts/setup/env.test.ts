import { describe, expect, test } from 'bun:test'
import { findStaleSecrets, parseEnv, patchEnv } from './env'

const EXAMPLE = `# comment
MCP_TOKEN=
DATABASE_URL=file:/app/data/minakata.db
TIMEZONE=Asia/Tokyo
OPENCODE_API_KEY=
`

describe('parseEnv', () => {
  test('キー値を抽出しコメントを無視する', () => {
    const env = parseEnv('# c\nA=1\nB=hello\n#C=skip\n')
    expect(env.get('A')).toBe('1')
    expect(env.get('B')).toBe('hello')
    expect(env.has('C')).toBe(false)
  })

  test('クォートを外す', () => {
    const env = parseEnv('A="a b"\n')
    expect(env.get('A')).toBe('a b')
  })
})

describe('patchEnv（既存あり）', () => {
  const existing = `# 先頭コメント
MCP_TOKEN=oldtoken
TIMEZONE=Asia/Tokyo

# 余剰キー
MCP_ALLOWED_HOSTS=localhost
#FIRECRAWL_API_KEY=fc-leakedoldkey
`

  test('対象キーのみ更新し他は温存する', () => {
    const out = patchEnv(existing, { MCP_TOKEN: 'newtoken' }, EXAMPLE)
    expect(out).toContain('MCP_TOKEN=newtoken')
    expect(out).toContain('# 先頭コメント')
    expect(out).toContain('# 余剰キー')
    expect(out).toContain('MCP_ALLOWED_HOSTS=localhost')
    expect(out).toContain('#FIRECRAWL_API_KEY=fc-leakedoldkey')
    expect(out).toContain('TIMEZONE=Asia/Tokyo')
  })

  test('並びを保持する', () => {
    const out = patchEnv(existing, { TIMEZONE: 'UTC' }, EXAMPLE)
    const lines = out.split('\n')
    expect(lines.indexOf('MCP_TOKEN=oldtoken')).toBeLessThan(lines.indexOf('TIMEZONE=UTC'))
  })

  test('未存在キーは末尾に追記する', () => {
    const out = patchEnv(existing, { NEW_KEY: 'v' }, EXAMPLE)
    expect(out).toContain('# setup により追記')
    expect(out).toContain('NEW_KEY=v')
    expect(out.indexOf('NEW_KEY=v')).toBeGreaterThan(out.indexOf('MCP_ALLOWED_HOSTS'))
  })

  test('空白を含む値はクォートする', () => {
    const out = patchEnv('A=x\n', { A: 'a b' }, EXAMPLE)
    expect(out).toContain('A="a b"')
  })
})

describe('patchEnv（既存なし）', () => {
  test('.env.example を基に右辺を埋める', () => {
    const out = patchEnv(null, { MCP_TOKEN: 'tok', OPENCODE_API_KEY: 'key' }, EXAMPLE)
    expect(out).toContain('MCP_TOKEN=tok')
    expect(out).toContain('OPENCODE_API_KEY=key')
    expect(out).toContain('DATABASE_URL=file:/app/data/minakata.db')
    expect(out).toContain('# comment')
  })

  test('末尾改行を保証する', () => {
    const out = patchEnv(null, {}, 'A=1')
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('findStaleSecrets', () => {
  test('コメントアウトされた旧シークレットを検出する', () => {
    const hits = findStaleSecrets('A=1\n#FIRECRAWL_API_KEY=fc-old\n# 普通のコメント\n')
    expect(hits).toEqual(['#FIRECRAWL_API_KEY=fc-old'])
  })
})
