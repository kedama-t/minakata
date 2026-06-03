import { lookup } from 'node:dns/promises'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

/** プライベート/ループバック/リンクローカルIPを検出する */
function isPrivateIp(ip: string): boolean {
  // IPv4
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [, a, b] = v4.map(Number)
    if (a === 10) return true
    if (a === 127) return true
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
    return false
  }
  // IPv6: loopback, link-local, ULA
  const lower = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (lower === '::1') return true
  if (lower.startsWith('fe80:')) return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  return false
}

/** SSRFを防ぐURL検証。スキーム・ホスト・DNS解決後IPを確認する */
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
  // IP リテラルを直接チェック
  if (isPrivateIp(hostname)) {
    throw new Error('SSRF: Private/loopback IP addresses are not allowed')
  }
  // DNS解決後のIPも確認（DNS rebinding対策）
  try {
    const result = await lookup(hostname, { all: true })
    for (const { address } of result) {
      if (isPrivateIp(address)) {
        throw new Error('SSRF: Hostname resolves to a private/loopback IP address')
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('SSRF:')) throw err
    throw new Error('SSRF: Failed to resolve hostname')
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
