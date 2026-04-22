const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function createDirectConversationId(peerId) {
  return `peer:${peerId}`
}

export function encodeMessage(message) {
  return textEncoder.encode(JSON.stringify(message))
}

export function decodeMessage(bytes) {
  return JSON.parse(textDecoder.decode(bytes))
}
