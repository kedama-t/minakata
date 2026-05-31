/** クラス名を結合する最小ユーティリティ。falsy 値は無視する。 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
