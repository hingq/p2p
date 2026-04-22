import { join } from 'node:path'

import { createChatApp } from './app/chat-app.js'
import { createTerminalApp } from './terminal/create-terminal-app.js'
import { createLibp2pTransport } from './transport/libp2p-transport.js'

const dataDirectory = process.env.CHAT_DATA_DIR ?? join(process.cwd(), '.data')
const listenAddresses = (process.env.CHAT_P2P_LISTEN ?? '/ip4/127.0.0.1/tcp/0/ws')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const transport = createLibp2pTransport({
  dataDirectory,
  listenAddresses
})
const chatApp = createChatApp({
  dataDirectory,
  transport
})

let shuttingDown = false

async function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  await chatApp.stop()
}

const terminalApp = createTerminalApp({
  chatApp,
  onExit: shutdown
})

process.once('SIGINT', () => {
  void terminalApp.exit()
})

process.once('SIGTERM', () => {
  void terminalApp.exit()
})

terminalApp.start().catch(async (error) => {
  console.error(error.message ?? error)
  await terminalApp.exit()
  process.exit(1)
})
