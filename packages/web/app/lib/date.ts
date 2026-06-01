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
  return Number(
    new Intl.DateTimeFormat('ja-JP', { timeZone: tz, hour: 'numeric', hour12: false }).format(
      new Date(),
    ),
  )
}
