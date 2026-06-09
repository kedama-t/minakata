import type { Article } from '@minakata/core'

/**
 * 記事 URL の単一整形オーナー(#215)。記事への参照は不変 id で保持し、表示の
 * 直前に現在の slug へ解決してここで URL を組む。slug / path を将来整理しても、
 * 参照側を id に保つ限り内部リンクは切れない。
 * slug は階層化(`a/b/c`)を許すが各セグメントは URL セーフ文字のみ
 * (MCP 側 `^[a-z0-9][a-z0-9-]*(/...)*$`)なのでエンコード不要。
 */
export function articleHref(slug: string): string {
  return `/articles/${slug}`
}

/** 本文中の `[[id:<ulid>]]` を、現在の slug を引いて標準 Markdown リンクに変換する */
export function resolveIdRefs(body: string, lookup: (id: string) => Article | null): string {
  return body.replace(/\[\[id:([^\]]+)\]\]/g, (match, id: string) => {
    const article = lookup(id.trim())
    if (!article) return match
    return `[${article.frontmatter.title}](${articleHref(article.frontmatter.slug)})`
  })
}
