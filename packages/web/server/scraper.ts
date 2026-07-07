import { lookup as dnsLookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

/** リダイレクト追従の上限。各ホップは assertSafeUrl で再検証する */
const MAX_REDIRECTS = 5
/** レスポンス本文の上限(DoS 緩和) */
const MAX_BODY_BYTES = 5_000_000

/** `[::1]` のようなブラケット付き IPv6 リテラルからブラケットを外す */
function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * IPv4-mapped / IPv4-compatible な IPv6 表記を dotted-quad へ展開する。
 * 例: `::ffff:127.0.0.1` / `::ffff:7f00:1` / `::127.0.0.1` → `127.0.0.1`
 * 該当しなければ null。
 */
function ipv4MappedToDotted(ip: string): string | null {
  const lower = ip.toLowerCase()
  let m = lower.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (m?.[1]) return m[1]
  m = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (m?.[1] && m[2]) {
    const hi = Number.parseInt(m[1], 16)
    const lo = Number.parseInt(m[2], 16)
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  }
  return null
}

/** private/loopback/link-local/予約済みの IPv4 か */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
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

/**
 * プライベート/ループバック/リンクローカル/予約済みIPを検出する。
 * IPv4 リテラルに加え、ブラケット付き IPv6・IPv4-mapped IPv6・IPv6 プライベート帯
 * (`::1` / `fe80::/10` / `fc00::/7`) も判定する。
 */
export function isPrivateIp(host: string): boolean {
  // ブラケット除去 + ゾーン ID (`%eth0`) 除去 + 小文字化
  const ip = (stripBrackets(host.trim()).split('%')[0] ?? '').toLowerCase()
  const mapped = ipv4MappedToDotted(ip)
  if (mapped) return isPrivateIpv4(mapped)
  if (ip.includes(':')) {
    if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1') return true
    if (/^fe[89ab]/i.test(ip)) return true // fe80::/10 link-local
    if (/^f[cd]/i.test(ip)) return true // fc00::/7 unique local
    return false
  }
  return isPrivateIpv4(ip)
}

/**
 * スキーム検証 + DNS 解決後の IP チェックで SSRF を防ぐ。
 * 検証を通った接続先 IP を返し、呼び出し側はこの IP に固定して接続する
 * (DNS リバインディング / TOCTOU 対策)。
 */
export async function assertSafeUrl(rawUrl: string): Promise<{ url: URL; addresses: string[] }> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('SSRF: Invalid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SSRF: Only http/https schemes are allowed')
  }
  const host = stripBrackets(parsed.hostname)
  if (isPrivateIp(parsed.hostname)) {
    throw new Error('SSRF: Private/loopback IP addresses are not allowed')
  }
  const isIpLiteral = /^[\d.]+$/.test(host) || parsed.hostname.includes(':')
  let addresses: string[]
  if (isIpLiteral) {
    addresses = [host]
  } else {
    addresses = await dnsLookup(host, { all: true })
      .then((r) => r.map((e) => e.address))
      .catch(() => {
        throw new Error('SSRF: Failed to resolve hostname')
      })
    if (addresses.length === 0) throw new Error('SSRF: Failed to resolve hostname')
  }
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error('SSRF: Hostname resolves to a private/loopback IP address')
    }
  }
  return { url: parsed, addresses }
}

/**
 * 外部コンテンツを <untrusted_content> タグで囲みプロンプトインジェクションを緩和する。
 * タグ内の閉じタグ文字列をエスケープして偽タグによるフェンス脱出を防ぐ。
 * scraper 以外(検索プロキシ等)からも再利用できるよう公開する。
 */
export function fenceUntrustedContent(content: string): string {
  const escaped = content.replaceAll('</untrusted_content>', '<\\/untrusted_content>')
  return `<untrusted_content>\n${escaped}\n</untrusted_content>`
}

interface RawResponse {
  statusCode: number
  location: string | undefined
  body: string
}

/**
 * 検証済み IP に固定して 1 リクエストを発行する。
 * 独自 `lookup` で OS リゾルバを無視し assertSafeUrl が通した IP のみに接続することで、
 * 検査後に別 IP へ切り替える DNS リバインディングを封じる。リダイレクトは追従しない。
 */
function requestOnce(target: URL, addresses: string[], timeoutMs: number): Promise<RawResponse> {
  const mod = target.protocol === 'https:' ? https : http
  const pinned = addresses[0] as string
  const family = pinned.includes(':') ? 6 : 4
  const options: https.RequestOptions = {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Minakata/1.0)',
      Accept: 'text/html,application/xhtml+xml',
    },
    lookup: (_hostname, opts, callback) => {
      const all = typeof opts === 'object' && opts !== null && 'all' in opts && opts.all
      if (all) {
        ;(callback as (e: null, a: { address: string; family: number }[]) => void)(null, [
          { address: pinned, family },
        ])
      } else {
        ;(callback as (e: null, a: string, f: number) => void)(null, pinned, family)
      }
    },
  }
  return new Promise<RawResponse>((resolve, reject) => {
    const req = mod.request(target, options, (res) => {
      const statusCode = res.statusCode ?? 0
      const location = typeof res.headers.location === 'string' ? res.headers.location : undefined
      if (statusCode >= 300 && statusCode < 400 && location) {
        res.resume() // 本文を破棄してソケットを解放
        resolve({ statusCode, location, body: '' })
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      res.on('data', (c: Buffer) => {
        total += c.length
        if (total > MAX_BODY_BYTES) {
          req.destroy()
          reject(new Error('SSRF: Response body too large'))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => {
        resolve({ statusCode, location: undefined, body: Buffer.concat(chunks).toString('utf8') })
      })
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Scrape request timed out'))
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * SSRF 安全に URL を取得する。初回 URL と各リダイレクト先を毎回 assertSafeUrl で検証し、
 * 検証済み IP に固定して接続する。リダイレクトは手動追従し、上限を超えたら拒否する。
 */
async function safeFetchHtml(
  rawUrl: string,
  timeoutMs: number,
): Promise<{ statusCode: number; body: string }> {
  let current = rawUrl
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const { url, addresses } = await assertSafeUrl(current)
    const res = await requestOnce(url, addresses, timeoutMs)
    if (res.statusCode >= 300 && res.statusCode < 400 && res.location) {
      current = new URL(res.location, url).toString()
      continue
    }
    return { statusCode: res.statusCode, body: res.body }
  }
  throw new Error('SSRF: Too many redirects')
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
  const { statusCode, body: html } = await safeFetchHtml(url, opts.timeout ?? 30_000)

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
