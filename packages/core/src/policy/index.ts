import type { Db } from '../db/index.ts'
import { now } from '../util/id.ts'

export interface ResearchPolicy {
  id: string
  body_md: string
  updated_at: string
  updated_by: string | null
}

/**
 * チーム共通の調査方針(リサーチ方針)。
 * Hermes は `get` で取得し subagent の system prompt 先頭に挿入する(US-3.3)。
 * 単一行(id='default')に集約。バージョン管理は git 履歴に頼る(後で必要なら拡張)。
 */
export class PolicyService {
  constructor(private readonly db: Db) {}

  get(): ResearchPolicy {
    const r = this.db
      .query<ResearchPolicy, []>(
        "SELECT id, body_md, updated_at, updated_by FROM research_policy WHERE id = 'default'",
      )
      .get()
    return (
      r ?? { id: 'default', body_md: '', updated_at: '1970-01-01T00:00:00.000Z', updated_by: null }
    )
  }

  update(body_md: string, updated_by: string): void {
    this.db
      .prepare(
        `UPDATE research_policy SET body_md = ?, updated_at = ?, updated_by = ? WHERE id = 'default'`,
      )
      .run(body_md, now(), updated_by)
  }
}
