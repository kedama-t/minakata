import { useDict } from '../../i18n/index.ts'

const COLORS: Record<string, string> = {
  fresh: 'bg-success/15 text-success',
  aging: 'bg-warning/15 text-warning',
  stale: 'bg-warning/30 text-warning',
  very_stale: 'bg-error/15 text-error',
}

/** 記事の鮮度ランクを表示するバッジ */
export function FreshnessBadge({ rank }: { rank: string }) {
  const t = useDict()
  const color = COLORS[rank] ?? 'bg-base-200 text-base-content/50'
  const label = (t.freshness as Record<string, string>)[rank] ?? rank
  return <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>{label}</span>
}
