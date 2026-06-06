import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Db } from '../db/index.ts'
import { newId, now } from '../util/id.ts'

export interface SkillProposal {
  id: string
  name: string
  description: string
  code: string
  status: 'proposed' | 'approved' | 'rejected'
  reviewer_id: string | null
  created_at: string
  decided_at: string | null
}

/**
 * Hermes による自己改善スキル提案(US-8.1, 8.2)。
 * - propose: Hermes が新しい SKILL.md を提案
 * - approve: admin が承認 → 実ファイルとして hermes-skills/<name>/SKILL.md(正本)に書き出す
 * - reject: 理由を記録するだけ
 * 削除は status を 'rejected' に戻す形で簡素化(物理削除は呼び出し側で)
 */
export class SkillProposalService {
  constructor(
    private readonly db: Db,
    /** 承認時に書き込むスキルの正本ディレクトリ(既定 `./hermes-skills`、#187) */
    private readonly skillsDir: string,
  ) {}

  propose(input: { name: string; description: string; code: string }): string {
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO skill_proposals (id, name, description, code, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.description, input.code, now())
    return id
  }

  list(status?: SkillProposal['status']): SkillProposal[] {
    if (status) {
      return this.db
        .query<SkillProposal, [string]>(
          `SELECT id, name, description, code, status, reviewer_id, created_at, decided_at
           FROM skill_proposals WHERE status = ? ORDER BY created_at DESC`,
        )
        .all(status)
    }
    return this.db
      .query<SkillProposal, []>(
        `SELECT id, name, description, code, status, reviewer_id, created_at, decided_at
         FROM skill_proposals ORDER BY created_at DESC`,
      )
      .all()
  }

  get(id: string): SkillProposal | null {
    const r = this.db
      .query<SkillProposal, [string]>(
        `SELECT id, name, description, code, status, reviewer_id, created_at, decided_at
         FROM skill_proposals WHERE id = ?`,
      )
      .get(id)
    return r ?? null
  }

  approve(id: string, reviewer_id: string): { written_to: string } {
    const proposal = this.get(id)
    if (!proposal) throw new Error(`skill proposal not found: ${id}`)
    if (proposal.status !== 'proposed') throw new Error(`already decided: ${proposal.status}`)
    // hermes/skills/<name>/SKILL.md として書き出す
    const fullPath = join(this.skillsDir, proposal.name, 'SKILL.md')
    if (!existsSync(dirname(fullPath))) mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, proposal.code, 'utf8')
    this.db
      .prepare(
        `UPDATE skill_proposals SET status = 'approved', reviewer_id = ?, decided_at = ? WHERE id = ?`,
      )
      .run(reviewer_id, now(), id)
    return { written_to: fullPath }
  }

  reject(id: string, reviewer_id: string): void {
    const proposal = this.get(id)
    if (!proposal) throw new Error(`skill proposal not found: ${id}`)
    if (proposal.status !== 'proposed') throw new Error(`already decided: ${proposal.status}`)
    this.db
      .prepare(
        `UPDATE skill_proposals SET status = 'rejected', reviewer_id = ?, decided_at = ? WHERE id = ?`,
      )
      .run(reviewer_id, now(), id)
  }
}
