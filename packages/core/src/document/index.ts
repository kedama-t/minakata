import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from '../db/index.ts'
import { newId, now } from '../util/id.ts'
import { type DocumentKind, detectKind, extractDocumentText } from './extract.ts'

export type { DocumentKind } from './extract.ts'
export { detectKind } from './extract.ts'

export interface DocumentRow {
  id: string
  filename: string
  kind: DocumentKind
  size: number
  uploaded_by: string
  created_at: string
}

export interface DocumentCreateInput {
  filename: string
  data: Uint8Array
  uploaded_by: string
}

/**
 * アップロード資料(pdf / md / pptx)の保存・参照・削除。
 * raw ファイルと抽出済み Markdown を documentsRoot/<id>/ に保存し(P3)、
 * SQLite の documents テーブルはインデックスとして使う。
 * エージェントは MCP の read_document 経由で抽出 Markdown のみを読む。
 */
export class DocumentService {
  constructor(
    private readonly db: Db,
    private readonly documentsRoot: string,
  ) {}

  /** 資料を保存しテキスト抽出する。未対応拡張子は Error を投げる */
  async create(input: DocumentCreateInput): Promise<DocumentRow> {
    const kind = detectKind(input.filename)
    if (!kind) throw new Error(`unsupported document type: ${input.filename}`)
    const text = await extractDocumentText(kind, input.data)
    const id = newId()
    const dir = this.dirOf(id)
    mkdirSync(dir, { recursive: true })
    await writeFile(join(dir, sanitizeFilename(input.filename)), input.data)
    await writeFile(join(dir, 'extracted.md'), text)
    const ts = now()
    this.db
      .prepare(
        `INSERT INTO documents (id, filename, kind, size, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.filename, kind, input.data.byteLength, input.uploaded_by, ts)
    return {
      id,
      filename: input.filename,
      kind,
      size: input.data.byteLength,
      uploaded_by: input.uploaded_by,
      created_at: ts,
    }
  }

  get(id: string): DocumentRow | null {
    return (
      this.db.query<DocumentRow, [string]>('SELECT * FROM documents WHERE id = ?').get(id) ?? null
    )
  }

  /** created_at 降順で一覧。uploaded_by で絞り込み可 */
  list(opts: { uploaded_by?: string | undefined; limit?: number | undefined } = {}): DocumentRow[] {
    const limit = opts.limit ?? 100
    if (opts.uploaded_by) {
      return this.db
        .query<DocumentRow, [string, number]>(
          'SELECT * FROM documents WHERE uploaded_by = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        )
        .all(opts.uploaded_by, limit)
    }
    return this.db
      .query<DocumentRow, [number]>(
        'SELECT * FROM documents ORDER BY created_at DESC, id DESC LIMIT ?',
      )
      .all(limit)
  }

  /** 抽出済み Markdown を読む。資料が無ければ null */
  async readText(id: string): Promise<string | null> {
    const row = this.get(id)
    if (!row) return null
    const path = join(this.dirOf(id), 'extracted.md')
    if (!existsSync(path)) return null
    return readFile(path, 'utf-8')
  }

  /** raw ファイルを読む(ダウンロード用)。資料が無ければ null */
  async readRaw(id: string): Promise<{ filename: string; data: Buffer } | null> {
    const row = this.get(id)
    if (!row) return null
    const path = join(this.dirOf(id), sanitizeFilename(row.filename))
    if (!existsSync(path)) return null
    return { filename: row.filename, data: await readFile(path) }
  }

  /** 行とファイル実体の両方を削除する */
  delete(id: string): boolean {
    const row = this.get(id)
    if (!row) return false
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    rmSync(this.dirOf(id), { recursive: true, force: true })
    return true
  }

  private dirOf(id: string): string {
    return join(this.documentsRoot, id)
  }
}

/** パス区切りを除去してファイル名のみにする(パストラバーサル防止) */
function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file'
  return base.replace(/^\.+/, '') || 'file'
}
