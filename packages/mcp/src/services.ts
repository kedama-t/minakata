import type {
  ActivityService,
  ArchiveProposalService,
  ArticleService,
  AuditService,
  BackupService,
  CommentService,
  FeedbackService,
  MaintenanceService,
  MessageService,
  PolicyService,
  ReviewService,
  SearchService,
  SkillProposalService,
  TaskService,
  TopicService,
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
  backup: BackupService
  reviews: ReviewService
  policy: PolicyService
  comments: CommentService
  feedback: FeedbackService
  skills: SkillProposalService
  archives: ArchiveProposalService
  topics: TopicService
}
