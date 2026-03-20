import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

import { createApiServer } from '../src/server/create-api-server.js'

function createFakeApp() {
  const routes = []
  let errorHandler

  return {
    use(handler) {
      if (handler.length === 4) {
        errorHandler = handler
      }
    },
    get(path, handler) {
      routes.push({ method: 'GET', path, handler })
    },
    post(path, handler) {
      routes.push({ method: 'POST', path, handler })
    },
    async invoke(method, path, body = {}) {
      const route = routes.find((candidate) => {
        if (candidate.method !== method) {
          return false
        }

        return matchPath(candidate.path, path) != null
      })

      if (!route) {
        throw new Error(`No route for ${method} ${path}`)
      }

      const request = {
        body,
        params: matchPath(route.path, path)
      }
      const response = {
        statusCode: 200,
        payload: null,
        status(code) {
          this.statusCode = code
          return this
        },
        json(payload) {
          this.payload = payload
          return this
        }
      }

      await route.handler(request, response, (error) => {
        if (error) {
          errorHandler(error, request, response, () => {})
        }
      })

      return response
    }
  }
}

function createFakeHttpServer() {
  const emitter = new EventEmitter()
  let currentAddress = null

  return {
    listen(port, host, callback) {
      currentAddress = {
        address: host,
        port: port === 0 ? 43030 : port
      }
      callback?.()
    },
    address() {
      return currentAddress
    },
    close(callback) {
      callback?.()
    },
    once: emitter.once.bind(emitter)
  }
}

function createFakeWebSocketServer() {
  const emitter = new EventEmitter()
  const clients = new Set()

  return {
    clients,
    on: emitter.on.bind(emitter),
    close(callback) {
      callback?.()
    },
    simulateConnection() {
      const socket = {
        OPEN: 1,
        readyState: 1,
        sent: [],
        send(payload) {
          this.sent.push(JSON.parse(payload))
        }
      }

      clients.add(socket)
      emitter.emit('connection', socket)

      return socket
    }
  }
}

function matchPath(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)

  if (patternParts.length !== pathParts.length) {
    return null
  }

  const params = {}

  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index]
    const pathPart = pathParts[index]

    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart)
      continue
    }

    if (patternPart !== pathPart) {
      return null
    }
  }

  return params
}

describe('api server', () => {
  const cleanup = []

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) {
      await fn()
    }
  })

  it('serves node, conversation and send-message endpoints', async () => {
    const fakeApp = createFakeApp()
    const fakeServer = createFakeHttpServer()
    const fakeWebSocketServer = createFakeWebSocketServer()
    const app = {
      start: vi.fn(async () => ({
        peerId: '12D3KooWlocal',
        addresses: ['/ip4/127.0.0.1/tcp/15002/ws'],
        connectionCount: 0
      })),
      listPeers: vi.fn(() => []),
      connectToPeer: vi.fn(async (multiaddr) => ({ peerId: '12D3KooWremote', multiaddr })),
      listConversations: vi.fn(() => [{ conversationId: 'peer:12D3KooWremote', title: '12D3KooWremote' }]),
      getMessages: vi.fn(() => [{ id: 'message-1', text: 'hello' }]),
      sendMessage: vi.fn(async () => ({ id: 'message-2', text: 'hello remote peer', status: 'sent' })),
      on: vi.fn(),
      off: vi.fn()
    }

    const server = createApiServer({
      chatApp: app,
      port: 0,
      createExpressApp: () => fakeApp,
      createHttpServer: () => fakeServer,
      createWebSocketServer: () => fakeWebSocketServer,
      createCorsMiddleware: () => (_request, _response, next) => next?.(),
      createJsonMiddleware: () => (_request, _response, next) => next?.()
    })
    const baseUrl = await server.start()
    cleanup.push(() => server.stop())

    expect(baseUrl).toBe('http://127.0.0.1:43030')

    const nodeResponse = await fakeApp.invoke('POST', '/api/node/start')
    expect(nodeResponse.payload).toEqual(
      expect.objectContaining({ peerId: '12D3KooWlocal' })
    )

    const conversationsResponse = await fakeApp.invoke('GET', '/api/conversations')
    expect(conversationsResponse.payload).toEqual([
      expect.objectContaining({ conversationId: 'peer:12D3KooWremote' })
    ])

    const sendResponse = await fakeApp.invoke('POST', '/api/messages/send', {
      peerId: '12D3KooWremote',
      text: 'hello remote peer'
    })
    expect(sendResponse.payload).toEqual(
      expect.objectContaining({ status: 'sent' })
    )
  })

  it('pushes chat app events over websocket', async () => {
    const fakeApp = createFakeApp()
    const fakeServer = createFakeHttpServer()
    const fakeWebSocketServer = createFakeWebSocketServer()
    const emitter = new EventEmitter()
    const app = {
      start: vi.fn(async () => ({
        peerId: '12D3KooWlocal',
        addresses: [],
        connectionCount: 0
      })),
      listPeers: vi.fn(() => []),
      connectToPeer: vi.fn(),
      listConversations: vi.fn(() => []),
      getMessages: vi.fn(() => []),
      sendMessage: vi.fn(),
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter)
    }

    const server = createApiServer({
      chatApp: app,
      port: 0,
      createExpressApp: () => fakeApp,
      createHttpServer: () => fakeServer,
      createWebSocketServer: () => fakeWebSocketServer,
      createCorsMiddleware: () => (_request, _response, next) => next?.(),
      createJsonMiddleware: () => (_request, _response, next) => next?.()
    })
    await server.start()
    cleanup.push(() => server.stop())

    const socket = fakeWebSocketServer.simulateConnection()

    emitter.emit('message:received', {
      conversationId: 'peer:12D3KooWremote',
      message: { id: 'message-1', text: 'hello local peer' }
    })

    expect(socket.sent[0]).toEqual({
      type: 'ready',
      payload: { ok: true }
    })
    expect(socket.sent[1]).toEqual({
      type: 'message:received',
      payload: {
        conversationId: 'peer:12D3KooWremote',
        message: { id: 'message-1', text: 'hello local peer' }
      }
    })
  })
})
