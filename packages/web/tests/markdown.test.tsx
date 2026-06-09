import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { ArticleMarkdown } from '../app/lib/markdown.tsx'

const SAMPLE = `## TL;DR

Minakata は **AI** です。

- item one
- item \`code\` two

\`\`\`ts
export const x = 1
\`\`\`

| a | b |
| - | - |
| 1 | 2 |

[link](https://example.com)
`

describe('ArticleMarkdown', () => {
  const html = renderToString(<ArticleMarkdown source={SAMPLE} />)

  test('Markdown 構造が HTML タグに変換される', () => {
    // 生 Markdown 記号が残っていないこと
    expect(html).not.toContain('## TL')
    expect(html).not.toContain('**AI**')
    expect(html).not.toContain('```ts')
    // 期待する HTML 要素が出ていること
    expect(html).toContain('<h2')
    expect(html).toContain('>TL;DR</h2>')
    expect(html).toContain('<strong>AI</strong>')
    expect(html).toContain('<ul')
    expect(html).toContain('>item one</li>')
    expect(html).toContain('<code')
    // Shiki ハイライトは useEffect で適用されるため SSR では言語クラスなし
    // コードブロックの内容が保持されていることを確認
    expect(html).toContain('export const x = 1')
    expect(html).toContain('<table')
    expect(html).toContain('<a')
    expect(html).toContain('href="https://example.com"')
  })

  test('react-markdown 内部の node プロップが DOM 属性に漏れない', () => {
    // 漏れると <h2 node="[object Object]"> のような出力になり、
    // React 19 のハイドレーション不一致を引き起こす(#34)
    expect(html).not.toContain('node="')
    expect(html).not.toContain('[object Object]')
  })

  test('外部リンクは target="_blank" + rel で開く', () => {
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer noopener"')
  })

  test('loose な番号付きリストでマーカーが別行に取り残されない(#217)', () => {
    const src = '1. **項目 A** — 説明 A\n\n2. **項目 B** — 説明 B\n'
    const out = renderToString(<ArticleMarkdown source={src} />)
    // list-inside ではなく list-outside + 左パディングで描画される
    expect(out).toContain('list-outside')
    expect(out).not.toContain('list-inside')
    // li 内の p は縦マージンを潰してマーカーと揃える(HTML 属性内なので & > は実体参照)
    expect(out).toContain('[&amp;&gt;p]:my-0')
    expect(out).toContain('<ol')
    expect(out).toContain('項目 A')
  })

  test('言語指定なしのコードブロックがインラインコード扱いされない(#217)', () => {
    const src = '```\n図 A\n  ↓\n図 B\n```\n'
    const out = renderToString(<ArticleMarkdown source={src} />)
    // pre 配下の code に渡らず HighlightedCode の fallback pre で描画される
    expect(out).toContain('図 A')
    expect(out).toContain('<pre')
    // インラインコードの背景クラスがブロックに漏れていないこと
    expect(out).not.toContain('bg-base-300')
  })
})
