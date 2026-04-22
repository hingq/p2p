import { join } from 'node:path'

import { createChatApp } from './app/chat-app.js'
import { createApiServer } from './server/create-api-server.js'
import { createLibp2pTransport } from './transport/libp2p-transport.js'

const dataDirectory = process.env.CHAT_DATA_DIR ?? join(process.cwd(), '.data')
const apiPort = Number.parseInt(process.env.CHAT_API_PORT ?? process.env.PORT ?? '3030', 10)
const apiHost = process.env.CHAT_API_HOST ?? '127.0.0.1'
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
const apiServer = createApiServer({
  chatApp,
  port: apiPort,
  host: apiHost
})

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  try {
    await chatApp.stop()
    await apiServer.stop()
  } finally {
    if (signal) {
      process.exit(0)
    }
  }
}

async function main() {
  const baseUrl = await apiServer.start()

  process.once('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
  })

  console.log(`P2P Chat API listening at ${baseUrl}`)
}

main().catch(async (error) => {
  console.error(error)
  await shutdown()
  process.exit(1)
})
