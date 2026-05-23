import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    const r = skills.approve(id, admin.id)
    expect(r.written_to).toBe(join(dir, 'release_watcher', 'SKILL.md'))
    expect(existsSync(r.written_to)).toBe(true)
    expect(readFileSync(r.written_to, 'utf8')).toContain('Hello SKILL')
    const got = skills.get(id)
    expect(got?.status).toBe('approved')
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
