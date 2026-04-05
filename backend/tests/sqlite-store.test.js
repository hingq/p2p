import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SqliteStore } from '../src/store/sqlite-store.js'

describe('sqlite store', () => {
  const tempDirs = []

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('persists and reads messages in timestamp order', () => {
    const directory = mkdtempSync(join(tmpdir(), 'p2p-chat-store-'))
    tempDirs.push(directory)

    const store = new SqliteStore({
      filename: join(directory, 'chat.sqlite')
    })

    store.initialize()
    store.upsertConversation({
      conversationId: 'peer:peer-b',
      type: 'direct',
      participants: ['peer-a', 'peer-b'],
      updatedAt: 2
    })

    store.saveMessage({
      id: 'message-2',
      conversationId: 'peer:peer-b',
      direction: 'in',
      from: 'peer-b',
      to: 'peer-a',
      text: 'second',
      status: 'received',
      ts: 2
    })

    store.saveMessage({
      id: 'message-1',
      conversationId: 'peer:peer-b',
      direction: 'out',
      from: 'peer-a',
      to: 'peer-b',
      text: 'first',
      status: 'pending',
      ts: 1
    })

    expect(store.getMessages('peer:peer-b')).toEqual([
      expect.objectContaining({ id: 'message-1', text: 'first', status: 'pending', ts: 1 }),
      expect.objectContaining({ id: 'message-2', text: 'second', status: 'received', ts: 2 })
    ])
  })

  it('updates message status and summarizes conversations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'p2p-chat-store-'))
    tempDirs.push(directory)

    const store = new SqliteStore({
      filename: join(directory, 'chat.sqlite')
    })

    store.initialize()
    store.upsertPeer({
      peerId: 'peer-b',
      addrs: ['/ip4/127.0.0.1/tcp/15002/ws'],
      lastSeen: 1,
      status: 'connected'
    })
    store.upsertConversation({
      conversationId: 'peer:peer-b',
      type: 'direct',
      participants: ['peer-a', 'peer-b'],
      updatedAt: 1
    })

    store.saveMessage({
      id: 'message-1',
      conversationId: 'peer:peer-b',
      direction: 'out',
      from: 'peer-a',
      to: 'peer-b',
      text: 'hello',
      status: 'pending',
      ts: 1
    })

    store.updateMessageStatus('message-1', 'sent')

    expect(store.getMessages('peer:peer-b')).toEqual([
      expect.objectContaining({ id: 'message-1', status: 'sent' })
    ])

    expect(store.listConversations()).toEqual([
      expect.objectContaining({
        conversationId: 'peer:peer-b',
        lastMessageText: 'hello',
        updatedAt: 1
      })
    ])
    expect(store.listPeers()).toEqual([
      expect.objectContaining({
        peerId: 'peer-b',
        addrs: ['/ip4/127.0.0.1/tcp/15002/ws'],
        status: 'connected'
      })
    ])
  })
})
