import BoringAvatar from 'boring-avatars'
import { useState } from 'react'
import type { AgentProfile } from '../../lib/agent-profiles.ts'

const SIZE_PX: Record<'sm' | 'md' | 'lg', number> = { sm: 40, md: 72, lg: 96 }

/** ユーザーアバター。boring-avatars の beam を使用 */
export function UserAvatar({
  email,
  size = 'md',
}: {
  email: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const px = SIZE_PX[size]
  return (
    <div className="rounded-full overflow-hidden shrink-0" style={{ width: px, height: px }}>
      <BoringAvatar size={px} name={email} variant="beam" />
    </div>
  )
}

/** エージェントアバター。画像読み込み失敗時は絵文字にフォールバック */
export function Avatar({
  profile,
  size = 'md',
}: {
  profile: AgentProfile
  size?: 'sm' | 'md' | 'lg'
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const dim =
    size === 'lg' ? 'w-24 h-24 text-2xl' : size === 'sm' ? 'w-12 h-12 text-sm' : 'w-18 h-18 text-lg'
  return (
    <div
      className={`${dim} rounded-full ${profile.ring ?? 'ring-base-300'} ring-2 flex items-center justify-center shadow-sm shrink-0 overflow-hidden bg-base-200`}
      title={profile.displayName}
      aria-label={profile.displayName}
    >
      {profile.avatar && !imgFailed ? (
        <img
          src={profile.avatar}
          alt={profile.displayName}
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span>{profile.emoji}</span>
      )}
    </div>
  )
}
