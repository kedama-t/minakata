import { redirect } from 'react-router'
import { defaultLocale, isLocale, serializeLocaleCookie } from '../i18n/index.ts'
import { assertSameOrigin } from '../lib/auth.ts'
import type { Route } from './+types/locale.ts'

/**
 * 言語切替用のアクション。POST `/locale` で cookie を書き換えて、
 * `Referer` (なければ `/`) にリダイレクトする(theme と同じパターン)。
 */
export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  const form = await request.formData()
  const value = String(form.get('locale') ?? defaultLocale)
  const locale = isLocale(value) ? value : defaultLocale
  const referer = request.headers.get('referer')
  let target = '/'
  if (referer) {
    try {
      target = new URL(referer).pathname || '/'
    } catch {
      target = '/'
    }
  }
  return redirect(target, {
    headers: { 'Set-Cookie': serializeLocaleCookie(locale) },
  })
}
