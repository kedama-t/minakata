import { unzipSync } from 'fflate'
import { extractText } from 'unpdf'

export type DocumentKind = 'pdf' | 'md' | 'pptx'

/** ファイル名の拡張子から対応する資料種別を判定する。未対応なら null */
export function detectKind(filename: string): DocumentKind | null {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pptx') return 'pptx'
  return null
}

/**
 * アップロード資料からテキスト(Markdown)を抽出する。
 * すべてローカル実行(P11): pdf は unpdf、pptx は fflate で XML を展開して <a:t> を拾う。
 */
export async function extractDocumentText(kind: DocumentKind, data: Uint8Array): Promise<string> {
  switch (kind) {
    case 'md':
      return new TextDecoder().decode(data)
    case 'pdf': {
      const { text } = await extractText(data, { mergePages: true })
      return text.trim()
    }
    case 'pptx':
      return extractPptxText(data)
  }
}

/** pptx(zip) からスライド順にテキストを抽出し、スライドごとに見出しを付ける */
function extractPptxText(data: Uint8Array): string {
  const files = unzipSync(data)
  const slideNames = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b))
  const decoder = new TextDecoder()
  const out: string[] = []
  for (const name of slideNames) {
    const file = files[name]
    if (!file) continue
    const xml = decoder.decode(file)
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) =>
      decodeXmlEntities(m[1] ?? ''),
    )
    const body = texts.join('\n').trim()
    out.push(`## Slide ${slideNo(name)}\n\n${body}`)
  }
  return out.join('\n\n').trim()
}

function slideNo(name: string): number {
  return Number(/slide(\d+)\.xml/.exec(name)?.[1] ?? 0)
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
