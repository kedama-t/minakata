import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { load as loadSqliteVec } from 'sqlite-vec'
// SQL ファイルは `?raw` でインライン化し、SSR バンドル化されても解決できるようにする
// Bun / Vite (Rollup) 両方で `?raw` は対応している
import init0001 from './migrations/0001_init.sql?raw'
import init0002 from './migrations/0002_vec.sql?raw'
import init0003 from './migrations/0003_archive_proposals.sql?raw'
import init0004 from './migrations/0004_review_before_status.sql?raw'
import init0005 from './migrations/0005_tasks_requested_by.sql?raw'
import init0006 from './migrations/0006_agent_activity.sql?raw'
import init0007 from './migrations/0007_agent_activity_agent_name.sql?raw'

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
  { name: '0004_review_before_status.sql', sql: init0004 },
  { name: '0005_tasks_requested_by.sql', sql: init0005 },
  { name: '0006_agent_activity.sql', sql: init0006 },
  { name: '0007_agent_activity_agent_name.sql', sql: init0007 },
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
 * インライン化されたマイグレーションを順に適用する。
 * `schema_migrations` テーブルで適用済みファイル名を追跡するので、ALTER TABLE
 * のような非冪等マイグレーションも安全に再実行できる。
 * 拡張ロード前提のマイグレーション(0002_vec.sql など)は loadExtension 後に呼ぶ。
 */
export function runMigrations(db: Db): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  )
  const applied = new Set(
    db
      .query<{ name: string }, []>('SELECT name FROM schema_migrations')
      .all()
      .map((r) => r.name),
  )
  const ts = new Date().toISOString()
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(m.name, ts)
  }
}

/** テスト用に :memory: で開く便利関数 */
export function openTestDb(): Db {
  return openDb({ path: ':memory:' })
}
