import { describe, expect, it, vi } from 'vitest'
import * as lp from 'it-length-prefixed'
import { multiaddr } from '@multiformats/multiaddr'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'

import { createLibp2pTransport } from '../src/transport/libp2p-transport.js'
import { decodeMessage, encodeMessage } from '../src/protocol/codec.js'

function createFakePeerId(id) {
  return {
    toString() {
      return id
    },
    equals(other) {
      return other?.toString?.() === id
    }
  }
}

async function decodeFrame(frame) {
  const decoded = []

  for await (const chunk of lp.decode([frame])) {
    decoded.push(decodeMessage(chunk.slice()))
  }

  return decoded[0]
}

async function createPeerIdString() {
  return peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString()
}

describe('libp2p transport', () => {
  it('starts, registers a handler and connects to peers', async () => {
    let registeredHandler
    const localPeerId = await createPeerIdString()
    const remotePeerId = await createPeerIdString()

    const fakeNode = {
      peerId: createFakePeerId(localPeerId),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      getMultiaddrs: vi.fn(() => [multiaddr(`/ip4/127.0.0.1/tcp/15002/ws/p2p/${localPeerId}`)]),
      handle: vi.fn(async (_protocol, handler) => {
        registeredHandler = handler
      }),
      dial: vi.fn(async () => ({
        remotePeer: createFakePeerId(remotePeerId)
      })),
      dialProtocol: vi.fn()
    }

    const transport = createLibp2pTransport({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0/ws'],
      createNode: vi.fn(async () => fakeNode)
    })

    const state = await transport.start()
    const peer = await transport.connectToPeer(`/ip4/203.0.113.10/tcp/15002/ws/p2p/${remotePeerId}`)

    expect(state).toEqual({
      peerId: localPeerId,
      addresses: [`/ip4/127.0.0.1/tcp/15002/ws/p2p/${localPeerId}`]
    })
    expect(peer).toEqual({
      peerId: remotePeerId,
      multiaddr: `/ip4/203.0.113.10/tcp/15002/ws/p2p/${remotePeerId}`,
      status: 'connected'
    })
    expect(fakeNode.handle).toHaveBeenCalledTimes(1)
    expect(typeof registeredHandler).toBe('function')
  })

  it('encodes outgoing messages and emits decoded incoming messages', async () => {
    let registeredHandler
    const sentFrames = []
    const localPeerId = await createPeerIdString()
    const remotePeerId = await createPeerIdString()

    const fakeNode = {
      peerId: createFakePeerId(localPeerId),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      getMultiaddrs: vi.fn(() => [multiaddr(`/ip4/127.0.0.1/tcp/15002/ws/p2p/${localPeerId}`)]),
      handle: vi.fn(async (_protocol, handler) => {
        registeredHandler = handler
      }),
      dial: vi.fn(async () => ({
        remotePeer: createFakePeerId(remotePeerId)
      })),
      dialProtocol: vi.fn(async () => ({
        send(frame) {
          sentFrames.push(frame.slice())
          return true
        },
        close: vi.fn(async () => {})
      }))
    }

    const transport = createLibp2pTransport({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0/ws'],
      createNode: vi.fn(async () => fakeNode)
    })
    const receivedEvents = []

    transport.on('message:received', (message) => {
      receivedEvents.push(message)
    })

    await transport.start()
    await transport.connectToPeer(`/ip4/203.0.113.10/tcp/15002/ws/p2p/${remotePeerId}`)
    await transport.sendChatMessage({
      id: 'message-1',
      conversationId: `peer:${remotePeerId}`,
      from: localPeerId,
      to: remotePeerId,
      text: 'hello remote peer',
      ts: 1760000000
    })

    await registeredHandler(
      {
        async *[Symbol.asyncIterator]() {
          yield lp.encode.single(
            encodeMessage({
              type: 'chat',
              id: 'message-2',
              conversationId: `peer:${localPeerId}`,
              from: remotePeerId,
              to: localPeerId,
              text: 'hello local peer',
              ts: 1760000001
            })
          )
        }
      },
      {
        remotePeer: createFakePeerId(remotePeerId)
      }
    )

    expect(await decodeFrame(sentFrames[0])).toEqual({
      type: 'chat',
      id: 'message-1',
      conversationId: `peer:${remotePeerId}`,
      from: localPeerId,
      to: remotePeerId,
      text: 'hello remote peer',
      ts: 1760000000
    })
    expect(receivedEvents).toEqual([
      {
        type: 'chat',
        id: 'message-2',
        conversationId: `peer:${localPeerId}`,
        from: remotePeerId,
        to: localPeerId,
        text: 'hello local peer',
        ts: 1760000001
      }
    ])
  })
})
