import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { AuthService } from '../src/auth/index.ts'
import { openTestDb } from '../src/db/index.ts'
import { DocumentService, detectKind } from '../src/document/index.ts'

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'minakata-docs-'))
  const db = openTestDb()
  const documents = new DocumentService(db, dir)
  const auth = new AuthService(db)
  const user = await auth.createAdminInitial('a@x', 'p123pass')
  return {
    documents,
    user,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/** スライド 2 枚のミニ pptx をオンメモリ生成する */
function makePptx(): Uint8Array {
  const slide = (texts: string[]) =>
    `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${texts
      .map((t) => `<a:t>${t}</a:t>`)
      .join('')}</p:sld>`
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'ppt/slides/slide1.xml': strToU8(slide(['Title Slide', 'Intro &amp; Scope'])),
    'ppt/slides/slide2.xml': strToU8(slide(['Second Slide'])),
  })
}

/** "Hello PDF" を 1 ページに描く最小 PDF を組み立てる */
function makePdf(): Uint8Array {
  const stream = 'BT /F1 12 Tf 72 712 Td (Hello PDF) Tj ET'
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(body)
}

describe('detectKind', () => {
  test('拡張子で pdf / md / pptx を判定し、未対応は null', () => {
    expect(detectKind('a.pdf')).toBe('pdf')
    expect(detectKind('A.MD')).toBe('md')
    expect(detectKind('deck.pptx')).toBe('pptx')
    expect(detectKind('x.docx')).toBeNull()
    expect(detectKind('noext')).toBeNull()
  })
})

describe('DocumentService', () => {
  test('md をアップロードすると raw と抽出 Markdown が保存される', async () => {
    const { documents, user, dir, cleanup } = await setup()
    const doc = await documents.create({
      filename: 'notes.md',
      data: new TextEncoder().encode('# Hello\n\nbody'),
      uploaded_by: user.id,
    })
    expect(doc.kind).toBe('md')
    expect(existsSync(join(dir, doc.id, 'notes.md'))).toBeTrue()
    expect(await documents.readText(doc.id)).toBe('# Hello\n\nbody')
    cleanup()
  })

  test('pptx からスライドごとのテキストを抽出する', async () => {
    const { documents, user, cleanup } = await setup()
    const doc = await documents.create({
      filename: 'deck.pptx',
      data: makePptx(),
      uploaded_by: user.id,
    })
    const text = await documents.readText(doc.id)
    expect(text).toContain('## Slide 1')
    expect(text).toContain('Title Slide')
    expect(text).toContain('Intro & Scope')
    expect(text).toContain('## Slide 2')
    cleanup()
  })

  test('pdf からテキストを抽出する', async () => {
    const { documents, user, cleanup } = await setup()
    const doc = await documents.create({
      filename: 'paper.pdf',
      data: makePdf(),
      uploaded_by: user.id,
    })
    expect(await documents.readText(doc.id)).toContain('Hello PDF')
    cleanup()
  })

  test('未対応の拡張子は拒否する', async () => {
    const { documents, user, cleanup } = await setup()
    await expect(
      documents.create({ filename: 'x.docx', data: new Uint8Array([1]), uploaded_by: user.id }),
    ).rejects.toThrow('unsupported document type')
    cleanup()
  })

  test('list は新しい順に返し、uploaded_by で絞り込める', async () => {
    const { documents, user, cleanup } = await setup()
    const a = await documents.create({
      filename: 'a.md',
      data: new TextEncoder().encode('a'),
      uploaded_by: user.id,
    })
    const b = await documents.create({
      filename: 'b.md',
      data: new TextEncoder().encode('b'),
      uploaded_by: user.id,
    })
    const all = documents.list()
    expect(all.map((d) => d.id)).toEqual([b.id, a.id])
    expect(documents.list({ uploaded_by: 'nobody' })).toEqual([])
    cleanup()
  })

  test('delete は行とファイル実体を消す', async () => {
    const { documents, user, dir, cleanup } = await setup()
    const doc = await documents.create({
      filename: 'a.md',
      data: new TextEncoder().encode('a'),
      uploaded_by: user.id,
    })
    expect(documents.delete(doc.id)).toBeTrue()
    expect(documents.get(doc.id)).toBeNull()
    expect(existsSync(join(dir, doc.id))).toBeFalse()
    expect(documents.delete(doc.id)).toBeFalse()
    cleanup()
  })

  test('ファイル名のパス区切りは除去して保存する', async () => {
    const { documents, user, dir, cleanup } = await setup()
    const doc = await documents.create({
      filename: '../evil.md',
      data: new TextEncoder().encode('x'),
      uploaded_by: user.id,
    })
    expect(existsSync(join(dir, doc.id, 'evil.md'))).toBeTrue()
    expect((await documents.readRaw(doc.id))?.data.toString()).toBe('x')
    cleanup()
  })
})
