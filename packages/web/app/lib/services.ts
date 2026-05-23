/**
 * core サービス群の singleton。Hono サーバープロセス内で 1 つだけ保持する。
 * loader / action はここから `getServices()` で取得。
 */
import {
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
  maintenance: MaintenanceService
  embedding: EmbeddingService
  reviews: ReviewService
  policy: PolicyService
  comments: CommentService
  skills: SkillProposalService
  archives: ArchiveProposalService
}

let cached: Services | null = null

export function getServices(): Services {
  if (cached) return cached
  const dbPath = process.env.DATABASE_URL?.replace(/^file:/, '') ?? './data/minakata.db'
  const articlesRoot = process.env.ARTICLES_ROOT ?? './data/articles'
  const skillsDir = process.env.SKILLS_DIR ?? './hermes/skills'
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
    maintenance: new MaintenanceService(db),
    embedding,
    reviews: new ReviewService(db, articles, tasks),
    policy: new PolicyService(db),
    comments: new CommentService(db),
    skills: new SkillProposalService(db, skillsDir),
    archives: new ArchiveProposalService(db, articles),
  }
  return cached
}
