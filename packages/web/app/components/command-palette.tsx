import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher, useNavigate } from 'react-router'

type ActionItem = {
  kind: 'action'
  id: string
  label: string
  hint?: string
  href: string
}
type ArticleItem = {
  kind: 'article'
  id: string
  label: string
  hint?: string
  href: string
}
type Item = ActionItem | ArticleItem

const STATIC_ACTIONS: ActionItem[] = [
  { kind: 'action', id: 'chat-new', label: '新規対話を開始', hint: '/chat/new', href: '/chat/new' },
  {
    kind: 'action',
    id: 'knowledge-new',
    label: 'ナレッジ質問を開始',
    hint: '/chat/new?kind=knowledge',
    href: '/chat/new?kind=knowledge',
  },
  { kind: 'action', id: 'search', label: '検索ページへ', hint: '/search', href: '/search' },
  {
    kind: 'action',
    id: 'topics',
    label: '購読トピックを編集',
    hint: '/topics',
    href: '/topics',
  },
  { kind: 'action', id: 'reviews', label: 'レビュー一覧', hint: '/reviews', href: '/reviews' },
]

interface SearchHit {
  id: string
  slug: string
  title: string
  status: string
}
interface SearchPayload {
  hits?: SearchHit[]
}

/**
 * グローバル Cmd+K (Ctrl+K) で開くコマンドパレット。
 * - 入力なし時は静的アクション (チャット起動 / ナレッジ質問 / 検索 / 等)
 * - 入力時は `/search?q=...` の loader を fetcher.load で叩いて記事を最大 8 件
 * - Enter で最上位、↑↓ で選択移動、Esc / クリック外で閉じる
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const fetcher = useFetcher<SearchPayload>()
  const navigate = useNavigate()

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setSelectedIdx(0)
  }, [])

  // Cmd+K / Ctrl+K で開く・Esc で閉じる + サイドバー検索ボタン等からのカスタムイベント
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape' && open) {
        e.preventDefault()
        close()
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpen)
    }
  }, [open, close])

  // open 時に input フォーカス
  useEffect(() => {
    if (open) {
      // 次フレームでフォーカス(<dialog> がマウント直後だと取れないことがある)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // クエリ変化で /search loader を叩く(debounce 200ms)
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) return
    const handle = setTimeout(() => {
      fetcher.load(`/search?q=${encodeURIComponent(q)}`)
    }, 200)
    return () => clearTimeout(handle)
  }, [open, query, fetcher])

  const articleItems: ArticleItem[] = useMemo(() => {
    const hits = fetcher.data?.hits ?? []
    return hits.slice(0, 8).map((h) => ({
      kind: 'article' as const,
      id: h.id,
      label: h.title,
      hint: h.status,
      href: `/articles/${h.slug}`,
    }))
  }, [fetcher.data])

  const items: Item[] = useMemo(() => {
    if (query.trim().length === 0) return STATIC_ACTIONS
    const lower = query.toLowerCase()
    const filteredStatic = STATIC_ACTIONS.filter((a) => a.label.toLowerCase().includes(lower))
    // 検索クエリ実行アクションを先頭に
    const queryAction: ActionItem = {
      kind: 'action',
      id: 'run-search',
      label: `「${query}」で検索`,
      hint: `/search?q=${query}`,
      href: `/search?q=${encodeURIComponent(query)}`,
    }
    return [queryAction, ...articleItems, ...filteredStatic]
  }, [query, articleItems])

  // items が変化したら selectedIdx を 0 にリセット
  // biome-ignore lint/correctness/useExhaustiveDependencies: items reference identity is recomputed each render
  useEffect(() => {
    setSelectedIdx(0)
  }, [items.length])

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = items[selectedIdx]
      if (target) {
        close()
        navigate(target.href)
      }
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-24 px-4"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
      role="presentation"
    >
      <dialog
        open
        className="bg-surface border border-border rounded shadow-xl w-full max-w-xl overflow-hidden static relative"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="コマンドパレット"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="アクションを検索 or 記事を検索…"
          className="w-full px-4 py-3 outline-none bg-transparent border-b border-border"
        />
        <ul className="max-h-96 overflow-y-auto">
          {items.map((item, i) => (
            <li
              key={`${item.kind}:${item.id}`}
              className={`flex items-center gap-2 px-4 py-2 cursor-pointer ${
                i === selectedIdx
                  ? 'bg-blue-50 dark:bg-blue-900/40'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
              }`}
              onMouseEnter={() => setSelectedIdx(i)}
              onClick={() => {
                close()
                navigate(item.href)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  close()
                  navigate(item.href)
                }
              }}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard nav via global key handler
              tabIndex={0}
            >
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  item.kind === 'article'
                    ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {item.kind === 'article' ? '記事' : '操作'}
              </span>
              <span className="flex-1 truncate text-sm">{item.label}</span>
              {item.hint && (
                <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-xs">
                  {item.hint}
                </span>
              )}
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              該当する候補はありません
            </li>
          )}
        </ul>
        <div className="px-4 py-2 border-t border-border text-xs text-slate-500 dark:text-slate-400 flex items-center gap-3">
          <span>↑↓ 選択</span>
          <span>Enter 実行</span>
          <span>Esc 閉じる</span>
          <span className="ml-auto">⌘K で再オープン</span>
        </div>
      </dialog>
    </div>
  )
}
