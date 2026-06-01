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
    expect(html).toContain('<li>item one</li>')
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
})
