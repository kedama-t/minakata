import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { BackupService } from '../src/backup/index.ts'
import { openTestDb } from '../src/db/index.ts'

/** テスト用の articlesRoot を tmp に用意し、記事 .md を 1 件書き込む */
function setupArticles(root: string): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'hello.md'), '# hello\n\nbody\n')
}

describe('BackupService.run', () => {
  test('初回実行で .git・articles・db スナップショットを作り commit する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-backup-'))
    const articlesRoot = join(dir, 'articles')
    const backupDir = join(dir, 'backup')
    setupArticles(articlesRoot)
    const db = openTestDb()
    const backup = new BackupService(db, { backupDir, articlesRoot })

    const r = await backup.run()

    expect(r.committed).toBe(true)
    expect(r.pushed).toBe(false)
    expect(r.changedFiles).toBeGreaterThan(0)
    expect(existsSync(join(backupDir, '.git'))).toBe(true)
    expect(existsSync(join(backupDir, 'articles', 'hello.md'))).toBe(true)
    expect(existsSync(join(backupDir, 'db', 'minakata.sqlite'))).toBe(true)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('差分が無ければ commit しない(committed: false)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-backup-'))
    const articlesRoot = join(dir, 'articles')
    const backupDir = join(dir, 'backup')
    setupArticles(articlesRoot)
    const db = openTestDb()
    const backup = new BackupService(db, { backupDir, articlesRoot })

    await backup.run()
    const second = await backup.run()

    expect(second.committed).toBe(false)
    expect(second.changedFiles).toBe(0)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('記事変更で再 commit され git log が増える', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-backup-'))
    const articlesRoot = join(dir, 'articles')
    const backupDir = join(dir, 'backup')
    setupArticles(articlesRoot)
    const db = openTestDb()
    const backup = new BackupService(db, { backupDir, articlesRoot })

    await backup.run()
    writeFileSync(join(articlesRoot, 'hello.md'), '# hello\n\nupdated body\n')
    const r = await backup.run()

    expect(r.committed).toBe(true)
    const log = await simpleGit(backupDir).log()
    expect(log.total).toBe(2)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('runtime skills 未指定でも warn を積んで成功する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-backup-'))
    const articlesRoot = join(dir, 'articles')
    const backupDir = join(dir, 'backup')
    setupArticles(articlesRoot)
    const db = openTestDb()
    const backup = new BackupService(db, { backupDir, articlesRoot })

    const r = await backup.run()

    expect(r.committed).toBe(true)
    expect(r.warnings.some((w) => w.includes('runtime skills'))).toBe(true)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('documentsRoot 指定時はアップロード資料を取り込む', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-backup-'))
    const articlesRoot = join(dir, 'articles')
    const backupDir = join(dir, 'backup')
    const documentsRoot = join(dir, 'documents')
    setupArticles(articlesRoot)
    mkdirSync(join(documentsRoot, 'DOC1'), { recursive: true })
    writeFileSync(join(documentsRoot, 'DOC1', 'spec.md'), '# spec\n')
    writeFileSync(join(documentsRoot, 'DOC1', 'extracted.md'), '# spec\n')
    const db = openTestDb()
    const backup = new BackupService(db, { backupDir, articlesRoot, documentsRoot })

    const r = await backup.run()

    expect(r.committed).toBe(true)
    expect(existsSync(join(backupDir, 'documents', 'DOC1', 'spec.md'))).toBe(true)
    expect(existsSync(join(backupDir, 'documents', 'DOC1', 'extracted.md'))).toBe(true)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('documentsRoot 未指定なら warn を積んで成功する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-backup-'))
    const articlesRoot = join(dir, 'articles')
    const backupDir = join(dir, 'backup')
    setupArticles(articlesRoot)
    const db = openTestDb()
    const backup = new BackupService(db, { backupDir, articlesRoot })

    const r = await backup.run()

    expect(r.committed).toBe(true)
    expect(r.warnings.some((w) => w.includes('documents root'))).toBe(true)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('runtime skills 指定時は skills/ を取り込む', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-backup-'))
    const articlesRoot = join(dir, 'articles')
    const backupDir = join(dir, 'backup')
    const skillsDir = join(dir, 'skills')
    setupArticles(articlesRoot)
    mkdirSync(join(skillsDir, 'demo'), { recursive: true })
    writeFileSync(join(skillsDir, 'demo', 'SKILL.md'), '---\nname: demo\n---\n')
    const db = openTestDb()
    const backup = new BackupService(db, { backupDir, articlesRoot, runtimeSkillsDir: skillsDir })

    const r = await backup.run()

    expect(r.committed).toBe(true)
    expect(existsSync(join(backupDir, 'skills', 'demo', 'SKILL.md'))).toBe(true)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
