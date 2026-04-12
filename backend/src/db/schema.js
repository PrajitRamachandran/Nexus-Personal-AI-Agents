import { db } from './index.js'

// ===== BASE TABLES =====
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT    UNIQUE NOT NULL,
    email     TEXT    UNIQUE NOT NULL,
    password  TEXT    NOT NULL,
    created_at TEXT   DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    username        TEXT    NOT NULL,
    model           TEXT,
    prompt_tokens   INTEGER,
    response_tokens INTEGER,
    total_tokens    INTEGER,
    duration_ms     INTEGER,
    message_count   INTEGER,
    user_message    TEXT,
    assistant_reply TEXT,
    created_at      TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user
  ON conversations(user_id);

  CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id);
`);


// ===== SAFE MIGRATIONS (DO NOT CRASH IF EXISTS) =====

// Add pinned column
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN pinned INTEGER DEFAULT 0;`);
  console.log("Added 'pinned' column");
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.error(e.message);
  }
}

// Add updated_at (useful for sorting recent chats)
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN updated_at DATETIME;`);
  console.log("Added 'updated_at' column");
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.error(e.message);
  }
}

// Add message token count (future RAG / cost tracking)
try {
  db.exec(`ALTER TABLE messages ADD COLUMN token_count INTEGER;`);
  console.log("Added 'token_count' column");
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.error(e.message);
  }
}

// Add soft delete (future undo delete)
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN is_deleted INTEGER DEFAULT 0;`);
  console.log("Added 'is_deleted' column");
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.error(e.message);
  }
}

// Track which legacy chat_log row a conversation was imported from
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN legacy_log_id INTEGER;`);
  console.log("Added 'legacy_log_id' column");
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.error(e.message);
  }
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_legacy_log_id
  ON conversations(legacy_log_id)
  WHERE legacy_log_id IS NOT NULL;
`);

function legacyConversationTitle(userMessage) {
  const normalized = (userMessage || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'Imported Chat'
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized
}

function sqliteTimestamp(value) {
  if (typeof value === 'string' && value.trim()) return value
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

const legacyLogsToImport = db.prepare(`
  SELECT l.id, l.user_id, l.user_message, l.assistant_reply, l.created_at
  FROM chat_logs l
  LEFT JOIN conversations c ON c.legacy_log_id = l.id
  WHERE c.id IS NULL
  ORDER BY l.created_at ASC, l.id ASC
`).all()

if (legacyLogsToImport.length > 0) {
  const insertConversation = db.prepare(`
    INSERT INTO conversations (
      user_id, title, created_at, updated_at, pinned, is_deleted, legacy_log_id
    ) VALUES (?, ?, ?, ?, 0, 0, ?)
  `)

  const insertUserMessage = db.prepare(`
    INSERT INTO messages (conversation_id, role, content, created_at)
    VALUES (?, 'user', ?, ?)
  `)

  const insertAssistantMessage = db.prepare(`
    INSERT INTO messages (conversation_id, role, content, created_at)
    VALUES (?, 'assistant', ?, datetime(?, '+1 second'))
  `)

  const importLegacyLogs = db.transaction((logs) => {
    for (const log of logs) {
      const createdAt = sqliteTimestamp(log.created_at)
      const title = legacyConversationTitle(log.user_message)
      const result = insertConversation.run(
        log.user_id,
        title,
        createdAt,
        createdAt,
        log.id
      )

      const conversationId = result.lastInsertRowid

      if (log.user_message) {
        insertUserMessage.run(conversationId, log.user_message, createdAt)
      }

      if (log.assistant_reply) {
        insertAssistantMessage.run(conversationId, log.assistant_reply, createdAt)
      }
    }
  })

  importLegacyLogs(legacyLogsToImport)
  console.log(`Imported ${legacyLogsToImport.length} legacy chat log(s) into conversations`)
}

console.log('Database schema ready')
