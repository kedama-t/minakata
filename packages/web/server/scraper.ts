import { lookup } from 'node:dns/promises'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

/** SSRF 対策: プライベート・ループバック・リンクローカル IP を拒否する */
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
async function validatePublicUrl(urlStr: string): Promise<void> {
  const parsed = new URL(urlStr)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`disallowed URL scheme: ${parsed.protocol}`)
  }
  const hostname = parsed.hostname
  const isIpLiteral = /^[\d.]+$/.test(hostname) || hostname.includes(':')
  const addrs = isIpLiteral
    ? [hostname]
    : (await lookup(hostname, { all: true })).map((r) => r.address)
  for (const addr of addrs) {
    if (isPrivateIp(addr))
      throw new Error('requests to private or internal addresses are not allowed')
  }
}

const td = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
})

export interface ScrapeResult {
  markdown: string
  metadata: {
    title: string
    description: string
    sourceURL: string
    statusCode: number
  }
}

/** URLを取得してMarkdownとメタデータを返す */
export async function scrapeUrl(
  url: string,
  opts: { onlyMainContent?: boolean; timeout?: number } = {},
): Promise<ScrapeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 30_000)

  await validatePublicUrl(url)

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
    markdown,
    metadata: {
      title,
      description: metaDesc,
      sourceURL: url,
      statusCode,
    },
  }
}
