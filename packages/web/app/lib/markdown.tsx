import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 記事本文向け Markdown レンダラ。
 * - GFM(表 / タスクリスト / ストライクスルー / 自動リンク)対応
 * - 既定で生 HTML をエスケープする(`rehype-raw` を付けない = XSS 防止)
 * - コードブロックは `<pre><code class="language-xxx">` で出力。サーバーサイド
 *   ハイライトは shiki への置き換えを後続タスクで予定(現状は素の <pre>)
 */
const components: Components = {
  a: ({ href, children, ...rest }) => (
    <a
      {...rest}
      href={href}
      // 出典・参照は外部 URL になりがちなので開く先を別タブに
      target="_blank"
      rel="noreferrer noopener"
      className="text-blue-700 hover:underline"
    >
      {children}
    </a>
  ),
  h1: ({ children, ...rest }) => (
    <h1 {...rest} className="text-2xl font-bold mt-6 mb-3">
      {children}
    </h1>
  ),
  h2: ({ children, ...rest }) => (
    <h2 {...rest} className="text-xl font-bold mt-5 mb-2 border-b pb-1">
      {children}
    </h2>
  ),
  h3: ({ children, ...rest }) => (
    <h3 {...rest} className="text-lg font-bold mt-4 mb-2">
      {children}
    </h3>
  ),
  p: ({ children, ...rest }) => (
    <p {...rest} className="my-3 leading-relaxed">
      {children}
    </p>
  ),
  ul: ({ children, ...rest }) => (
    <ul {...rest} className="list-disc list-inside my-3 space-y-1">
      {children}
    </ul>
  ),
  ol: ({ children, ...rest }) => (
    <ol {...rest} className="list-decimal list-inside my-3 space-y-1">
      {children}
    </ol>
  ),
  blockquote: ({ children, ...rest }) => (
    <blockquote {...rest} className="border-l-4 border-slate-300 pl-3 my-3 text-slate-700 italic">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...rest }) => {
    // インラインコードか、フェンス付き(language-xxx)かを className で判定
    const isBlock = typeof className === 'string' && className.startsWith('language-')
    if (isBlock) {
      return (
        <code {...rest} className={`${className} block`}>
          {children}
        </code>
      )
    }
    return (
      <code {...rest} className="bg-slate-100 px-1 rounded text-sm">
        {children}
      </code>
    )
  },
  pre: ({ children, ...rest }) => (
    <pre {...rest} className="bg-slate-900 text-slate-100 p-3 rounded my-3 overflow-x-auto text-sm">
      {children}
    </pre>
  ),
  table: ({ children, ...rest }) => (
    <div className="overflow-x-auto my-3">
      <table {...rest} className="border-collapse">
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...rest }) => (
    <th {...rest} className="border px-2 py-1 bg-slate-100 text-left">
      {children}
    </th>
  ),
  td: ({ children, ...rest }) => (
    <td {...rest} className="border px-2 py-1">
      {children}
    </td>
  ),
  hr: () => <hr className="my-6 border-slate-200" />,
}

export function ArticleMarkdown({ source }: { source: string }) {
  return (
    <div className="prose prose-slate max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
