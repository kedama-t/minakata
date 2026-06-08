import { constants, accessSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import simpleGit, { type SimpleGit } from 'simple-git'
import type { Db } from '../db/index.ts'
import { now } from '../util/id.ts'

export interface BackupOptions {
  /** バックアップ専用 git リポジトリのルート(既定 ./data/backup) */
  backupDir: string
  /** 記事 Markdown のルート(data/articles) */
  articlesRoot: string
  /** Hermes runtime skills のディレクトリ。読めない場合は warn-skip */
  runtimeSkillsDir?: string
  /** push 先 GitHub repo の URL(https://github.com/owner/repo.git)。無ければ commit のみ */
  remote?: string
  /** GitHub PAT。remote URL に x-access-token として注入する。ログには出さない */
  token?: string
}

export interface BackupResult {
  committed: boolean
  hash?: string
  pushed: boolean
  changedFiles: number
  warnings: string[]
  error?: string
}

/**
 * 記事・DB・runtime skills を専用 git リポジトリに集約し、GitHub private repo へ
 * push する定期バックアップ。Hermes の backup_agent skill が MCP 経由で起動する。
 * - 記事 Markdown は行差分が効くため git 管理が有効
 * - DB は VACUUM INTO で一貫スナップショットを丸ごと退避
 * - token は remote URL に注入するが返り値・例外文言には残さない
 */
export class BackupService {
  private readonly git: SimpleGit
  private readonly backupDir: string
  private readonly articlesRoot: string
  private readonly runtimeSkillsDir: string | undefined
  private readonly remote: string | undefined
  private readonly token: string | undefined

  constructor(
    private readonly db: Db,
    opts: BackupOptions,
  ) {
    this.backupDir = opts.backupDir
    this.articlesRoot = opts.articlesRoot
    this.runtimeSkillsDir = opts.runtimeSkillsDir
    this.remote = opts.remote
    this.token = opts.token
    if (!existsSync(this.backupDir)) mkdirSync(this.backupDir, { recursive: true })
    this.git = simpleGit(this.backupDir)
  }

  /** リポジトリ初期化と origin 設定(冪等)。token があれば URL に注入する */
  private async ensureRepo(): Promise<void> {
    if (!existsSync(join(this.backupDir, '.git'))) {
      await this.git.init()
      await this.git.addConfig('user.email', 'backup@minakata.local')
      await this.git.addConfig('user.name', 'Minakata Backup')
    }
    if (this.remote) {
      const url = this.remoteWithToken()
      const remotes = await this.git.getRemotes(true)
      if (remotes.some((r) => r.name === 'origin')) {
        await this.git.remote(['set-url', 'origin', url])
      } else {
        await this.git.addRemote('origin', url)
      }
    }
  }

  /** remote URL に token を埋め込む。https の場合のみ x-access-token 形式にする */
  private remoteWithToken(): string {
    if (!this.remote) return ''
    if (this.token && this.remote.startsWith('https://')) {
      return this.remote.replace(/^https:\/\//, `https://x-access-token:${this.token}@`)
    }
    return this.remote
  }

  /** 例外文言に token が混ざらないよう除去する */
  private redact(s: string): string {
    return this.token ? s.split(this.token).join('***') : s
  }

  /** ディレクトリを宛先へ丸ごと同期する(削除も反映)。.git は除外 */
  private syncDir(src: string, dest: string): void {
    rmSync(dest, { recursive: true, force: true })
    cpSync(src, dest, {
      recursive: true,
      filter: (from) => basename(from) !== '.git',
    })
  }

  /** バックアップを 1 回実行する */
  async run(opts?: { message?: string }): Promise<BackupResult> {
    const warnings: string[] = []
    await this.ensureRepo()

    // 1. 記事 Markdown
    if (existsSync(this.articlesRoot)) {
      this.syncDir(this.articlesRoot, join(this.backupDir, 'articles'))
    } else {
      warnings.push(`articlesRoot not found: ${this.articlesRoot}`)
    }

    // 2. DB スナップショット(VACUUM INTO で一貫コピー)
    const dbDir = join(this.backupDir, 'db')
    mkdirSync(dbDir, { recursive: true })
    const dbSnapshot = join(dbDir, 'minakata.sqlite')
    rmSync(dbSnapshot, { force: true })
    this.db.prepare('VACUUM INTO ?').run(dbSnapshot)

    // 3. runtime skills(読めた場合のみ)
    if (this.runtimeSkillsDir && existsSync(this.runtimeSkillsDir)) {
      try {
        accessSync(this.runtimeSkillsDir, constants.R_OK)
        this.syncDir(this.runtimeSkillsDir, join(this.backupDir, 'skills'))
      } catch {
        warnings.push(`runtime skills not readable, skipped: ${this.runtimeSkillsDir}`)
      }
    } else {
      warnings.push('runtime skills dir not set or missing, skipped')
    }

    // 4. commit(変更が無ければスキップ)
    await this.git.add('-A')
    const status = await this.git.status()
    if (status.files.length === 0) {
      return { committed: false, pushed: false, changedFiles: 0, warnings }
    }
    const message = opts?.message ?? `backup: ${now()}`
    const commit = await this.git.commit(message)

    // 5. push(remote 指定時のみ)
    let pushed = false
    let error: string | undefined
    if (this.remote) {
      try {
        await this.git.push(['-u', 'origin', 'HEAD'])
        pushed = true
      } catch (e) {
        error = this.redact(e instanceof Error ? e.message : String(e))
      }
    }

    return {
      committed: true,
      hash: commit.commit,
      pushed,
      changedFiles: status.files.length,
      warnings,
      ...(error ? { error } : {}),
    }
  }
}
