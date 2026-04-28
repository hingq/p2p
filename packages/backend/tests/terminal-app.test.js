import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import React from 'react'
import { render } from 'ink-testing-library'

import { createTerminalApp, createTerminalController, TerminalScreen } from '../src/terminal/create-terminal-app.js'

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

function createStaticController(snapshot) {
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    handleInput: vi.fn(async () => {})
  }
}

describe('terminal controller', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts, connects a peer from overview, then sends a message in conversations view', async () => {
    const chatApp = createFakeChatApp()
    const onExit = vi.fn(async () => {})
    const controller = createTerminalController({
      chatApp,
      onExit,
      now: () => 1000
    })

    await controller.start()
    expect(controller.getSnapshot().isReady).toBe(true)
    expect(controller.getSnapshot().activeView).toBe('overview')

    await controller.handleInput('\r', { name: 'return' })
    for (const char of '/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote') {
      await controller.handleInput(char, { sequence: char })
    }
    await controller.handleInput('\r', { name: 'return' })

    expect(chatApp.connectToPeer).toHaveBeenCalledWith('/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote')
    expect(controller.getSnapshot().selectedConversationId).toBe('peer:12D3KooWremote')
    expect(controller.getSnapshot().activeView).toBe('conversations')
    expect(controller.getSnapshot().focusArea).toBe('composer')

    for (const char of 'hello from ink') {
      await controller.handleInput(char, { sequence: char })
    }
    await controller.handleInput('\r', { name: 'return' })

    expect(chatApp.sendMessage).toHaveBeenCalledWith({
      peerId: '12D3KooWremote',
      text: 'hello from ink'
    })
    expect(controller.getSnapshot().composerText).toBe('')

    await controller.exit()
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('updates cached messages when an inbound event arrives', async () => {
    const chatApp = createFakeChatApp()
    const controller = createTerminalController({
      chatApp,
      onExit: vi.fn(async () => {})
    })

    await controller.start()
    await chatApp.connectToPeer('/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote')
    await controller.refreshData()

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

    expect(controller.getSnapshot().messagesByConversation['peer:12D3KooWremote']).toEqual([
      expect.objectContaining({
        id: 'message-in',
        text: 'hello local peer'
      })
    ])
    expect(controller.getSnapshot().statusMessage).toContain('New message')
  })

  it('navigates between views and only writes plain text when composer is focused', async () => {
    const chatApp = createFakeChatApp()
    const controller = createTerminalController({
      chatApp,
      onExit: vi.fn(async () => {})
    })

    await controller.start()
    await controller.handleInput('q', { name: 'q', sequence: 'q' })
    expect(controller.getSnapshot().composerText).toBe('')

    await controller.handleInput('', { name: 'right' })
    expect(controller.getSnapshot().activeView).toBe('conversations')
    expect(controller.getSnapshot().focusArea).toBe('conversation-list')

    await controller.handleInput('\t', { name: 'tab' })
    expect(controller.getSnapshot().focusArea).toBe('composer')

    await controller.handleInput('q', { name: 'q', sequence: 'q' })
    await controller.handleInput('r', { name: 'r', sequence: 'r' })
    await controller.handleInput('c', { name: 'c', sequence: 'c' })
    expect(controller.getSnapshot().composerText).toBe('qrc')
  })
})

describe('terminal screen', () => {
  it('renders the overview shell for a ready node', () => {
    const controller = createStaticController({
      node: {
        peerId: '12D3KooWlocal',
        addresses: ['/ip4/127.0.0.1/tcp/15002/ws']
      },
      peers: [
        {
          peerId: '12D3KooWremote',
          addrs: ['/ip4/127.0.0.1/tcp/15003/ws/p2p/12D3KooWremote'],
          lastSeen: 10,
          status: 'connected'
        }
      ],
      conversations: [
        {
          conversationId: 'peer:12D3KooWremote',
          title: '12D3KooWremote',
          lastMessageText: 'hello',
          updatedAt: 10
        }
      ],
      messagesByConversation: {},
      selectedConversationId: 'peer:12D3KooWremote',
      selectedPeerIndex: 0,
      overviewActionIndex: 0,
      peerActionIndex: 0,
      activeView: 'overview',
      focusArea: 'overview-actions',
      composerText: '',
      connectText: '',
      isConnectOpen: false,
      isReady: true,
      isBusy: false,
      busyLabel: '',
      statusMessage: 'Node ready.',
      shouldExit: false
    })

    const app = render(React.createElement(TerminalScreen, { controller }))

    expect(app.lastFrame()).toContain('P2P Chat Console')
    expect(app.lastFrame()).toContain('Overview')
    expect(app.lastFrame()).toContain('12D3KooWlocal')

    app.unmount()
  })
})

describe('terminal app', () => {
  it('requires an interactive tty', async () => {
    const chatApp = createFakeChatApp()
    const app = createTerminalApp({
      chatApp,
      stdin: { isTTY: false },
      stdout: { isTTY: false },
      stderr: { isTTY: false }
    })

    await expect(app.start()).rejects.toThrow('Terminal UI requires an interactive TTY.')
  })
})
