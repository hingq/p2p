<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

const props = defineProps({
  initialState: {
    type: Object,
    default: null
  }
})

const state = reactive(createInitialState(props.initialState))
const connectForm = reactive({
  multiaddr: '',
  error: ''
})
const composer = reactive({
  text: '',
  error: ''
})
const statusMessage = ref('')
const selectedConversationId = ref(state.conversations[0]?.conversationId ?? null)

let eventSocket

const selectedConversation = computed(
  () => state.conversations.find((conversation) => conversation.conversationId === selectedConversationId.value) ?? null
)
const selectedMessages = computed(() => {
  if (selectedConversationId.value == null) {
    return []
  }

  return state.messagesByConversation[selectedConversationId.value] ?? []
})
const selectedPeerId = computed(() => {
  if (selectedConversation.value?.title) {
    return selectedConversation.value.title
  }

  if (selectedConversation.value?.conversationId?.startsWith('peer:')) {
    return selectedConversation.value.conversationId.slice(5)
  }

  return ''
})

watch(
  () => state.conversations,
  (conversations) => {
    if (selectedConversationId.value == null && conversations.length > 0) {
      selectedConversationId.value = conversations[0].conversationId
      return
    }

    if (
      selectedConversationId.value != null &&
      !conversations.some((conversation) => conversation.conversationId === selectedConversationId.value)
    ) {
      selectedConversationId.value = conversations[0]?.conversationId ?? null
    }
  },
  { deep: true }
)

onMounted(() => {
  if (props.initialState != null) {
    return
  }

  void bootstrap()
})

onBeforeUnmount(() => {
  eventSocket?.close()
})

async function bootstrap() {
  await startNode()
  await refreshConversations()
  connectEvents()
}

async function startNode() {
  try {
    const response = await fetch('/api/node/start', {
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Node start failed: ${response.status}`)
    }

    state.node = await response.json()
    statusMessage.value = '节点已启动'
  } catch (error) {
    statusMessage.value = error.message ?? '节点启动失败'
  }
}

async function refreshConversations() {
  const response = await fetch('/api/conversations')
  const conversations = await response.json()

  state.conversations = conversations

  if (selectedConversationId.value == null && conversations.length > 0) {
    selectedConversationId.value = conversations[0].conversationId
  }

  if (selectedConversationId.value != null) {
    await loadMessages(selectedConversationId.value)
  }
}

async function loadMessages(conversationId) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`)

  state.messagesByConversation[conversationId] = await response.json()
}

async function connectPeer() {
  connectForm.error = ''
  statusMessage.value = ''

  try {
    const response = await fetch('/api/peers/connect', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        multiaddr: connectForm.multiaddr
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error ?? '连接失败')
    }

    const peer = await response.json()
    statusMessage.value = `已连接 ${peer.peerId}`
    connectForm.multiaddr = ''
    await refreshConversations()
  } catch (error) {
    connectForm.error = error.message ?? '连接失败'
  }
}

async function selectConversation(conversationId) {
  selectedConversationId.value = conversationId
  await loadMessages(conversationId)
}

async function sendMessage() {
  composer.error = ''
  statusMessage.value = ''

  if (!composer.text.trim() || !selectedPeerId.value) {
    return
  }

  try {
    const response = await fetch('/api/messages/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        peerId: selectedPeerId.value,
        text: composer.text.trim()
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error ?? '发送失败')
    }

    composer.text = ''
    await refreshConversations()
    if (selectedConversationId.value != null) {
      await loadMessages(selectedConversationId.value)
    }
  } catch (error) {
    composer.error = error.message ?? '发送失败'
  }
}

function connectEvents() {
  if (eventSocket != null) {
    return
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

  eventSocket = new WebSocket(`${protocol}//${window.location.host}/events`)
  eventSocket.addEventListener('message', async (event) => {
    const message = JSON.parse(event.data)

    if (message.type === 'ready') {
      return
    }

    if (message.type === 'message:received' || message.type === 'message:updated') {
      const { conversationId, message: payload } = message.payload
      const messages = state.messagesByConversation[conversationId] ?? []
      const nextMessages = messages.filter((item) => item.id !== payload.id)
      nextMessages.push(payload)
      nextMessages.sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id))
      state.messagesByConversation[conversationId] = nextMessages

      await refreshConversations()
      if (selectedConversationId.value == null) {
        selectedConversationId.value = conversationId
      }
      return
    }

    if (message.type === 'peer:connected') {
      statusMessage.value = `已连接 ${message.payload.peerId}`
    }
  })
}

function createInitialState(initialState) {
  return {
    node: initialState?.node ?? null,
    conversations: initialState?.conversations ?? [],
    messagesByConversation: initialState?.messagesByConversation ?? {}
  }
}
</script>

<template>
  <div class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">P2P Messaging MVP</p>
        <h1>P2P Chat</h1>
        <p class="summary">
          手动交换 multiaddr，建立节点直连，保留本地消息历史。
        </p>
      </div>
      <div class="status-card">
        <p class="status-label">本地节点</p>
        <p class="status-peer">{{ state.node?.peerId ?? '未启动' }}</p>
        <ul class="address-list">
          <li v-for="address in state.node?.addresses ?? []" :key="address">
            {{ address }}
          </li>
        </ul>
        <p class="status-meta">
          已连接 {{ state.node?.connectionCount ?? 0 }} 个节点
        </p>
      </div>
    </header>

    <main class="layout">
      <aside class="sidebar">
        <section class="panel">
          <div class="panel-title-row">
            <h2>连接节点</h2>
            <button class="ghost-button" type="button" @click="startNode">启动节点</button>
          </div>
          <form class="stack" @submit.prevent="connectPeer">
            <label class="field">
              <span>目标 multiaddr</span>
              <textarea v-model="connectForm.multiaddr" rows="3" placeholder="/ip4/127.0.0.1/tcp/15002/ws/p2p/..." />
            </label>
            <button class="primary-button" type="submit">连接</button>
            <p v-if="connectForm.error" class="error-text">{{ connectForm.error }}</p>
          </form>
        </section>

        <section class="panel">
          <div class="panel-title-row">
            <h2>会话</h2>
            <button class="ghost-button" type="button" @click="refreshConversations">刷新</button>
          </div>
          <div class="conversation-list">
            <button v-for="conversation in state.conversations" :key="conversation.conversationId"
              class="conversation-card" :class="{ active: conversation.conversationId === selectedConversationId }"
              type="button" @click="selectConversation(conversation.conversationId)">
              <strong>{{ conversation.title }}</strong>
              <span>{{ conversation.lastMessageText ?? '暂无消息' }}</span>
            </button>
          </div>
        </section>
      </aside>

      <section class="panel chat-panel">
        <div class="chat-header">
          <div>
            <p class="status-label">当前会话</p>
            <h2>{{ selectedConversation?.title ?? '选择一个会话' }}</h2>
          </div>
          <p class="status-note">{{ statusMessage }}</p>
        </div>

        <div class="message-list">
          <article v-for="message in selectedMessages" :key="message.id" class="message-card"
            :class="message.direction === 'out' ? 'outbound' : 'inbound'">
            <p class="message-text">{{ message.text }}</p>
            <div class="message-meta">
              <span>{{ message.from }}</span>
              <span>{{ message.status }}</span>
            </div>
          </article>
          <p v-if="selectedMessages.length === 0" class="empty-state">
            发送第一条消息，或等待对端发来内容。
          </p>
        </div>

        <form class="composer" @submit.prevent="sendMessage">
          <label class="field">
            <span>消息内容</span>
            <textarea v-model="composer.text" rows="4" placeholder="输入要发送给当前 peer 的文本消息" />
          </label>
          <div class="composer-actions">
            <p v-if="composer.error" class="error-text">{{ composer.error }}</p>
            <button class="primary-button" type="submit" :disabled="!selectedConversation">
              发送消息
            </button>
          </div>
        </form>
      </section>
    </main>
  </div>
</template>

<style scoped>
:global(body) {
  margin: 0;
  font-family: "IBM Plex Sans", "Noto Sans SC", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(242, 198, 102, 0.2), transparent 30%),
    linear-gradient(180deg, #f4efe5 0%, #efe7d8 100%);
  color: #18222d;
}

:global(*) {
  box-sizing: border-box;
}

.shell {
  min-height: 100vh;
  /* padding: 32px; */
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.9fr);
  gap: 24px;
  margin-bottom: 24px;
}

.eyebrow,
.status-label {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7a5d2f;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-family: "IBM Plex Serif", "Source Han Serif SC", serif;
  font-size: clamp(40px, 6vw, 64px);
  line-height: 0.95;
}

.summary {
  max-width: 48rem;
  margin-top: 14px;
  font-size: 16px;
  line-height: 1.6;
  color: #425466;
}

.status-card,
.panel {
  border: 1px solid rgba(24, 34, 45, 0.12);
  border-radius: 24px;
  background: rgba(255, 252, 247, 0.8);
  box-shadow: 0 20px 60px rgba(24, 34, 45, 0.08);
  backdrop-filter: blur(10px);
}

.status-card {
  padding: 24px;
}

.status-peer {
  font-weight: 700;
  word-break: break-all;
}

.status-meta,
.status-note,
.message-meta,
.conversation-card span,
.empty-state {
  color: #58697a;
}

.address-list {
  padding-left: 18px;
  margin: 12px 0;
  word-break: break-all;
}

.layout {
  margin: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.sidebar {
  display: grid;
  gap: 24px;

  .panel {
    width: 25vw;
  }
}

.panel {
  padding: 20px;
  width: 70vw;
}

.panel-title-row,
.chat-header,
.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.stack {
  display: grid;
  gap: 14px;
  margin-top: 16px;
}

.field {
  display: grid;
  gap: 8px;
  font-size: 14px;
}

textarea {
  width: 100%;
  border: 1px solid rgba(24, 34, 45, 0.15);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.85);
  padding: 14px 16px;
  font: inherit;
  resize: vertical;
  color: inherit;
}

button {
  font: inherit;
  cursor: pointer;
}

.primary-button,
.ghost-button,
.conversation-card {
  border-radius: 999px;
  transition: transform 120ms ease, background-color 120ms ease, color 120ms ease;
}

.primary-button {
  border: none;
  padding: 12px 18px;
  background: linear-gradient(135deg, #c0572e, #d8922d);
  color: #fff7f0;
  font-weight: 600;
}

.ghost-button {
  border: 1px solid rgba(24, 34, 45, 0.14);
  background: transparent;
  padding: 10px 14px;
  color: #18222d;
}

.conversation-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.conversation-card {
  display: grid;
  gap: 6px;
  border: 1px solid rgba(24, 34, 45, 0.1);
  background: rgba(255, 255, 255, 0.75);
  padding: 12px;
  text-align: left;
  width: 300px;
  overflow: hidden;
}

.conversation-card.active {
  background: #1f3447;
  color: #f8f4eb;
}

.conversation-card.active span {
  color: rgba(248, 244, 235, 0.72);
}

.chat-panel {
  display: grid;
  gap: 20px;
  min-height: 620px;
}

.message-list {
  display: grid;
  gap: 12px;
  align-content: start;
  min-height: 320px;
}

.message-card {
  max-width: min(80%, 720px);
  border-radius: 20px;
  padding: 16px;
  background: #fffdfa;
  border: 1px solid rgba(24, 34, 45, 0.08);
}

.message-card.outbound {
  margin-left: auto;
  background: linear-gradient(135deg, #20374c, #35536d);
  color: #f9f6ef;
}

.message-card.outbound .message-meta {
  color: rgba(249, 246, 239, 0.75);
}

.message-text {
  margin-bottom: 10px;
  line-height: 1.5;
}

.message-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  word-break: break-all;
}

.composer {
  display: grid;
  gap: 12px;
}

.error-text {
  color: #af2d2d;
  font-size: 14px;
}

.empty-state {
  padding: 32px 12px;
  text-align: center;
}

@media (max-width: 960px) {
  .shell {
    padding: 20px;
  }

  .hero,
  .layout {
    grid-template-columns: 1fr;
  }

  .message-card {
    max-width: 100%;
  }

  .panel-title-row,
  .chat-header,
  .composer-actions {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
