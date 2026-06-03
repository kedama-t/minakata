/** IP ベースのシンプルなインメモリレート制限(ログインフォーム用) */

const WINDOW_MS = 5 * 60 * 1000 // 5 分
const MAX_ATTEMPTS = 5

interface Entry {
  count: number
  windowStart: number
}

const store = new Map<string, Entry>()

/** ログイン試行を記録し、レート制限に引っかかった場合は true を返す */
export function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = store.get(ip)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now })
    return false
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return true
  }
  entry.count++
  return false
}

/** ログイン成功時に試行カウントをリセットする */
export function resetRateLimit(ip: string): void {
  store.delete(ip)
}
