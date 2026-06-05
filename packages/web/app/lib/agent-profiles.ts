// モニター画面用のエージェント人格カタログ。
// 既知のエージェント (hermes/skills/*) ごとに、表示名・絵文字・グラデーション・役割を持つ。
// エージェントを追加するときは core/src/schema/index.ts の AgentNameSchema にも追加すること。
// AgentName 型で型付けしているため、片方が漏れるとコンパイルエラーになる。

import type { AgentName } from '@minakata/core'

export type AgentProfile = {
  /** audit_log.agent_name の素の値 */
  key: string
  emoji: string
  displayName: string
  role: string
  /** 任意のアイコンURL。なければ絵文字のみで表現する */
  avatar?: string
  ring?: string
}

/** AgentName 全種のプロファイル。AgentNameSchema と型レベルで同期される */
const PROFILES: Record<AgentName, AgentProfile> = {
  dialogue: {
    key: 'dialogue',
    emoji: '💬',
    displayName: 'ミミー',
    role: '対話担当：ユーザーとのチャットに応えます',
    ring: 'ring-fuchsia-400',
    avatar: '/agents/mimy.png',
  },
  researcher: {
    key: 'researcher',
    emoji: '🔎',
    displayName: 'リズ',
    role: 'リサーチ担当：タスクをこなして記事を書き足します',
    avatar: '/agents/lyz.png',
    ring: 'ring-sky-400',
  },
  daily_research: {
    key: 'daily_research',
    emoji: '🌅',
    displayName: 'ヨナ',
    role: '日次調査：夜中に飛び回って新しい話題を集めてきます',
    avatar: '/agents/yona.png',
    ring: 'ring-amber-900',
  },
  freshness_checker: {
    key: 'freshness_checker',
    emoji: '🍃',
    displayName: 'セン',
    role: '記事の鮮度管理：記事の鮮度を見守ります',
    avatar: '/agents/sen.png',
    ring: 'ring-emerald-400',
  },
  changelog_writer: {
    key: 'changelog_writer',
    emoji: '📝',
    displayName: 'チロ',
    role: 'ChangeLog担当：日々の出来事をまとめます',
    avatar: '/agents/chiro.png',
    ring: 'ring-yellow-400',
  },
  synthesizer: {
    key: 'synthesizer',
    emoji: '🔮',
    displayName: 'トーゴ',
    role: '体系化担当：類似記事を統合して上位概念の記事を生成します',
    avatar: '/agents/togo.png',
    ring: 'ring-violet-400',
  },
  gap_detector: {
    key: 'gap_detector',
    emoji: '🕳️',
    displayName: 'ガプ',
    role: 'ギャップ検出：知識の穴を見つけて調査タスクを投入します',
    avatar: '/agents/gap.png',
    ring: 'ring-orange-400',
  },
  taxonomy_builder: {
    key: 'taxonomy_builder',
    emoji: '📂',
    displayName: 'ケイト',
    role: '分類整理：タグ・カテゴリ体系を自動で整備します',
    avatar: '/agents/kate.png',
    ring: 'ring-teal-400',
  },
  hermes: {
    key: 'hermes',
    emoji: '🛰️',
    displayName: 'Hermes',
    role: 'エージェントハーネス本体',
    ring: 'ring-blue-400',
  },
  system: {
    key: 'system',
    emoji: '⚙️',
    displayName: 'Q',
    role: 'システムによる自動処理',
    avatar: '/agents/q.png',
    ring: 'ring-slate-400',
  },
}

export const SYSTEM_PROFILE: AgentProfile = PROFILES.system

/**
 * agent_name / actor から表示用プロフィールを得る。
 * 未登録エージェントにはフォールバックプロファイルを返す。
 */
export function getAgentProfile(agentName: string | null | undefined): AgentProfile {
  if (!agentName || agentName.startsWith('hermes')) return PROFILES.hermes
  return (
    (PROFILES as Record<string, AgentProfile>)[agentName] ?? {
      key: agentName,
      emoji: '✨',
      displayName: agentName,
      role: '稼働中のエージェント',
      ring: 'ring-slate-400',
    }
  )
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
  'minakata.list_tags': { phrase: 'タグ一覧を確認しました', category: 'read' },
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
export function relativeTime(iso: string, now: Date = new Date(), tz = 'Asia/Tokyo'): string {
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
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: tz })
}
