import { describe, expect, test } from 'bun:test'
import type { Article } from '@minakata/core'
import { articleHref, resolveIdRefs } from '../app/lib/article-link.ts'

/** lookup 用の最小 Article。resolveIdRefs は title / slug のみ参照する */
function fakeArticle(slug: string, title: string): Article {
  return {
    frontmatter: { slug, title },
    body: '',
    path: '',
    content_hash: '',
  } as unknown as Article
}

describe('articleHref', () => {
  test('slug から記事 URL を組む', () => {
    expect(articleHref('foo')).toBe('/articles/foo')
  })

  test('階層化 slug をそのまま URL に通す', () => {
    expect(articleHref('synthesis/llm-overview')).toBe('/articles/synthesis/llm-overview')
  })
})

describe('resolveIdRefs', () => {
  const lookup = (id: string): Article | null =>
    id === 'A1' ? fakeArticle('cat/the-slug', 'タイトル') : null

  test('[[id:..]] を現在の slug を引いた Markdown リンクに変換する', () => {
    expect(resolveIdRefs('前 [[id:A1]] 後', lookup)).toBe(
      '前 [タイトル](/articles/cat/the-slug) 後',
    )
  })

  test('未知の id はそのまま残す(リンク切れにしない)', () => {
    expect(resolveIdRefs('[[id:UNKNOWN]]', lookup)).toBe('[[id:UNKNOWN]]')
  })

  test('複数の参照をすべて解決する', () => {
    expect(resolveIdRefs('[[id:A1]] と [[id:A1]]', lookup)).toBe(
      '[タイトル](/articles/cat/the-slug) と [タイトル](/articles/cat/the-slug)',
    )
  })
})
