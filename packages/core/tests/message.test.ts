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
})
