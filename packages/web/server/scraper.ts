import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

const td = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
})

export interface ScrapeResult {
  /** フェンス付き Markdown。外部コンテンツは <untrusted_content> タグで囲まれている */
  markdown: string
  metadata: {
    title: string
    description: string
    sourceURL: string
    statusCode: number
  }
}

/**
 * 外部コンテンツを <untrusted_content> タグで囲みプロンプトインジェクションを緩和する。
 * タグ内に含まれる閉じタグ文字列をエスケープして偽タグによるフェンス脱出を防ぐ。
 */
function fenceUntrustedContent(content: string): string {
  const escaped = content.replaceAll('</untrusted_content>', '<\\/untrusted_content>')
  return `<untrusted_content>\n${escaped}\n</untrusted_content>`
}

/** URLを取得してMarkdownとメタデータを返す */
export async function scrapeUrl(
  url: string,
  opts: { onlyMainContent?: boolean; timeout?: number } = {},
): Promise<ScrapeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 30_000)

  let html: string
  let statusCode: number

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Minakata/1.0)' },
    })
    statusCode = res.status
    html = await res.text()
  } finally {
    clearTimeout(timer)
  }

  const { document } = parseHTML(html)

  // OGP / meta でメタデータ抽出
  const metaDesc =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ??
    document.querySelector('meta[property="og:description"]')?.getAttribute('content') ??
    ''

  let markdown: string
  let title: string

  if (opts.onlyMainContent !== false) {
    // Readability でメインコンテンツ抽出
    const article = new Readability(document as unknown as Document).parse()
    title = article?.title ?? document.querySelector('title')?.textContent ?? ''
    const contentHtml = article?.content ?? html
    markdown = td.turndown(contentHtml)
  } else {
    title = document.querySelector('title')?.textContent ?? ''
    markdown = td.turndown(html)
  }

  return {
    markdown: fenceUntrustedContent(markdown),
    metadata: {
      title,
      description: metaDesc,
      sourceURL: url,
      statusCode,
    },
  }
}
