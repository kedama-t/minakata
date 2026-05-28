import { newId, now } from '@minakata/core'
import { Form } from 'react-router'
import { requireEditor } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/topics.ts'

interface TopicRow {
  id: string
  name: string
  keywords_json: string
  priority_sources_json: string
  exclusion_json: string
  depth: string
  format: string | null
  instructions_md: string
  active: number
}

interface SubscriptionRow {
  topic_id: string
}

function splitLines(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireEditor(request)
  const { db } = getServices()
  const topics = db
    .query<TopicRow, []>(
      `SELECT id, name, keywords_json, priority_sources_json, exclusion_json, depth, format,
              instructions_md, active
         FROM topics ORDER BY created_at DESC`,
    )
    .all()
    .map((t) => ({
      ...t,
      keywords: JSON.parse(t.keywords_json) as string[],
      priority_sources: JSON.parse(t.priority_sources_json) as string[],
      exclusion: JSON.parse(t.exclusion_json) as string[],
      active: t.active === 1,
    }))
  const subs = db
    .query<SubscriptionRow, [string]>('SELECT topic_id FROM subscriptions WHERE user_id = ?')
    .all(user.id)
  const subscribed = new Set(subs.map((s) => s.topic_id))
  return { topics: topics.map((t) => ({ ...t, subscribed: subscribed.has(t.id) })) }
}

export async function action({ request }: Route.ActionArgs) {
  const user = requireEditor(request)
  const services = getServices()
  const { db } = services
  const form = await request.formData()
  const intent = String(form.get('intent') ?? 'create')

  if (intent === 'subscribe' || intent === 'unsubscribe') {
    const topicId = String(form.get('topic_id') ?? '')
    if (!topicId) return { error: 'topic_id が必要' }
    if (intent === 'subscribe') {
      db.prepare(
        'INSERT OR IGNORE INTO subscriptions (user_id, topic_id, created_at) VALUES (?, ?, ?)',
      ).run(user.id, topicId, now())
    } else {
      db.prepare('DELETE FROM subscriptions WHERE user_id = ? AND topic_id = ?').run(
        user.id,
        topicId,
      )
    }
    return { ok: intent }
  }

  // create
  const name = String(form.get('name') ?? '').trim()
  const depth = String(form.get('depth') ?? 'shallow')
  const format = String(form.get('format') ?? '').trim() || null
  const instructions_md = String(form.get('instructions_md') ?? '').trim()
  if (!name) return { error: '名称が必要' }
  const keywords = splitLines(String(form.get('keywords') ?? ''))
  const priority_sources = splitLines(String(form.get('priority_sources') ?? ''))
  const exclusion = splitLines(String(form.get('exclusion') ?? ''))
  const id = newId()
  const ts = now()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO topics (id, name, keywords_json, priority_sources_json, exclusion_json,
            depth, format, instructions_md, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      JSON.stringify(keywords),
      JSON.stringify(priority_sources),
      JSON.stringify(exclusion),
      depth,
      format,
      instructions_md,
      user.id,
      ts,
      ts,
    )
    // 作成者は自動で購読する(US-2.1: 「自分が知りたい情報」の前提)
    db.prepare(
      'INSERT OR IGNORE INTO subscriptions (user_id, topic_id, created_at) VALUES (?, ?, ?)',
    ).run(user.id, id, ts)
  })()
  return { ok: 'created' }
}

export default function Topics({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">購読トピック</h1>

      <Form method="post" className="bg-white dark:bg-slate-800 p-4 rounded border space-y-2 mb-6">
        <input type="hidden" name="intent" value="create" />
        <input
          name="name"
          required
          className="w-full px-3 py-2 border rounded"
          placeholder="例: LLM エージェントの最新動向"
        />
        <textarea
          name="keywords"
          rows={2}
          className="w-full px-3 py-2 border rounded text-sm"
          placeholder="キーワード(カンマまたは改行区切り)。例: LLM, agent, MCP"
        />
        <textarea
          name="priority_sources"
          rows={2}
          className="w-full px-3 py-2 border rounded text-sm"
          placeholder="優先ソース URL(カンマまたは改行区切り)"
        />
        <textarea
          name="exclusion"
          rows={2}
          className="w-full px-3 py-2 border rounded text-sm"
          placeholder="除外条件(キーワード / ドメイン等)"
        />
        <div className="flex gap-2 items-center">
          <select name="depth" className="px-3 py-2 border rounded">
            <option value="shallow">浅い概要</option>
            <option value="deep">深堀り</option>
          </select>
          <input
            name="format"
            className="flex-1 px-3 py-2 border rounded text-sm"
            placeholder="出力フォーマット(任意)。例: TL;DR + 章立て + 出典"
          />
        </div>
        <textarea
          name="instructions_md"
          rows={4}
          className="w-full px-3 py-2 border rounded text-sm font-mono"
          placeholder="トピック個別の指示(Markdown)。リサーチ方針より優先される"
        />
        {actionData?.error && (
          <p className="text-red-600 dark:text-red-400 text-sm">{actionData.error}</p>
        )}
        {actionData?.ok === 'created' && (
          <p className="text-green-600 dark:text-green-400 text-sm">
            登録しました(あなたを自動購読登録、次回バッチから有効)
          </p>
        )}
        {(actionData?.ok === 'subscribe' || actionData?.ok === 'unsubscribe') && (
          <p className="text-green-600 dark:text-green-400 text-sm">
            {actionData.ok === 'subscribe' ? '購読しました' : '購読解除しました'}
          </p>
        )}
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">
          追加
        </button>
      </Form>

      <h2 className="text-lg font-bold mb-2">登録済み</h2>
      <ul className="space-y-2">
        {loaderData.topics.map((t) => (
          <li key={t.id} className="bg-white dark:bg-slate-800 p-3 rounded border space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{t.name}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                {t.depth} / {t.active ? '有効' : '停止中'}
              </span>
              <span className="ml-auto">
                <Form method="post" className="inline">
                  <input type="hidden" name="topic_id" value={t.id} />
                  <button
                    type="submit"
                    name="intent"
                    value={t.subscribed ? 'unsubscribe' : 'subscribe'}
                    className={`text-xs px-2 py-0.5 rounded ${
                      t.subscribed
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {t.subscribed ? '購読中(解除)' : '購読する'}
                  </button>
                </Form>
              </span>
            </div>
            {t.keywords.length > 0 && (
              <div className="text-xs text-slate-600 dark:text-slate-400 dark:text-slate-500">
                <span className="font-bold mr-1">キーワード:</span>
                {t.keywords.join(', ')}
              </div>
            )}
            {t.priority_sources.length > 0 && (
              <div className="text-xs text-slate-600 dark:text-slate-400 dark:text-slate-500">
                <span className="font-bold mr-1">優先ソース:</span>
                {t.priority_sources.join(', ')}
              </div>
            )}
            {t.exclusion.length > 0 && (
              <div className="text-xs text-slate-600 dark:text-slate-400 dark:text-slate-500">
                <span className="font-bold mr-1">除外:</span>
                {t.exclusion.join(', ')}
              </div>
            )}
            {t.format && (
              <div className="text-xs text-slate-600 dark:text-slate-400 dark:text-slate-500">
                <span className="font-bold mr-1">フォーマット:</span>
                {t.format}
              </div>
            )}
            {t.instructions_md && (
              <details className="text-xs text-slate-600 dark:text-slate-400 dark:text-slate-500">
                <summary className="cursor-pointer text-blue-700 dark:text-blue-300">
                  個別指示を表示
                </summary>
                <pre className="bg-slate-50 dark:bg-slate-950 p-2 mt-1 rounded whitespace-pre-wrap font-mono">
                  {t.instructions_md}
                </pre>
              </details>
            )}
          </li>
        ))}
        {loaderData.topics.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500">
            まだトピックがありません
          </p>
        )}
      </ul>
    </div>
  )
}
