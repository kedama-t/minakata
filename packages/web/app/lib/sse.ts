import { useEffect, useRef, useState } from 'react'

export type SseStatus = 'connecting' | 'open' | 'closed'

/**
 * `/events` SSE バスを購読する hook。
 * トピックごとに addEventListener され、`onEvent(topic, data)` で受け取る。
 * EventSource は自前再接続を行うため、コンポーネント側で retry ロジックは不要。
 */
export function useEventSource(
  topics: readonly string[],
  onEvent: (topic: string, data: unknown) => void,
): SseStatus {
  const [status, setStatus] = useState<SseStatus>('connecting')
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent
  const topicsKey = topics.join(',')

  useEffect(() => {
    if (!topicsKey) {
      setStatus('closed')
      return
    }
    const url = `/events?topics=${encodeURIComponent(topicsKey)}`
    const es = new EventSource(url)
    setStatus('connecting')

    const onOpen = (): void => setStatus('open')
    const onError = (): void => setStatus('connecting')
    es.addEventListener('open', onOpen)
    es.addEventListener('error', onError)

    const listeners: Array<[string, (ev: MessageEvent) => void]> = []
    for (const topic of topicsKey.split(',')) {
      const handler = (ev: MessageEvent): void => {
        try {
          const data: unknown = JSON.parse(ev.data)
          cbRef.current(topic, data)
        } catch {
          // ignore malformed payload
        }
      }
      es.addEventListener(topic, handler as EventListener)
      listeners.push([topic, handler])
    }

    return () => {
      es.removeEventListener('open', onOpen)
      es.removeEventListener('error', onError)
      for (const [topic, handler] of listeners) {
        es.removeEventListener(topic, handler as EventListener)
      }
      es.close()
      setStatus('closed')
    }
  }, [topicsKey])

  return status
}
