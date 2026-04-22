import { describe, expect, it } from 'vitest'

import { createDirectConversationId, decodeMessage, encodeMessage } from '../src/protocol/codec.js'

describe('protocol codec', () => {
  it('encodes and decodes a chat message', () => {
    const message = {
      type: 'chat',
      id: 'message-1',
      conversationId: 'peer:12D3KooWsender',
      from: '12D3KooWsender',
      to: '12D3KooWreceiver',
      text: 'hello from test',
      ts: 1760000000
    }

    const encoded = encodeMessage(message)
    const decoded = decodeMessage(encoded)

    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(decoded).toEqual(message)
  })

  it('creates a stable direct conversation id', () => {
    expect(createDirectConversationId('12D3KooWpeer')).toBe('peer:12D3KooWpeer')
  })
})
