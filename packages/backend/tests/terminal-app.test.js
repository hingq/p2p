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
    setInputText: vi.fn(),
    submitLine: vi.fn(async () => {}),
    handleInput: vi.fn(async () => {}),
    exit: vi.fn(async () => {})
  }
}

describe('terminal controller', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('connects with a command, selects the peer, then sends plain text as a message', async () => {
    const chatApp = createFakeChatApp()
    const onExit = vi.fn(async () => {})
    const controller = createTerminalController({
      chatApp,
      onExit,
      now: () => 1000
    })

    await controller.start()
    expect(controller.getSnapshot().isReady).toBe(true)
    expect(controller.getSnapshot().transcript.map((line) => line.text).join('\n')).toContain('/connect <multiaddr>')

    await controller.submitLine('/connect /ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote')

    expect(chatApp.connectToPeer).toHaveBeenCalledWith('/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote')
    expect(controller.getSnapshot().currentPeerId).toBe('12D3KooWremote')
    expect(controller.getSnapshot().transcript.at(-1).text).toContain('Connected to 12D3KooWremote')

    await controller.submitLine('hello from command mode')

    expect(chatApp.sendMessage).toHaveBeenCalledWith({
      peerId: '12D3KooWremote',
      text: 'hello from command mode'
    })
    expect(controller.getSnapshot().inputText).toBe('')
    expect(controller.getSnapshot().transcript.at(-1).text).toContain('me -> 12D3KooWremote')

    await controller.submitLine('/quit')
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('lists peers and switches chats with slash commands', async () => {
    const chatApp = createFakeChatApp()
    const controller = createTerminalController({
      chatApp,
      onExit: vi.fn(async () => {})
    })

    await controller.start()
    await controller.submitLine('/connect /ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote')
    await controller.submitLine('/peers')
    expect(controller.getSnapshot().transcript.at(-1).text).toContain('12D3KooWremote')

    await controller.submitLine('/chat 12D3KooWremote')
    expect(controller.getSnapshot().currentPeerId).toBe('12D3KooWremote')
    expect(controller.getSnapshot().statusMessage).toContain('Chatting with')
  })

  it('records inbound messages in the command transcript', async () => {
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

    expect(controller.getSnapshot().transcript.at(-1).text).toContain('12D3KooWremote -> me')
    expect(controller.getSnapshot().transcript.at(-1).text).toContain('hello local peer')
  })

  it('tab-completes slash commands from the current input', async () => {
    const chatApp = createFakeChatApp()
    const controller = createTerminalController({
      chatApp,
      onExit: vi.fn(async () => {})
    })

    await controller.start()
    controller.setInputText('/co')

    await controller.handleInput('', { tab: true })

    expect(controller.getSnapshot().inputText).toBe('/connect ')
  })
})

describe('terminal screen', () => {
  it('renders a command prompt instead of view navigation', () => {
    const controller = createStaticController({
      node: {
        peerId: '12D3KooWlocal',
        addresses: ['/ip4/127.0.0.1/tcp/15002/ws']
      },
      peers: [],
      conversations: [],
      messagesByConversation: {},
      currentPeerId: '12D3KooWremote',
      inputText: '',
      transcript: [
        { id: 1, kind: 'system', text: 'P2P chat ready.' },
        { id: 2, kind: 'system', text: 'Commands: /help /connect <multiaddr> /peers /chat <peerId> /quit' }
      ],
      isReady: true,
      isBusy: false,
      busyLabel: '',
      statusMessage: 'Chatting with 12D3KooWremote',
      shouldExit: false
    })

    const app = render(React.createElement(TerminalScreen, { controller }))

    expect(app.lastFrame()).toContain('P2P Chat')
    expect(app.lastFrame()).toContain('chat 12D3KooWremote')
    expect(app.lastFrame()).toContain('>')
    expect(app.lastFrame()).not.toContain('Overview')

    app.unmount()
  })

  it('shows slash command hints while typing a command', () => {
    const controller = createStaticController({
      node: {
        peerId: '12D3KooWlocal',
        addresses: ['/ip4/127.0.0.1/tcp/15002/ws']
      },
      peers: [],
      conversations: [],
      messagesByConversation: {},
      currentPeerId: null,
      inputText: '/co',
      transcript: [{ id: 1, kind: 'system', text: 'P2P chat ready.' }],
      isReady: true,
      isBusy: false,
      busyLabel: '',
      statusMessage: 'Ready.',
      shouldExit: false
    })

    const app = render(React.createElement(TerminalScreen, { controller }))

    expect(app.lastFrame()).toContain('/connect <multiaddr>')
    expect(app.lastFrame()).toContain('/conversations')
    expect(app.lastFrame()).not.toContain('/peers')

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
