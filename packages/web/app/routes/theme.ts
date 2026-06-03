import { redirect } from 'react-router'
import { assertSameOrigin } from '../lib/auth.ts'
import { serializeThemeCookie } from '../lib/theme.ts'
import type { Route } from './+types/theme.ts'

/**
 * テーマトグル用のアクション。POST `/theme` で cookie を書き換えて、
 * `Referer` (なければ `/`) にリダイレクトする。
 */
export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  const form = await request.formData()
  const value = String(form.get('theme') ?? 'system')
  const theme = value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
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
    headers: { 'Set-Cookie': serializeThemeCookie(theme) },
  })
}
