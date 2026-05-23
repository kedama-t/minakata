import { ArticleStatusSchema, TaskPrioritySchema } from '@minakata/core'
/**
 * Minakata MCP の公開ツール群(Phase 1)。
 * tech-stack.md §5.3, user-stories.md の各 US 受け入れ条件に対応。
 *
 * 各ツールは zod の inputSchema を持ち、内部で core サービスを呼ぶだけのシン層に保つ。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { McpServices } from './services.ts'

type CallContext = { agent?: string }

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  structuredContent: data as Record<string, unknown>,
})

export function registerArticleTools(
  server: McpServer,
  s: McpServices,
  ctx: CallContext = {},
): void {
  server.registerTool(
    'minakata.read_article',
    {
      description: '記事を ID または slug で取得する',
      inputSchema: { id_or_slug: z.string() },
    },
    async ({ id_or_slug }) => {
      const a = s.articles.read(id_or_slug)
      if (!a) return ok({ found: false })
      await s.articles.touchAccessed(a.frontmatter.id)
      return ok({ found: true, frontmatter: a.frontmatter, body: a.body, path: a.path })
    },
  )

  server.registerTool(
    'minakata.create_article',
    {
      description: '新規記事を作成する。Markdown 書き込み + DB インデックス + Git コミット',
      inputSchema: {
        title: z.string(),
        slug: z.string(),
        body: z.string(),
        tags: z.array(z.string()).optional(),
        topic_id: z.string().optional(),
        summary: z.string().optional(),
        author: z.string().default('agent:researcher'),
        source: z.enum(['manual', 'agent_research', 'agent_changelog']).optional(),
      },
    },
    async (args) => {
      const created = await s.articles.create({
        title: args.title,
        slug: args.slug,
        body: args.body,
        tags: args.tags,
        topic_id: args.topic_id ?? null,
        summary: args.summary,
        source: args.source,
        author: args.author,
      })
      s.audit.log({
        actor: ctx.agent ?? args.author,
        tool_name: 'minakata.create_article',
        target_article_id: created.frontmatter.id,
        after_hash: created.content_hash,
      })
      return ok({ id: created.frontmatter.id, slug: created.frontmatter.slug })
    },
  )

  server.registerTool(
    'minakata.update_article',
    {
      description:
        '既存記事を更新する。body を渡した場合は ReviewService.proposeUpdate を経由し、変更率がしきい値(既定 30%)を超えると pending_approval で保留される(US-6.2)。body 以外のフィールドだけの場合は直接反映する。',
      inputSchema: {
        id: z.string(),
        body: z.string().optional(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: ArticleStatusSchema.optional(),
        summary: z.string().optional(),
        last_researched_at: z.string().datetime().optional(),
        cost_usd: z.number().nonnegative().optional(),
        author: z.string().default('agent:researcher'),
        /** 0..1。デフォルト 0.3。0 にすると常に保留、1 にすると常に直接反映(テスト・移行用) */
        review_threshold: z.number().min(0).max(1).optional(),
      },
    },
    async (args) => {
      const before = s.articles.read(args.id)
      // body 提案は ReviewService 経由で 30% ゲートを通す
      if (args.body !== undefined) {
        const proposal = await s.reviews.proposeUpdate({
          article_id: args.id,
          proposed_body: args.body,
          author: args.author,
          ...(args.review_threshold !== undefined && { threshold: args.review_threshold }),
          ...(args.cost_usd !== undefined && { cost_usd: args.cost_usd }),
        })
        if (proposal.kind === 'pending') {
          s.audit.log({
            actor: ctx.agent ?? args.author,
            tool_name: 'minakata.update_article',
            target_article_id: args.id,
            before_hash: before?.content_hash ?? null,
            cost_usd: args.cost_usd ?? 0,
            metadata: {
              result: 'pending_approval',
              review_id: proposal.review_id,
              change_pct: proposal.change_pct,
            },
          })
          return ok({
            id: args.id,
            status: 'pending_approval',
            review_id: proposal.review_id,
            change_pct: proposal.change_pct,
          })
        }
        // applied:本文の反映は完了済。残りのメタデータがあれば追加で更新する
      }
      const hasMeta =
        args.title !== undefined ||
        args.tags !== undefined ||
        args.status !== undefined ||
        args.summary !== undefined ||
        args.last_researched_at !== undefined
      const updated =
        hasMeta || args.body === undefined
          ? await s.articles.update({
              id: args.id,
              title: args.title,
              tags: args.tags,
              status: args.status,
              summary: args.summary,
              last_researched_at: args.last_researched_at,
              cost_usd: args.body === undefined ? args.cost_usd : undefined,
              author: args.author,
            })
          : s.articles.read(args.id)
      s.audit.log({
        actor: ctx.agent ?? args.author,
        tool_name: 'minakata.update_article',
        target_article_id: args.id,
        before_hash: before?.content_hash ?? null,
        after_hash: updated?.content_hash ?? null,
        cost_usd: args.cost_usd ?? 0,
      })
      return ok({ id: args.id, status: 'applied' })
    },
  )

  server.registerTool(
    'minakata.archive_article',
    {
      description: '記事をアーカイブする(自動更新対象外に)。admin 承認ゲートは MCP 側で実装予定',
      inputSchema: {
        id: z.string(),
        author: z.string().default('agent:freshness'),
      },
    },
    async (args) => {
      await s.articles.archive(args.id, args.author)
      s.audit.log({
        actor: ctx.agent ?? args.author,
        tool_name: 'minakata.archive_article',
        target_article_id: args.id,
      })
      return ok({ id: args.id, archived: true })
    },
  )

  server.registerTool(
    'minakata.unarchive_article',
    {
      description:
        'アーカイブ解除(US-7.3)。再開後 urgent 優先度で refresh タスクを 1 件キューに投入する',
      inputSchema: {
        id: z.string(),
        author: z.string().default('user:editor'),
      },
    },
    async (args) => {
      await s.articles.unarchive(args.id, args.author)
      s.tasks.enqueue({
        type: 'refresh',
        priority: 'urgent',
        payload: { article_id: args.id, reason: 'unarchived' },
      })
      s.audit.log({
        actor: ctx.agent ?? args.author,
        tool_name: 'minakata.unarchive_article',
        target_article_id: args.id,
      })
      return ok({ id: args.id, unarchived: true })
    },
  )

  server.registerTool(
    'minakata.list_articles',
    {
      description: '記事一覧を取得する',
      inputSchema: {
        status: ArticleStatusSchema.optional(),
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => {
      const items = s.articles.list({ status: args.status, limit: args.limit, offset: args.offset })
      return ok({ items })
    },
  )
}

export function registerSearchTools(server: McpServer, s: McpServices): void {
  server.registerTool(
    'minakata.fulltext_search',
    {
      description: 'FTS5 全文検索。snippet 付きで返す',
      inputSchema: {
        q: z.string().min(1),
        status: ArticleStatusSchema.optional(),
        exclude_archived: z.boolean().optional(),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async (args) => {
      const hits = s.search.fulltext({
        q: args.q,
        status: args.status,
        excludeArchived: args.exclude_archived ?? false,
        limit: args.limit,
      })
      return ok({ hits })
    },
  )

  server.registerTool(
    'minakata.by_tag',
    {
      description: 'タグで記事を絞り込む',
      inputSchema: {
        tag: z.string().min(1),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) => ok({ hits: s.search.byTag(args.tag, args.limit) }),
  )

  server.registerTool(
    'minakata.similar_articles',
    {
      description: '対象記事に類似する記事(コサイン類似度)を返す',
      inputSchema: {
        article_id: z.string(),
        limit: z.number().int().positive().max(20).optional(),
      },
    },
    async (args) => ok({ hits: s.search.similar(args.article_id, args.limit ?? 5) }),
  )
}

export function registerMessageTools(
  server: McpServer,
  s: McpServices,
  ctx: CallContext = {},
): void {
  server.registerTool(
    'minakata.poll_messages',
    {
      description: '未取得のユーザー発言を取り出す。Hermes の dialogue subagent が 30 秒周期で呼ぶ',
      inputSchema: { limit: z.number().int().positive().max(100).optional() },
    },
    async ({ limit }) => ok({ messages: s.messages.pollUserMessages(limit) }),
  )

  server.registerTool(
    'minakata.claim_message',
    {
      description: 'メッセージを claim して処理開始を宣言する',
      inputSchema: { message_id: z.string(), claimed_by: z.string() },
    },
    async ({ message_id, claimed_by }) =>
      ok({ claimed: s.messages.claim(message_id, ctx.agent ?? claimed_by) }),
  )

  server.registerTool(
    'minakata.post_agent_response',
    {
      description: 'エージェントの応答チャンクを書き込む。is_final=true で完了',
      inputSchema: {
        session_id: z.string(),
        content: z.string(),
        is_final: z.boolean().default(false),
      },
    },
    async (args) => {
      const m = s.messages.postAgentResponse({
        session_id: args.session_id,
        content: args.content,
        is_final: args.is_final,
      })
      return ok({ id: m.id })
    },
  )
}

export function registerTaskTools(server: McpServer, s: McpServices, ctx: CallContext = {}): void {
  server.registerTool(
    'minakata.enqueue_task',
    {
      description: '調査・編集タスクをキューに投入する。dedup_key で冪等性確保',
      inputSchema: {
        type: z.string(),
        priority: TaskPrioritySchema,
        payload: z.record(z.string(), z.unknown()).optional(),
        dedup_key: z.string().optional(),
        parent_task_id: z.string().optional(),
        parent_review_id: z.string().optional(),
      },
    },
    async (args) => {
      const t = s.tasks.enqueue({
        type: args.type,
        priority: args.priority,
        payload: args.payload,
        dedup_key: args.dedup_key ?? null,
        parent_task_id: args.parent_task_id ?? null,
        parent_review_id: args.parent_review_id ?? null,
      })
      s.audit.log({
        actor: ctx.agent ?? 'unknown',
        tool_name: 'minakata.enqueue_task',
        metadata: { type: args.type, priority: args.priority },
      })
      return ok({ id: t.id, status: t.status })
    },
  )

  server.registerTool(
    'minakata.poll_tasks',
    {
      description: '次の処理対象タスクを claim する(priority 順)',
      inputSchema: {
        claimed_by: z.string(),
        limit: z.number().int().positive().max(10).optional(),
      },
    },
    async ({ claimed_by, limit }) =>
      ok({ tasks: s.tasks.claim(ctx.agent ?? claimed_by, limit ?? 1) }),
  )

  server.registerTool(
    'minakata.complete_task',
    {
      description: 'タスクを完了状態にする。LLM コストを cost_usd で渡す',
      inputSchema: { id: z.string(), cost_usd: z.number().nonnegative().optional() },
    },
    async (args) => {
      s.tasks.complete(args.id, args.cost_usd !== undefined ? { cost_usd: args.cost_usd } : {})
      s.audit.log({
        actor: ctx.agent ?? 'agent',
        tool_name: 'minakata.complete_task',
        cost_usd: args.cost_usd ?? 0,
        metadata: { task_id: args.id },
      })
      return ok({ id: args.id, status: 'done' })
    },
  )

  server.registerTool(
    'minakata.fail_task',
    {
      description: 'タスクを失敗扱いにする。指数バックオフで再キュー、3 回超で DLQ',
      inputSchema: { id: z.string(), reason: z.string() },
    },
    async (args) => {
      s.tasks.fail(args.id, args.reason)
      return ok({ id: args.id, requeued: true })
    },
  )
}

export function registerMaintenanceTools(server: McpServer, s: McpServices): void {
  server.registerTool(
    'minakata.snapshot_db',
    {
      description: 'SQLite を VACUUM INTO で別ファイルに退避する',
      inputSchema: { path: z.string() },
    },
    async ({ path }) => ok(s.maintenance.snapshot(path)),
  )

  server.registerTool(
    'minakata.recompute_freshness',
    {
      description: '鮮度ランクを再計算する。Hermes の freshness_checker から呼ぶ',
      inputSchema: {
        aging_h: z.number().positive().default(24),
        stale_h: z.number().positive().default(72),
        very_stale_h: z.number().positive().default(168),
      },
    },
    async (args) =>
      ok(
        s.maintenance.recomputeFreshness({
          aging_h: args.aging_h,
          stale_h: args.stale_h,
          very_stale_h: args.very_stale_h,
        }),
      ),
  )
}

export function registerReviewTools(
  server: McpServer,
  s: McpServices,
  ctx: CallContext = {},
): void {
  server.registerTool(
    'minakata.propose_update',
    {
      description:
        '記事更新の提案。変更率 30% 超なら pending_approval で保留、以下なら直接反映(US-6.1, 6.2)',
      inputSchema: {
        article_id: z.string(),
        proposed_body: z.string(),
        author: z.string().default('agent:researcher'),
        threshold: z.number().min(0).max(1).optional(),
        cost_usd: z.number().nonnegative().optional(),
      },
    },
    async (args) => {
      const r = await s.reviews.proposeUpdate({
        article_id: args.article_id,
        proposed_body: args.proposed_body,
        author: args.author,
        ...(args.threshold !== undefined && { threshold: args.threshold }),
        ...(args.cost_usd !== undefined && { cost_usd: args.cost_usd }),
      })
      s.audit.log({
        actor: ctx.agent ?? args.author,
        tool_name: 'minakata.propose_update',
        target_article_id: args.article_id,
        cost_usd: args.cost_usd ?? 0,
        metadata: { result: r.kind },
      })
      return ok(r)
    },
  )

  server.registerTool(
    'minakata.approve_review',
    {
      description: 'レビューを承認して proposed_body を実反映する',
      inputSchema: { review_id: z.string(), reviewer_id: z.string() },
    },
    async (args) => {
      await s.reviews.approve(args.review_id, args.reviewer_id)
      s.audit.log({
        actor: `user:${args.reviewer_id}`,
        tool_name: 'minakata.approve_review',
        metadata: { review_id: args.review_id },
      })
      return ok({ review_id: args.review_id, status: 'approved' })
    },
  )

  server.registerTool(
    'minakata.reject_review',
    {
      description: 'レビューを差し戻し、revise タスクをキューに投入する',
      inputSchema: {
        review_id: z.string(),
        reviewer_id: z.string(),
        comment: z.string().min(1),
      },
    },
    async (args) => {
      const r = await s.reviews.reject(args.review_id, args.reviewer_id, args.comment)
      s.audit.log({
        actor: `user:${args.reviewer_id}`,
        tool_name: 'minakata.reject_review',
        metadata: { review_id: args.review_id, comment: args.comment },
      })
      return ok({ ...r, status: 'rejected' })
    },
  )

  server.registerTool(
    'minakata.add_review_comment',
    {
      description: 'レビューに行コメントを追加する',
      inputSchema: {
        review_id: z.string(),
        author_id: z.string(),
        body: z.string().min(1),
        line_anchor: z.string().optional(),
      },
    },
    async (args) => {
      const id = s.reviews.addComment({
        review_id: args.review_id,
        author_id: args.author_id,
        body: args.body,
        line_anchor: args.line_anchor ?? null,
      })
      return ok({ id })
    },
  )

  server.registerTool(
    'minakata.list_pending_reviews',
    {
      description: '承認待ちのレビュー一覧を返す',
      inputSchema: {},
    },
    async () => ok({ reviews: s.reviews.listPending() }),
  )
}

export function registerPolicyTools(
  server: McpServer,
  s: McpServices,
  ctx: CallContext = {},
): void {
  server.registerTool(
    'minakata.get_research_policy',
    {
      description: 'チーム共通のリサーチ方針 Markdown を返す。Hermes は system prompt に挿入する',
      inputSchema: {},
    },
    async () => ok(s.policy.get()),
  )

  server.registerTool(
    'minakata.update_research_policy',
    {
      description: 'リサーチ方針を更新する(admin 専用想定)',
      inputSchema: { body_md: z.string(), updated_by: z.string() },
    },
    async (args) => {
      s.policy.update(args.body_md, args.updated_by)
      s.audit.log({
        actor: ctx.agent ?? `user:${args.updated_by}`,
        tool_name: 'minakata.update_research_policy',
        metadata: { length: args.body_md.length },
      })
      return ok({ ok: true })
    },
  )
}

export function registerCommentTools(server: McpServer, s: McpServices): void {
  server.registerTool(
    'minakata.add_article_comment',
    {
      description: '記事にコメントを付ける。差し込み位置の anchor 文字列はクライアント解釈',
      inputSchema: {
        article_id: z.string(),
        author_id: z.string(),
        body: z.string().min(1),
        anchor: z.string().optional(),
      },
    },
    async (args) => {
      const id = s.comments.add({
        article_id: args.article_id,
        author_id: args.author_id,
        body: args.body,
        anchor: args.anchor ?? null,
      })
      return ok({ id })
    },
  )

  server.registerTool(
    'minakata.list_article_comments',
    {
      description: '記事に紐づくコメント一覧',
      inputSchema: { article_id: z.string() },
    },
    async ({ article_id }) => ok({ comments: s.comments.listByArticle(article_id) }),
  )

  server.registerTool(
    'minakata.resolve_article_comment',
    {
      description: 'コメントを解決済みにする',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      s.comments.resolve(id)
      return ok({ id, status: 'resolved' })
    },
  )
}

export function registerSkillTools(server: McpServer, s: McpServices, ctx: CallContext = {}): void {
  server.registerTool(
    'minakata.propose_skill',
    {
      description: 'スキル化の提案。admin が承認するとファイルとして書き出される(US-8.1)',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .regex(/^[a-z][a-z0-9_-]*$/, '英小文字・数字・ハイフン・アンダースコアのみ'),
        description: z.string().min(1),
        code: z.string().min(1),
      },
    },
    async (args) => {
      const id = s.skills.propose(args)
      s.audit.log({
        actor: ctx.agent ?? 'agent:skill_proposer',
        tool_name: 'minakata.propose_skill',
        metadata: { name: args.name },
      })
      return ok({ id, status: 'proposed' })
    },
  )

  server.registerTool(
    'minakata.approve_skill',
    {
      description: 'スキル提案を承認し、SKILL.md を書き出す',
      inputSchema: { id: z.string(), reviewer_id: z.string() },
    },
    async (args) => {
      const r = s.skills.approve(args.id, args.reviewer_id)
      s.audit.log({
        actor: `user:${args.reviewer_id}`,
        tool_name: 'minakata.approve_skill',
        metadata: { id: args.id, ...r },
      })
      return ok({ id: args.id, ...r })
    },
  )

  server.registerTool(
    'minakata.reject_skill',
    {
      description: 'スキル提案を却下',
      inputSchema: { id: z.string(), reviewer_id: z.string() },
    },
    async (args) => {
      s.skills.reject(args.id, args.reviewer_id)
      s.audit.log({
        actor: `user:${args.reviewer_id}`,
        tool_name: 'minakata.reject_skill',
        metadata: { id: args.id },
      })
      return ok({ id: args.id, status: 'rejected' })
    },
  )

  server.registerTool(
    'minakata.list_skill_proposals',
    {
      description: 'スキル提案一覧',
      inputSchema: { status: z.enum(['proposed', 'approved', 'rejected']).optional() },
    },
    async (args) => ok({ proposals: s.skills.list(args.status) }),
  )
}

export function registerAllTools(
  server: McpServer,
  services: McpServices,
  ctx: CallContext = {},
): void {
  registerArticleTools(server, services, ctx)
  registerSearchTools(server, services)
  registerMessageTools(server, services, ctx)
  registerTaskTools(server, services, ctx)
  registerMaintenanceTools(server, services)
  registerReviewTools(server, services, ctx)
  registerPolicyTools(server, services, ctx)
  registerCommentTools(server, services)
  registerSkillTools(server, services, ctx)
}
