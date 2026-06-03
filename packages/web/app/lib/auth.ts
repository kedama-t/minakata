import type { User } from '@minakata/core'
import { redirect } from 'react-router'
import { getServices } from './services.ts'

const COOKIE_NAME = 'minakata_session'
const COOKIE_MAX_AGE = 30 * 86_400 // 30 days

/**
 * 本番運用は HTTPS 前提(Caddy 等の reverse proxy 経由)なので Cookie に
 * `Secure` を付ける。ローカル開発の HTTP 環境では `COOKIE_SECURE=false` で
 * opt-out できる。値が未指定(undefined)の場合は `Secure` を付ける。
 * 本番環境で `COOKIE_SECURE=false` を設定した場合は起動時に警告を出す。
 */
function isSecureCookieEnabled(): boolean {
  const disabled = process.env.COOKIE_SECURE === 'false'
  if (disabled && process.env.NODE_ENV === 'production') {
    console.error(
      '[minakata] SECURITY WARNING: COOKIE_SECURE=false in production — session cookies will be sent over plain HTTP',
    )
  }
  return !disabled
}

export function serializeSession(token: string): string {
  const secure = isSecureCookieEnabled() ? '; Secure' : ''
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=${COOKIE_MAX_AGE}`
}

export function clearSessionCookie(): string {
  const secure = isSecureCookieEnabled() ? '; Secure' : ''
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=0`
}

export function getSessionToken(req: Request): string | null {
  const raw = req.headers.get('cookie') ?? ''
  for (const part of raw.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k === COOKIE_NAME && v) return decodeURIComponent(v)
  }
  return null
}

export function getCurrentUser(req: Request): User | null {
  const token = getSessionToken(req)
  if (!token) return null
  return getServices().auth.resolveSession(token)
}

/** loader / action 用ガード:未認証なら /login へリダイレクト */
export function requireUser(req: Request): User {
  const user = getCurrentUser(req)
  if (!user) throw redirect('/login')
  return user
}

/** role が editor 以上を要求(viewer は弾く) */
export function requireEditor(req: Request): User {
  const user = requireUser(req)
  if (user.role === 'viewer') throw new Response('Forbidden', { status: 403 })
  return user
}

export function requireAdmin(req: Request): User {
  const user = requireUser(req)
  if (user.role !== 'admin') throw new Response('Forbidden', { status: 403 })
  return user
}
