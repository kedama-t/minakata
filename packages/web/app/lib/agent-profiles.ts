// モニター画面用のエージェント人格カタログ。
// 既知のエージェント (hermes/skills/*) ごとに、絵文字・グラデーション・アイコンを持つ。
// 表示名・役割の文言は i18n 辞書 (app/i18n/locales/*) 側で管理する。
// エージェントを追加するときは core/src/schema/index.ts の AgentNameSchema と
// 各言語辞書の agents.profiles にも追加すること(型レベルで同期される)。

import type { AgentName } from '@minakata/core'
import type { Dict } from '../i18n/index.ts'

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

type AgentVisual = Omit<AgentProfile, 'displayName' | 'role'>

/** AgentName 全種の見た目情報。AgentNameSchema と型レベルで同期される */
const VISUALS: Record<AgentName, AgentVisual> = {
  dialogue: {
    key: 'dialogue',
    emoji: '💬',
    ring: 'ring-fuchsia-400',
    avatar: '/agents/mimy.png',
  },
  researcher: {
    key: 'researcher',
    emoji: '🔎',
    avatar: '/agents/lyz.png',
    ring: 'ring-sky-400',
  },
  daily_research: {
    key: 'daily_research',
    emoji: '🌅',
    avatar: '/agents/yona.png',
    ring: 'ring-amber-900',
  },
  freshness_checker: {
    key: 'freshness_checker',
    emoji: '🍃',
    avatar: '/agents/sen.png',
    ring: 'ring-emerald-400',
  },
  changelog_writer: {
    key: 'changelog_writer',
    emoji: '📝',
    avatar: '/agents/chiro.png',
    ring: 'ring-yellow-400',
  },
  synthesizer: {
    key: 'synthesizer',
    emoji: '🔮',
    avatar: '/agents/togo.png',
    ring: 'ring-violet-400',
  },
  gap_detector: {
    key: 'gap_detector',
    emoji: '🕳️',
    avatar: '/agents/gap.png',
    ring: 'ring-orange-400',
  },
  taxonomy_builder: {
    key: 'taxonomy_builder',
    emoji: '📂',
    avatar: '/agents/kate.png',
    ring: 'ring-teal-400',
  },
  feedback_analyst: {
    key: 'feedback_analyst',
    emoji: '💗',
    avatar: '/agents/licca.png',
    ring: 'ring-rose-400',
  },
  backup_agent: {
    key: 'backup_agent',
    emoji: '🗄️',
    avatar: '/agents/clara.png',
    ring: 'ring-indigo-400',
  },
  reviser: {
    key: 'reviser',
    emoji: '🖊️',
    avatar: '/agents/noel.png',
    ring: 'ring-lime-400',
  },
  hermes: {
    key: 'hermes',
    emoji: '🛰️',
    ring: 'ring-blue-400',
  },
  system: {
    key: 'system',
    emoji: '⚙️',
    avatar: '/agents/q.png',
    ring: 'ring-slate-400',
  },
}

/** 監査ログ(システム操作)を表す actor キー */
export const SYSTEM_KEY: AgentName = 'system'

function buildProfile(name: AgentName, t: Dict): AgentProfile {
  const text = t.agents.profiles[name]
  return { ...VISUALS[name], displayName: text.name, role: text.role }
}

export function getSystemProfile(t: Dict): AgentProfile {
  return buildProfile('system', t)
}

/**
 * agent_name / actor から表示用プロフィールを得る。
 * 未登録エージェントにはフォールバックプロファイルを返す。
 */
export function getAgentProfile(agentName: string | null | undefined, t: Dict): AgentProfile {
  if (!agentName || agentName.startsWith('hermes')) return buildProfile('hermes', t)
  if (agentName in VISUALS) return buildProfile(agentName as AgentName, t)
  return {
    key: agentName,
    emoji: '✨',
    displayName: agentName,
    role: t.agents.fallbackRole,
    ring: 'ring-slate-400',
  }
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
    text: 'text-neutral',
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
    text: 'text-neutral',
    icon: '🔧',
  },
}

/** ツール名 → カテゴリ。表示フレーズは辞書 (tools.phrases) 側で管理する */
const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  'minakata.read_article': 'read',
  'minakata.list_articles': 'read',
  'minakata.fulltext_search': 'read',
  'minakata.by_tag': 'read',
  'minakata.similar_articles': 'read',
  'minakata.list_tags': 'read',
  'minakata.list_article_comments': 'read',
  'minakata.list_archive_proposals': 'read',
  'minakata.list_pending_reviews': 'read',
  'minakata.list_skill_proposals': 'read',
  'minakata.get_research_policy': 'read',
  'minakata.create_article': 'write',
  'minakata.update_article': 'write',
  'minakata.propose_update': 'write',
  'minakata.add_article_comment': 'write',
  'minakata.add_review_comment': 'write',
  'minakata.propose_skill': 'write',
  'minakata.archive_article': 'archive',
  'minakata.unarchive_article': 'archive',
  'minakata.approve_archive': 'approve',
  'minakata.approve_review': 'approve',
  'minakata.approve_skill': 'approve',
  'minakata.resolve_article_comment': 'approve',
  'minakata.reject_archive': 'reject',
  'minakata.reject_review': 'reject',
  'minakata.reject_skill': 'reject',
  'minakata.enqueue_task': 'task',
  'minakata.poll_tasks': 'task',
  'minakata.complete_task': 'task',
  'minakata.fail_task': 'task',
  'minakata.poll_messages': 'message',
  'minakata.claim_message': 'message',
  'minakata.post_agent_response': 'message',
  'minakata.report_progress': 'message',
  'minakata.update_research_policy': 'policy',
  'minakata.recompute_freshness': 'policy',
  'minakata.get_feedback_signals': 'read',
  'minakata.get_feedback_insights': 'read',
  'minakata.update_feedback_insights': 'policy',
  'minakata.snapshot_db': 'system',
  'minakata.backup': 'system',
  'web.archive_article': 'archive',
  'web.approve_archive': 'approve',
  'web.reject_archive': 'reject',
  'web.unarchive_article': 'archive',
  'web.approve_review': 'approve',
  'web.reject_review': 'reject',
  'web.approve_skill': 'approve',
  'web.reject_skill': 'reject',
  'web.update_role': 'policy',
}

export function describeTool(
  toolName: string,
  t: Dict,
): {
  phrase: string
  category: ToolCategory
  icon: string
  bgClass: string
  textClass: string
} {
  const category: ToolCategory = TOOL_CATEGORIES[toolName] ?? 'system'
  const style = CATEGORY_STYLE[category]
  const phrase = (t.tools.phrases as Record<string, string>)[toolName]
  return {
    phrase: phrase ?? t.tools.fallback(toolName.replace(/^minakata\./, '')),
    category,
    icon: style.icon,
    bgClass: style.bg,
    textClass: style.text,
  }
}

/**
 * 実況 phase が「ターンの終了」を表すか判定する。
 * 完了 / 終了 / スキップ を含む phase は、エージェントがそのターンを終えた合図。
 * phase はエージェントが日本語で報告する文字列のため、判定語は辞書化しない。
 */
export function isPhaseTerminal(phase: string): boolean {
  return /完了|終了|スキップ/.test(phase)
}

/** ISO 8601 timestamp → "5分前" / "5m ago" の相対表現 */
export function relativeTime(
  iso: string,
  t: Dict,
  now: Date = new Date(),
  tz = 'Asia/Tokyo',
): string {
  const time = new Date(iso).getTime()
  const diff = now.getTime() - time
  if (diff < 0) return t.time.future
  const sec = Math.floor(diff / 1000)
  if (sec < 5) return t.time.justNow
  if (sec < 60) return t.time.secondsAgo(sec)
  const min = Math.floor(sec / 60)
  if (min < 60) return t.time.minutesAgo(min)
  const hr = Math.floor(min / 60)
  if (hr < 24) return t.time.hoursAgo(hr)
  const day = Math.floor(hr / 24)
  if (day < 30) return t.time.daysAgo(day)
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: tz })
}
