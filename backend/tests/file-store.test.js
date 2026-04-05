import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { FileStore } from '../src/store/file-store.js'

describe('file store', () => {
  const tempDirs = []

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('persists and reads messages in timestamp order', () => {
    const directory = mkdtempSync(join(tmpdir(), 'p2p-chat-file-store-'))
    tempDirs.push(directory)

    const store = new FileStore({ directory })

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

  it('updates message status, summarizes conversations and writes json files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'p2p-chat-file-store-'))
    tempDirs.push(directory)

    const store = new FileStore({ directory })

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
    expect(existsSync(join(directory, 'peers.json'))).toBe(true)
    expect(existsSync(join(directory, 'conversations.json'))).toBe(true)
    expect(existsSync(join(directory, 'messages.json'))).toBe(true)

    expect(JSON.parse(readFileSync(join(directory, 'messages.json'), 'utf8'))).toEqual([
      expect.objectContaining({ id: 'message-1', status: 'sent' })
    ])
  })
})
