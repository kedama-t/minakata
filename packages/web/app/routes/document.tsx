import { Form, redirect } from 'react-router'
import { detectLocale, getDict, useDict } from '../i18n/index.ts'
import { assertSameOrigin, requireEditor } from '../lib/auth.ts'
import { formatDateTime, useTimezone } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/document.ts'

export async function loader({ request, params }: Route.LoaderArgs) {
  requireEditor(request)
  const services = getServices()
  const doc = params.id ? services.documents.get(params.id) : null
  if (!doc) throw new Response('Not Found', { status: 404 })

  // ?download=1 で raw ファイルを返す
  const url = new URL(request.url)
  if (url.searchParams.get('download') === '1') {
    const raw = await services.documents.readRaw(doc.id)
    if (!raw) throw new Response('Not Found', { status: 404 })
    return new Response(new Uint8Array(raw.data), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(raw.filename)}`,
      },
    })
  }

  const text = await services.documents.readText(doc.id)
  return { doc, text: text ?? '' }
}

export async function action({ request, params }: Route.ActionArgs) {
  assertSameOrigin(request)
  const user = requireEditor(request)
  const services = getServices()
  const t = getDict(detectLocale(request))
  const doc = params.id ? services.documents.get(params.id) : null
  if (!doc) return { error: t.documents.notFound }
  if (doc.uploaded_by !== user.id && user.role !== 'admin') {
    throw new Response('Forbidden', { status: 403 })
  }
  services.documents.delete(doc.id)
  return redirect('/documents')
}

export default function DocumentDetail({ loaderData }: Route.ComponentProps) {
  const t = useDict()
  const tz = useTimezone()
  const { doc, text } = loaderData
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold truncate">{doc.filename}</h1>
        <span className="px-2 py-0.5 rounded text-xs font-mono uppercase bg-base-200 shrink-0">
          {doc.kind}
        </span>
      </div>
      <p className="text-sm text-base-content/50 mb-4">
        {t.documents.uploadedAt} {formatDateTime(doc.created_at, tz)}
      </p>
      <div className="flex items-center gap-2 mb-6">
        <a href={`/documents/${doc.id}?download=1`} className="btn btn-sm">
          {t.documents.download}
        </a>
        <Form
          method="post"
          onSubmit={(e) => {
            if (!confirm(t.documents.confirmDelete)) e.preventDefault()
          }}
        >
          <button type="submit" className="btn btn-sm btn-ghost text-error">
            {t.common.delete}
          </button>
        </Form>
      </div>
      <h2 className="font-semibold mb-2">{t.documents.preview}</h2>
      <pre className="bg-surface rounded-xl border p-4 text-sm whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  )
}
