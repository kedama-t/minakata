import type {
  ActivityService,
  ArchiveProposalService,
  ArticleService,
  AuditService,
  CommentService,
  MaintenanceService,
  MessageService,
  PolicyService,
  ReviewService,
  SearchService,
  SkillProposalService,
  TaskService,
} from '@minakata/core'

/**
 * MCP ツールが必要とする core サービス一式。
 * テスト時はモック / インメモリ DB 接続の実装を差し込める。
 */
export interface McpServices {
  articles: ArticleService
  search: SearchService
  messages: MessageService
  tasks: TaskService
  audit: AuditService
  activity: ActivityService
  maintenance: MaintenanceService
  reviews: ReviewService
  policy: PolicyService
  comments: CommentService
  skills: SkillProposalService
  archives: ArchiveProposalService
}
