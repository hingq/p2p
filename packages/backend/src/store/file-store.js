import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function compareMessages(left, right) {
  if (left.ts !== right.ts) {
    return left.ts - right.ts
  }

  return left.id.localeCompare(right.id)
}

export class FileStore {
  constructor({ directory }) {
    this.directory = directory
    this.paths = {
      peers: join(directory, 'peers.json'),
      conversations: join(directory, 'conversations.json'),
      messages: join(directory, 'messages.json')
    }
    this.state = null
  }

  initialize() {
    mkdirSync(this.directory, { recursive: true })

    this.state = {
      peers: this.#readJsonFile(this.paths.peers),
      conversations: this.#readJsonFile(this.paths.conversations),
      messages: this.#readJsonFile(this.paths.messages)
    }

    this.#flush()
  }

  upsertPeer(peer) {
    this.#assertInitialized()

    const peers = this.state.peers.filter((item) => item.peerId !== peer.peerId)
    peers.push({
      peerId: peer.peerId,
      addrs: ensureArray(peer.addrs),
      lastSeen: peer.lastSeen ?? null,
      status: peer.status ?? 'unknown'
    })

    this.state.peers = peers.sort((left, right) => left.peerId.localeCompare(right.peerId))
    this.#writeSection('peers')
  }

  upsertConversation(conversation) {
    this.#assertInitialized()

    const conversations = this.state.conversations.filter(
      (item) => item.conversationId !== conversation.conversationId
    )
    conversations.push({
      conversationId: conversation.conversationId,
      type: conversation.type,
      participants: ensureArray(conversation.participants),
      updatedAt: conversation.updatedAt
    })

    this.state.conversations = conversations.sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt - left.updatedAt
      }

      return left.conversationId.localeCompare(right.conversationId)
    })
    this.#writeSection('conversations')
  }

  saveMessage(message) {
    this.#assertInitialized()

    const messages = this.state.messages.filter((item) => item.id !== message.id)
    messages.push(clone(message))
    messages.sort(compareMessages)
    this.state.messages = messages

    const existingConversation = this.state.conversations.find(
      (item) => item.conversationId === message.conversationId
    )

    if (existingConversation) {
      existingConversation.updatedAt = Math.max(existingConversation.updatedAt, message.ts)
      this.state.conversations.sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) {
          return right.updatedAt - left.updatedAt
        }

        return left.conversationId.localeCompare(right.conversationId)
      })
      this.#writeSection('conversations')
    }

    this.#writeSection('messages')
  }

  updateMessageStatus(messageId, status) {
    this.#assertInitialized()

    const message = this.state.messages.find((item) => item.id === messageId)

    if (message) {
      message.status = status
      this.#writeSection('messages')
    }
  }

  getMessages(conversationId) {
    this.#assertInitialized()

    return this.state.messages
      .filter((item) => item.conversationId === conversationId)
      .sort(compareMessages)
      .map(clone)
  }

  listPeers() {
    this.#assertInitialized()

    return this.state.peers.map(clone)
  }

  listConversations() {
    this.#assertInitialized()

    return this.state.conversations
      .map((conversation) => {
        const lastMessage = this.state.messages
          .filter((message) => message.conversationId === conversation.conversationId)
          .sort(compareMessages)
          .at(-1)

        return {
          ...clone(conversation),
          lastMessageText: lastMessage?.text ?? null
        }
      })
      .sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) {
          return right.updatedAt - left.updatedAt
        }

        return left.conversationId.localeCompare(right.conversationId)
      })
  }

  close() {
    this.state = null
  }

  #assertInitialized() {
    if (this.state == null) {
      throw new Error('FileStore has not been initialized')
    }
  }

  #readJsonFile(filename) {
    try {
      return ensureArray(JSON.parse(readFileSync(filename, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return []
      }

      throw error
    }
  }

  #flush() {
    this.#writeSection('peers')
    this.#writeSection('conversations')
    this.#writeSection('messages')
  }

  #writeSection(section) {
    const filename = this.paths[section]
    const tempFilename = `${filename}.tmp`

    writeFileSync(tempFilename, `${JSON.stringify(this.state[section], null, 2)}\n`, 'utf8')
    renameSync(tempFilename, filename)
  }
}
