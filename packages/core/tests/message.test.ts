import { describe, expect, test } from 'bun:test'
import { AuthService } from '../src/auth/index.ts'
import { openTestDb } from '../src/db/index.ts'
import { MessageService } from '../src/message/index.ts'

describe('MessageService', () => {
  test('post → poll → subscribe で agent 応答を受け取る', async () => {
    const db = openTestDb()
    const auth = new AuthService(db)
    const messages = new MessageService(db)
    const user = await auth.createAdminInitial('a@x', 'p')
    const session = messages.createSession({ user_id: user.id })
    const userMsg = messages.postUser(session.id, '調べて')
    const polled = messages.pollUserMessages()
    expect(polled.length).toBe(1)
    expect(polled[0]?.content).toBe('調べて')

    // subscribe で agent 応答を受け取る
    const received: string[] = []
    const ctrl = new AbortController()
    const iter = messages.subscribe(session.id, ctrl.signal)[Symbol.asyncIterator]()
    const collect = (async () => {
      while (true) {
        const r = await iter.next()
        if (r.done) return
        received.push(r.value.content)
        if (r.value.is_final) return
      }
    })()
    messages.postAgentResponse({ session_id: session.id, content: 'こんにちは', is_final: false })
    messages.postAgentResponse({ session_id: session.id, content: 'です', is_final: true })
    await collect
    expect(received).toEqual(['こんにちは', 'です'])
    expect(userMsg.role).toBe('user')
    db.close()
  })

  test('listSessionsByUser で kind / ページング / 末尾抜粋を取得できる', async () => {
    const db = openTestDb()
    const auth = new AuthService(db)
    const messages = new MessageService(db)
    const user = await auth.createAdminInitial('b@x', 'p')
    const tick = () => new Promise<void>((r) => setTimeout(r, 3))

    const s1 = messages.createSession({ user_id: user.id, title: 's1' })
    messages.postUser(s1.id, '最初のメッセージ')
    await tick()
    const s2 = messages.createSession({ user_id: user.id, title: 's2' })
    messages.postUser(s2.id, '質問です')
    messages.postAgentResponse({ session_id: s2.id, content: '回答', is_final: true })
    await tick()
    const s3 = messages.createSession({ user_id: user.id, title: 's3' })

    const all = messages.listSessionsByUser({ user_id: user.id, limit: 10 })
    expect(all.length).toBe(3)
    expect(all[0]?.id).toBe(s3.id)
    expect(all[2]?.id).toBe(s1.id)
    expect(all[2]?.last_message).toBe('最初のメッセージ')
    expect(all[2]?.last_message_role).toBe('user')

    const firstPage = messages.listSessionsByUser({ user_id: user.id, limit: 1 })
    expect(firstPage.length).toBe(1)
    expect(firstPage[0]?.id).toBe(s3.id)
    const nextPage = messages.listSessionsByUser({
      user_id: user.id,
      limit: 1,
      before: firstPage[0]?.updated_at,
    })
    expect(nextPage.length).toBe(1)
    expect(nextPage[0]?.id).toBe(s2.id)

    db.close()
  })

  test('listSessionsByUser は他ユーザーのセッションを返さない', async () => {
    const db = openTestDb()
    const auth = new AuthService(db)
    const messages = new MessageService(db)
    const u1 = await auth.createAdminInitial('c@x', 'p')
    const u2 = await auth.createUser({ email: 'd@x', password: 'p', role: 'editor' })
    messages.createSession({ user_id: u1.id })
    messages.createSession({ user_id: u2.id })
    const own = messages.listSessionsByUser({ user_id: u1.id })
    expect(own.length).toBe(1)
    expect(own[0]?.user_id).toBe(u1.id)
    db.close()
  })
})
