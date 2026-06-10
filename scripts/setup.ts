#!/usr/bin/env bun
// Minakata 対話型セットアップ CLI。`bun run setup` で起動。
// .env と hermes/config.yaml を対話的に生成・更新する。

import { randomBytes } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  password,
  select,
  spinner,
  text,
} from '@clack/prompts'
import pc from 'picocolors'
import {
  checkProvider,
  patchModelDefault,
  patchSkillModel,
  readModelDefault,
  readSkillModel,
} from './setup/config'
import { findStaleSecrets, parseEnv, patchEnv } from './setup/env'

const ROOT = dirname(import.meta.dir)
const ENV_PATH = join(ROOT, '.env')
const ENV_EXAMPLE_PATH = join(ROOT, '.env.example')
const CONFIG_PATH = join(ROOT, 'hermes', 'config.yaml')
// synthesizer は統合（synthesis）に高度な推論を要するため per-skill で別モデルを使う。
const SYNTH_SKILL_PATH = join(ROOT, 'hermes-skills', 'synthesizer', 'SKILL.md')

// OpenCode Go のモデル候補（正準一覧: https://opencode.ai/zen/go/v1/models）
const DEFAULT_MODEL = 'deepseek-v4-flash'
const MODEL_PRESETS = [DEFAULT_MODEL, 'glm-5', 'kimi-k2.5', 'minimax-m2.5']
// 高度なタスク（synthesizer の統合）向けの上位モデル候補。
const ADVANCED_DEFAULT_MODEL = 'deepseek-v4-pro'
const ADVANCED_MODEL_PRESETS = [ADVANCED_DEFAULT_MODEL, 'glm-5', 'kimi-k2.5', 'minimax-m2.5']

/** ファイルを読む。存在しなければ null。 */
async function tryRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** clack のキャンセル（Ctrl+C）を検出したら終了する。 */
function check<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('セットアップを中断しました。')
    process.exit(0)
  }
  return value as T
}

/** シークレットを末尾4文字だけ残してマスクする。 */
function mask(value: string): string {
  if (!value) return pc.dim('(未設定)')
  if (value.length <= 4) return '****'
  return `${'*'.repeat(8)}${value.slice(-4)}`
}

async function main() {
  intro(pc.bgCyan(pc.black(' Minakata セットアップ ')))

  const existingEnv = await tryRead(ENV_PATH)
  const envExample = await tryRead(ENV_EXAMPLE_PATH)
  if (!envExample) {
    cancel('.env.example が見つかりません。リポジトリルートで実行してください。')
    process.exit(1)
  }
  const configYaml = await tryRead(CONFIG_PATH)

  const current = existingEnv ? parseEnv(existingEnv) : new Map<string, string>()
  if (existingEnv) {
    log.info(`既存の ${pc.cyan('.env')} を読み込みました。値を初期値として表示します。`)
  } else {
    log.info(`${pc.cyan('.env')} が無いため新規作成します。`)
  }

  // --- シークレット（自動生成） ---
  const mcpToken = await resolveSecret('MCP_TOKEN', current.get('MCP_TOKEN'))
  const searxngSecret = await resolveSecret('SEARXNG_SECRET', current.get('SEARXNG_SECRET'))

  // --- API キー ---
  const opencodeKey = check(
    await password({
      message: 'OpenCode API キー（opencode.ai/auth で取得）',
      validate: (v) => (!v ? '必須です' : undefined),
    }),
  )
  // --- Firecrawl（Minakata 互換 or クラウド） ---
  // minakata の FIRECRAWL_API_KEY は /v1/scrape の Bearer 検証用の共有シークレット
  // （クラウドの実キー fc-… ではない）。互換利用時はランダム自動生成で十分。
  const MINAKATA_BASE = 'http://minakata:3000'
  const prevBase = current.get('FIRECRAWL_BASE_URL')
  const firecrawlMode = check(
    await select({
      message: 'Firecrawl（Web 抽出）の利用方法',
      initialValue: prevBase && prevBase !== MINAKATA_BASE ? 'cloud' : 'minakata',
      options: [
        { value: 'minakata', label: 'Minakata の互換エンドポイントを使う（推奨）' },
        { value: 'cloud', label: 'Firecrawl クラウド版を使う' },
      ],
    }),
  )

  let firecrawlKey: string
  let firecrawlBaseUrl: string
  if (firecrawlMode === 'cloud') {
    firecrawlKey = check(
      await password({
        message: 'Firecrawl API キー（fc-…）',
        validate: (v) => (!v ? '必須です' : undefined),
      }),
    )
    firecrawlBaseUrl = check(
      await text({
        message: 'Firecrawl baseUrl',
        placeholder: 'https://api.firecrawl.dev',
        initialValue:
          prevBase && prevBase !== MINAKATA_BASE ? prevBase : 'https://api.firecrawl.dev',
      }),
    )
  } else {
    // 互換利用: baseUrl は minakata 固定、API キーは共有 Bearer をランダム生成
    firecrawlBaseUrl = MINAKATA_BASE
    firecrawlKey = await resolveSecret('FIRECRAWL_API_KEY', current.get('FIRECRAWL_API_KEY'))
  }

  // --- バックアップ（任意） ---
  const backupRemote = check(
    await text({
      message: 'バックアップ先 git remote（任意・空ならローカル commit のみ）',
      placeholder: 'https://github.com/owner/minakata-backup.git',
      initialValue: current.get('BACKUP_GIT_REMOTE') ?? '',
    }),
  )
  let backupToken = current.get('BACKUP_GIT_TOKEN') ?? ''
  if (backupRemote) {
    const entered = check(
      await password({
        message: backupToken
          ? 'バックアップ用 GitHub トークン（空 Enter で既存を維持）'
          : 'バックアップ用 GitHub トークン（fine-grained PAT・contents:write）',
      }),
    )
    if (entered) backupToken = entered
  }

  // --- 環境 ---
  const timezone = check(
    await text({
      message: 'タイムゾーン（IANA）',
      initialValue: current.get('TIMEZONE') ?? 'Asia/Tokyo',
    }),
  )
  const cookieSecure = check(
    await select({
      message: 'Cookie の Secure 属性',
      initialValue: current.get('COOKIE_SECURE') ?? 'true',
      options: [
        { value: 'true', label: 'true（HTTPS / 本番）' },
        { value: 'false', label: 'false（localhost で HTTP 開発）' },
      ],
    }),
  )

  // --- Hermes UID/GID（自動検出） ---
  const uid = String(process.getuid?.() ?? 10000)
  const gid = String(process.getgid?.() ?? 10000)
  log.info(`Hermes UID/GID を自動検出: ${pc.cyan(uid)} / ${pc.cyan(gid)}`)

  // --- デフォルトモデル（hermes/config.yaml） ---
  let chosenModel: string | null = null
  if (configYaml) {
    const currentModel = readModelDefault(configYaml) ?? DEFAULT_MODEL
    chosenModel = await pickModel('デフォルトモデル（OpenCode Go）', MODEL_PRESETS, currentModel)
    if (!checkProvider(configYaml)) {
      log.warn(
        `${pc.cyan('hermes/config.yaml')} の model.provider が ${pc.cyan('opencode-go')} ではありません。確認してください。`,
      )
    }
  } else {
    log.warn(`${pc.cyan('hermes/config.yaml')} が見つからないため、モデル設定をスキップします。`)
  }

  // --- 高度なタスク向けモデル（synthesizer の統合に使用） ---
  const synthSkill = await tryRead(SYNTH_SKILL_PATH)
  let chosenAdvancedModel: string | null = null
  if (synthSkill) {
    const currentAdvanced = readSkillModel(synthSkill) ?? ADVANCED_DEFAULT_MODEL
    chosenAdvancedModel = await pickModel(
      '高度なタスク向けモデル（synthesizer の知識統合）',
      ADVANCED_MODEL_PRESETS,
      currentAdvanced,
    )
  } else {
    log.warn(
      `${pc.cyan('hermes-skills/synthesizer/SKILL.md')} が見つからないため、高度モデル設定をスキップします。`,
    )
  }

  // --- 書き込み ---
  const updates: Record<string, string> = {
    MCP_TOKEN: mcpToken,
    SEARXNG_SECRET: searxngSecret,
    OPENCODE_API_KEY: opencodeKey,
    FIRECRAWL_API_KEY: firecrawlKey,
    FIRECRAWL_BASE_URL: firecrawlBaseUrl,
    BACKUP_GIT_REMOTE: backupRemote,
    BACKUP_GIT_TOKEN: backupToken,
    TIMEZONE: timezone,
    COOKIE_SECURE: cookieSecure,
    HERMES_UID: uid,
    HERMES_GID: gid,
  }

  const proceed = check(
    await confirm({ message: `設定を ${pc.cyan('.env')} に書き込みます。続行しますか？` }),
  )
  if (!proceed) {
    cancel('書き込みを中止しました。')
    process.exit(0)
  }

  const s = spinner()
  s.start('設定を書き込み中')
  const nextEnv = patchEnv(existingEnv, updates, envExample)
  await writeFile(ENV_PATH, nextEnv, 'utf8')
  await chmod(ENV_PATH, 0o600)
  if (configYaml && chosenModel) {
    await writeFile(CONFIG_PATH, patchModelDefault(configYaml, chosenModel), 'utf8')
  }
  if (synthSkill && chosenAdvancedModel) {
    await writeFile(SYNTH_SKILL_PATH, patchSkillModel(synthSkill, chosenAdvancedModel), 'utf8')
  }
  s.stop('書き込み完了')

  // --- サマリ（シークレットはマスク） ---
  note(
    [
      `${pc.dim('MCP_TOKEN')}        ${mask(mcpToken)}`,
      `${pc.dim('SEARXNG_SECRET')}   ${mask(searxngSecret)}`,
      `${pc.dim('OPENCODE_API_KEY')} ${mask(opencodeKey)}`,
      `${pc.dim('FIRECRAWL_API_KEY')} ${mask(firecrawlKey)}`,
      `${pc.dim('FIRECRAWL_BASE_URL')} ${firecrawlBaseUrl}`,
      `${pc.dim('BACKUP_GIT_REMOTE')} ${backupRemote || pc.dim('(未設定)')}`,
      `${pc.dim('BACKUP_GIT_TOKEN')}  ${mask(backupToken)}`,
      `${pc.dim('TIMEZONE')}         ${timezone}`,
      `${pc.dim('COOKIE_SECURE')}    ${cookieSecure}`,
      `${pc.dim('HERMES_UID/GID')}   ${uid} / ${gid}`,
      chosenModel ? `${pc.dim('model.default')}    ${chosenModel}` : '',
      chosenAdvancedModel ? `${pc.dim('synthesizer.model')} ${chosenAdvancedModel}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    '設定内容',
  )

  const stale = findStaleSecrets(nextEnv)
  if (stale.length > 0) {
    log.warn(
      `${pc.cyan('.env')} にコメントアウトされた旧シークレットらしき行が残っています。削除を検討してください:\n${stale.map((l) => pc.dim(l)).join('\n')}`,
    )
  }

  outro(`完了。${pc.cyan('bun run compose:up')} で起動できます。`)
}

/** プリセット選択 + カスタム入力でモデル名を決める（必須）。 */
async function pickModel(
  message: string,
  presets: string[],
  currentModel: string,
): Promise<string> {
  const picked = check(
    await select({
      message,
      initialValue: presets.includes(currentModel) ? currentModel : '__custom__',
      options: [
        ...presets.map((m) => ({
          value: m,
          label: m === currentModel ? `${m} ${pc.dim('(現在)')}` : m,
        })),
        { value: '__custom__', label: 'カスタム入力…' },
      ],
    }),
  )
  if (picked !== '__custom__') return picked
  return check(
    await text({
      message: 'モデル名を入力',
      initialValue: currentModel,
      validate: (v) => (!v ? '必須です' : undefined),
    }),
  )
}

/** シークレットの生成/温存を対話で決める。 */
async function resolveSecret(name: string, existing: string | undefined): Promise<string> {
  if (existing) {
    const regen = check(
      await confirm({
        message: `${name} は既に設定済みです。再生成しますか？`,
        initialValue: false,
      }),
    )
    if (!regen) return existing
  }
  log.success(`${name} を生成しました ✓`)
  return randomBytes(32).toString('hex')
}

main().catch((err) => {
  log.error(String(err?.message ?? err))
  process.exit(1)
})
