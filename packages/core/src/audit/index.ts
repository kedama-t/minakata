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
  /** cost_usd は DB のデフォルトが 0 のため、行としては常に number(input の optional とは別) */
  cost_usd: number
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

  /**
   * 監査ログを時系列降順で返す。`since` / `actor` / `agent_name` / `tool_name`
   * のフィルタとカーソルページング (`before` = timestamp) に対応。
   * /monitor 画面と Hermes 稼働状況ウィジェットで使う。
   */
  list(
    opts:
      | number
      | {
          limit?: number | undefined
          since?: string | undefined
          before?: string | undefined
          actor?: string | undefined
          agent_name?: string | undefined
          tool_name?: string | undefined
        } = 100,
  ): AuditLogRow[] {
    const o = typeof opts === 'number' ? { limit: opts } : opts
    const limit = o.limit ?? 100
    const conditions: string[] = []
    const params: Array<string | number> = []
    if (o.since) {
      conditions.push('timestamp >= ?')
      params.push(o.since)
    }
    if (o.before) {
      conditions.push('timestamp < ?')
      params.push(o.before)
    }
    if (o.actor) {
      conditions.push('actor = ?')
      params.push(o.actor)
    }
    if (o.agent_name) {
      conditions.push('agent_name = ?')
      params.push(o.agent_name)
    }
    if (o.tool_name) {
      conditions.push('tool_name = ?')
      params.push(o.tool_name)
    }
    params.push(limit)
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
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
        Array<string | number>
      >(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC, id DESC LIMIT ?`)
      .all(...params)
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

  /** 直近に登場した agent_name / tool_name の集合を返す(フィルタ用) */
  distinctAgents(): string[] {
    return this.db
      .query<{ agent_name: string | null }, []>(
        'SELECT DISTINCT agent_name FROM audit_log WHERE agent_name IS NOT NULL ORDER BY agent_name',
      )
      .all()
      .map((r) => r.agent_name)
      .filter((v): v is string => Boolean(v))
  }

  distinctTools(): string[] {
    return this.db
      .query<{ tool_name: string }, []>(
        'SELECT DISTINCT tool_name FROM audit_log ORDER BY tool_name',
      )
      .all()
      .map((r) => r.tool_name)
  }
}
