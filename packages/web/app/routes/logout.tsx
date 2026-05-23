import { redirect } from 'react-router'
import { clearSessionCookie, getSessionToken } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/logout.ts'

export async function action({ request }: Route.ActionArgs) {
  const token = getSessionToken(request)
  if (token) {
    const sessionId = token.split('.')[0]
    if (sessionId) getServices().auth.deleteSession(sessionId)
  }
  return redirect('/login', { headers: { 'Set-Cookie': clearSessionCookie() } })
}

export async function loader({ request }: Route.LoaderArgs) {
  return action({ request, params: {}, context: {} } as Route.ActionArgs)
}

export default function Logout() {
  return null
}
