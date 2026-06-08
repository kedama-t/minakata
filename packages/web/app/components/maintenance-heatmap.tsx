/** 日×時間帯(0-23h)のメンテナンスヒートマップ */

export interface HeatmapDay {
  day: string
  hours: HeatmapHour[]
}

export interface HeatmapHour {
  hour: number
  total: number
  created: number
  updated: number
}

function cellColor(total: number): string {
  if (total === 0) return 'bg-base-200'
  if (total === 1) return 'bg-success/20'
  if (total <= 3) return 'bg-success/40'
  if (total <= 6) return 'bg-success/60'
  return 'bg-success/80'
}

export function MaintenanceHeatmap({
  days,
  timezone,
}: {
  days: HeatmapDay[]
  timezone: string
}) {
  if (days.length === 0) {
    return <p className="text-sm text-base-content/50 py-2">まだ記録がありません</p>
  }

  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {/* 時間軸ヘッダー */}
        <div className="flex items-center gap-px mb-1">
          <div className="w-24 shrink-0" />
          {hours.map((h) => (
            <div key={h} className="w-5 text-center text-[9px] text-base-content/30 font-mono">
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </div>
          ))}
        </div>

        {/* 日行 */}
        <div className="flex flex-col gap-px">
          {days.map((d) => (
            <div key={d.day} className="flex items-center gap-px">
              <div className="w-24 shrink-0 text-[10px] text-base-content/40 font-mono text-right pr-2">
                {d.day}
              </div>
              {hours.map((h) => {
                const cell = d.hours[h] ?? { hour: h, total: 0, created: 0, updated: 0 }
                const tip =
                  cell.total === 0
                    ? `${d.day} ${String(h).padStart(2, '0')}時 — 更新なし`
                    : `${d.day} ${String(h).padStart(2, '0')}時 — 新規 ${cell.created} 件 / 更新 ${cell.updated} 件`
                return (
                  <div
                    key={h}
                    data-tip={tip}
                    className={`tooltip tooltip-top w-5 h-4 rounded-[2px] cursor-default ${cellColor(cell.total)}`}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* 凡例 */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-[10px] text-base-content/40">少</span>
          {[0, 1, 3, 5, 7].map((v) => (
            <div key={v} className={`w-4 h-4 rounded-[2px] ${cellColor(v)}`} />
          ))}
          <span className="text-[10px] text-base-content/40">多</span>
          <span className="text-[10px] text-base-content/30 ml-1">({timezone})</span>
        </div>
      </div>
    </div>
  )
}
