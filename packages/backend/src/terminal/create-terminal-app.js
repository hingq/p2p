import React, { useSyncExternalStore } from 'react'
import { Box, Text, render, useInput } from 'ink'
import TextInput from 'ink-text-input'
import Spinner from 'ink-spinner'

const VIEWS = ['overview', 'conversations', 'peers']
const OVERVIEW_ACTIONS = ['connect', 'refresh', 'quit']
const PEER_ACTIONS = ['open conversation', 'connect']

function truncate(value, maxLength) {
  if (!value) {
    return ''
  }

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

function normalizeMessageText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function sortMessages(messages) {
  return [...messages].sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id))
}

function getViewLabel(view) {
  if (view === 'overview') {
    return 'Overview'
  }

  if (view === 'conversations') {
    return 'Conversations'
  }

  return 'Peers'
}

function getDefaultFocusForView(view) {
  if (view === 'conversations') {
    return 'conversation-list'
  }

  if (view === 'peers') {
    return 'peer-list'
  }

  return 'overview-actions'
}

function isPrintableInput(input, key = {}) {
  return !key.ctrl && !key.meta && typeof input === 'string' && input >= ' '
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

function createInitialState() {
  return {
    node: null,
    peers: [],
    conversations: [],
    messagesByConversation: {},
    selectedConversationId: null,
    selectedPeerIndex: 0,
    overviewActionIndex: 0,
    peerActionIndex: 0,
    activeView: 'overview',
    focusArea: 'overview-actions',
    composerText: '',
    connectText: '',
    isConnectOpen: false,
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

  function bindChatAppEvents() {
    const handlers = {
      'message:received': ({ conversationId, message }) => {
        updateState((current) => {
          const messages = current.messagesByConversation[conversationId] ?? []
          const nextMessages = sortMessages([...messages.filter((item) => item.id !== message.id), message])
          const nextSelectedConversationId = current.selectedConversationId ?? conversationId
          const nextConversations = chatApp.listConversations()
          const nextPeers = chatApp.listPeers?.() ?? []

          return {
            ...current,
            peers: nextPeers,
            conversations: nextConversations,
            selectedConversationId: nextSelectedConversationId,
            selectedPeerIndex: normalizePeerIndex(current.selectedPeerIndex, nextPeers.length),
            messagesByConversation: {
              ...current.messagesByConversation,
              [conversationId]: nextMessages
            },
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
        updateState((current) => {
          const nextPeers = chatApp.listPeers?.() ?? []
          const nextConversations = chatApp.listConversations()

          return {
            ...current,
            peers: nextPeers,
            conversations: nextConversations,
            selectedPeerIndex: normalizePeerIndex(current.selectedPeerIndex, nextPeers.length),
            statusMessage: `Connected ${peer.peerId}`
          }
        })
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

  function normalizeConversationSelection(conversations, selectedConversationId) {
    if (selectedConversationId && conversations.some((item) => item.conversationId === selectedConversationId)) {
      return selectedConversationId
    }

    return conversations[0]?.conversationId ?? null
  }

  function normalizePeerIndex(index, length) {
    if (length <= 0) {
      return 0
    }

    return Math.max(0, Math.min(index, length - 1))
  }

  async function syncData({ reloadMessages = true } = {}) {
    const peers = chatApp.listPeers?.() ?? []
    const conversations = chatApp.listConversations()
    const selectedConversationId = normalizeConversationSelection(conversations, state.selectedConversationId)
    const messagesByConversation = { ...state.messagesByConversation }

    if (reloadMessages && selectedConversationId) {
      messagesByConversation[selectedConversationId] = chatApp.getMessages(selectedConversationId)
    }

    updateState((current) => ({
      ...current,
      peers,
      conversations,
      selectedConversationId,
      selectedPeerIndex: normalizePeerIndex(current.selectedPeerIndex, peers.length),
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
      statusMessage: 'Node ready. Use Left/Right to switch views.'
    }))
  }

  function getSelectedConversation(snapshot = state) {
    return snapshot.conversations.find((conversation) => conversation.conversationId === snapshot.selectedConversationId) ?? null
  }

  function getSelectedPeer(snapshot = state) {
    return snapshot.peers[snapshot.selectedPeerIndex] ?? null
  }

  function setActiveView(view) {
    updateState((current) => ({
      ...current,
      activeView: view,
      focusArea: getDefaultFocusForView(view)
    }))
  }

  function moveView(delta) {
    const currentIndex = VIEWS.indexOf(state.activeView)
    const nextIndex = (currentIndex + delta + VIEWS.length) % VIEWS.length
    setActiveView(VIEWS[nextIndex])
  }

  function moveConversationSelection(delta) {
    if (state.conversations.length === 0) {
      return
    }

    const currentIndex = state.conversations.findIndex((item) => item.conversationId === state.selectedConversationId)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + state.conversations.length) % state.conversations.length
    const selectedConversationId = state.conversations[nextIndex].conversationId
    const messagesByConversation = {
      ...state.messagesByConversation,
      [selectedConversationId]: chatApp.getMessages(selectedConversationId)
    }

    updateState((current) => ({
      ...current,
      selectedConversationId,
      messagesByConversation
    }))
  }

  function movePeerSelection(delta) {
    updateState((current) => ({
      ...current,
      selectedPeerIndex: normalizePeerIndex(current.selectedPeerIndex + delta, current.peers.length)
    }))
  }

  function toggleConversationFocus() {
    updateState((current) => ({
      ...current,
      focusArea: current.focusArea === 'conversation-list' ? 'composer' : 'conversation-list'
    }))
  }

  function togglePeerFocus() {
    updateState((current) => ({
      ...current,
      focusArea: current.focusArea === 'peer-list' ? 'peer-actions' : 'peer-list'
    }))
  }

  function moveOverviewAction(delta) {
    updateState((current) => ({
      ...current,
      overviewActionIndex: (current.overviewActionIndex + delta + OVERVIEW_ACTIONS.length) % OVERVIEW_ACTIONS.length
    }))
  }

  function movePeerAction(delta) {
    updateState((current) => ({
      ...current,
      peerActionIndex: (current.peerActionIndex + delta + PEER_ACTIONS.length) % PEER_ACTIONS.length
    }))
  }

  function openConnectDialog(initialValue = '') {
    updateState((current) => ({
      ...current,
      isConnectOpen: true,
      connectText: initialValue,
      statusMessage: initialValue ? 'Edit the multiaddr and press Enter.' : 'Enter a multiaddr and press Enter.'
    }))
  }

  function closeConnectDialog() {
    updateState((current) => ({
      ...current,
      isConnectOpen: false,
      connectText: '',
      statusMessage: 'Connect cancelled.'
    }))
  }

  async function refreshData() {
    setBusy(true, 'Refreshing')

    try {
      await syncData()
      setStatus(`Refreshed at ${formatTimestamp(now())}`)
    } finally {
      setBusy(false)
    }
  }

  async function submitConnect() {
    const multiaddr = state.connectText.trim()

    if (!multiaddr) {
      setStatus('Multiaddr is required.')
      return
    }

    setBusy(true, 'Connecting')

    try {
      const peer = await chatApp.connectToPeer(multiaddr)
      await syncData()
      updateState((current) => ({
        ...current,
        activeView: 'conversations',
        focusArea: 'composer',
        isConnectOpen: false,
        connectText: '',
        selectedConversationId: `peer:${peer.peerId}`,
        messagesByConversation: {
          ...current.messagesByConversation,
          [`peer:${peer.peerId}`]: chatApp.getMessages(`peer:${peer.peerId}`)
        },
        statusMessage: `Connected ${peer.peerId}`
      }))
    } catch (error) {
      setStatus(error.message ?? 'Connect failed.')
    } finally {
      setBusy(false)
    }
  }

  async function submitMessage() {
    const text = state.composerText.trim()
    const conversation = getSelectedConversation()
    const peerId = getPeerIdFromConversation(conversation)

    if (!text) {
      setStatus('Message cannot be empty.')
      return
    }

    if (!peerId) {
      setStatus('Select a conversation first.')
      return
    }

    setBusy(true, 'Sending')

    try {
      await chatApp.sendMessage({ peerId, text })
      await syncData()
      updateState((current) => ({
        ...current,
        composerText: '',
        statusMessage: `Sent to ${peerId}`
      }))
    } catch (error) {
      setStatus(error.message ?? 'Send failed.')
    } finally {
      setBusy(false)
    }
  }

  function openConversationForPeer() {
    const peer = getSelectedPeer()

    if (!peer) {
      setStatus('No peer selected.')
      return
    }

    const conversationId = `peer:${peer.peerId}`
    const conversation = state.conversations.find((item) => item.conversationId === conversationId)

    if (!conversation) {
      if (peer.addrs?.[0]) {
        openConnectDialog(peer.addrs[0])
        return
      }

      setStatus('No conversation or peer address available.')
      return
    }

    updateState((current) => ({
      ...current,
      activeView: 'conversations',
      focusArea: 'composer',
      selectedConversationId: conversation.conversationId,
      messagesByConversation: {
        ...current.messagesByConversation,
        [conversation.conversationId]: chatApp.getMessages(conversation.conversationId)
      },
      statusMessage: `Opened conversation with ${peer.peerId}`
    }))
  }

  function connectSelectedPeer() {
    const peer = getSelectedPeer()

    if (!peer?.addrs?.[0]) {
      setStatus('Selected peer has no saved address.')
      return
    }

    openConnectDialog(peer.addrs[0])
  }

  async function runOverviewAction() {
    const action = OVERVIEW_ACTIONS[state.overviewActionIndex]

    if (action === 'connect') {
      openConnectDialog()
      return
    }

    if (action === 'refresh') {
      await refreshData()
      return
    }

    await exit()
  }

  async function runPeerAction() {
    const action = PEER_ACTIONS[state.peerActionIndex]

    if (action === 'connect') {
      connectSelectedPeer()
      return
    }

    openConversationForPeer()
  }

  async function handleConnectInput(input, key = {}) {
    if (key.name === 'escape') {
      closeConnectDialog()
      return
    }

    if (key.name === 'backspace') {
      updateState((current) => ({
        ...current,
        connectText: current.connectText.slice(0, -1)
      }))
      return
    }

    if (key.name === 'return') {
      await submitConnect()
      return
    }

    if (isPrintableInput(input, key)) {
      updateState((current) => ({
        ...current,
        connectText: current.connectText + input
      }))
    }
  }

  async function handleConversationInput(input, key = {}) {
    if (key.name === 'tab') {
      toggleConversationFocus()
      return
    }

    if (state.focusArea === 'conversation-list') {
      if (key.name === 'up') {
        moveConversationSelection(-1)
        return
      }

      if (key.name === 'down') {
        moveConversationSelection(1)
        return
      }

      if (key.name === 'return') {
        updateState((current) => ({
          ...current,
          focusArea: 'composer'
        }))
      }

      return
    }

    if (key.name === 'escape') {
      updateState((current) => ({
        ...current,
        focusArea: 'conversation-list'
      }))
      return
    }

    if (key.name === 'backspace') {
      updateState((current) => ({
        ...current,
        composerText: current.composerText.slice(0, -1)
      }))
      return
    }

    if (key.name === 'return') {
      await submitMessage()
      return
    }

    if (isPrintableInput(input, key)) {
      updateState((current) => ({
        ...current,
        composerText: current.composerText + input
      }))
    }
  }

  async function handlePeerInput(input, key = {}) {
    if (key.name === 'tab') {
      togglePeerFocus()
      return
    }

    if (state.focusArea === 'peer-list') {
      if (key.name === 'up') {
        movePeerSelection(-1)
        return
      }

      if (key.name === 'down') {
        movePeerSelection(1)
        return
      }

      if (key.name === 'return') {
        openConversationForPeer()
      }

      return
    }

    if (key.name === 'left') {
      movePeerAction(-1)
      return
    }

    if (key.name === 'right') {
      movePeerAction(1)
      return
    }

    if (key.name === 'escape') {
      updateState((current) => ({
        ...current,
        focusArea: 'peer-list'
      }))
      return
    }

    if (key.name === 'return') {
      await runPeerAction()
    }
  }

  async function handleOverviewInput(key = {}) {
    if (key.name === 'up') {
      moveOverviewAction(-1)
      return
    }

    if (key.name === 'down') {
      moveOverviewAction(1)
      return
    }

    if (key.name === 'return') {
      await runOverviewAction()
    }
  }

  async function handleInput(input, key = {}) {
    if (state.shouldExit) {
      return
    }

    if ((key.ctrl && key.name === 'c') || key.sequence === '\u0003') {
      await exit()
      return
    }

    if (key.ctrl && key.name === 'r') {
      await refreshData()
      return
    }

    if (state.isConnectOpen) {
      await handleConnectInput(input, key)
      return
    }

    if (state.activeView === 'peers' && state.focusArea === 'peer-actions') {
      await handlePeerInput(input, key)
      return
    }

    if (key.name === 'left') {
      moveView(-1)
      return
    }

    if (key.name === 'right') {
      moveView(1)
      return
    }

    if (state.activeView === 'conversations') {
      await handleConversationInput(input, key)
      return
    }

    if (state.activeView === 'peers') {
      await handlePeerInput(input, key)
      return
    }

    await handleOverviewInput(key)
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
      shouldExit: true
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
    handleInput
  }
}

function useControllerState(controller) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot)
}

function Section({ title, children, grow = false }) {
  return React.createElement(
    Box,
    {
      borderStyle: 'round',
      borderColor: 'gray',
      paddingX: 1,
      paddingY: 0,
      flexDirection: 'column',
      flexGrow: grow ? 1 : 0,
      width: grow ? undefined : '100%'
    },
    React.createElement(Text, { color: 'cyanBright' }, title),
    children
  )
}

function BulletList({ items, emptyLabel, selectedIndex = -1, dimUnselected = false }) {
  if (items.length === 0) {
    return React.createElement(Text, { color: 'gray' }, emptyLabel)
  }

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    ...items.map((item, index) =>
      React.createElement(
        Text,
        {
          key: `${item.key ?? item.label}-${index}`,
          color: index === selectedIndex ? 'greenBright' : undefined,
          dimColor: dimUnselected && index !== selectedIndex
        },
        `${index === selectedIndex ? '›' : ' '} ${item.label}`
      )
    )
  )
}

function renderHeader(state) {
  const peerId = state.node?.peerId ?? 'starting'
  const readiness = state.isReady ? 'ready' : 'booting'

  return React.createElement(
    Box,
    { justifyContent: 'space-between' },
    React.createElement(
      Text,
      { color: 'blueBright' },
      `P2P Chat Console  peer ${peerId}`
    ),
    React.createElement(
      Text,
      { color: state.isBusy ? 'yellowBright' : 'greenBright' },
      state.isBusy ? `${state.busyLabel}...` : readiness
    )
  )
}

function renderNav(state) {
  return React.createElement(
    Box,
    { marginTop: 1, marginBottom: 1 },
    ...VIEWS.map((view, index) =>
      React.createElement(
        Text,
        {
          key: view,
          color: state.activeView === view ? 'black' : 'gray',
          backgroundColor: state.activeView === view ? 'cyan' : undefined
        },
        `${index > 0 ? '  ' : ''}${getViewLabel(view)}`
      )
    )
  )
}

function renderOverview(state) {
  const recentPeers = state.peers.slice(0, 4).map((peer) => ({
    key: peer.peerId,
    label: `${truncate(peer.peerId, 24)}  ${peer.status ?? 'unknown'}`
  }))
  const recentConversations = state.conversations.slice(0, 4).map((conversation) => {
    const preview = conversation.lastMessageText ? normalizeMessageText(conversation.lastMessageText) : 'No messages yet'
    return {
      key: conversation.conversationId,
      label: `${truncate(conversation.title ?? conversation.conversationId, 16)}  ${truncate(preview, 28)}`
    }
  })
  const addresses = state.node?.addresses?.length ? state.node.addresses.join(', ') : 'No listen addresses'

  return React.createElement(
    Box,
    { flexDirection: 'column', flexGrow: 1 },
    React.createElement(
      Box,
      { columnGap: 1 },
      React.createElement(
        Box,
        { flexDirection: 'column', flexGrow: 1, width: '58%' },
        React.createElement(
          Section,
          { title: 'Node' },
          React.createElement(Text, null, `Peer ID: ${state.node?.peerId ?? 'starting'}`),
          React.createElement(Text, null, `Peers: ${state.peers.length}`),
          React.createElement(Text, null, `Conversations: ${state.conversations.length}`),
          React.createElement(Text, { wrap: 'truncate-end' }, `Listen: ${addresses}`)
        ),
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(
            Section,
            { title: 'Actions' },
            React.createElement(
              BulletList,
              {
                items: OVERVIEW_ACTIONS.map((action) => ({ key: action, label: action })),
                emptyLabel: 'No actions.',
                selectedIndex: state.overviewActionIndex
              }
            )
          )
        )
      ),
      React.createElement(
        Box,
        { flexDirection: 'column', flexGrow: 1 },
        React.createElement(
          Section,
          { title: 'Recent Peers' },
          React.createElement(BulletList, {
            items: recentPeers,
            emptyLabel: 'No peers connected yet.'
          })
        ),
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(
            Section,
            { title: 'Recent Conversations' },
            React.createElement(BulletList, {
              items: recentConversations,
              emptyLabel: 'No conversations yet.'
            })
          )
        )
      )
    )
  )
}

function renderConversationView(state) {
  const selectedConversation = state.conversations.find((item) => item.conversationId === state.selectedConversationId) ?? null
  const messages = selectedConversation ? state.messagesByConversation[selectedConversation.conversationId] ?? [] : []
  const conversationItems = state.conversations.map((conversation) => {
    const preview = conversation.lastMessageText ? normalizeMessageText(conversation.lastMessageText) : 'No messages yet'
    return {
      key: conversation.conversationId,
      label: `${truncate(conversation.title ?? conversation.conversationId, 14)}  ${truncate(preview, 20)}`
    }
  })

  return React.createElement(
    Box,
    { columnGap: 1, flexGrow: 1 },
    React.createElement(
      Box,
      { width: '34%', flexDirection: 'column' },
      React.createElement(
        Section,
        { title: `Conversations ${state.focusArea === 'conversation-list' ? '[focus]' : ''}`, grow: true },
        React.createElement(BulletList, {
          items: conversationItems,
          emptyLabel: 'No conversations yet.',
          selectedIndex: state.conversations.findIndex((item) => item.conversationId === state.selectedConversationId),
          dimUnselected: true
        })
      )
    ),
    React.createElement(
      Box,
      { flexDirection: 'column', flexGrow: 1 },
      React.createElement(
        Section,
        {
          title: selectedConversation
            ? `Thread ${selectedConversation.title ?? selectedConversation.conversationId}`
            : 'Thread',
          grow: true
        },
        messages.length === 0
          ? React.createElement(Text, { color: 'gray' }, 'Nothing to show.')
          : React.createElement(
              Box,
              { flexDirection: 'column' },
              ...messages.slice(-12).map((message) =>
                React.createElement(
                  Text,
                  { key: message.id, wrap: 'truncate-end' },
                  `${formatTimestamp(message.ts)} ${message.direction === 'out' ? 'me' : truncate(message.from ?? 'peer', 12)} ${message.status}  ${truncate(message.text, 72)}`
                )
              )
            )
      ),
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(
          Section,
          { title: `Message ${state.focusArea === 'composer' ? '[focus]' : ''}` },
          React.createElement(TextInput, {
            value: state.composerText,
            placeholder: selectedConversation ? 'Type a message and press Enter' : 'Select a conversation first',
            focus: state.focusArea === 'composer' && !state.isConnectOpen,
            showCursor: state.focusArea === 'composer' && !state.isConnectOpen,
            onChange: () => {}
          })
        )
      )
    )
  )
}

function renderPeersView(state) {
  const selectedPeer = state.peers[state.selectedPeerIndex] ?? null
  const peerItems = state.peers.map((peer) => ({
    key: peer.peerId,
    label: `${truncate(peer.peerId, 18)}  ${peer.status ?? 'unknown'}`
  }))
  const addresses = selectedPeer?.addrs?.length ? selectedPeer.addrs.join(', ') : 'No saved addresses'

  return React.createElement(
    Box,
    { columnGap: 1, flexGrow: 1 },
    React.createElement(
      Box,
      { width: '34%', flexDirection: 'column' },
      React.createElement(
        Section,
        { title: `Known Peers ${state.focusArea === 'peer-list' ? '[focus]' : ''}`, grow: true },
        React.createElement(BulletList, {
          items: peerItems,
          emptyLabel: 'No peers yet.',
          selectedIndex: state.selectedPeerIndex,
          dimUnselected: true
        })
      )
    ),
    React.createElement(
      Box,
      { flexDirection: 'column', flexGrow: 1 },
      React.createElement(
        Section,
        { title: 'Peer Details' },
        selectedPeer
          ? React.createElement(
              Box,
              { flexDirection: 'column' },
              React.createElement(Text, null, `Peer ID: ${selectedPeer.peerId}`),
              React.createElement(Text, null, `Status: ${selectedPeer.status ?? 'unknown'}`),
              React.createElement(Text, null, `Last seen: ${formatTimestamp(selectedPeer.lastSeen)}`),
              React.createElement(Text, { wrap: 'truncate-end' }, `Addresses: ${addresses}`)
            )
          : React.createElement(Text, { color: 'gray' }, 'Select a peer to inspect.')
      ),
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(
          Section,
          { title: `Peer Actions ${state.focusArea === 'peer-actions' ? '[focus]' : ''}` },
          React.createElement(BulletList, {
            items: PEER_ACTIONS.map((action) => ({ key: action, label: action })),
            emptyLabel: 'No actions.',
            selectedIndex: state.peerActionIndex
          })
        )
      )
    )
  )
}

function renderConnectDialog(state) {
  if (!state.isConnectOpen) {
    return null
  }

  return React.createElement(
    Box,
    { marginBottom: 1 },
    React.createElement(
      Section,
      { title: 'Connect' },
      React.createElement(Text, { color: 'gray' }, 'Paste a multiaddr, press Enter to connect, Esc to cancel.'),
      React.createElement(TextInput, {
        value: state.connectText,
        placeholder: '/ip4/127.0.0.1/tcp/15002/ws/p2p/<peerId>',
        focus: true,
        showCursor: true,
        onChange: () => {}
      })
    )
  )
}

function renderFooter(state) {
  const shortcutText =
    state.activeView === 'conversations'
      ? 'Left/Right switch view  Tab toggle focus  Up/Down move  Enter submit  Ctrl+R refresh  Ctrl+C quit'
      : 'Left/Right switch view  Up/Down move  Enter select  Tab focus  Ctrl+R refresh  Ctrl+C quit'

  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    React.createElement(
      Text,
      { color: state.statusMessage.toLowerCase().includes('failed') ? 'redBright' : 'yellowBright', wrap: 'truncate-end' },
      `Status: ${state.statusMessage}`
    ),
    React.createElement(Text, { color: 'gray', wrap: 'truncate-end' }, shortcutText)
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
    renderNav(state),
    renderConnectDialog(state),
    !state.isReady
      ? React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(
            Section,
            { title: 'Booting' },
            React.createElement(
              Box,
              null,
              React.createElement(Spinner, { type: 'dots' }),
              React.createElement(Text, null, ` ${state.statusMessage}`)
            )
          )
        )
      : state.activeView === 'conversations'
        ? renderConversationView(state)
        : state.activeView === 'peers'
          ? renderPeersView(state)
          : renderOverview(state),
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
