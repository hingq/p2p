import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { createDirectConversationId } from '../protocol/codec.js'
import { FileStore } from '../store/file-store.js'

export function createChatApp({ dataDirectory, transport }) {
  mkdirSync(dataDirectory, { recursive: true })

  const store = new FileStore({
    directory: join(dataDirectory, 'store')
  })
  const emitter = new EventEmitter()

  let localPeerId = null
  let localAddresses = []
  let started = false

  async function start() {
    if (!started) {
      store.initialize()
      const nodeState = await transport.start()
      localPeerId = nodeState.peerId
      localAddresses = nodeState.addresses ?? []
      started = true

      transport.on('message:received', handleIncomingMessage)
      return {
        ...nodeState,
        connectionCount: 0
      }
    }

    return {
      peerId: localPeerId,
      addresses: localAddresses,
      connectionCount: 0
    }
  }

  async function stop() {
    if (!started) {
      return
    }

    transport.off?.('message:received', handleIncomingMessage)
    await transport.stop()
    store.close()
    localAddresses = []
    started = false
  }

  async function connectToPeer(multiaddr) {
    const peer = await transport.connectToPeer(multiaddr)
    const connectedAt = Date.now()

    store.upsertPeer({
      peerId: peer.peerId,
      addrs: [multiaddr],
      lastSeen: connectedAt,
      status: peer.status ?? 'connected'
    })
    store.upsertConversation({
      conversationId: createDirectConversationId(peer.peerId),
      type: 'direct',
      participants: [localPeerId, peer.peerId],
      updatedAt: connectedAt
    })

    emitter.emit('peer:connected', peer)

    return peer
  }

  async function sendMessage({ peerId, text }) {
    const ts = Date.now()
    const conversationId = createDirectConversationId(peerId)

    store.upsertConversation({
      conversationId,
      type: 'direct',
      participants: [localPeerId, peerId],
      updatedAt: ts
    })

    const message = {
      id: randomUUID(),
      conversationId,
      direction: 'out',
      from: localPeerId,
      to: peerId,
      text,
      status: 'pending',
      ts
    }

    store.saveMessage(message)

    try {
      await transport.sendChatMessage({
        id: message.id,
        conversationId,
        from: localPeerId,
        to: peerId,
        text,
        ts
      })
      store.updateMessageStatus(message.id, 'sent')
    } catch (error) {
      store.updateMessageStatus(message.id, 'failed')
      throw error
    }

    const persistedMessage = store.getMessages(conversationId).find((item) => item.id === message.id)
    emitter.emit('message:updated', {
      conversationId,
      message: persistedMessage
    })

    return persistedMessage
  }

  function listConversations() {
    return store.listConversations().map((conversation) => ({
      ...conversation,
      title: conversation.participants.find((participant) => participant !== localPeerId) ?? conversation.conversationId
    }))
  }

  function listPeers() {
    return store.listPeers()
  }

  function getMessages(conversationId) {
    return store.getMessages(conversationId)
  }

  function on(eventName, listener) {
    emitter.on(eventName, listener)
  }

  function off(eventName, listener) {
    emitter.off(eventName, listener)
  }

  function handleIncomingMessage(message) {
    const conversationId = createDirectConversationId(message.from)

    store.upsertConversation({
      conversationId,
      type: 'direct',
      participants: [localPeerId, message.from],
      updatedAt: message.ts
    })
    store.upsertPeer({
      peerId: message.from,
      addrs: [],
      lastSeen: message.ts,
      status: 'connected'
    })
    store.saveMessage({
      id: message.id,
      conversationId,
      direction: 'in',
      from: message.from,
      to: message.to,
      text: message.text,
      status: 'received',
      ts: message.ts
    })

    emitter.emit('message:received', {
      conversationId,
      message: store.getMessages(conversationId).find((item) => item.id === message.id)
    })
  }

  return {
    start,
    stop,
    connectToPeer,
    sendMessage,
    listPeers,
    listConversations,
    getMessages,
    on,
    off
  }
}
