const LABELS: Record<string, string> = {
  fresh: '新着',
  aging: 'やや古い',
  stale: '要更新',
  very_stale: '長期未更新',
}

const COLORS: Record<string, string> = {
  fresh: 'bg-success/15 text-success',
  aging: 'bg-warning/15 text-warning',
  stale: 'bg-warning/30 text-warning',
  very_stale: 'bg-error/15 text-error',
}

/** 記事の鮮度ランクを表示するバッジ */
export function FreshnessBadge({ rank }: { rank: string }) {
  const color = COLORS[rank] ?? 'bg-base-200 text-base-content/50'
  const label = LABELS[rank] ?? rank
  return <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>{label}</span>
}
