// hermes/config.yaml の model ブロックを編集する純関数。
// yaml 依存を足さず、コメントを壊さないよう model: ブロック限定の行置換を行う。

const TOP_LEVEL_KEY = /^[^\s#]/

/** model: ブロックの行範囲 [start, end) を返す。見つからなければ null。 */
function findModelBlock(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((l) => /^model:\s*$/.test(l))
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && TOP_LEVEL_KEY.test(line)) {
      end = i
      break
    }
  }
  return { start, end }
}

/**
 * model.default を書き換える。model: ブロック内の default: 行だけを対象にし、
 * インデントとダブルクォートスタイルを保持する。provider は検証のみ。
 * model: ブロックが無ければ throw（黙って追記しない）。
 */
export function patchModelDefault(yaml: string, model: string): string {
  if (model.includes('"')) {
    throw new Error('モデル名にダブルクォートは使用できません')
  }
  const lines = yaml.split('\n')
  const block = findModelBlock(lines)
  if (!block) throw new Error('hermes/config.yaml に model: ブロックが見つかりません')

  let replaced = false
  for (let i = block.start + 1; i < block.end; i++) {
    const m = lines[i]?.match(/^(\s+)default:\s*.*$/)
    if (m) {
      lines[i] = `${m[1] ?? '  '}default: "${model}"`
      replaced = true
      break
    }
  }
  if (!replaced) {
    lines.splice(block.start + 1, 0, `  default: "${model}"`)
  }
  return lines.join('\n')
}

/** model: ブロック内の現在の default 値を返す。 */
export function readModelDefault(yaml: string): string | null {
  const lines = yaml.split('\n')
  const block = findModelBlock(lines)
  if (!block) return null
  for (let i = block.start + 1; i < block.end; i++) {
    const m = lines[i]?.match(/^\s+default:\s*"?([^"]*)"?\s*$/)
    if (m) return (m[1] ?? '').trim()
  }
  return null
}

/** provider が期待値（opencode-go）かを検証する。 */
export function checkProvider(yaml: string, expected = 'opencode-go'): boolean {
  const lines = yaml.split('\n')
  const block = findModelBlock(lines)
  if (!block) return false
  for (let i = block.start + 1; i < block.end; i++) {
    const m = lines[i]?.match(/^\s+provider:\s*"?([^"]*)"?\s*$/)
    if (m) return (m[1] ?? '').trim() === expected
  }
  return false
}

// --- SKILL.md frontmatter の per-skill model 編集 ---
// synthesizer など metadata.hermes.config.model を持つスキルの model 行を
// 書き換える。yaml 依存を足さず frontmatter 限定の行置換でコメントを壊さない。

/** frontmatter（先頭 --- 〜 次の ---）の行範囲 [start, end) を返す。無ければ null。 */
function findFrontmatter(lines: string[]): { start: number; end: number } | null {
  if (lines[0]?.trim() !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') return { start: 1, end: i }
  }
  return null
}

/**
 * frontmatter 内の model 行を書き換える。インデントを保持する。
 * model 行が見つからなければ throw（黙って追記しない）。
 */
export function patchSkillModel(md: string, model: string): string {
  if (model.includes('"')) {
    throw new Error('モデル名にダブルクォートは使用できません')
  }
  const lines = md.split('\n')
  const fm = findFrontmatter(lines)
  if (!fm) throw new Error('SKILL.md に frontmatter が見つかりません')

  for (let i = fm.start; i < fm.end; i++) {
    const m = lines[i]?.match(/^(\s+)model:\s*.*$/)
    if (m) {
      lines[i] = `${m[1]}model: "${model}"`
      return lines.join('\n')
    }
  }
  throw new Error('SKILL.md の frontmatter に model 行が見つかりません')
}

/** frontmatter 内の現在の model 値を返す。 */
export function readSkillModel(md: string): string | null {
  const lines = md.split('\n')
  const fm = findFrontmatter(lines)
  if (!fm) return null
  for (let i = fm.start; i < fm.end; i++) {
    const m = lines[i]?.match(/^\s+model:\s*"?([^"]*)"?\s*$/)
    if (m) return (m[1] ?? '').trim()
  }
  return null
}
