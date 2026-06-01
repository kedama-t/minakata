import type { ActivityLogRow } from '@minakata/core'
import { useEffect, useState } from 'react'
import { getAgentProfile } from '../lib/agent-profiles.ts'

type ToastItem = {
  id: string
  displayName: string
  phase: string
  detail: string | null
  emoji: string
}

/** エージェントの report_progress を SSE で受け取ってトースト表示するグローバルコンテナ */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const es = new EventSource('/events?topics=activity')

    const handleActivity = (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { kind: string; row: ActivityLogRow }
      if (data.kind !== 'activity') return
      const row = data.row
      const profile = getAgentProfile(row.agent_name ?? row.actor)
      const toast: ToastItem = {
        id: row.id,
        displayName: profile.displayName,
        phase: row.phase,
        detail: row.detail,
        emoji: profile.emoji,
      }
      setToasts((prev) => [...prev.slice(-4), toast])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id))
      }, 5000)
    }

    es.addEventListener('activity', handleActivity)
    return () => {
      es.removeEventListener('activity', handleActivity)
      es.close()
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast-in bg-surface border border-border rounded-xl shadow-lg px-4 py-3 flex items-start gap-3 max-w-72"
        >
          <span className="text-xl mt-0.5 shrink-0">{t.emoji}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">{t.displayName}</p>
            <p className="text-xs text-base-content/60 mt-0.5 line-clamp-2">
              {t.phase}
              {t.detail ? ` · ${t.detail}` : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
