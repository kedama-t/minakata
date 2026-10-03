import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import simpleGit from 'simple-git'
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
 * - approve: admin が承認 → 実ファイルとして hermes-skills/<name>/SKILL.md(正本)に書き出し、
 *   git コミットして変更履歴を残す(US-8.1, #207)
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

  async approve(
    id: string,
    reviewer_id: string,
  ): Promise<{ written_to: string; commit: string | null }> {
    const proposal = this.get(id)
    if (!proposal) throw new Error(`skill proposal not found: ${id}`)
    if (proposal.status !== 'proposed') throw new Error(`already decided: ${proposal.status}`)
    // hermes-skills/<name>/SKILL.md として書き出す
    const fullPath = join(this.skillsDir, proposal.name, 'SKILL.md')
    if (!existsSync(dirname(fullPath))) mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, proposal.code, 'utf8')
    const commit = await this.commitSkill(fullPath, {
      message: `skill: approve ${proposal.name}\n\nproposal: ${id}\nreviewer: ${reviewer_id}\noperation: approve`,
      author: `admin:${reviewer_id} <${reviewer_id}@minakata.local>`,
    })
    this.db
      .prepare(
        `UPDATE skill_proposals SET status = 'approved', reviewer_id = ?, decided_at = ? WHERE id = ?`,
      )
      .run(reviewer_id, now(), id)
    return { written_to: fullPath, commit }
  }

  /**
   * スキルファイル 1 つだけを git コミットする。skillsDir が既存ワークツリー
   * (開発時のリポジトリ本体など)の中ならそこへ、無ければ skillsDir に init する。
   * pathspec 指定でコミットするため、他にステージ済みの変更は巻き込まない。
   * 内容が既存コミットと同一なら何もせず null を返す。
   */
  private async commitSkill(
    fullPath: string,
    input: { message: string; author: string },
  ): Promise<string | null> {
    const git = simpleGit({
      baseDir: this.skillsDir,
      config: ['user.name=Minakata', 'user.email=agent@minakata.local'],
    })
    if (!(await git.checkIsRepo())) await git.init()
    const rel = relative(this.skillsDir, fullPath)
    await git.add(rel)
    const status = await git.status([rel])
    if (status.files.length === 0) return null
    const res = await git.commit(input.message, [rel], { '--author': input.author })
    return res.commit || null
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
