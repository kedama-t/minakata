import type { Db } from '../db/index.ts'
import { newId, now } from '../util/id.ts'

export interface AuditLogInput {
  actor: string
  agent_name?: string | null | undefined
  hermes_session_id?: string | null | undefined
  tool_name: string
  target_article_id?: string | null | undefined
  before_hash?: string | null | undefined
  after_hash?: string | null | undefined
  source_request_id?: string | null | undefined
  cost_usd?: number | undefined
  metadata?: Record<string, unknown> | undefined
}

export interface AuditLogRow extends AuditLogInput {
  id: string
  timestamp: string
}

/**
 * 全変更系操作の監査ログを記録する。tech-stack.md §7 で定義された最低項目をカバー。
 */
export class AuditService {
  constructor(private readonly db: Db) {}

  log(input: AuditLogInput): string {
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO audit_log (id, timestamp, actor, agent_name, hermes_session_id, tool_name,
          target_article_id, before_hash, after_hash, source_request_id, cost_usd, metadata_json)
         VALUES ($id, $ts, $actor, $agent, $session, $tool, $target, $before, $after, $req, $cost, $meta)`,
      )
      .run({
        id,
        ts: now(),
        actor: input.actor,
        agent: input.agent_name ?? null,
        session: input.hermes_session_id ?? null,
        tool: input.tool_name,
        target: input.target_article_id ?? null,
        before: input.before_hash ?? null,
        after: input.after_hash ?? null,
        req: input.source_request_id ?? null,
        cost: input.cost_usd ?? 0,
        meta: input.metadata ? JSON.stringify(input.metadata) : null,
      })
    return id
  }

  list(limit = 100): AuditLogRow[] {
    const rows = this.db
      .query<
        {
          id: string
          timestamp: string
          actor: string
          agent_name: string | null
          hermes_session_id: string | null
          tool_name: string
          target_article_id: string | null
          before_hash: string | null
          after_hash: string | null
          source_request_id: string | null
          cost_usd: number
          metadata_json: string | null
        },
        [number]
      >('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?')
      .all(limit)
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      actor: r.actor,
      agent_name: r.agent_name,
      hermes_session_id: r.hermes_session_id,
      tool_name: r.tool_name,
      target_article_id: r.target_article_id,
      before_hash: r.before_hash,
      after_hash: r.after_hash,
      source_request_id: r.source_request_id,
      cost_usd: r.cost_usd,
      metadata: r.metadata_json
        ? (JSON.parse(r.metadata_json) as Record<string, unknown>)
        : undefined,
    }))
  }
}
