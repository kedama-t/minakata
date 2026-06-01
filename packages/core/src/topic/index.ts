import type { Db } from '../db/index.ts'
import { now } from '../util/id.ts'

export interface TopicRow {
  id: string
  name: string
  keywords: string[]
  priority_sources: string[]
  exclusion: string[]
  depth: 'shallow' | 'deep'
  format: string | null
  instructions_md: string
  active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

interface RawRow {
  id: string
  name: string
  keywords_json: string
  priority_sources_json: string
  exclusion_json: string
  depth: string
  format: string | null
  instructions_md: string
  active: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface UpdateTopicInput {
  name?: string
  keywords?: string[]
  priority_sources?: string[]
  exclusion?: string[]
  depth?: 'shallow' | 'deep'
  format?: string | null
  instructions_md?: string
  active?: boolean
}

/** 購読トピックの読み書きサービス。 */
export class TopicService {
  constructor(private readonly db: Db) {}

  private parse(r: RawRow): TopicRow {
    return {
      id: r.id,
      name: r.name,
      keywords: JSON.parse(r.keywords_json) as string[],
      priority_sources: JSON.parse(r.priority_sources_json) as string[],
      exclusion: JSON.parse(r.exclusion_json) as string[],
      depth: r.depth as 'shallow' | 'deep',
      format: r.format,
      instructions_md: r.instructions_md,
      active: r.active === 1,
      created_by: r.created_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }
  }

  /** active=1 のトピックを全件返す。daily_research が使用する。 */
  listActive(): TopicRow[] {
    return this.db
      .query<RawRow, []>(
        `SELECT id, name, keywords_json, priority_sources_json, exclusion_json,
                depth, format, instructions_md, active, created_by, created_at, updated_at
           FROM topics WHERE active = 1 ORDER BY created_at ASC`,
      )
      .all()
      .map((r) => this.parse(r))
  }

  get(id: string): TopicRow | null {
    const r = this.db
      .query<RawRow, [string]>(
        `SELECT id, name, keywords_json, priority_sources_json, exclusion_json,
                depth, format, instructions_md, active, created_by, created_at, updated_at
           FROM topics WHERE id = ?`,
      )
      .get(id)
    return r ? this.parse(r) : null
  }

  update(id: string, input: UpdateTopicInput): TopicRow | null {
    const ts = now()
    const sets: string[] = ['updated_at = $ts']
    const params: Record<string, string | number | null> = { id, ts }

    if (input.name !== undefined) {
      sets.push('name = $name')
      params.name = input.name
    }
    if (input.keywords !== undefined) {
      sets.push('keywords_json = $kw')
      params.kw = JSON.stringify(input.keywords)
    }
    if (input.priority_sources !== undefined) {
      sets.push('priority_sources_json = $ps')
      params.ps = JSON.stringify(input.priority_sources)
    }
    if (input.exclusion !== undefined) {
      sets.push('exclusion_json = $ex')
      params.ex = JSON.stringify(input.exclusion)
    }
    if (input.depth !== undefined) {
      sets.push('depth = $depth')
      params.depth = input.depth
    }
    if (input.format !== undefined) {
      sets.push('format = $format')
      params.format = input.format
    }
    if (input.instructions_md !== undefined) {
      sets.push('instructions_md = $inst')
      params.inst = input.instructions_md
    }
    if (input.active !== undefined) {
      sets.push('active = $active')
      params.active = input.active ? 1 : 0
    }

    this.db.prepare(`UPDATE topics SET ${sets.join(', ')} WHERE id = $id`).run(params)
    return this.get(id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM topics WHERE id = ?').run(id)
  }
}
