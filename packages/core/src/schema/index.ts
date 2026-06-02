import { z } from 'zod'

export const RoleSchema = z.enum(['viewer', 'editor', 'admin'])
export type Role = z.infer<typeof RoleSchema>

export const ArticleStatusSchema = z.enum(['draft', 'published', 'pending_approval', 'archived'])
export type ArticleStatus = z.infer<typeof ArticleStatusSchema>

export const ArticleSourceKindSchema = z.enum([
  'manual',
  'agent_research',
  'agent_changelog',
  'agent_daily',
])
export type ArticleSourceKind = z.infer<typeof ArticleSourceKindSchema>

export const FreshnessRankSchema = z.enum(['fresh', 'aging', 'stale', 'very_stale'])
export type FreshnessRank = z.infer<typeof FreshnessRankSchema>

export const TaskPrioritySchema = z.enum(['urgent', 'interactive', 'scheduled', 'maintenance'])
export type TaskPriority = z.infer<typeof TaskPrioritySchema>

export const TaskStatusSchema = z.enum(['queued', 'claimed', 'done', 'failed'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const SourceRefSchema = z.object({
  url: z.string().url(),
  fetched_at: z.string().datetime(),
  archive_url: z.string().url().nullable().optional(),
  used_in_sections: z.array(z.string()).default([]),
})
export type SourceRef = z.infer<typeof SourceRefSchema>

// 記事 frontmatter
export const ArticleFrontmatterSchema = z.object({
  id: z.string().min(26).max(26),
  title: z.string().min(1),
  slug: z.string().min(1),
  status: ArticleStatusSchema,
  source: ArticleSourceKindSchema,
  tags: z.array(z.string()).default([]),
  topic_id: z.string().nullable().optional(),
  sources: z.array(SourceRefSchema).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_researched_at: z.string().datetime().nullable().optional(),
  last_accessed_at: z.string().datetime().nullable().optional(),
  created_by: z.string(),
  last_modified_by: z.string(),
  summary: z.string().default(''),
  related_to: z.array(z.string()).default([]),
  cost_usd: z.number().nonnegative().default(0),
  freshness_rank: FreshnessRankSchema.default('fresh'),
})
export type ArticleFrontmatter = z.infer<typeof ArticleFrontmatterSchema>
