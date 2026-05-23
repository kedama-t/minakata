/** 任意文字列の SHA-256 ハッシュ(hex)を返す */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes: Uint8Array = typeof input === 'string' ? new TextEncoder().encode(input) : input
  // BufferSource として渡すため underlying ArrayBuffer を取り出す
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', ab)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
