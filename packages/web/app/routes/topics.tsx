import { newId, now } from '@minakata/core'
import { useEffect, useRef, useState } from 'react'
import { Form, useFetcher } from 'react-router'
import { detectLocale, getDict, useDict } from '../i18n/index.ts'
import { assertSameOrigin, requireEditor } from '../lib/auth.ts'
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
  assertSameOrigin(request)
  const user = requireEditor(request)
  const services = getServices()
  const { db } = services
  const t = getDict(detectLocale(request))
  const form = await request.formData()
  const intent = String(form.get('intent') ?? 'create')

  if (intent === 'subscribe' || intent === 'unsubscribe') {
    const topicId = String(form.get('topic_id') ?? '')
    if (!topicId) return { error: t.topics.errorTopicIdRequired }
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

  if (intent === 'delete') {
    const topicId = String(form.get('topic_id') ?? '')
    if (!topicId) return { error: t.topics.errorTopicIdRequired }
    db.prepare('DELETE FROM topics WHERE id = ?').run(topicId)
    return { ok: 'deleted' }
  }

  if (intent === 'update') {
    const topicId = String(form.get('topic_id') ?? '')
    if (!topicId) return { error: t.topics.errorTopicIdRequired }
    const name = String(form.get('name') ?? '').trim()
    if (!name) return { error: t.topics.errorNameRequired }
    const keywords = splitLines(String(form.get('keywords') ?? ''))
    const priority_sources = splitLines(String(form.get('priority_sources') ?? ''))
    const exclusion = splitLines(String(form.get('exclusion') ?? ''))
    const depth = String(form.get('depth') ?? 'shallow')
    const format = String(form.get('format') ?? '').trim() || null
    const instructions_md = String(form.get('instructions_md') ?? '').trim()
    db.prepare(
      `UPDATE topics SET name=?, keywords_json=?, priority_sources_json=?, exclusion_json=?,
              depth=?, format=?, instructions_md=?, updated_at=? WHERE id=?`,
    ).run(
      name,
      JSON.stringify(keywords),
      JSON.stringify(priority_sources),
      JSON.stringify(exclusion),
      depth,
      format,
      instructions_md,
      now(),
      topicId,
    )
    return { ok: 'updated' }
  }

  // create
  const name = String(form.get('name') ?? '').trim()
  const depth = String(form.get('depth') ?? 'shallow')
  const format = String(form.get('format') ?? '').trim() || null
  const instructions_md = String(form.get('instructions_md') ?? '').trim()
  if (!name) return { error: t.topics.errorNameRequired }
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

type Topic = Awaited<ReturnType<typeof loader>>['topics'][number]

function EditModal({
  topic,
  onClose,
}: {
  topic: Topic
  onClose: () => void
}) {
  const t = useDict()
  const fetcher = useFetcher<typeof action>()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  useEffect(() => {
    if (fetcher.data?.ok === 'updated') onClose()
  }, [fetcher.data, onClose])

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box max-w-2xl">
        <h3 className="font-bold text-lg mb-4">{t.topics.editTitle}</h3>
        <fetcher.Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="topic_id" value={topic.id} />
          <input
            name="name"
            required
            defaultValue={topic.name}
            className="w-full px-3 py-2 border rounded"
            placeholder={t.topics.namePlaceholder}
          />
          <textarea
            name="keywords"
            rows={2}
            defaultValue={topic.keywords.join(', ')}
            className="w-full px-3 py-2 border rounded text-sm"
            placeholder={t.topics.keywordsPlaceholder}
          />
          <textarea
            name="priority_sources"
            rows={2}
            defaultValue={topic.priority_sources.join('\n')}
            className="w-full px-3 py-2 border rounded text-sm"
            placeholder={t.topics.sourcesPlaceholder}
          />
          <textarea
            name="exclusion"
            rows={2}
            defaultValue={topic.exclusion.join(', ')}
            className="w-full px-3 py-2 border rounded text-sm"
            placeholder={t.topics.exclusionPlaceholder}
          />
          <div className="flex gap-2 items-center">
            <select name="depth" defaultValue={topic.depth} className="px-3 py-2 border rounded">
              <option value="shallow">{t.topics.depthShallow}</option>
              <option value="deep">{t.topics.depthDeep}</option>
            </select>
            <input
              name="format"
              defaultValue={topic.format ?? ''}
              className="flex-1 px-3 py-2 border rounded text-sm"
              placeholder={t.topics.formatPlaceholder}
            />
          </div>
          <textarea
            name="instructions_md"
            rows={4}
            defaultValue={topic.instructions_md}
            className="w-full px-3 py-2 border rounded text-sm font-mono"
            placeholder={t.topics.instructionsPlaceholder}
          />
          {fetcher.data?.error && <p className="text-error text-sm">{fetcher.data.error}</p>}
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary">
              {t.common.save}
            </button>
          </div>
        </fetcher.Form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit">{t.common.close}</button>
      </form>
    </dialog>
  )
}

export default function Topics({ loaderData, actionData }: Route.ComponentProps) {
  const t = useDict()
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null)
  const deleteFetcher = useFetcher<typeof action>()

  function handleDelete(topic: Topic) {
    if (!confirm(t.topics.confirmDelete(topic.name))) return
    deleteFetcher.submit({ intent: 'delete', topic_id: topic.id }, { method: 'post' })
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">{t.topics.title}</h1>

      <Form method="post" className="bg-surface p-4 rounded border space-y-2 mb-6">
        <input type="hidden" name="intent" value="create" />
        <input
          name="name"
          required
          className="w-full px-3 py-2 border rounded"
          placeholder={t.topics.namePlaceholder}
        />
        <textarea
          name="keywords"
          rows={2}
          className="w-full px-3 py-2 border rounded text-sm"
          placeholder={t.topics.keywordsPlaceholderNew}
        />
        <textarea
          name="priority_sources"
          rows={2}
          className="w-full px-3 py-2 border rounded text-sm"
          placeholder={t.topics.sourcesPlaceholder}
        />
        <textarea
          name="exclusion"
          rows={2}
          className="w-full px-3 py-2 border rounded text-sm"
          placeholder={t.topics.exclusionPlaceholder}
        />
        <div className="flex gap-2 items-center">
          <select name="depth" className="px-3 py-2 border rounded">
            <option value="shallow">{t.topics.depthShallow}</option>
            <option value="deep">{t.topics.depthDeep}</option>
          </select>
          <input
            name="format"
            className="flex-1 px-3 py-2 border rounded text-sm"
            placeholder={t.topics.formatPlaceholderNew}
          />
        </div>
        <textarea
          name="instructions_md"
          rows={4}
          className="w-full px-3 py-2 border rounded text-sm font-mono"
          placeholder={t.topics.instructionsPlaceholderNew}
        />
        {actionData?.error && <p className="text-error text-sm">{actionData.error}</p>}
        {actionData?.ok === 'created' && <p className="text-success text-sm">{t.topics.created}</p>}
        {(actionData?.ok === 'subscribe' || actionData?.ok === 'unsubscribe') && (
          <p className="text-success text-sm">
            {actionData.ok === 'subscribe' ? t.topics.subscribed : t.topics.unsubscribed}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-sm">
          {t.common.add}
        </button>
      </Form>

      <h2 className="text-lg font-bold mb-2">{t.topics.registered}</h2>
      <ul className="space-y-2">
        {loaderData.topics.map((topic) => (
          <li key={topic.id} className="bg-surface p-3 rounded border space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{topic.name}</span>
              <span className="text-xs text-base-content/60">
                {topic.depth} / {topic.active ? t.topics.active : t.topics.inactive}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  className="text-xs px-2 py-0.5 rounded bg-base-300 text-base-content/60 hover:bg-base-200"
                  onClick={() => setEditingTopic(topic)}
                >
                  {t.common.edit}
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-0.5 rounded bg-error/15 text-error hover:bg-error/25"
                  onClick={() => handleDelete(topic)}
                >
                  {t.common.delete}
                </button>
                <Form method="post" className="inline">
                  <input type="hidden" name="topic_id" value={topic.id} />
                  <button
                    type="submit"
                    name="intent"
                    value={topic.subscribed ? 'unsubscribe' : 'subscribe'}
                    className={`text-xs px-2 py-0.5 rounded ${
                      topic.subscribed
                        ? 'bg-primary/15 text-primary'
                        : 'bg-base-300 text-base-content/60'
                    }`}
                  >
                    {topic.subscribed ? t.topics.unsubscribe : t.topics.subscribe}
                  </button>
                </Form>
              </span>
            </div>
            {topic.keywords.length > 0 && (
              <div className="text-xs text-base-content/60">
                <span className="font-bold mr-1">{t.topics.keywordsLabel}</span>
                {topic.keywords.join(', ')}
              </div>
            )}
            {topic.priority_sources.length > 0 && (
              <div className="text-xs text-base-content/60">
                <span className="font-bold mr-1">{t.topics.sourcesLabel}</span>
                {topic.priority_sources.join(', ')}
              </div>
            )}
            {topic.exclusion.length > 0 && (
              <div className="text-xs text-base-content/60">
                <span className="font-bold mr-1">{t.topics.exclusionLabel}</span>
                {topic.exclusion.join(', ')}
              </div>
            )}
            {topic.format && (
              <div className="text-xs text-base-content/60">
                <span className="font-bold mr-1">{t.topics.formatLabel}</span>
                {topic.format}
              </div>
            )}
            {topic.instructions_md && (
              <details className="text-xs text-base-content/60">
                <summary className="cursor-pointer text-primary">
                  {t.topics.showInstructions}
                </summary>
                <pre className="bg-canvas p-2 mt-1 rounded whitespace-pre-wrap font-mono">
                  {topic.instructions_md}
                </pre>
              </details>
            )}
          </li>
        ))}
        {loaderData.topics.length === 0 && (
          <p className="text-sm text-base-content/60">{t.topics.empty}</p>
        )}
      </ul>

      {editingTopic && <EditModal topic={editingTopic} onClose={() => setEditingTopic(null)} />}
    </div>
  )
}
