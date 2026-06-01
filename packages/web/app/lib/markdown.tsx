import { isValidElement, useEffect, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlight } from './highlight.ts'

/**
 * Shiki でシンタックスハイライトしたコードブロック。
 * SSR ではプレーンテキストで返し、クライアントマウント後にハイライトを適用する。
 */
export function HighlightedCode({
  code,
  lang,
  fallbackClassName,
  wrapperClassName,
}: {
  code: string
  lang: string
  fallbackClassName?: string
  wrapperClassName?: string
}) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    highlight(code, lang).then(setHtml)
  }, [code, lang])

  if (!html) {
    return (
      <pre
        className={
          fallbackClassName ??
          'bg-neutral text-neutral-content p-4 rounded my-3 overflow-x-auto text-sm leading-relaxed'
        }
      >
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className={
        wrapperClassName ??
        'my-3 [&>pre]:rounded [&>pre]:p-4 [&>pre]:overflow-x-auto [&>pre]:text-sm [&>pre]:leading-relaxed'
      }
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki が生成した信頼できる HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * 記事本文向け Markdown レンダラ。
 * - GFM(表 / タスクリスト / ストライクスルー / 自動リンク)対応
 * - 既定で生 HTML をエスケープする(`rehype-raw` を付けない = XSS 防止)
 * - components の各オーバーライドでは `react-markdown` が `passNode: true` で
 *   渡してくる `node` プロップを destructure で取り除き、DOM 属性に漏らさない。
 *   漏らすと `<h2 node="[object Object]">` 等になり React 19 のハイドレーション
 *   ミスマッチを誘発し、最悪クライアント側で本文が描画されなくなる(#34)。
 */
const components: Components = {
  a: ({ node: _node, href, children, ...rest }) => (
    <a
      {...rest}
      href={href}
      // 出典・参照は外部 URL になりがちなので開く先を別タブに
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary hover:underline"
    >
      {children}
    </a>
  ),
  h1: ({ node: _node, children, ...rest }) => (
    <h1 {...rest} className="text-2xl font-bold mt-6 mb-3">
      {children}
    </h1>
  ),
  h2: ({ node: _node, children, ...rest }) => (
    <h2 {...rest} className="text-xl font-bold mt-5 mb-2 border-b pb-1">
      {children}
    </h2>
  ),
  h3: ({ node: _node, children, ...rest }) => (
    <h3 {...rest} className="text-lg font-bold mt-4 mb-2">
      {children}
    </h3>
  ),
  p: ({ node: _node, children, ...rest }) => (
    <p {...rest} className="my-3 leading-relaxed">
      {children}
    </p>
  ),
  ul: ({ node: _node, children, ...rest }) => (
    <ul {...rest} className="list-disc list-inside my-3 space-y-1">
      {children}
    </ul>
  ),
  ol: ({ node: _node, children, ...rest }) => (
    <ol {...rest} className="list-decimal list-inside my-3 space-y-1">
      {children}
    </ol>
  ),
  blockquote: ({ node: _node, children, ...rest }) => (
    <blockquote
      {...rest}
      className="border-l-4 border-border-strong pl-3 my-3 text-base-content/80 italic"
    >
      {children}
    </blockquote>
  ),
  code: ({ node: _node, className, children, ...rest }) => {
    // フェンス付き(```lang)は pre コンポーネントで Shiki ハイライトを行うためそのまま返す
    const isBlock = typeof className === 'string' && className.startsWith('language-')
    if (isBlock) {
      return (
        <code {...rest} className={className}>
          {children}
        </code>
      )
    }
    return (
      <code {...rest} className="bg-base-300 px-1 rounded text-sm">
        {children}
      </code>
    )
  },
  pre: ({ node: _node, children }) => {
    // フェンス付きコードブロックは children が単一の <code language-xxx> 要素
    if (isValidElement(children)) {
      const props = (children as React.ReactElement<{ className?: string; children?: unknown }>)
        .props
      if (typeof props.className === 'string' && props.className.includes('language-')) {
        const lang = props.className.match(/language-(\S+)/)?.[1] ?? 'text'
        const code = String(props.children ?? '').replace(/\n$/, '')
        return <HighlightedCode code={code} lang={lang} />
      }
    }
    return (
      <pre className="bg-neutral text-neutral-content p-4 rounded my-3 overflow-x-auto text-sm leading-relaxed">
        {children}
      </pre>
    )
  },
  table: ({ node: _node, children, ...rest }) => (
    <div className="overflow-x-auto my-3">
      <table {...rest} className="border-collapse">
        {children}
      </table>
    </div>
  ),
  th: ({ node: _node, children, ...rest }) => (
    <th {...rest} className="border px-2 py-1 bg-base-300 text-left">
      {children}
    </th>
  ),
  td: ({ node: _node, children, ...rest }) => (
    <td {...rest} className="border px-2 py-1">
      {children}
    </td>
  ),
  hr: () => <hr className="my-6 border-border" />,
}

export function ArticleMarkdown({ source }: { source: string }) {
  // `prose` 系クラスは Tailwind v4 + typography プラグイン無しの構成では存在しない
  // ため、見出し等の Tailwind ユーティリティクラスは components マップ側で個別に
  // 当てている。ここでは折り返しやリンク色のためのコンテナクラスだけ持たせる。
  return (
    <div className="text-base text-base-content break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
