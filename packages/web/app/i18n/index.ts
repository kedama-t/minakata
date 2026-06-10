import { useRouteLoaderData } from 'react-router'
import { en } from './locales/en.ts'
import { type Dict, ja } from './locales/ja.ts'

export type { Dict }

/**
 * 対応言語のレジストリ。言語を追加するときは
 * `locales/<code>.ts` を作成してここに登録するだけでよい
 * (スイッチャー・locale 解決・型チェックはすべてここから導出される)。
 */
export const dictionaries = { ja, en } as const satisfies Record<string, Dict>

export type Locale = keyof typeof dictionaries

export const locales = Object.keys(dictionaries) as Locale[]
export const defaultLocale: Locale = 'ja'

const COOKIE_NAME = 'minakata_locale'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function isLocale(value: string): value is Locale {
  return value in dictionaries
}

function readLocaleCookie(req: Request): Locale | null {
  const raw = req.headers.get('cookie') ?? ''
  for (const part of raw.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k === COOKIE_NAME && v) {
      const value = decodeURIComponent(v)
      if (isLocale(value)) return value
    }
  }
  return null
}

/** Accept-Language ヘッダから対応言語を選ぶ(q 値の降順) */
function negotiateLocale(req: Request): Locale | null {
  const header = req.headers.get('accept-language')
  if (!header) return null
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2)
      return { tag: (tag ?? '').toLowerCase(), q: q ? Number.parseFloat(q) : 1 }
    })
    .sort((a, b) => b.q - a.q)
  for (const { tag } of ranked) {
    const primary = tag.split('-')[0] ?? ''
    if (isLocale(tag)) return tag
    if (isLocale(primary)) return primary
  }
  return null
}

/** リクエストから locale を解決する。cookie → Accept-Language → 既定 の順 */
export function detectLocale(req: Request): Locale {
  return readLocaleCookie(req) ?? negotiateLocale(req) ?? defaultLocale
}

export function serializeLocaleCookie(locale: Locale): string {
  return `${COOKIE_NAME}=${locale}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`
}

/** loader / action 用。リクエスト外(コンポーネント)では useDict() を使う */
export function getDict(locale: Locale): Dict {
  return dictionaries[locale]
}

/** root loader が返す locale。コンポーネントから現在言語を知るためのフック */
export function useLocale(): Locale {
  const root = useRouteLoaderData('root') as { locale?: Locale } | undefined
  return root?.locale ?? defaultLocale
}

/** 現在言語の辞書を返すフック。UI 文字列は必ずこの辞書から引く */
export function useDict(): Dict {
  return dictionaries[useLocale()]
}
