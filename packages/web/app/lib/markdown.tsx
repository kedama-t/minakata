import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
      className="text-blue-700 dark:text-blue-300 hover:underline"
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
      className="border-l-4 border-slate-300 pl-3 my-3 text-slate-700 dark:text-slate-300 italic"
    >
      {children}
    </blockquote>
  ),
  code: ({ node: _node, className, children, ...rest }) => {
    // フェンス付き(```lang)は className="language-xxx" が付く。それ以外はインライン扱い。
    const isBlock = typeof className === 'string' && className.startsWith('language-')
    if (isBlock) {
      return (
        <code {...rest} className={`${className} block`}>
          {children}
        </code>
      )
    }
    return (
      <code {...rest} className="bg-slate-100 dark:bg-slate-700 px-1 rounded text-sm">
        {children}
      </code>
    )
  },
  pre: ({ node: _node, children, ...rest }) => (
    <pre {...rest} className="bg-slate-900 text-slate-100 p-3 rounded my-3 overflow-x-auto text-sm">
      {children}
    </pre>
  ),
  table: ({ node: _node, children, ...rest }) => (
    <div className="overflow-x-auto my-3">
      <table {...rest} className="border-collapse">
        {children}
      </table>
    </div>
  ),
  th: ({ node: _node, children, ...rest }) => (
    <th {...rest} className="border px-2 py-1 bg-slate-100 dark:bg-slate-700 text-left">
      {children}
    </th>
  ),
  td: ({ node: _node, children, ...rest }) => (
    <td {...rest} className="border px-2 py-1">
      {children}
    </td>
  ),
  hr: () => <hr className="my-6 border-slate-200 dark:border-slate-700" />,
}

export function ArticleMarkdown({ source }: { source: string }) {
  // `prose` 系クラスは Tailwind v4 + typography プラグイン無しの構成では存在しない
  // ため、見出し等の Tailwind ユーティリティクラスは components マップ側で個別に
  // 当てている。ここでは折り返しやリンク色のためのコンテナクラスだけ持たせる。
  return (
    <div className="text-base text-slate-900 dark:text-slate-100 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
