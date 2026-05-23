import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { load as loadSqliteVec } from 'sqlite-vec'
// SQL ファイルは `?raw` でインライン化し、SSR バンドル化されても解決できるようにする
// Bun / Vite (Rollup) 両方で `?raw` は対応している
import init0001 from './migrations/0001_init.sql?raw'
import init0002 from './migrations/0002_vec.sql?raw'
import init0003 from './migrations/0003_archive_proposals.sql?raw'

export type Db = Database

export interface OpenDbOptions {
  /** SQLite ファイルパス。`:memory:` を渡すと in-memory(テスト用) */
  path: string
  /** 初回オープン時にマイグレーションを適用するか(デフォルト true) */
  runMigrations?: boolean
}

// 順序が重要(ファイル名昇順)。先に init、後に vec(拡張ロード後)
const MIGRATIONS: { name: string; sql: string }[] = [
  { name: '0001_init.sql', sql: init0001 },
  { name: '0002_vec.sql', sql: init0002 },
  { name: '0003_archive_proposals.sql', sql: init0003 },
]

/**
 * macOS / 一部 Linux ディストロの組み込み SQLite は拡張ロードを無効化している。
 * sqlite-vec をロードするため、拡張対応ビルドの SQLite を `Database.setCustomSQLite` で差し込む。
 *
 * 優先順位:
 *   1. 環境変数 SQLITE_CUSTOM_LIB(明示指定)
 *   2. Homebrew (`/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`)
 *   3. Linux 標準パス(`/usr/lib/x86_64-linux-gnu/libsqlite3.so.0` など)
 */
let customSqliteApplied = false
function ensureCustomSqlite(): void {
  if (customSqliteApplied) return
  const candidates = [
    process.env.SQLITE_CUSTOM_LIB,
    '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/lib/x86_64-linux-gnu/libsqlite3.so.0',
    '/usr/lib/aarch64-linux-gnu/libsqlite3.so.0',
  ].filter((p): p is string => Boolean(p))
  for (const lib of candidates) {
    if (existsSync(lib)) {
      Database.setCustomSQLite(lib)
      customSqliteApplied = true
      return
    }
  }
  // 見つからなくても進める(拡張ロードで失敗したらエラーが出る)
}

export function openDb(options: OpenDbOptions): Db {
  ensureCustomSqlite()
  const { path } = options
  if (path !== ':memory:') {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  const db = new Database(path, { create: true, strict: true })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
  loadSqliteVec(db)
  if (options.runMigrations ?? true) runMigrations(db)
  return db
}

/**
 * インライン化されたマイグレーションを順に適用する。冪等性は各 SQL 側の IF NOT EXISTS に依存。
 * 拡張ロード前提のマイグレーション(0002_vec.sql など)は loadExtension 後に呼ぶ。
 */
export function runMigrations(db: Db): void {
  for (const m of MIGRATIONS) db.exec(m.sql)
}

/** テスト用に :memory: で開く便利関数 */
export function openTestDb(): Db {
  return openDb({ path: ':memory:' })
}
