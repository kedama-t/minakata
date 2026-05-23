import { newId, now } from '@minakata/core'
import { Form } from 'react-router'
import { requireEditor } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/topics.ts'

interface TopicRow {
  id: string
  name: string
  keywords_json: string
  depth: string
  active: number
}

export async function loader({ request }: Route.LoaderArgs) {
  requireEditor(request)
  const { db } = getServices()
  const topics = db
    .query<TopicRow, []>(
      'SELECT id, name, keywords_json, depth, active FROM topics ORDER BY created_at DESC',
    )
    .all()
    .map((t) => ({
      ...t,
      keywords: JSON.parse(t.keywords_json) as string[],
      active: t.active === 1,
    }))
  return { topics }
}

export async function action({ request }: Route.ActionArgs) {
  const user = requireEditor(request)
  const form = await request.formData()
  const name = String(form.get('name') ?? '').trim()
  const keywordsRaw = String(form.get('keywords') ?? '')
  const depth = String(form.get('depth') ?? 'shallow')
  if (!name) return { error: '名称が必要' }
  const keywords = keywordsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const { db } = getServices()
  const id = newId()
  const ts = now()
  db.prepare(
    `INSERT INTO topics (id, name, keywords_json, depth, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, JSON.stringify(keywords), depth, user.id, ts, ts)
  return { ok: true }
}

export default function Topics({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">購読トピック</h1>

      <Form method="post" className="bg-white p-4 rounded border space-y-2 mb-6">
        <input
          name="name"
          required
          className="w-full px-3 py-2 border rounded"
          placeholder="例: LLM エージェントの最新動向"
        />
        <input
          name="keywords"
          className="w-full px-3 py-2 border rounded"
          placeholder="カンマ区切りのキーワード(例: LLM, agent, MCP)"
        />
        <select name="depth" className="px-3 py-2 border rounded">
          <option value="shallow">浅い概要</option>
          <option value="deep">深堀り</option>
        </select>
        {actionData?.error && <p className="text-red-600 text-sm">{actionData.error}</p>}
        {actionData?.ok && (
          <p className="text-green-600 text-sm">登録しました(次回バッチから有効)</p>
        )}
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">
          追加
        </button>
      </Form>

      <h2 className="text-lg font-bold mb-2">登録済み</h2>
      <ul className="space-y-2">
        {loaderData.topics.map((t) => (
          <li key={t.id} className="bg-white p-3 rounded border">
            <div className="font-semibold">
              {t.name}{' '}
              <span className="text-xs text-slate-500">
                {t.depth} / {t.active ? '有効' : '停止中'}
              </span>
            </div>
            <div className="text-xs text-slate-500">{t.keywords.join(', ')}</div>
          </li>
        ))}
        {loaderData.topics.length === 0 && (
          <p className="text-sm text-slate-500">まだトピックがありません</p>
        )}
      </ul>
    </div>
  )
}
