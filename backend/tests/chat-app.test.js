import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createChatApp } from '../src/app/chat-app.js'

function createFakeTransport() {
  const emitter = new EventEmitter()

  return {
    peerId: '12D3KooWlocal',
    addresses: ['/ip4/127.0.0.1/tcp/15002/ws'],
    start: vi.fn(async () => ({
      peerId: '12D3KooWlocal',
      addresses: ['/ip4/127.0.0.1/tcp/15002/ws']
    })),
    stop: vi.fn(async () => {}),
    connectToPeer: vi.fn(async (multiaddr) => ({
      peerId: '12D3KooWremote',
      multiaddr,
      status: 'connected'
    })),
    sendChatMessage: vi.fn(async () => {}),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit(eventName, payload) {
      emitter.emit(eventName, payload)
    }
  }
}

describe('chat app', () => {
  const tempDirs = []

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('starts, connects peers and persists sent messages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'p2p-chat-app-'))
    tempDirs.push(directory)

    const transport = createFakeTransport()
    const app = createChatApp({
      dataDirectory: directory,
      transport
    })

    const nodeState = await app.start()
    const peer = await app.connectToPeer('/ip4/203.0.113.10/tcp/15002/ws/p2p/12D3KooWremote')
    expect(app.listConversations()).toEqual([
      expect.objectContaining({
        conversationId: 'peer:12D3KooWremote',
        lastMessageText: null,
        participants: ['12D3KooWlocal', '12D3KooWremote']
      })
    ])

    const message = await app.sendMessage({
      peerId: peer.peerId,
      text: 'hello remote peer'
    })

    expect(nodeState.peerId).toBe('12D3KooWlocal')
    expect(peer.peerId).toBe('12D3KooWremote')
    expect(message.status).toBe('sent')
    expect(app.listPeers()).toEqual([
      expect.objectContaining({
        peerId: '12D3KooWremote',
        addrs: ['/ip4/203.0.113.10/tcp/15002/ws/p2p/12D3KooWremote'],
        status: 'connected'
      })
    ])
    expect(app.listConversations()).toEqual([
      expect.objectContaining({
        conversationId: 'peer:12D3KooWremote',
        lastMessageText: 'hello remote peer'
      })
    ])
    expect(app.getMessages('peer:12D3KooWremote')).toEqual([
      expect.objectContaining({
        text: 'hello remote peer',
        direction: 'out',
        status: 'sent'
      })
    ])
  })

  it('persists incoming messages and emits app events', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'p2p-chat-app-'))
    tempDirs.push(directory)

    const transport = createFakeTransport()
    const app = createChatApp({
      dataDirectory: directory,
      transport
    })

    const receivedEvents = []
    app.on('message:received', (event) => {
      receivedEvents.push(event)
    })

    await app.start()
    transport.emit('message:received', {
      id: 'message-inbound',
      from: '12D3KooWremote',
      to: '12D3KooWlocal',
      text: 'hello local peer',
      ts: 1760000002
    })

    expect(app.getMessages('peer:12D3KooWremote')).toEqual([
      expect.objectContaining({
        id: 'message-inbound',
        direction: 'in',
        status: 'received'
      })
    ])
    expect(receivedEvents).toEqual([
      expect.objectContaining({
        conversationId: 'peer:12D3KooWremote',
        message: expect.objectContaining({ text: 'hello local peer' })
      })
    ])
  })

  it('returns node addresses when start is called after the node is already running', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'p2p-chat-app-'))
    tempDirs.push(directory)

    const transport = createFakeTransport()
    delete transport.addresses
    const app = createChatApp({
      dataDirectory: directory,
      transport
    })

    await app.start()

    expect(await app.start()).toEqual({
      peerId: '12D3KooWlocal',
      addresses: ['/ip4/127.0.0.1/tcp/15002/ws'],
      connectionCount: 0
    })
  })
})
