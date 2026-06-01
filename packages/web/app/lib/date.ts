/** ISO → "YYYY/MM/DD HH:mm:ss" in the given timezone */
export function formatDateTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: tz })
}

/** ISO → "YYYY/MM/DD" in the given timezone */
export function formatDate(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: tz })
}

/** Current hour (0-23) in the given timezone */
export function localHour(tz: string): number {
  // 'ja-JP' は "11時" のように単位付きで返すため Number() が NaN になる。
  // 'en' は数字のみを返すので安全。
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date())
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
}
