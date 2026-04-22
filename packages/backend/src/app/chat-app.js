import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { createDirectConversationId } from '../protocol/codec.js'
import { FileStore } from '../store/file-store.js'

export function createChatApp({ dataDirectory, transport, store }) {
  mkdirSync(dataDirectory, { recursive: true })

  const activeStore =
    store ??
    new FileStore({
      directory: join(dataDirectory, 'store')
    })
  const emitter = new EventEmitter()

  let localPeerId = null
  let localAddresses = []
  let started = false

  async function start() {
    if (!started) {
      activeStore.initialize()
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
    activeStore.close()
    localAddresses = []
    started = false
  }

  async function connectToPeer(multiaddr) {
    const peer = await transport.connectToPeer(multiaddr)
    const connectedAt = Date.now()

    activeStore.upsertPeer({
      peerId: peer.peerId,
      addrs: [multiaddr],
      lastSeen: connectedAt,
      status: peer.status ?? 'connected'
    })
    activeStore.upsertConversation({
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

    activeStore.upsertConversation({
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

    activeStore.saveMessage(message)

    try {
      await transport.sendChatMessage({
        id: message.id,
        conversationId,
        from: localPeerId,
        to: peerId,
        text,
        ts
      })
      activeStore.updateMessageStatus(message.id, 'sent')
    } catch (error) {
      activeStore.updateMessageStatus(message.id, 'failed')
      throw error
    }

    const persistedMessage = activeStore.getMessages(conversationId).find((item) => item.id === message.id)
    emitter.emit('message:updated', {
      conversationId,
      message: persistedMessage
    })

    return persistedMessage
  }

  function listConversations() {
    return activeStore.listConversations().map((conversation) => ({
      ...conversation,
      title: conversation.participants.find((participant) => participant !== localPeerId) ?? conversation.conversationId
    }))
  }

  function listPeers() {
    return activeStore.listPeers()
  }

  function getMessages(conversationId) {
    return activeStore.getMessages(conversationId)
  }

  function on(eventName, listener) {
    emitter.on(eventName, listener)
  }

  function off(eventName, listener) {
    emitter.off(eventName, listener)
  }

  function handleIncomingMessage(message) {
    const conversationId = createDirectConversationId(message.from)

    activeStore.upsertConversation({
      conversationId,
      type: 'direct',
      participants: [localPeerId, message.from],
      updatedAt: message.ts
    })
    activeStore.upsertPeer({
      peerId: message.from,
      addrs: [],
      lastSeen: message.ts,
      status: 'connected'
    })
    activeStore.saveMessage({
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
      message: activeStore.getMessages(conversationId).find((item) => item.id === message.id)
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
