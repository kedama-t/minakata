import { EventEmitter } from 'node:events'
import type { Db } from '../db/index.ts'
import { newId, now } from '../util/id.ts'

/** エージェントごとに保持する直近の実況件数 */
const MAX_PER_ACTOR = 50

export interface ActivityLogInput {
  actor: string
  /** スキルが自己申告する論理名(agent-profiles.ts のキーに対応) */
  agent_name?: string | null
  phase: string
  detail?: string | null
  target_article_id?: string | null
}

export interface ActivityLogRow extends ActivityLogInput {
  id: string
  timestamp: string
  actor: string
  agent_name: string | null
  phase: string
  detail: string | null
  target_article_id: string | null
}

/** エージェントの進捗実況を記録する。audit_log とは分離した揮発可能なランタイムログ。 */
export class ActivityService extends EventEmitter {
  constructor(private readonly db: Db) {
    super()
    this.setMaxListeners(0)
  }

  log(input: ActivityLogInput): string {
    const id = newId()
    const ts = now()
    this.db
      .prepare(
        `INSERT INTO agent_activity (id, timestamp, actor, agent_name, phase, detail, target_article_id)
         VALUES ($id, $ts, $actor, $agent_name, $phase, $detail, $target)`,
      )
      .run({
        id,
        ts,
        actor: input.actor,
        agent_name: input.agent_name ?? null,
        phase: input.phase,
        detail: input.detail ?? null,
        target: input.target_article_id ?? null,
      })

    // 同 actor の古い行を間引いて肥大化を防ぐ。id は ULID で単調増加するため timestamp が同一でも正しく並ぶ
    this.db
      .prepare(
        `DELETE FROM agent_activity
         WHERE actor = ?
           AND id NOT IN (
             SELECT id FROM agent_activity
             WHERE actor = ?
             ORDER BY timestamp DESC, id DESC
             LIMIT ?
           )`,
      )
      .run(input.actor, input.actor, MAX_PER_ACTOR)

    const row: ActivityLogRow = {
      id,
      timestamp: ts,
      actor: input.actor,
      agent_name: input.agent_name ?? null,
      phase: input.phase,
      detail: input.detail ?? null,
      target_article_id: input.target_article_id ?? null,
    }
    this.emit('activity-logged', row)
    return id
  }

  list(opts: { limit?: number; since?: string; actor?: string } = {}): ActivityLogRow[] {
    const limit = opts.limit ?? 100
    const conditions: string[] = []
    const params: Array<string | number> = []
    if (opts.since) {
      conditions.push('timestamp >= ?')
      params.push(opts.since)
    }
    if (opts.actor) {
      conditions.push('actor = ?')
      params.push(opts.actor)
    }
    params.push(limit)
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    return this.db
      .query<
        {
          id: string
          timestamp: string
          actor: string
          agent_name: string | null
          phase: string
          detail: string | null
          target_article_id: string | null
        },
        Array<string | number>
      >(`SELECT * FROM agent_activity ${where} ORDER BY timestamp DESC, id DESC LIMIT ?`)
      .all(...params)
      .map((r) => ({ ...r }))
  }

  /** 各 actor の最新実況を1件ずつ返す(カードのライブ表示用) */
  latestByActor(): Map<string, ActivityLogRow> {
    const rows = this.db
      .query<
        {
          id: string
          timestamp: string
          actor: string
          agent_name: string | null
          phase: string
          detail: string | null
          target_article_id: string | null
        },
        []
      >(
        `SELECT * FROM agent_activity
         WHERE id IN (
           SELECT id FROM agent_activity
           GROUP BY actor
           HAVING timestamp = MAX(timestamp)
         )`,
      )
      .all()
    const map = new Map<string, ActivityLogRow>()
    for (const r of rows) map.set(r.actor, { ...r })
    return map
  }
}
