/**
 * core サービス群の singleton。Hono サーバープロセス内で 1 つだけ保持する。
 * loader / action はここから `getServices()` で取得。
 */
import {
  ActivityService,
  ArchiveProposalService,
  ArticleService,
  AuditService,
  AuthService,
  BackupService,
  CommentService,
  type Db,
  DocumentService,
  EmbeddingService,
  FeedbackService,
  GitService,
  MaintenanceService,
  MessageService,
  PolicyService,
  ReviewService,
  SearchService,
  SkillProposalService,
  TaskService,
  TopicService,
  openDb,
} from '@minakata/core'

export interface Services {
  db: Db
  articles: ArticleService
  search: SearchService
  messages: MessageService
  tasks: TaskService
  auth: AuthService
  audit: AuditService
  activity: ActivityService
  maintenance: MaintenanceService
  backup: BackupService
  embedding: EmbeddingService
  reviews: ReviewService
  policy: PolicyService
  comments: CommentService
  feedback: FeedbackService
  skills: SkillProposalService
  archives: ArchiveProposalService
  topics: TopicService
  documents: DocumentService
}

let cached: Services | null = null

export function getServices(): Services {
  if (cached) return cached
  const dbPath = process.env.DATABASE_URL?.replace(/^file:/, '') ?? './data/minakata.db'
  const articlesRoot = process.env.ARTICLES_ROOT ?? './data/articles'
  // 承認スキルは git 管理される正本に書き出す(#187)。実行時 hermes/skills/
  // は gitignore され Hermes が curator で自律編集するため、承認スキルは正本へ。
  const skillsDir = process.env.SKILLS_DIR ?? './hermes-skills'
  const snapshotDir = process.env.SNAPSHOT_DIR ?? './data/snapshots'
  // 定期バックアップ: data/ 配下の専用 git repo に集約し、設定があれば GitHub へ push
  const backupDir = process.env.BACKUP_DIR ?? './data/backup'
  const backupRemote = process.env.BACKUP_GIT_REMOTE
  const backupToken = process.env.BACKUP_GIT_TOKEN
  const runtimeSkillsDir = process.env.RUNTIME_SKILLS_DIR
  // アップロード資料(raw + 抽出 Markdown)の保存先(#239)
  const documentsRoot = process.env.DOCUMENTS_ROOT ?? './data/documents'
  const db = openDb({ path: dbPath })
  const git = new GitService(articlesRoot)
  const embedding = new EmbeddingService()
  const articles = new ArticleService(db, articlesRoot, git, embedding)
  const tasks = new TaskService(db)
  cached = {
    db,
    articles,
    search: new SearchService(db),
    messages: new MessageService(db),
    tasks,
    auth: new AuthService(db),
    audit: new AuditService(db),
    activity: new ActivityService(db),
    maintenance: new MaintenanceService(db, snapshotDir),
    backup: new BackupService(db, {
      backupDir,
      articlesRoot,
      documentsRoot,
      ...(runtimeSkillsDir ? { runtimeSkillsDir } : {}),
      ...(backupRemote ? { remote: backupRemote } : {}),
      ...(backupToken ? { token: backupToken } : {}),
    }),
    embedding,
    reviews: new ReviewService(db, articles, tasks),
    policy: new PolicyService(db),
    comments: new CommentService(db),
    feedback: new FeedbackService(db),
    skills: new SkillProposalService(db, skillsDir),
    archives: new ArchiveProposalService(db, articles),
    topics: new TopicService(db),
    documents: new DocumentService(db, documentsRoot),
  }
  return cached
}
