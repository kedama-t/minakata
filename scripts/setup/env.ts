// .env の解析・更新ロジック（副作用なしの純関数）。setup CLI から呼ばれる。

const KEY_LINE = /^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/

/** .env テキストからキー→値のマップを抽出する（コメント行は無視）。 */
export function parseEnv(content: string): Map<string, string> {
  const env = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (/^\s*#/.test(line)) continue
    const m = line.match(KEY_LINE)
    const key = m?.[1]
    if (key === undefined) continue
    env.set(key, unquote((m?.[2] ?? '').trim()))
  }
  return env
}

/** 値に空白や # を含む場合のみダブルクォートで囲む。 */
function serializeValue(value: string): string {
  if (value === '') return ''
  if (/[\s#"]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`
  return value
}

/** ダブルクォートで囲まれた値のクォートを外す。 */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }
  return value
}

/**
 * .env を更新する。
 * - existing あり: 行 in-place パッチ。対象キー行の右辺だけ差し替え、
 *   コメント・空行・余剰キー・既存の並びは一切触らない。未存在キーのみ末尾追記。
 * - existing なし: template（.env.example）を基に各 KEY= 行の右辺を埋めて生成する。
 */
export function patchEnv(
  existing: string | null,
  updates: Record<string, string>,
  template: string,
): string {
  const base = existing ?? template
  const lines = base.split('\n')
  const applied = new Set<string>()

  const patched = lines.map((line) => {
    if (/^\s*#/.test(line)) return line
    const m = line.match(KEY_LINE)
    const key = m?.[1]
    if (key === undefined) return line
    const value = updates[key]
    if (value === undefined) return line
    applied.add(key)
    return `${key}=${serializeValue(value)}`
  })

  // template / existing に存在しなかったキーを末尾へ追記。
  const missing = Object.entries(updates).filter(([k]) => !applied.has(k))
  if (missing.length > 0) {
    if (patched.length > 0 && patched.at(-1) === '') patched.pop()
    patched.push('', '# setup により追記')
    for (const [key, value] of missing) patched.push(`${key}=${serializeValue(value)}`)
  }

  let result = patched.join('\n')
  if (!result.endsWith('\n')) result += '\n'
  return result
}

/** コメントアウトされた旧シークレットらしき行を検出する（完了時の警告用）。 */
export function findStaleSecrets(content: string): string[] {
  const hits: string[] = []
  for (const line of content.split('\n')) {
    if (!/^\s*#/.test(line)) continue
    if (/(API_KEY|SECRET|TOKEN|fc-|sk-)/i.test(line) && /=\S|fc-\S|sk-\S/.test(line)) {
      hits.push(line.trim())
    }
  }
  return hits
}
