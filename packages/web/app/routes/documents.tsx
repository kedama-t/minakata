import { detectKind } from '@minakata/core'
import { Form, useNavigation } from 'react-router'
import { detectLocale, getDict, useDict } from '../i18n/index.ts'
import { assertSameOrigin, requireEditor } from '../lib/auth.ts'
import { formatDateTime, useTimezone } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/documents.ts'

const MAX_FILE_SIZE = 20 * 1024 * 1024

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireEditor(request)
  const services = getServices()
  const documents = services.documents.list()
  const uploaders = new Map<string, string>()
  for (const d of documents) {
    if (!uploaders.has(d.uploaded_by)) {
      const u = services.auth.findUserById(d.uploaded_by)
      if (u) uploaders.set(d.uploaded_by, u.email)
    }
  }
  return { documents, uploaders: Object.fromEntries(uploaders), isAdmin: user.role === 'admin' }
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  const user = requireEditor(request)
  const services = getServices()
  const t = getDict(detectLocale(request))
  const form = await request.formData()
  const intent = String(form.get('intent') ?? 'upload')

  if (intent === 'delete') {
    const id = String(form.get('id') ?? '')
    const doc = services.documents.get(id)
    if (!doc) return { error: t.documents.notFound }
    // 削除はアップロード者本人か admin のみ
    if (doc.uploaded_by !== user.id && user.role !== 'admin') {
      throw new Response('Forbidden', { status: 403 })
    }
    services.documents.delete(id)
    return { ok: 'deleted' }
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return { error: t.documents.errorNoFiles }
  for (const f of files) {
    if (!detectKind(f.name)) return { error: t.documents.errorUnsupported(f.name) }
    if (f.size > MAX_FILE_SIZE) return { error: t.documents.errorTooLarge(f.name) }
  }

  const documentIds: string[] = []
  for (const f of files) {
    try {
      const doc = await services.documents.create({
        filename: f.name,
        data: new Uint8Array(await f.arrayBuffer()),
        uploaded_by: user.id,
      })
      documentIds.push(doc.id)
    } catch {
      return { error: t.documents.errorExtraction(f.name) }
    }
  }

  // 執筆指示があれば document_write タスクを enqueue する(P5: 記事執筆はエージェント経由)
  const instructions = String(form.get('instructions') ?? '').trim()
  if (instructions) {
    services.tasks.enqueue({
      type: 'document_write',
      priority: 'interactive',
      requested_by: user.id,
      payload: { goal: instructions, instructions, document_ids: documentIds },
    })
    return { ok: 'submitted', message: t.documents.taskSubmitted }
  }
  return { ok: 'uploaded', message: t.documents.uploaded(documentIds.length) }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function kindBadge(kind: string): string {
  switch (kind) {
    case 'pdf':
      return 'bg-rose-500/15 text-rose-600'
    case 'pptx':
      return 'bg-orange-500/15 text-orange-600'
    default:
      return 'bg-sky-500/15 text-sky-600'
  }
}

export default function Documents({ loaderData, actionData }: Route.ComponentProps) {
  const t = useDict()
  const tz = useTimezone()
  const { documents, uploaders } = loaderData
  const navigation = useNavigation()
  const submitting = navigation.state === 'submitting'
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">{t.documents.title}</h1>

      <section className="bg-surface rounded-xl border p-4 mb-8">
        <h2 className="font-semibold mb-1">{t.documents.uploadTitle}</h2>
        <p className="text-sm text-base-content/60 mb-3">{t.documents.uploadHint}</p>
        {actionData && 'error' in actionData && actionData.error && (
          <p className="text-sm text-error mb-2">{actionData.error}</p>
        )}
        {actionData && 'message' in actionData && actionData.message && (
          <p className="text-sm text-success mb-2">{actionData.message}</p>
        )}
        <Form method="post" encType="multipart/form-data" className="space-y-3">
          <input type="hidden" name="intent" value="upload" />
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="doc-files">
              {t.documents.filesLabel}
            </label>
            <input
              id="doc-files"
              type="file"
              name="files"
              multiple
              accept=".pdf,.md,.markdown,.pptx"
              className="file-input file-input-bordered w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="doc-instructions">
              {t.documents.instructionsLabel}
            </label>
            <textarea
              id="doc-instructions"
              name="instructions"
              rows={4}
              className="textarea textarea-bordered w-full"
              placeholder={t.documents.instructionsPlaceholder}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {t.documents.submit}
          </button>
        </Form>
      </section>

      <h2 className="font-semibold mb-3">{t.documents.listTitle}</h2>
      <ul className="space-y-2">
        {documents.map((d) => (
          <li
            key={d.id}
            className="bg-surface rounded-xl border p-3 flex items-center gap-3 hover:border-border-strong transition-colors"
          >
            <span
              className={`px-2 py-0.5 rounded text-xs font-mono uppercase shrink-0 ${kindBadge(d.kind)}`}
            >
              {d.kind}
            </span>
            <a
              href={`/documents/${d.id}`}
              className="font-medium text-primary hover:underline truncate"
            >
              {d.filename}
            </a>
            <span className="text-xs text-base-content/50 shrink-0">{formatSize(d.size)}</span>
            <span className="ml-auto text-xs text-base-content/50 shrink-0 hidden sm:inline">
              {uploaders[d.uploaded_by] ?? d.uploaded_by} · {formatDateTime(d.created_at, tz)}
            </span>
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm(t.documents.confirmDelete)) e.preventDefault()
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={d.id} />
              <button type="submit" className="btn btn-ghost btn-xs text-error">
                {t.common.delete}
              </button>
            </Form>
          </li>
        ))}
        {documents.length === 0 && (
          <p className="text-sm text-base-content/60">{t.documents.empty}</p>
        )}
      </ul>
    </div>
  )
}
