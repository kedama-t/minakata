import { type Highlighter, getSingletonHighlighter } from 'shiki'

const LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'json',
  'bash',
  'sh',
  'shell',
  'html',
  'css',
  'markdown',
  'yaml',
  'toml',
  'sql',
] as const

let promise: Promise<Highlighter> | null = null

function getHighlighter() {
  if (!promise) {
    promise = getSingletonHighlighter({
      themes: ['vitesse-dark'],
      langs: [...LANGS],
    })
  }
  return promise
}

/** code を Vitesse Dark でハイライトした HTML 文字列を返す。未知の言語は text として扱う。 */
export async function highlight(code: string, lang: string): Promise<string> {
  const hl = await getHighlighter()
  const loaded = hl.getLoadedLanguages()
  // biome-ignore lint/suspicious/noExplicitAny: Shiki の型は string より厳格だが実行時チェックに any が必要
  const resolvedLang = loaded.includes(lang as any) ? lang : 'text'
  return hl.codeToHtml(code, { lang: resolvedLang, theme: 'vitesse-dark' })
}
