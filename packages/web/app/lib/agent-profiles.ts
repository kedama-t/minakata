// モニター画面用のエージェント人格カタログ。
// 既知のエージェント (hermes/skills/*) ごとに、表示名・絵文字・グラデーション・役割を持つ。

export type AgentProfile = {
  /** audit_log.agent_name の素の値 */
  key: string
  emoji: string
  displayName: string
  role: string
  /** 任意のアイコンURL。なければ絵文字のみで表現する */
  avatar?: string
  /** Tailwind の bg-gradient-to-br 用クラス。例: "from-teal-400 to-teal-600" */
  gradient: string
  /** バッジ等で使う薄色 */
  tintBg: string
  tintText: string
}

const KNOWN_PROFILES: Record<string, AgentProfile> = {
  dialogue: {
    key: 'dialogue',
    emoji: '💬',
    displayName: 'ミミー',
    role: '対話エージェント：ユーザーとのチャットに応えます',
    gradient: 'from-rose-400 to-pink-400',
    avatar: 'agents/mimy.png',
    tintBg: 'bg-rose-50 dark:bg-rose-500/15',
    tintText: 'text-rose-700 dark:text-rose-300',
  },
  researcher: {
    key: 'researcher',
    emoji: '🔎',
    displayName: 'リズ',
    role: 'リサーチエージェント：タスクをこなして記事を書き足します',
    avatar: 'agents/lyz.png',
    gradient: 'from-teal-400 to-teal-600',
    tintBg: 'bg-teal-50 dark:bg-teal-500/15',
    tintText: 'text-teal-700 dark:text-teal-300',
  },
  daily_research: {
    key: 'daily_research',
    emoji: '🌅',
    displayName: 'ヨナ',
    role: '夜中に飛び回って新しい話題を集めてきます',
    avatar: 'agents/yona.png',
    gradient: 'from-amber-400 to-orange-500',
    tintBg: 'bg-amber-50 dark:bg-amber-500/15',
    tintText: 'text-amber-700 dark:text-amber-300',
  },
  freshness_checker: {
    key: 'freshness_checker',
    emoji: '🍃',
    displayName: 'セン',
    role: '記事の鮮度管理：記事の鮮度を見守ります',
    avatar: 'agents/sen.png',
    gradient: 'from-emerald-400 to-teal-500',
    tintBg: 'bg-emerald-50 dark:bg-emerald-500/15',
    tintText: 'text-emerald-700 dark:text-emerald-300',
  },
  changelog_writer: {
    key: 'changelog_writer',
    emoji: '📝',
    displayName: 'チロ',
    role: '日々の出来事を ChangeLog にまとめます',
    avatar: 'agents/chiro.png',
    gradient: 'from-yellow-400 to-amber-500',
    tintBg: 'bg-yellow-50 dark:bg-yellow-500/15',
    tintText: 'text-yellow-700 dark:text-yellow-300',
  },
}

const HERMES_PROFILE: AgentProfile = {
  key: 'hermes',
  emoji: '🛰️',
  displayName: 'Hermes',
  role: 'エージェントハーネス本体',
  gradient: 'from-neutral/60 to-neutral',
  tintBg: 'bg-neutral/10',
  tintText: 'text-neutral-content',
}

export const SYSTEM_PROFILE: AgentProfile = {
  key: 'system',
  emoji: '⚙️',
  displayName: 'システム',
  role: 'システム自動処理',
  avatar: 'agents/system.png',
  gradient: 'from-neutral/60 to-neutral',
  tintBg: 'bg-neutral/10',
  tintText: 'text-neutral-content',
}

const FALLBACK_GRADIENTS = [
  'from-rose-400 to-red-500',
  'from-teal-300 to-teal-500',
  'from-lime-400 to-green-500',
  'from-violet-400 to-fuchsia-500',
  'from-stone-400 to-stone-600',
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * agent_name / actor から表示用プロフィールを得る。
 * 未登録エージェントには名前ハッシュからグラデーションを決定論的に割り当てる。
 */
export function getAgentProfile(agentName: string | null | undefined): AgentProfile {
  if (!agentName) return HERMES_PROFILE
  if (KNOWN_PROFILES[agentName]) return KNOWN_PROFILES[agentName]
  if (agentName === 'hermes' || agentName.startsWith('hermes')) return HERMES_PROFILE
  const idx = hashStr(agentName) % FALLBACK_GRADIENTS.length
  const gradient = FALLBACK_GRADIENTS[idx] ?? 'from-neutral/60 to-neutral'
  return {
    key: agentName,
    emoji: '✨',
    displayName: agentName,
    role: '稼働中のエージェント',
    gradient,
    tintBg: 'bg-neutral/10',
    tintText: 'text-neutral-content',
  }
}

/**
 * actor 文字列(`user:xxx` / `agent:xxx` / `hermes` / `system` 等)から
 * モニター表示用のプロフィールを返す。actor が agent でない場合(user/system)は専用扱い。
 */
export function getActorProfile(actor: string, agentName: string | null | undefined): AgentProfile {
  if (agentName) return getAgentProfile(agentName)
  if (actor.startsWith('user:')) {
    return {
      key: actor,
      emoji: '🙂',
      displayName: actor.slice('user:'.length) || 'ユーザー',
      role: '人間のユーザー',
      gradient: 'from-neutral/40 to-neutral/70',
      tintBg: 'bg-neutral/10',
      tintText: 'text-neutral-content',
    }
  }
  if (actor === 'system') {
    return {
      key: 'system',
      emoji: '⚙️',
      displayName: 'system',
      role: 'システム自動処理',
      gradient: 'from-neutral/60 to-neutral',
      tintBg: 'bg-neutral/10',
      tintText: 'text-neutral-content',
    }
  }
  return getAgentProfile(actor.replace(/^agent:/, '') || null)
}

// ─── ツール名 → 自然文/カテゴリ ──────────────────────────────────────────

export type ToolCategory =
  | 'read'
  | 'write'
  | 'archive'
  | 'approve'
  | 'reject'
  | 'task'
  | 'message'
  | 'policy'
  | 'system'

const CATEGORY_STYLE: Record<ToolCategory, { bg: string; text: string; icon: string }> = {
  read: {
    bg: 'bg-neutral/10',
    text: 'text-neutral-content',
    icon: '👀',
  },
  write: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    icon: '✏️',
  },
  archive: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    icon: '📦',
  },
  approve: {
    bg: 'bg-success/10',
    text: 'text-success',
    icon: '✅',
  },
  reject: {
    bg: 'bg-error/10',
    text: 'text-error',
    icon: '↩️',
  },
  task: {
    bg: 'bg-secondary/10',
    text: 'text-secondary',
    icon: '📋',
  },
  message: {
    bg: 'bg-accent/10',
    text: 'text-accent',
    icon: '💌',
  },
  policy: {
    bg: 'bg-info/10',
    text: 'text-info',
    icon: '⚙️',
  },
  system: {
    bg: 'bg-neutral/10',
    text: 'text-neutral-content',
    icon: '🔧',
  },
}

const TOOL_DICT: Record<string, { phrase: string; category: ToolCategory }> = {
  'minakata.read_article': { phrase: '記事を読み込みました', category: 'read' },
  'minakata.list_articles': { phrase: '記事一覧を確認しました', category: 'read' },
  'minakata.fulltext_search': { phrase: 'ナレッジを検索しました', category: 'read' },
  'minakata.by_tag': { phrase: 'タグから記事を探しました', category: 'read' },
  'minakata.similar_articles': { phrase: '関連する記事を探しました', category: 'read' },
  'minakata.list_article_comments': { phrase: 'コメントを確認しました', category: 'read' },
  'minakata.list_archive_proposals': {
    phrase: 'アーカイブ提案を確認しました',
    category: 'read',
  },
  'minakata.list_pending_reviews': {
    phrase: '保留中のレビューを確認しました',
    category: 'read',
  },
  'minakata.list_skill_proposals': { phrase: 'スキル提案を確認しました', category: 'read' },
  'minakata.get_research_policy': { phrase: 'リサーチ方針を確認しました', category: 'read' },

  'minakata.create_article': { phrase: '新しい記事を書きました', category: 'write' },
  'minakata.update_article': { phrase: '記事を更新しました', category: 'write' },
  'minakata.propose_update': { phrase: '更新案を提案しました', category: 'write' },
  'minakata.add_article_comment': { phrase: '記事にコメントを残しました', category: 'write' },
  'minakata.add_review_comment': { phrase: 'レビューにコメントしました', category: 'write' },
  'minakata.propose_skill': { phrase: '新しいスキルを提案しました', category: 'write' },

  'minakata.archive_article': { phrase: 'アーカイブに送りました', category: 'archive' },
  'minakata.unarchive_article': { phrase: 'アーカイブから戻しました', category: 'archive' },

  'minakata.approve_archive': { phrase: 'アーカイブを承認しました', category: 'approve' },
  'minakata.approve_review': { phrase: 'レビューを承認しました', category: 'approve' },
  'minakata.approve_skill': { phrase: 'スキルを承認しました', category: 'approve' },
  'minakata.resolve_article_comment': {
    phrase: 'コメントを解決しました',
    category: 'approve',
  },

  'minakata.reject_archive': { phrase: 'アーカイブを差し戻しました', category: 'reject' },
  'minakata.reject_review': { phrase: 'レビューを差し戻しました', category: 'reject' },
  'minakata.reject_skill': { phrase: 'スキル提案を却下しました', category: 'reject' },

  'minakata.enqueue_task': { phrase: 'タスクをキューに追加しました', category: 'task' },
  'minakata.poll_tasks': { phrase: 'タスクを取りに行きました', category: 'task' },
  'minakata.complete_task': { phrase: 'タスクを完了しました', category: 'task' },
  'minakata.fail_task': { phrase: 'タスクでつまずきました', category: 'task' },

  'minakata.poll_messages': { phrase: '新着メッセージを確認しました', category: 'message' },
  'minakata.claim_message': { phrase: 'メッセージを受け取りました', category: 'message' },
  'minakata.post_agent_response': { phrase: 'お返事を投稿しました', category: 'message' },
  'minakata.report_progress': { phrase: '近況を報告しました', category: 'message' },

  'minakata.update_research_policy': {
    phrase: 'リサーチ方針を更新しました',
    category: 'policy',
  },
  'minakata.recompute_freshness': { phrase: '鮮度を計算し直しました', category: 'policy' },
  'minakata.snapshot_db': { phrase: 'DB をバックアップしました', category: 'system' },
}

export function describeTool(toolName: string): {
  phrase: string
  category: ToolCategory
  icon: string
  bgClass: string
  textClass: string
} {
  const entry = TOOL_DICT[toolName]
  const category: ToolCategory = entry?.category ?? 'system'
  const style = CATEGORY_STYLE[category]
  return {
    phrase: entry?.phrase ?? `${toolName.replace(/^minakata\./, '')} を実行しました`,
    category,
    icon: style.icon,
    bgClass: style.bg,
    textClass: style.text,
  }
}

/** ISO 8601 timestamp → "5分前" の相対表現 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime()
  const diff = now.getTime() - t
  if (diff < 0) return '少し未来'
  const sec = Math.floor(diff / 1000)
  if (sec < 5) return 'たった今'
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 時間前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 日前`
  return new Date(iso).toLocaleDateString('ja-JP')
}
