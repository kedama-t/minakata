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
  CommentService,
  type Db,
  EmbeddingService,
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
  embedding: EmbeddingService
  reviews: ReviewService
  policy: PolicyService
  comments: CommentService
  skills: SkillProposalService
  archives: ArchiveProposalService
  topics: TopicService
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
    embedding,
    reviews: new ReviewService(db, articles, tasks),
    policy: new PolicyService(db),
    comments: new CommentService(db),
    skills: new SkillProposalService(db, skillsDir),
    archives: new ArchiveProposalService(db, articles),
    topics: new TopicService(db),
  }
  return cached
}
