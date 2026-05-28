import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('login', 'routes/login.tsx'),
  route('logout', 'routes/logout.tsx'),
  route('setup', 'routes/setup.tsx'),
  route('invitations/:token', 'routes/invitation.tsx'),
  route('articles/:slug', 'routes/article.tsx'),
  route('search', 'routes/search.tsx'),
  route('topics', 'routes/topics.tsx'),
  route('chats', 'routes/chats.tsx'),
  route('chat/:sessionId', 'routes/chat.tsx'),
  route('chat/:sessionId/stream', 'routes/chat-stream.tsx'),
  route('settings/members', 'routes/members.tsx'),
  route('reviews', 'routes/reviews.tsx'),
  route('reviews/:reviewId', 'routes/review.tsx'),
  route('settings/policy', 'routes/policy.tsx'),
  route('admin/skills', 'routes/skills.tsx'),
  route('admin/archives', 'routes/archives.tsx'),
] satisfies RouteConfig
