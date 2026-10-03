import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { AuthService } from '../src/auth/index.ts'
import { openTestDb } from '../src/db/index.ts'
import { SkillProposalService } from '../src/skill/index.ts'

describe('SkillProposalService', () => {
  test('propose → approve で SKILL.md が書き出される', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-skill-'))
    const db = openTestDb()
    const auth = new AuthService(db)
    const admin = await auth.createAdminInitial('a@x', 'p123pass')
    const skills = new SkillProposalService(db, dir)
    const id = skills.propose({
      name: 'release_watcher',
      description: '指定 GitHub リポのリリースを監視するスキル',
      code: '# release_watcher\n\nHello SKILL',
    })
    const r = await skills.approve(id, admin.id)
    expect(r.written_to).toBe(join(dir, 'release_watcher', 'SKILL.md'))
    expect(existsSync(r.written_to)).toBe(true)
    expect(readFileSync(r.written_to, 'utf8')).toContain('Hello SKILL')
    const got = skills.get(id)
    expect(got?.status).toBe('approved')
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('approve で git コミットされ、提案 ID / reviewer が履歴に残る (#207)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-skill-'))
    const db = openTestDb()
    const auth = new AuthService(db)
    const admin = await auth.createAdminInitial('a@x', 'p123pass')
    const skills = new SkillProposalService(db, dir)
    const id = skills.propose({ name: 'release_watcher', description: 'd', code: '# v1' })
    const r = await skills.approve(id, admin.id)
    expect(r.commit).toBeTruthy()
    const log = await simpleGit(dir).log({ file: 'release_watcher/SKILL.md' })
    expect(log.total).toBe(1)
    expect(log.latest?.message).toBe('skill: approve release_watcher')
    expect(log.latest?.body).toContain(`proposal: ${id}`)
    expect(log.latest?.body).toContain(`reviewer: ${admin.id}`)
    expect(log.latest?.author_name).toBe(`admin:${admin.id}`)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('既存リポでは他のステージ済み変更を巻き込まず、同一内容なら空コミットしない', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-skill-'))
    const git = simpleGit(dir)
    await git.init()
    await git.addConfig('user.name', 'dev')
    await git.addConfig('user.email', 'dev@example.com')
    writeFileSync(join(dir, 'unrelated.txt'), 'wip')
    await git.add('unrelated.txt')
    const db = openTestDb()
    const auth = new AuthService(db)
    const admin = await auth.createAdminInitial('a@x', 'p123pass')
    const skills = new SkillProposalService(db, dir)
    const id1 = skills.propose({ name: 's', description: 'd', code: '# same' })
    expect((await skills.approve(id1, admin.id)).commit).toBeTruthy()
    const committed = await git.raw(['show', '--name-only', '--format=', 'HEAD'])
    expect(committed.trim()).toBe('s/SKILL.md')
    expect((await git.status()).staged).toContain('unrelated.txt')
    const id2 = skills.propose({ name: 's', description: 'd', code: '# same' })
    expect((await skills.approve(id2, admin.id)).commit).toBeNull()
    expect((await git.log()).total).toBe(1)
    expect(skills.get(id2)?.status).toBe('approved')
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('reject で status が rejected になる', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minakata-skill-'))
    const db = openTestDb()
    const auth = new AuthService(db)
    const admin = await auth.createAdminInitial('a@x', 'p123pass')
    const skills = new SkillProposalService(db, dir)
    const id = skills.propose({ name: 'bad', description: 'x', code: 'y' })
    skills.reject(id, admin.id)
    expect(skills.get(id)?.status).toBe('rejected')
    expect(existsSync(join(dir, 'bad'))).toBe(false)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
