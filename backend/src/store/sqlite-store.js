import Database from 'better-sqlite3'

function parseJson(value, fallback) {
  return value ? JSON.parse(value) : fallback
}

export class SqliteStore {
  constructor({ filename }) {
    this.filename = filename
    this.database = null
  }

  initialize() {
    this.database = new Database(this.filename)
    this.database.pragma('journal_mode = WAL')

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS peers (
        peer_id TEXT PRIMARY KEY,
        addrs TEXT NOT NULL DEFAULT '[]',
        last_seen INTEGER,
        status TEXT
      );

      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        participants TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        from_peer TEXT NOT NULL,
        to_peer TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        ts INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_ts
      ON messages (conversation_id, ts);
    `)
  }

  upsertPeer(peer) {
    this.database
      .prepare(`
        INSERT INTO peers (peer_id, addrs, last_seen, status)
        VALUES (@peerId, @addrs, @lastSeen, @status)
        ON CONFLICT(peer_id) DO UPDATE SET
          addrs = excluded.addrs,
          last_seen = excluded.last_seen,
          status = excluded.status
      `)
      .run({
        peerId: peer.peerId,
        addrs: JSON.stringify(peer.addrs ?? []),
        lastSeen: peer.lastSeen ?? null,
        status: peer.status ?? 'unknown'
      })
  }

  upsertConversation(conversation) {
    this.database
      .prepare(`
        INSERT INTO conversations (conversation_id, type, participants, updated_at)
        VALUES (@conversationId, @type, @participants, @updatedAt)
        ON CONFLICT(conversation_id) DO UPDATE SET
          type = excluded.type,
          participants = excluded.participants,
          updated_at = excluded.updated_at
      `)
      .run({
        conversationId: conversation.conversationId,
        type: conversation.type,
        participants: JSON.stringify(conversation.participants ?? []),
        updatedAt: conversation.updatedAt
      })
  }

  saveMessage(message) {
    this.database
      .prepare(`
        INSERT INTO messages (id, conversation_id, direction, from_peer, to_peer, text, status, ts)
        VALUES (@id, @conversationId, @direction, @from, @to, @text, @status, @ts)
      `)
      .run(message)

    this.database
      .prepare(`
        UPDATE conversations
        SET updated_at = MAX(updated_at, @updatedAt)
        WHERE conversation_id = @conversationId
      `)
      .run({
        conversationId: message.conversationId,
        updatedAt: message.ts
      })
  }

  updateMessageStatus(messageId, status) {
    this.database
      .prepare(`
        UPDATE messages
        SET status = ?
        WHERE id = ?
      `)
      .run(status, messageId)
  }

  getMessages(conversationId) {
    return this.database
      .prepare(`
        SELECT
          id,
          conversation_id AS conversationId,
          direction,
          from_peer AS "from",
          to_peer AS "to",
          text,
          status,
          ts
        FROM messages
        WHERE conversation_id = ?
        ORDER BY ts ASC, id ASC
      `)
      .all(conversationId)
  }

  listConversations() {
    return this.database
      .prepare(`
        SELECT
          c.conversation_id AS conversationId,
          c.type,
          c.participants,
          c.updated_at AS updatedAt,
          (
            SELECT text
            FROM messages m
            WHERE m.conversation_id = c.conversation_id
            ORDER BY m.ts DESC, m.id DESC
            LIMIT 1
          ) AS lastMessageText
        FROM conversations c
        ORDER BY c.updated_at DESC, c.conversation_id ASC
      `)
      .all()
      .map((conversation) => ({
        ...conversation,
        participants: parseJson(conversation.participants, [])
      }))
  }

  close() {
    this.database?.close()
    this.database = null
  }
}
