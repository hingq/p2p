import http from 'node:http'

import cors from 'cors'
import express from 'express'
import { WebSocketServer } from 'ws'

const EVENT_NAMES = ['message:received', 'message:updated', 'peer:connected', 'peer:disconnected']

export function createApiServer({
  chatApp,
  port = 3030,
  host = '127.0.0.1',
  createExpressApp = express,
  createHttpServer = http.createServer,
  createWebSocketServer = (options) => new WebSocketServer(options),
  createCorsMiddleware = cors,
  createJsonMiddleware = express.json
}) {
  const app = createExpressApp()
  const server = createHttpServer(app)
  const websocketServer = createWebSocketServer({ server, path: '/events' })
  const listeners = new Map()

  app.use(createCorsMiddleware())
  app.use(createJsonMiddleware())

  app.post('/api/node/start', async (_request, response, next) => {
    try {
      response.json(await chatApp.start())
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/peers', (_request, response) => {
    response.json(chatApp.listPeers?.() ?? [])
  })

  app.post('/api/peers/connect', async (request, response, next) => {
    try {
      response.json(await chatApp.connectToPeer(request.body.multiaddr))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/conversations', (_request, response) => {
    response.json(chatApp.listConversations())
  })

  app.get('/api/conversations/:conversationId/messages', (request, response) => {
    response.json(chatApp.getMessages(request.params.conversationId))
  })

  app.post('/api/messages/send', async (request, response, next) => {
    try {
      response.json(
        await chatApp.sendMessage({
          peerId: request.body.peerId,
          text: request.body.text
        })
      )
    } catch (error) {
      next(error)
    }
  })

  app.use((error, _request, response, _next) => {
    response.status(500).json({
      error: error.message ?? 'Unexpected server error'
    })
  })

  websocketServer.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        type: 'ready',
        payload: { ok: true }
      })
    )
  })

  for (const eventName of EVENT_NAMES) {
    const listener = (payload) => {
      const message = JSON.stringify({
        type: eventName,
        payload
      })

      for (const client of websocketServer.clients) {
        if (client.readyState === client.OPEN) {
          client.send(message)
        }
      }
    }

    listeners.set(eventName, listener)
    chatApp.on(eventName, listener)
  }

  return {
    async start() {
      const address = await new Promise((resolve, reject) => {
        server.listen(port, host, () => {
          resolve(server.address())
        })
        server.once('error', reject)
      })

      const boundHost = typeof address === 'object' && address?.address ? address.address : '127.0.0.1'
      const normalizedHost = boundHost === '::' ? '127.0.0.1' : boundHost
      const activePort = typeof address === 'object' ? address?.port : port

      return `http://${normalizedHost}:${activePort}`
    },
    async stop() {
      for (const [eventName, listener] of listeners) {
        chatApp.off(eventName, listener)
      }

      await new Promise((resolve, reject) => {
        websocketServer.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  }
}
