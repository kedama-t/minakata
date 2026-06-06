import { describe, expect, test } from 'bun:test'
import { checkProvider, patchModelDefault, readModelDefault } from './config'

const YAML = `# 先頭コメント
model:
  # default のコメント
  default: "deepseek-v4-flash"
  provider: "opencode-go"

web:
  search_backend: "searxng"
  default: "should-not-touch"
`

describe('patchModelDefault', () => {
  test('model ブロック内の default だけ置換する', () => {
    const out = patchModelDefault(YAML, 'glm-5')
    expect(out).toContain('default: "glm-5"')
    expect(out).toContain('default: "should-not-touch"')
    expect(out).toContain('# default のコメント')
    expect(out).toContain('provider: "opencode-go"')
  })

  test('インデントとコメントを保持する', () => {
    const out = patchModelDefault(YAML, 'kimi-k2.5')
    expect(out).toContain('  default: "kimi-k2.5"')
    expect(out).toContain('# 先頭コメント')
  })

  test('model ブロックが無ければ throw する', () => {
    expect(() => patchModelDefault('web:\n  x: 1\n', 'm')).toThrow()
  })

  test('ダブルクォートを含むモデル名は拒否する', () => {
    expect(() => patchModelDefault(YAML, 'a"b')).toThrow()
  })

  test('default が無ければ model 直下に挿入する', () => {
    const out = patchModelDefault('model:\n  provider: "opencode-go"\n', 'm')
    expect(out).toContain('  default: "m"')
  })
})

describe('readModelDefault', () => {
  test('現在の default を返す', () => {
    expect(readModelDefault(YAML)).toBe('deepseek-v4-flash')
  })
})

describe('checkProvider', () => {
  test('provider 一致を検証する', () => {
    expect(checkProvider(YAML)).toBe(true)
    expect(checkProvider(YAML, 'other')).toBe(false)
  })
})
