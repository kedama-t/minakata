import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher, useNavigate } from 'react-router'
import { type Dict, useDict } from '../i18n/index.ts'
import { articleHref } from '../lib/article-link.ts'

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

function buildStaticActions(t: Dict): ActionItem[] {
  return [
    {
      kind: 'action',
      id: 'chat-new',
      label: t.commandPalette.actionNewChat,
      hint: '/chat/new',
      href: '/chat/new',
    },
    {
      kind: 'action',
      id: 'search',
      label: t.commandPalette.actionSearch,
      hint: '/search',
      href: '/search',
    },
    {
      kind: 'action',
      id: 'topics',
      label: t.commandPalette.actionTopics,
      hint: '/topics',
      href: '/topics',
    },
    {
      kind: 'action',
      id: 'reviews',
      label: t.commandPalette.actionReviews,
      hint: '/reviews',
      href: '/reviews',
    },
  ]
}

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
  const t = useDict()
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
      href: articleHref(h.slug),
    }))
  }, [fetcher.data])

  const items: Item[] = useMemo(() => {
    const staticActions = buildStaticActions(t)
    if (query.trim().length === 0) return staticActions
    const lower = query.toLowerCase()
    const filteredStatic = staticActions.filter((a) => a.label.toLowerCase().includes(lower))
    // 検索クエリ実行アクションを先頭に
    const queryAction: ActionItem = {
      kind: 'action',
      id: 'run-search',
      label: t.commandPalette.runSearch(query),
      hint: `/search?q=${query}`,
      href: `/search?q=${encodeURIComponent(query)}`,
    }
    return [queryAction, ...articleItems, ...filteredStatic]
  }, [query, articleItems, t])

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
        className="bg-surface text-base-content border border-border rounded shadow-xl w-full max-w-xl overflow-hidden static relative"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={t.commandPalette.label}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder={t.commandPalette.placeholder}
          className="w-full px-4 py-3 outline-none bg-transparent border-b border-border"
        />
        <ul className="max-h-96 overflow-y-auto">
          {items.map((item, i) => (
            <li
              key={`${item.kind}:${item.id}`}
              className={`flex items-center gap-2 px-4 py-2 cursor-pointer ${
                i === selectedIdx ? 'bg-primary/10' : 'hover:bg-base-200/50'
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
                    ? 'bg-accent/15 text-accent'
                    : 'bg-base-300 text-base-content/60'
                }`}
              >
                {item.kind === 'article'
                  ? t.commandPalette.kindArticle
                  : t.commandPalette.kindAction}
              </span>
              <span className="flex-1 truncate text-sm">{item.label}</span>
              {item.hint && (
                <span className="text-xs text-base-content/40 truncate max-w-xs">{item.hint}</span>
              )}
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-base-content/60">
              {t.commandPalette.empty}
            </li>
          )}
        </ul>
        <div className="px-4 py-2 border-t border-border text-xs text-base-content/60 flex items-center gap-3">
          <span>{t.commandPalette.hintMove}</span>
          <span>{t.commandPalette.hintRun}</span>
          <span>{t.commandPalette.hintClose}</span>
          <span className="ml-auto">{t.commandPalette.hintReopen}</span>
        </div>
      </dialog>
    </div>
  )
}
