import React, { useSyncExternalStore } from 'react'
import { Box, Text, render, useInput } from 'ink'
import TextInput from 'ink-text-input'
import Spinner from 'ink-spinner'

const COMMANDS = [
  { name: '/help', usage: '/help', description: 'Show commands' },
  { name: '/connect', usage: '/connect <multiaddr>', description: 'Connect and select a peer' },
  { name: '/peers', usage: '/peers', description: 'List known peers' },
  { name: '/conversations', usage: '/conversations', description: 'List conversations' },
  { name: '/chat', usage: '/chat <peerId>', description: 'Switch active chat' },
  { name: '/messages', usage: '/messages [peerId]', description: 'Show recent messages' },
  { name: '/refresh', usage: '/refresh', description: 'Refresh local data' },
  { name: '/quit', usage: '/quit', description: 'Exit' }
]

const HELP_LINES = [
  `Commands: ${COMMANDS.map((command) => command.usage).join(' ')}`,
  'When a chat is selected, type plain text and press Enter to send.'
]

function formatTimestamp(ts) {
  if (typeof ts !== 'number') {
    return '--:--:--'
  }

  return new Date(ts).toLocaleTimeString('en-GB', {
    hour12: false
  })
}

function normalizeMessageText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function sortMessages(messages) {
  return [...messages].sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id))
}

function getPeerIdFromConversation(conversation) {
  if (conversation?.title) {
    return conversation.title
  }

  if (conversation?.conversationId?.startsWith('peer:')) {
    return conversation.conversationId.slice(5)
  }

  return ''
}

function getCommandSuggestions(inputText) {
  if (!inputText.startsWith('/')) {
    return []
  }

  const query = inputText.split(/\s+/, 1)[0]
  return COMMANDS.filter((command) => command.name.startsWith(query))
}

function createInitialState() {
  return {
    node: null,
    peers: [],
    conversations: [],
    messagesByConversation: {},
    currentPeerId: null,
    inputText: '',
    transcript: [],
    isReady: false,
    isBusy: false,
    busyLabel: '',
    statusMessage: 'Starting node...',
    shouldExit: false
  }
}

export function createTerminalController({ chatApp, onExit = () => {}, now = () => Date.now() }) {
  let state = createInitialState()
  let started = false
  let exiting = false
  let nextLineId = 1
  const subscribers = new Set()
  const listeners = new Map()

  function getSnapshot() {
    return state
  }

  function emit() {
    for (const subscriber of subscribers) {
      subscriber()
    }
  }

  function subscribe(subscriber) {
    subscribers.add(subscriber)

    return () => {
      subscribers.delete(subscriber)
    }
  }

  function updateState(updater) {
    state = typeof updater === 'function' ? updater(state) : { ...state, ...updater }
    emit()
  }

  function setStatus(message) {
    updateState((current) => ({
      ...current,
      statusMessage: message
    }))
  }

  function setBusy(isBusy, busyLabel = '') {
    updateState((current) => ({
      ...current,
      isBusy,
      busyLabel
    }))
  }

  function appendTranscript(kind, text) {
    updateState((current) => ({
      ...current,
      transcript: [...current.transcript, { id: nextLineId++, kind, text }].slice(-80)
    }))
  }

  function appendHelp() {
    for (const line of HELP_LINES) {
      appendTranscript('system', line)
    }
  }

  function bindChatAppEvents() {
    const handlers = {
      'message:received': ({ conversationId, message }) => {
        updateState((current) => {
          const messages = current.messagesByConversation[conversationId] ?? []
          const nextMessages = sortMessages([...messages.filter((item) => item.id !== message.id), message])
          const nextConversations = chatApp.listConversations()
          const nextPeers = chatApp.listPeers?.() ?? []

          return {
            ...current,
            peers: nextPeers,
            conversations: nextConversations,
            currentPeerId: current.currentPeerId ?? message.from,
            messagesByConversation: {
              ...current.messagesByConversation,
              [conversationId]: nextMessages
            },
            transcript: [
              ...current.transcript,
              {
                id: nextLineId++,
                kind: 'in',
                text: `${formatTimestamp(message.ts)} ${message.from} -> me: ${message.text}`
              }
            ].slice(-80),
            statusMessage: `New message from ${message.from}`
          }
        })
      },
      'message:updated': ({ conversationId, message }) => {
        updateState((current) => {
          const messages = current.messagesByConversation[conversationId] ?? []
          const nextMessages = sortMessages([...messages.filter((item) => item.id !== message.id), message])

          return {
            ...current,
            messagesByConversation: {
              ...current.messagesByConversation,
              [conversationId]: nextMessages
            },
            statusMessage: `Message ${message.status}`
          }
        })
      },
      'peer:connected': (peer) => {
        updateState((current) => ({
          ...current,
          peers: chatApp.listPeers?.() ?? [],
          conversations: chatApp.listConversations(),
          statusMessage: `Connected ${peer.peerId}`
        }))
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

  function getConversationForPeer(peerId) {
    return state.conversations.find((conversation) => getPeerIdFromConversation(conversation) === peerId) ?? null
  }

  async function syncData({ reloadMessages = true } = {}) {
    const peers = chatApp.listPeers?.() ?? []
    const conversations = chatApp.listConversations()
    const messagesByConversation = { ...state.messagesByConversation }
    const currentPeerId = state.currentPeerId ?? getPeerIdFromConversation(conversations[0])

    if (reloadMessages) {
      for (const conversation of conversations) {
        if (!currentPeerId || getPeerIdFromConversation(conversation) === currentPeerId) {
          messagesByConversation[conversation.conversationId] = chatApp.getMessages(conversation.conversationId)
        }
      }
    }

    updateState((current) => ({
      ...current,
      peers,
      conversations,
      currentPeerId,
      messagesByConversation
    }))
  }

  async function bootstrap() {
    const node = await chatApp.start()
    bindChatAppEvents()
    updateState((current) => ({
      ...current,
      node
    }))
    await syncData()
    updateState((current) => ({
      ...current,
      isReady: true,
      statusMessage: 'Ready.'
    }))
    appendTranscript('system', `P2P chat ready. Peer ID: ${node.peerId}`)
    appendTranscript('system', `Listen: ${node.addresses?.join(', ') || 'none'}`)
    appendHelp()
  }

  async function refreshData() {
    setBusy(true, 'Refreshing')

    try {
      await syncData()
      setStatus(`Refreshed at ${formatTimestamp(now())}`)
      appendTranscript('system', `Refreshed at ${formatTimestamp(now())}`)
    } finally {
      setBusy(false)
    }
  }

  function setInputText(inputText) {
    updateState((current) => ({
      ...current,
      inputText
    }))
  }

  async function connectToPeer(multiaddr) {
    if (!multiaddr) {
      appendTranscript('error', 'Usage: /connect <multiaddr>')
      setStatus('Multiaddr is required.')
      return
    }

    setBusy(true, 'Connecting')

    try {
      const peer = await chatApp.connectToPeer(multiaddr)
      await syncData()
      updateState((current) => ({
        ...current,
        currentPeerId: peer.peerId,
        messagesByConversation: {
          ...current.messagesByConversation,
          [`peer:${peer.peerId}`]: chatApp.getMessages(`peer:${peer.peerId}`)
        },
        statusMessage: `Chatting with ${peer.peerId}`
      }))
      appendTranscript('system', `Connected to ${peer.peerId}. Plain text now sends to this chat.`)
    } catch (error) {
      const message = error.message ?? 'Connect failed.'
      appendTranscript('error', message)
      setStatus(message)
    } finally {
      setBusy(false)
    }
  }

  async function sendMessage(text) {
    const peerId = state.currentPeerId

    if (!peerId) {
      appendTranscript('error', 'No active chat. Use /connect <multiaddr> or /chat <peerId>.')
      setStatus('Select a chat first.')
      return
    }

    setBusy(true, 'Sending')

    try {
      await chatApp.sendMessage({ peerId, text })
      await syncData()
      appendTranscript('out', `${formatTimestamp(now())} me -> ${peerId}: ${text}`)
      setStatus(`Sent to ${peerId}`)
    } catch (error) {
      const message = error.message ?? 'Send failed.'
      appendTranscript('error', message)
      setStatus(message)
    } finally {
      setBusy(false)
    }
  }

  function listPeers() {
    if (state.peers.length === 0) {
      appendTranscript('system', 'No peers yet.')
      return
    }

    for (const peer of state.peers) {
      appendTranscript('system', `${peer.peerId}  ${peer.status ?? 'unknown'}  ${(peer.addrs ?? []).join(', ')}`)
    }
  }

  function listConversations() {
    if (state.conversations.length === 0) {
      appendTranscript('system', 'No conversations yet.')
      return
    }

    for (const conversation of state.conversations) {
      const peerId = getPeerIdFromConversation(conversation)
      const preview = conversation.lastMessageText ? normalizeMessageText(conversation.lastMessageText) : 'No messages yet'
      appendTranscript('system', `${peerId}  ${preview}`)
    }
  }

  function showMessages(peerId = state.currentPeerId) {
    if (!peerId) {
      appendTranscript('error', 'Usage: /messages [peerId]')
      return
    }

    const conversation = getConversationForPeer(peerId)

    if (!conversation) {
      appendTranscript('error', `No conversation for ${peerId}.`)
      return
    }

    const messages = state.messagesByConversation[conversation.conversationId] ?? chatApp.getMessages(conversation.conversationId)

    if (messages.length === 0) {
      appendTranscript('system', `No messages with ${peerId}.`)
      return
    }

    for (const message of messages.slice(-20)) {
      const label = message.direction === 'out' ? `me -> ${peerId}` : `${message.from} -> me`
      appendTranscript(message.direction === 'out' ? 'out' : 'in', `${formatTimestamp(message.ts)} ${label}: ${message.text}`)
    }
  }

  function switchChat(peerId) {
    if (!peerId) {
      appendTranscript('error', 'Usage: /chat <peerId>')
      return
    }

    const conversation = getConversationForPeer(peerId)

    if (!conversation) {
      appendTranscript('error', `No conversation for ${peerId}. Use /connect <multiaddr> first.`)
      return
    }

    updateState((current) => ({
      ...current,
      currentPeerId: peerId,
      messagesByConversation: {
        ...current.messagesByConversation,
        [conversation.conversationId]: chatApp.getMessages(conversation.conversationId)
      },
      statusMessage: `Chatting with ${peerId}`
    }))
    appendTranscript('system', `Chatting with ${peerId}.`)
  }

  async function runCommand(line) {
    const [command, ...parts] = line.split(/\s+/)
    const rest = parts.join(' ').trim()

    if (command === '/help') {
      appendHelp()
      return
    }

    if (command === '/connect') {
      await connectToPeer(rest)
      return
    }

    if (command === '/peers') {
      listPeers()
      return
    }

    if (command === '/conversations') {
      listConversations()
      return
    }

    if (command === '/chat') {
      switchChat(rest)
      return
    }

    if (command === '/messages') {
      showMessages(rest || state.currentPeerId)
      return
    }

    if (command === '/refresh') {
      await refreshData()
      return
    }

    if (command === '/quit' || command === '/exit') {
      await exit()
      return
    }

    appendTranscript('error', `Unknown command: ${command}. Type /help.`)
  }

  async function submitLine(line = state.inputText) {
    const text = line.trim()
    setInputText('')

    if (!text) {
      return
    }

    appendTranscript('input', `> ${text}`)

    if (text.startsWith('/')) {
      await runCommand(text)
      return
    }

    await sendMessage(text)
  }

  async function handleInput(input, key = {}) {
    if (key.tab && state.inputText.startsWith('/')) {
      const [suggestion] = getCommandSuggestions(state.inputText)

      if (suggestion) {
        setInputText(`${suggestion.name} `)
      }

      return
    }

    if ((key.ctrl && (input === 'c' || key.name === 'c')) || key.sequence === '\u0003') {
      await exit()
    }
  }

  async function start() {
    if (started) {
      return
    }

    started = true
    await bootstrap()
  }

  async function exit() {
    if (exiting) {
      return
    }

    exiting = true
    updateState((current) => ({
      ...current,
      shouldExit: true,
      statusMessage: 'Exiting...'
    }))
    unbindChatAppEvents()
    await onExit()
  }

  return {
    subscribe,
    getSnapshot,
    start,
    exit,
    refreshData,
    setInputText,
    submitLine,
    handleInput
  }
}

function useControllerState(controller) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot)
}

function getLineColor(kind) {
  if (kind === 'error') {
    return 'redBright'
  }

  if (kind === 'input') {
    return 'cyanBright'
  }

  if (kind === 'in') {
    return 'greenBright'
  }

  if (kind === 'out') {
    return 'blueBright'
  }

  return undefined
}

function renderHeader(state) {
  const peerId = state.node?.peerId ?? 'starting'
  const chatLabel = state.currentPeerId ? `chat ${state.currentPeerId}` : 'no active chat'

  return React.createElement(
    Box,
    { justifyContent: 'space-between' },
    React.createElement(Text, { color: 'blueBright' }, `P2P Chat  peer ${peerId}`),
    React.createElement(
      Text,
      { color: state.isBusy ? 'yellowBright' : 'greenBright' },
      state.isBusy ? `${state.busyLabel}...` : chatLabel
    )
  )
}

function renderTranscript(state) {
  const lines = state.transcript.slice(-22)

  if (lines.length === 0) {
    return React.createElement(Text, { color: 'gray' }, 'Starting...')
  }

  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1, flexGrow: 1 },
    ...lines.map((line) =>
      React.createElement(
        Text,
        {
          key: line.id,
          color: getLineColor(line.kind),
          wrap: 'truncate-end'
        },
        line.text
      )
    )
  )
}

function renderPrompt(state, controller) {
  const placeholder = state.currentPeerId ? `message ${state.currentPeerId} or /help` : '/connect <multiaddr> or /help'

  return React.createElement(
    Box,
    { marginTop: 1 },
    React.createElement(Text, { color: 'cyanBright' }, '> '),
    React.createElement(TextInput, {
      value: state.inputText,
      placeholder,
      focus: state.isReady && !state.shouldExit,
      showCursor: state.isReady && !state.shouldExit,
      onChange: controller.setInputText,
      onSubmit: (value) => {
        void controller.submitLine(value)
      }
    })
  )
}

function renderCommandHints(state) {
  const suggestions = getCommandSuggestions(state.inputText).slice(0, 6)

  if (suggestions.length === 0) {
    return null
  }

  return React.createElement(
    Box,
    { flexDirection: 'column', marginLeft: 2 },
    ...suggestions.map((command, index) =>
      React.createElement(
        Text,
        {
          key: command.name,
          color: index === 0 ? 'cyanBright' : 'gray'
        },
        `${command.usage}  ${command.description}`
      )
    )
  )
}

function renderFooter(state) {
  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    React.createElement(
      Text,
      { color: state.statusMessage.toLowerCase().includes('failed') ? 'redBright' : 'gray', wrap: 'truncate-end' },
      state.statusMessage
    )
  )
}

export function TerminalScreen({ controller }) {
  const state = useControllerState(controller)

  useInput((input, key) => {
    void controller.handleInput(input, key)
  })

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingX: 1, paddingY: 0 },
    renderHeader(state),
    !state.isReady
      ? React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(Spinner, { type: 'dots' }),
          React.createElement(Text, null, ` ${state.statusMessage}`)
      )
      : renderTranscript(state),
    renderPrompt(state, controller),
    renderCommandHints(state),
    renderFooter(state)
  )
}

export function createTerminalApp({
  chatApp,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  onExit = () => {},
  now = () => Date.now()
}) {
  const controller = createTerminalController({
    chatApp,
    now,
    onExit
  })

  let renderResult = null

  async function start() {
    if (!stdin.isTTY || !stdout.isTTY) {
      throw new Error('Terminal UI requires an interactive TTY.')
    }

    if (renderResult) {
      return
    }

    renderResult = render(React.createElement(TerminalScreen, { controller }), {
      stdin,
      stdout,
      stderr,
      exitOnCtrlC: false
    })

    try {
      await controller.start()
    } catch (error) {
      if (renderResult) {
        renderResult.unmount()
        renderResult = null
      }

      throw error
    }
  }

  async function exit() {
    await controller.exit()

    if (renderResult) {
      renderResult.unmount()
      renderResult = null
    }
  }

  return {
    controller,
    start,
    exit
  }
}
