import { lookup } from 'node:dns/promises'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

/** プライベート/ループバック/リンクローカル/予約済みIPを検出する */
function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1') return true
  if (/^fe80:/i.test(ip)) return true
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map(Number)
  const a = nums[0] as number
  const b = nums[1] as number
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 240 ||
    a === 255 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

/** スキーム検証 + DNS 解決後の IP チェックで SSRF を防ぐ */
async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('SSRF: Invalid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SSRF: Only http/https schemes are allowed')
  }
  const hostname = parsed.hostname
  if (isPrivateIp(hostname)) {
    throw new Error('SSRF: Private/loopback IP addresses are not allowed')
  }
  const isIpLiteral = /^[\d.]+$/.test(hostname) || hostname.includes(':')
  const addrs = isIpLiteral
    ? [hostname]
    : await lookup(hostname, { all: true })
        .then((r) => r.map((e) => e.address))
        .catch((err) => {
          if (err instanceof Error && err.message.startsWith('SSRF:')) throw err
          throw new Error('SSRF: Failed to resolve hostname')
        })
  for (const addr of addrs) {
    if (isPrivateIp(addr)) {
      throw new Error('SSRF: Hostname resolves to a private/loopback IP address')
    }
  }
}

/**
 * 外部コンテンツを <untrusted_content> タグで囲みプロンプトインジェクションを緩和する。
 * タグ内の閉じタグ文字列をエスケープして偽タグによるフェンス脱出を防ぐ。
 */
function fenceUntrustedContent(content: string): string {
  const escaped = content.replaceAll('</untrusted_content>', '<\\/untrusted_content>')
  return `<untrusted_content>\n${escaped}\n</untrusted_content>`
}

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

/** URLを取得してMarkdownとメタデータを返す。SSRF検証に失敗した場合は例外を投げる */
export async function scrapeUrl(
  url: string,
  opts: { onlyMainContent?: boolean; timeout?: number } = {},
): Promise<ScrapeResult> {
  await assertSafeUrl(url)

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

  const metaDesc =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ??
    document.querySelector('meta[property="og:description"]')?.getAttribute('content') ??
    ''

  let markdown: string
  let title: string

  if (opts.onlyMainContent !== false) {
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
