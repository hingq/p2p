import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

import { createTerminalApp } from '../src/terminal/create-terminal-app.js'

function createFakeChatApp() {
  const emitter = new EventEmitter()
  const conversations = []
  const messagesByConversation = new Map()
  const peers = []

  return {
    start: vi.fn(async () => ({
      peerId: '12D3KooWlocal',
      addresses: ['/ip4/127.0.0.1/tcp/15002/ws'],
      connectionCount: 0
    })),
    stop: vi.fn(async () => {}),
    listPeers: vi.fn(() => peers.map((peer) => ({ ...peer, addrs: [...peer.addrs] }))),
    listConversations: vi.fn(() =>
      conversations.map((conversation) => ({
        ...conversation,
        participants: [...conversation.participants]
      }))
    ),
    getMessages: vi.fn((conversationId) =>
      (messagesByConversation.get(conversationId) ?? []).map((message) => ({ ...message }))
    ),
    connectToPeer: vi.fn(async (multiaddr) => {
      const peerId = multiaddr.split('/').at(-1)
      const ts = 10
      peers.push({
        peerId,
        addrs: [multiaddr],
        lastSeen: ts,
        status: 'connected'
      })
      conversations.unshift({
        conversationId: `peer:${peerId}`,
        type: 'direct',
        participants: ['12D3KooWlocal', peerId],
        updatedAt: ts,
        title: peerId,
        lastMessageText: null
      })
      messagesByConversation.set(`peer:${peerId}`, [])

      return {
        peerId,
        multiaddr,
        status: 'connected'
      }
    }),
    sendMessage: vi.fn(async ({ peerId, text }) => {
      const conversationId = `peer:${peerId}`
      const items = messagesByConversation.get(conversationId) ?? []
      const message = {
        id: `message-${items.length + 1}`,
        conversationId,
        direction: 'out',
        from: '12D3KooWlocal',
        to: peerId,
        text,
        status: 'sent',
        ts: items.length + 1
      }
      messagesByConversation.set(conversationId, [...items, message])

      const conversation = conversations.find((item) => item.conversationId === conversationId)
      if (conversation) {
        conversation.lastMessageText = text
        conversation.updatedAt = message.ts
      }

      emitter.emit('message:updated', {
        conversationId,
        message
      })

      return message
    }),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit(eventName, payload) {
      emitter.emit(eventName, payload)
    }
  }
}

function createFakeTerminal() {
  const stdin = new EventEmitter()
  stdin.isTTY = true
  stdin.setRawMode = vi.fn()
  stdin.resume = vi.fn()
  stdin.pause = vi.fn()

  const stdout = {
    isTTY: true,
    columns: 120,
    rows: 40,
    write: vi.fn()
  }

  return { stdin, stdout }
}

describe('terminal app', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts, connects a peer and sends a message', async () => {
    const chatApp = createFakeChatApp()
    const { stdin, stdout } = createFakeTerminal()
    const onExit = vi.fn(async () => {})
    const app = createTerminalApp({
      chatApp,
      stdin,
      stdout,
      onExit,
      now: () => 1000
    })

    await app.start()

    await app.handleKeypress('o', { name: 'o', ctrl: true })
    for (const char of '/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote') {
      await app.handleKeypress(char, { sequence: char })
    }
    await app.handleKeypress('\r', { name: 'return' })

    expect(chatApp.connectToPeer).toHaveBeenCalledWith('/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote')
    expect(app.state.selectedConversationId).toBe('peer:12D3KooWremote')

    for (const char of 'hello from terminal') {
      await app.handleKeypress(char, { sequence: char })
    }
    await app.handleKeypress('\r', { name: 'return' })

    expect(chatApp.sendMessage).toHaveBeenCalledWith({
      peerId: '12D3KooWremote',
      text: 'hello from terminal'
    })
    expect(app.state.composerText).toBe('')

    await app.exit()
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('updates state when an inbound message event arrives', async () => {
    const chatApp = createFakeChatApp()
    const { stdin, stdout } = createFakeTerminal()
    const app = createTerminalApp({
      chatApp,
      stdin,
      stdout,
      onExit: vi.fn(async () => {})
    })

    await app.start()
    await chatApp.connectToPeer('/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote')
    await app.refreshData()

    chatApp.emit('message:received', {
      conversationId: 'peer:12D3KooWremote',
      message: {
        id: 'message-in',
        conversationId: 'peer:12D3KooWremote',
        direction: 'in',
        from: '12D3KooWremote',
        to: '12D3KooWlocal',
        text: 'hello local peer',
        status: 'received',
        ts: 99
      }
    })

    expect(app.state.messagesByConversation['peer:12D3KooWremote']).toEqual([
      expect.objectContaining({
        id: 'message-in',
        text: 'hello local peer'
      })
    ])
    expect(app.state.statusMessage).toContain('New message')
    expect(app.state.peers).toEqual([
      expect.objectContaining({
        peerId: '12D3KooWremote'
      })
    ])
  })

  it('treats q r c as plain text unless ctrl is pressed', async () => {
    const chatApp = createFakeChatApp()
    const { stdin, stdout } = createFakeTerminal()
    const onExit = vi.fn(async () => {})
    const app = createTerminalApp({
      chatApp,
      stdin,
      stdout,
      onExit
    })

    await app.start()

    await app.handleKeypress('c', { name: 'c', sequence: 'c' })
    await app.handleKeypress('r', { name: 'r', sequence: 'r' })
    await app.handleKeypress('q', { name: 'q', sequence: 'q' })

    expect(app.state.mode).toBe('message')
    expect(app.state.composerText).toBe('crq')
    expect(onExit).not.toHaveBeenCalled()

    await app.handleKeypress('o', { name: 'o', ctrl: true })
    expect(app.state.mode).toBe('connect')

    await app.handleKeypress('q', { name: 'q', sequence: 'q' })
    await app.handleKeypress('r', { name: 'r', sequence: 'r' })
    await app.handleKeypress('c', { name: 'c', sequence: 'c' })

    expect(app.state.promptText).toBe('qrc')
    expect(onExit).not.toHaveBeenCalled()

    await app.handleKeypress('q', { name: 'q', ctrl: true })
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
