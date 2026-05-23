import { describe, expect, test } from 'bun:test'
import { VERSION } from '@minakata/core'

describe('@minakata/web', () => {
  test('core を workspace 越しに参照できる', () => {
    expect(VERSION).toMatch(/^\d/)
  })
})
