import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { webSockets } from '@libp2p/websockets'
import { privateKeyFromProtobuf, privateKeyToProtobuf, generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromString } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr'
import * as lp from 'it-length-prefixed'

import { decodeMessage, encodeMessage } from '../protocol/codec.js'

export const CHAT_PROTOCOL = '/chat/1.0.0'

function extractPeerId(connection, address) {
  const fromConnection = connection?.remotePeer?.toString?.()

  if (fromConnection) {
    return fromConnection
  }

  const components = multiaddr(address).getComponents()
  const peerComponent = [...components].reverse().find((component) => component.name === 'p2p')

  if (peerComponent?.value) {
    return peerComponent.value
  }

  throw new Error(`Could not determine peer id from multiaddr: ${address}`)
}

async function createDefaultNode({ listenAddresses, identityFile }) {
  mkdirSync(join(identityFile, '..'), { recursive: true })

  let privateKey

  try {
    privateKey = privateKeyFromProtobuf(readFileSync(identityFile))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }

    privateKey = await generateKeyPair('Ed25519')
    writeFileSync(identityFile, privateKeyToProtobuf(privateKey))
  }

  return createLibp2p({
    start: false,
    privateKey,
    addresses: {
      listen: listenAddresses
    },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping()
    }
  })
}

export function createLibp2pTransport({
  dataDirectory = join(process.cwd(), '.data'),
  listenAddresses = ['/ip4/127.0.0.1/tcp/0/ws'],
  createNode
} = {}) {
  const emitter = new EventEmitter()

  let node
  let started = false

  async function start() {
    if (started) {
      return {
        peerId: node.peerId.toString(),
        addresses: getAddresses()
      }
    }

    node =
      node ??
      (await (createNode?.() ??
        createDefaultNode({
          listenAddresses,
          identityFile: join(dataDirectory, 'identity', 'peer-id.key')
        })))

    await node.handle(CHAT_PROTOCOL, handleIncomingStream)
    await node.start()
    started = true

    return {
      peerId: node.peerId.toString(),
      addresses: getAddresses()
    }
  }

  async function stop() {
    if (!started) {
      return
    }

    await node.unhandle?.(CHAT_PROTOCOL)
    await node.stop()
    started = false
  }

  async function connectToPeer(address) {
    const target = multiaddr(address)
    const connection = await node.dial(target)
    const peerId = extractPeerId(connection, address)

    return {
      peerId,
      multiaddr: address,
      status: 'connected'
    }
  }

  async function sendChatMessage(message) {
    const stream = await node.dialProtocol(peerIdFromString(message.to), CHAT_PROTOCOL)
    const payload = encodeMessage({
      ...message,
      type: 'chat'
    })
    const frame = lp.encode.single(payload)

    const writable = stream.send(frame)

    if (writable === false && typeof stream.onDrain === 'function') {
      await stream.onDrain()
    }

    await stream.close?.()
  }

  function on(eventName, listener) {
    emitter.on(eventName, listener)
  }

  function off(eventName, listener) {
    emitter.off(eventName, listener)
  }

  async function handleIncomingStream(stream, connection) {
    for await (const chunk of lp.decode(stream)) {
      emitter.emit('message:received', decodeMessage(chunk.slice()))
    }
  }

  function getAddresses() {
    return node.getMultiaddrs().map((address) => address.toString())
  }

  return {
    start,
    stop,
    connectToPeer,
    sendChatMessage,
    on,
    off
  }
}
