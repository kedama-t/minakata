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

// --- i18n（インライン辞書） ---
// ja を正とし、en は `Strings`(= typeof ja) を満たす。キー欠落は typecheck で落ちる。
// 可変部分は関数で表現する。pc 装飾は同一モジュールなので辞書内で直接使う。
type Lang = 'ja' | 'en'

const ja = {
  langSelect: '言語を選択 / Select language',
  langJa: '日本語',
  langEn: 'English',
  title: ' Minakata セットアップ ',
  cancelled: 'セットアップを中断しました。',
  unset: '(未設定)',
  noEnvExample: '.env.example が見つかりません。リポジトリルートで実行してください。',
  loadedEnv: `既存の ${pc.cyan('.env')} を読み込みました。値を初期値として表示します。`,
  newEnv: `${pc.cyan('.env')} が無いため新規作成します。`,
  opencodeKey: 'OpenCode API キー（opencode.ai/auth で取得）',
  required: '必須です',
  firecrawlMode: 'Firecrawl（Web 抽出）の利用方法',
  firecrawlMinakata: 'Minakata の互換エンドポイントを使う（推奨）',
  firecrawlCloud: 'Firecrawl クラウド版を使う',
  firecrawlKey: 'Firecrawl API キー（fc-…）',
  firecrawlBaseUrl: 'Firecrawl baseUrl',
  backupRemote: 'バックアップ先 git remote（任意・空ならローカル commit のみ）',
  backupTokenKeep: 'バックアップ用 GitHub トークン（空 Enter で既存を維持）',
  backupTokenNew: 'バックアップ用 GitHub トークン（fine-grained PAT・contents:write）',
  timezone: 'タイムゾーン（IANA）',
  cookieSecure: 'Cookie の Secure 属性',
  cookieSecureTrue: 'true（HTTPS / 本番）',
  cookieSecureFalse: 'false（localhost で HTTP 開発）',
  uidDetected: (uid: string, gid: string) =>
    `Hermes UID/GID を自動検出: ${pc.cyan(uid)} / ${pc.cyan(gid)}`,
  defaultModel: 'デフォルトモデル（OpenCode Go）',
  providerWarn: `${pc.cyan('hermes/config.yaml')} の model.provider が ${pc.cyan('opencode-go')} ではありません。確認してください。`,
  configNotFound: `${pc.cyan('hermes/config.yaml')} が見つからないため、モデル設定をスキップします。`,
  advancedModel: '高度なタスク向けモデル（synthesizer の知識統合）',
  synthNotFound: `${pc.cyan('hermes-skills/synthesizer/SKILL.md')} が見つからないため、高度モデル設定をスキップします。`,
  writeConfirm: `設定を ${pc.cyan('.env')} に書き込みます。続行しますか？`,
  writeCancelled: '書き込みを中止しました。',
  writing: '設定を書き込み中',
  writeDone: '書き込み完了',
  summaryTitle: '設定内容',
  staleWarn: (lines: string) =>
    `${pc.cyan('.env')} にコメントアウトされた旧シークレットらしき行が残っています。削除を検討してください:\n${lines}`,
  outro: `完了。${pc.cyan('bun run compose:up')} で起動できます。`,
  modelCustom: 'カスタム入力…',
  modelCurrent: '(現在)',
  modelNameInput: 'モデル名を入力',
  modelQuote: 'モデル名にダブルクォートは使用できません',
  secretExists: (name: string) => `${name} は既に設定済みです。再生成しますか？`,
  secretGenerated: (name: string) => `${name} を生成しました ✓`,
}

type Strings = typeof ja

const en: Strings = {
  langSelect: 'Select language / 言語を選択',
  langJa: '日本語',
  langEn: 'English',
  title: ' Minakata Setup ',
  cancelled: 'Setup cancelled.',
  unset: '(unset)',
  noEnvExample: '.env.example not found. Run this from the repository root.',
  loadedEnv: `Loaded existing ${pc.cyan('.env')}. Using its values as defaults.`,
  newEnv: `No ${pc.cyan('.env')} found; creating a new one.`,
  opencodeKey: 'OpenCode API key (get it at opencode.ai/auth)',
  required: 'Required',
  firecrawlMode: 'Firecrawl (web extraction) mode',
  firecrawlMinakata: "Use Minakata's compatible endpoint (recommended)",
  firecrawlCloud: 'Use Firecrawl cloud',
  firecrawlKey: 'Firecrawl API key (fc-…)',
  firecrawlBaseUrl: 'Firecrawl baseUrl',
  backupRemote: 'Backup git remote (optional; empty = local commits only)',
  backupTokenKeep: 'GitHub token for backup (press Enter to keep existing)',
  backupTokenNew: 'GitHub token for backup (fine-grained PAT, contents:write)',
  timezone: 'Timezone (IANA)',
  cookieSecure: 'Cookie Secure attribute',
  cookieSecureTrue: 'true (HTTPS / production)',
  cookieSecureFalse: 'false (HTTP dev on localhost)',
  uidDetected: (uid, gid) => `Auto-detected Hermes UID/GID: ${pc.cyan(uid)} / ${pc.cyan(gid)}`,
  defaultModel: 'Default model (OpenCode Go)',
  providerWarn: `model.provider in ${pc.cyan('hermes/config.yaml')} is not ${pc.cyan('opencode-go')}. Please verify.`,
  configNotFound: `${pc.cyan('hermes/config.yaml')} not found; skipping model configuration.`,
  advancedModel: 'Model for advanced tasks (synthesizer knowledge synthesis)',
  synthNotFound: `${pc.cyan('hermes-skills/synthesizer/SKILL.md')} not found; skipping advanced model configuration.`,
  writeConfirm: `Write settings to ${pc.cyan('.env')}. Continue?`,
  writeCancelled: 'Write aborted.',
  writing: 'Writing settings',
  writeDone: 'Write complete',
  summaryTitle: 'Settings',
  staleWarn: (lines) =>
    `${pc.cyan('.env')} still contains commented-out lines that look like old secrets. Consider removing them:\n${lines}`,
  outro: `Done. Start it with ${pc.cyan('bun run compose:up')}.`,
  modelCustom: 'Custom input…',
  modelCurrent: '(current)',
  modelNameInput: 'Enter model name',
  modelQuote: 'Model names cannot contain double quotes',
  secretExists: (name) => `${name} is already set. Regenerate?`,
  secretGenerated: (name) => `Generated ${name} ✓`,
}

const dict: Record<Lang, Strings> = { ja, en }

// 言語選択後に main 冒頭で確定する。check() / pickModel() / resolveSecret() から参照する。
let t: Strings = ja

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
    cancel(t.cancelled)
    process.exit(0)
  }
  return value as T
}

/** シークレットを末尾4文字だけ残してマスクする。 */
function mask(value: string): string {
  if (!value) return pc.dim(t.unset)
  if (value.length <= 4) return '****'
  return `${'*'.repeat(8)}${value.slice(-4)}`
}

/** 表示言語を選ぶ（最初の対話。両言語を併記して提示）。 */
async function selectLang(): Promise<Lang> {
  const v = await select({
    message: ja.langSelect,
    options: [
      { value: 'ja', label: ja.langJa },
      { value: 'en', label: ja.langEn },
    ],
  })
  if (isCancel(v)) {
    cancel('Cancelled / 中断しました')
    process.exit(0)
  }
  return v as Lang
}

async function main() {
  t = dict[await selectLang()]
  intro(pc.bgCyan(pc.black(t.title)))

  const existingEnv = await tryRead(ENV_PATH)
  const envExample = await tryRead(ENV_EXAMPLE_PATH)
  if (!envExample) {
    cancel(t.noEnvExample)
    process.exit(1)
  }
  const configYaml = await tryRead(CONFIG_PATH)

  const current = existingEnv ? parseEnv(existingEnv) : new Map<string, string>()
  if (existingEnv) {
    log.info(t.loadedEnv)
  } else {
    log.info(t.newEnv)
  }

  // --- シークレット（自動生成） ---
  const mcpToken = await resolveSecret('MCP_TOKEN', current.get('MCP_TOKEN'))
  const searxngSecret = await resolveSecret('SEARXNG_SECRET', current.get('SEARXNG_SECRET'))

  // --- API キー ---
  const opencodeKey = check(
    await password({
      message: t.opencodeKey,
      validate: (v) => (!v ? t.required : undefined),
    }),
  )
  // --- Firecrawl（Minakata 互換 or クラウド） ---
  // minakata の FIRECRAWL_API_KEY は /v1/scrape の Bearer 検証用の共有シークレット
  // （クラウドの実キー fc-… ではない）。互換利用時はランダム自動生成で十分。
  const MINAKATA_BASE = 'http://minakata:3000'
  const prevBase = current.get('FIRECRAWL_BASE_URL')
  const firecrawlMode = check(
    await select({
      message: t.firecrawlMode,
      initialValue: prevBase && prevBase !== MINAKATA_BASE ? 'cloud' : 'minakata',
      options: [
        { value: 'minakata', label: t.firecrawlMinakata },
        { value: 'cloud', label: t.firecrawlCloud },
      ],
    }),
  )

  let firecrawlKey: string
  let firecrawlBaseUrl: string
  if (firecrawlMode === 'cloud') {
    firecrawlKey = check(
      await password({
        message: t.firecrawlKey,
        validate: (v) => (!v ? t.required : undefined),
      }),
    )
    firecrawlBaseUrl = check(
      await text({
        message: t.firecrawlBaseUrl,
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
      message: t.backupRemote,
      placeholder: 'https://github.com/owner/minakata-backup.git',
      initialValue: current.get('BACKUP_GIT_REMOTE') ?? '',
    }),
  )
  let backupToken = current.get('BACKUP_GIT_TOKEN') ?? ''
  if (backupRemote) {
    const entered = check(
      await password({
        message: backupToken ? t.backupTokenKeep : t.backupTokenNew,
      }),
    )
    if (entered) backupToken = entered
  }

  // --- 環境 ---
  const timezone = check(
    await text({
      message: t.timezone,
      initialValue: current.get('TIMEZONE') ?? 'Asia/Tokyo',
    }),
  )
  const cookieSecure = check(
    await select({
      message: t.cookieSecure,
      initialValue: current.get('COOKIE_SECURE') ?? 'true',
      options: [
        { value: 'true', label: t.cookieSecureTrue },
        { value: 'false', label: t.cookieSecureFalse },
      ],
    }),
  )

  // --- Hermes UID/GID（自動検出） ---
  const uid = String(process.getuid?.() ?? 10000)
  const gid = String(process.getgid?.() ?? 10000)
  log.info(t.uidDetected(uid, gid))

  // --- デフォルトモデル（hermes/config.yaml） ---
  let chosenModel: string | null = null
  if (configYaml) {
    const currentModel = readModelDefault(configYaml) ?? DEFAULT_MODEL
    chosenModel = await pickModel(t.defaultModel, MODEL_PRESETS, currentModel)
    if (!checkProvider(configYaml)) {
      log.warn(t.providerWarn)
    }
  } else {
    log.warn(t.configNotFound)
  }

  // --- 高度なタスク向けモデル（synthesizer の統合に使用） ---
  const synthSkill = await tryRead(SYNTH_SKILL_PATH)
  let chosenAdvancedModel: string | null = null
  if (synthSkill) {
    const currentAdvanced = readSkillModel(synthSkill) ?? ADVANCED_DEFAULT_MODEL
    chosenAdvancedModel = await pickModel(t.advancedModel, ADVANCED_MODEL_PRESETS, currentAdvanced)
  } else {
    log.warn(t.synthNotFound)
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

  const proceed = check(await confirm({ message: t.writeConfirm }))
  if (!proceed) {
    cancel(t.writeCancelled)
    process.exit(0)
  }

  const s = spinner()
  s.start(t.writing)
  const nextEnv = patchEnv(existingEnv, updates, envExample)
  await writeFile(ENV_PATH, nextEnv, 'utf8')
  await chmod(ENV_PATH, 0o600)
  if (configYaml && chosenModel) {
    await writeFile(CONFIG_PATH, patchModelDefault(configYaml, chosenModel), 'utf8')
  }
  if (synthSkill && chosenAdvancedModel) {
    await writeFile(SYNTH_SKILL_PATH, patchSkillModel(synthSkill, chosenAdvancedModel), 'utf8')
  }
  s.stop(t.writeDone)

  // --- サマリ（シークレットはマスク） ---
  note(
    [
      `${pc.dim('MCP_TOKEN')}        ${mask(mcpToken)}`,
      `${pc.dim('SEARXNG_SECRET')}   ${mask(searxngSecret)}`,
      `${pc.dim('OPENCODE_API_KEY')} ${mask(opencodeKey)}`,
      `${pc.dim('FIRECRAWL_API_KEY')} ${mask(firecrawlKey)}`,
      `${pc.dim('FIRECRAWL_BASE_URL')} ${firecrawlBaseUrl}`,
      `${pc.dim('BACKUP_GIT_REMOTE')} ${backupRemote || pc.dim(t.unset)}`,
      `${pc.dim('BACKUP_GIT_TOKEN')}  ${mask(backupToken)}`,
      `${pc.dim('TIMEZONE')}         ${timezone}`,
      `${pc.dim('COOKIE_SECURE')}    ${cookieSecure}`,
      `${pc.dim('HERMES_UID/GID')}   ${uid} / ${gid}`,
      chosenModel ? `${pc.dim('model.default')}    ${chosenModel}` : '',
      chosenAdvancedModel ? `${pc.dim('synthesizer.model')} ${chosenAdvancedModel}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    t.summaryTitle,
  )

  const stale = findStaleSecrets(nextEnv)
  if (stale.length > 0) {
    log.warn(t.staleWarn(stale.map((l) => pc.dim(l)).join('\n')))
  }

  outro(t.outro)
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
          label: m === currentModel ? `${m} ${pc.dim(t.modelCurrent)}` : m,
        })),
        { value: '__custom__', label: t.modelCustom },
      ],
    }),
  )
  if (picked !== '__custom__') return picked
  return check(
    await text({
      message: t.modelNameInput,
      initialValue: currentModel,
      validate: (v) => (!v ? t.required : v.includes('"') ? t.modelQuote : undefined),
    }),
  )
}

/** シークレットの生成/温存を対話で決める。 */
async function resolveSecret(name: string, existing: string | undefined): Promise<string> {
  if (existing) {
    const regen = check(
      await confirm({
        message: t.secretExists(name),
        initialValue: false,
      }),
    )
    if (!regen) return existing
  }
  log.success(t.secretGenerated(name))
  return randomBytes(32).toString('hex')
}

main().catch((err) => {
  log.error(String(err?.message ?? err))
  process.exit(1)
})
