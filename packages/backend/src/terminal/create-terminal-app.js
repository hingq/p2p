import readline from 'node:readline'

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function formatTimestamp(ts) {
  if (typeof ts !== 'number') {
    return '--:--:--'
  }

  return new Date(ts).toLocaleTimeString('en-GB', {
    hour12: false
  })
}

function wrapText(text, width) {
  if (width <= 0) {
    return ['']
  }

  const lines = []
  const source = text.length === 0 ? [''] : text.split('\n')

  for (const segment of source) {
    if (segment.length === 0) {
      lines.push('')
      continue
    }

    let cursor = 0

    while (cursor < segment.length) {
      lines.push(segment.slice(cursor, cursor + width))
      cursor += width
    }
  }

  return lines
}

function normalizeMessageText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

export function createTerminalApp({
  chatApp,
  stdin = process.stdin,
  stdout = process.stdout,
  onExit = () => {},
  now = () => Date.now()
}) {
  const state = {
    node: null,
    peers: [],
    conversations: [],
    messagesByConversation: {},
    selectedConversationId: null,
    composerText: '',
    promptText: '',
    mode: 'message',
    statusMessage: 'Starting node...',
    shouldExit: false
  }

  const listeners = new Map()
  let started = false
  let inAltScreen = false

  function getSelectedConversation() {
    return (
      state.conversations.find((conversation) => conversation.conversationId === state.selectedConversationId) ?? null
    )
  }

  function getSelectedPeerId() {
    const conversation = getSelectedConversation()

    if (conversation?.title) {
      return conversation.title
    }

    if (conversation?.conversationId?.startsWith('peer:')) {
      return conversation.conversationId.slice(5)
    }

    return ''
  }

  async function bootstrap() {
    state.node = await chatApp.start()
    state.peers = chatApp.listPeers?.() ?? []
    state.conversations = chatApp.listConversations()

    if (state.selectedConversationId == null && state.conversations.length > 0) {
      state.selectedConversationId = state.conversations[0].conversationId
    }

    if (state.selectedConversationId != null) {
      await loadMessages(state.selectedConversationId)
    }

    state.statusMessage = 'Node ready. Press c to connect, q to quit.'
    bindChatAppEvents()
  }

  async function loadMessages(conversationId) {
    state.messagesByConversation[conversationId] = chatApp.getMessages(conversationId)
  }

  async function refreshData() {
    state.peers = chatApp.listPeers?.() ?? []
    state.conversations = chatApp.listConversations()

    if (
      state.selectedConversationId != null &&
      !state.conversations.some((conversation) => conversation.conversationId === state.selectedConversationId)
    ) {
      state.selectedConversationId = state.conversations[0]?.conversationId ?? null
    }

    if (state.selectedConversationId == null && state.conversations.length > 0) {
      state.selectedConversationId = state.conversations[0].conversationId
    }

    if (state.selectedConversationId != null) {
      await loadMessages(state.selectedConversationId)
    }
  }

  function bindChatAppEvents() {
    const handlers = {
      'message:received': async ({ conversationId, message }) => {
        const messages = state.messagesByConversation[conversationId] ?? []
        const nextMessages = messages.filter((item) => item.id !== message.id)
        nextMessages.push(message)
        nextMessages.sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id))
        state.messagesByConversation[conversationId] = nextMessages
        state.peers = chatApp.listPeers?.() ?? []
        state.conversations = chatApp.listConversations()

        if (state.selectedConversationId == null) {
          state.selectedConversationId = conversationId
        }

        state.statusMessage = `New message from ${message.from}`
        render()
      },
      'message:updated': ({ conversationId, message }) => {
        const messages = state.messagesByConversation[conversationId] ?? []
        const nextMessages = messages.filter((item) => item.id !== message.id)
        nextMessages.push(message)
        nextMessages.sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id))
        state.messagesByConversation[conversationId] = nextMessages
        state.statusMessage = `Message ${message.status}`
        render()
      },
      'peer:connected': async (peer) => {
        state.peers = chatApp.listPeers?.() ?? []
        state.conversations = chatApp.listConversations()
        state.statusMessage = `Connected ${peer.peerId}`
        render()
      }
    }

    for (const [eventName, listener] of Object.entries(handlers)) {
      listeners.set(eventName, listener)
      chatApp.on(eventName, listener)
    }
  }

  function unbindChatAppEvents() {
    for (const [eventName, listener] of listeners) {
      chatApp.off(eventName, listener)
    }

    listeners.clear()
  }

  function enterAltScreen() {
    if (inAltScreen) {
      return
    }

    stdout.write('\u001b[?1049h\u001b[?25l')
    inAltScreen = true
  }

  function leaveAltScreen() {
    if (!inAltScreen) {
      return
    }

    stdout.write('\u001b[?25h\u001b[?1049l')
    inAltScreen = false
  }

  function clearScreen() {
    stdout.write('\u001b[2J\u001b[H')
  }

  function render() {
    if (!started) {
      return
    }

    const width = Math.max(stdout.columns ?? 100, 80)
    const height = Math.max(stdout.rows ?? 30, 24)
    const leftWidth = Math.min(34, Math.max(24, Math.floor(width * 0.32)))
    const rightWidth = width - leftWidth - 3

    const headerLines = buildHeaderLines(width)
    const conversationLines = buildConversationLines(leftWidth, height - headerLines.length - 5)
    const messageLines = buildMessageLines(rightWidth, height - headerLines.length - 5)
    const inputLines = buildInputLines(width)
    const bodyHeight = Math.max(conversationLines.length, messageLines.length)
    const rows = []

    rows.push(...headerLines)
    rows.push('='.repeat(width))

    for (let index = 0; index < bodyHeight; index += 1) {
      const left = (conversationLines[index] ?? '').padEnd(leftWidth, ' ')
      const right = messageLines[index] ?? ''
      rows.push(`${left} | ${right}`)
    }

    rows.push('='.repeat(width))
    rows.push(...inputLines)

    clearScreen()
    stdout.write(`${rows.slice(0, height).join('\n')}\n`)
  }

  function buildHeaderLines(width) {
    const addresses = state.node?.addresses?.length ? state.node.addresses.join(', ') : 'No listen addresses'
    const selectedConversation = getSelectedConversation()
    const selectedTitle = selectedConversation?.title ?? 'No conversation selected'
    const peerCount = state.peers.length

    return [
      truncate(`P2P Chat TUI | peer ${state.node?.peerId ?? 'starting'} | peers ${peerCount}`, width),
      truncate(`Listen ${addresses}`, width),
      truncate(`Conversation ${selectedTitle}`, width),
      truncate(`Status ${state.statusMessage}`, width)
    ]
  }

  function buildConversationLines(width, height) {
    const lines = ['Conversations']
    const available = Math.max(height - 1, 1)

    if (state.conversations.length === 0) {
      lines.push('  No conversations yet.')
      return lines.slice(0, height)
    }

    for (const conversation of state.conversations.slice(0, available)) {
      const marker = conversation.conversationId === state.selectedConversationId ? '>' : ' '
      const summary = conversation.lastMessageText ? normalizeMessageText(conversation.lastMessageText) : 'No messages'
      const line = `${marker} ${conversation.title} | ${summary}`
      lines.push(truncate(line, width))
    }

    return lines.slice(0, height)
  }

  function buildMessageLines(width, height) {
    const lines = ['Messages']
    const conversationId = state.selectedConversationId
    const messages = conversationId ? state.messagesByConversation[conversationId] ?? [] : []

    if (messages.length === 0) {
      lines.push('  Nothing to show.')
      return lines.slice(0, height)
    }

    const rendered = []

    for (const message of messages) {
      const prefix = message.direction === 'out' ? 'me' : truncate(message.from ?? 'peer', 12)
      const meta = `${formatTimestamp(message.ts)} ${prefix} ${message.status}`
      rendered.push(truncate(meta, width))

      for (const line of wrapText(message.text, width - 2)) {
        rendered.push(`  ${line}`)
      }
    }

    const visible = rendered.slice(Math.max(0, rendered.length - Math.max(height - 1, 1)))
    return ['Messages', ...visible].slice(0, height)
  }

  function buildInputLines(width) {
    const modeLabel = state.mode === 'connect' ? 'Connect' : 'Message'
    const prompt = state.mode === 'connect' ? state.promptText : state.composerText
    const help = 'Keys: Up/Down switch conversation | Tab toggle input | Ctrl+O connect | Ctrl+R refresh | Ctrl+Q quit'

    return [
      truncate(help, width),
      truncate(`${modeLabel}> ${prompt}`, width)
    ]
  }

  async function handleKeypress(str, key = {}) {
    if (key.sequence === '\u0003') {
      await exit()
      return
    }

    if (key.name === 'up') {
      moveSelection(-1)
      render()
      return
    }

    if (key.name === 'down') {
      moveSelection(1)
      render()
      return
    }

    if (key.name === 'r' && key.ctrl) {
      await refreshData()
      state.statusMessage = `Refreshed at ${formatTimestamp(now())}`
      render()
      return
    }

    if (key.name === 'o' && key.ctrl) {
      state.mode = 'connect'
      state.promptText = ''
      state.statusMessage = 'Enter a multiaddr and press Enter.'
      render()
      return
    }

    if (key.name === 'q' && key.ctrl) {
      await exit()
      return
    }

    if (key.name === 'tab') {
      if (state.mode === 'connect') {
        state.mode = 'message'
        state.statusMessage = 'Switched to message input.'
      } else {
        state.mode = 'connect'
        state.statusMessage = 'Switched to connect input.'
      }

      render()
      return
    }

    if (key.name === 'escape' && state.mode === 'connect') {
      state.mode = 'message'
      state.promptText = ''
      state.statusMessage = 'Connect cancelled.'
      render()
      return
    }

    if (key.name === 'backspace') {
      if (state.mode === 'connect') {
        state.promptText = state.promptText.slice(0, -1)
      } else {
        state.composerText = state.composerText.slice(0, -1)
      }

      render()
      return
    }

    if (key.name === 'return') {
      if (state.mode === 'connect') {
        await submitConnect()
      } else {
        await submitMessage()
      }
      render()
      return
    }

    if (!key.ctrl && !key.meta && typeof str === 'string' && str >= ' ') {
      if (state.mode === 'connect') {
        state.promptText += str
      } else {
        state.composerText += str
      }

      render()
    }
  }

  function moveSelection(delta) {
    if (state.conversations.length === 0) {
      return
    }

    const currentIndex = state.conversations.findIndex(
      (conversation) => conversation.conversationId === state.selectedConversationId
    )
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + state.conversations.length) % state.conversations.length
    state.selectedConversationId = state.conversations[nextIndex].conversationId

    void loadMessages(state.selectedConversationId)
  }

  async function submitConnect() {
    const multiaddr = state.promptText.trim()

    if (!multiaddr) {
      state.statusMessage = 'Multiaddr is required.'
      return
    }

    try {
      const peer = await chatApp.connectToPeer(multiaddr)
      state.mode = 'message'
      state.promptText = ''
      await refreshData()
      state.selectedConversationId = `peer:${peer.peerId}`
      await loadMessages(state.selectedConversationId)
      state.statusMessage = `Connected ${peer.peerId}`
    } catch (error) {
      state.statusMessage = error.message ?? 'Connect failed.'
    }
  }

  async function submitMessage() {
    const text = state.composerText.trim()
    const peerId = getSelectedPeerId()

    if (!text) {
      state.statusMessage = 'Message cannot be empty.'
      return
    }

    if (!peerId) {
      state.statusMessage = 'Select a conversation first.'
      return
    }

    try {
      await chatApp.sendMessage({ peerId, text })
      state.composerText = ''
      await refreshData()
      state.statusMessage = `Sent to ${peerId}`
    } catch (error) {
      state.statusMessage = error.message ?? 'Send failed.'
    }
  }

  async function start() {
    if (!stdin.isTTY || !stdout.isTTY) {
      throw new Error('Terminal UI requires an interactive TTY.')
    }

    if (started) {
      return
    }

    started = true
    enterAltScreen()
    readline.emitKeypressEvents(stdin)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('keypress', handleKeypress)

    try {
      await bootstrap()
      render()
    } catch (error) {
      await exit()
      throw error
    }
  }

  async function exit() {
    if (state.shouldExit) {
      return
    }

    state.shouldExit = true
    stdin.off('keypress', handleKeypress)

    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(false)
    }

    stdin.pause()
    unbindChatAppEvents()
    leaveAltScreen()
    await onExit()
  }

  return {
    state,
    start,
    exit,
    render,
    refreshData,
    handleKeypress
  }
}
