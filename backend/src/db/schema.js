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
    conversation_id INTEGER,
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
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
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

db.exec(`
  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,        -- "User likes Yamaha bikes"
    context TEXT,                 -- "Use when suggesting vehicles"
    category TEXT,                -- preference / habit / personal
    last_used DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_memory_user
  ON memory(user_id);
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

// ===== MEMORY SYSTEM MIGRATIONS =====

// Add relevance_score to memory (used for usage-ranked retrieval)
try {
  db.exec(`ALTER TABLE memory ADD COLUMN relevance_score REAL DEFAULT 1.0;`)
  console.log("Added 'relevance_score' column to memory")
} catch (e) {
  if (!e.message.includes('duplicate column')) console.error(e.message)
}

// Add embedding to memory (serialised float[] from /api/embed — enables semantic search)
try {
  db.exec(`ALTER TABLE memory ADD COLUMN embedding TEXT;`)
  console.log("Added 'embedding' column to memory")
} catch (e) {
  if (!e.message.includes('duplicate column')) console.error(e.message)
}

// Add auto_titled to conversations (ensures title generation fires exactly once)
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN auto_titled INTEGER DEFAULT 0;`)
  console.log("Added 'auto_titled' column to conversations")
} catch (e) {
  if (!e.message.includes('duplicate column')) console.error(e.message)
}

// ===== CHAT_LOGS METRIC COLUMN MIGRATIONS =====

const newLogColumns = [
  [`ALTER TABLE chat_logs ADD COLUMN conversation_id INTEGER;`,          'conversation_id'],
  [`ALTER TABLE chat_logs ADD COLUMN time_to_first_token_ms INTEGER;`,  'time_to_first_token_ms'],
  [`ALTER TABLE chat_logs ADD COLUMN total_wall_ms INTEGER;`,            'total_wall_ms'],
  [`ALTER TABLE chat_logs ADD COLUMN tokens_per_second REAL;`,           'tokens_per_second'],
  [`ALTER TABLE chat_logs ADD COLUMN ollama_load_ms INTEGER;`,           'ollama_load_ms'],
  [`ALTER TABLE chat_logs ADD COLUMN ollama_prompt_eval_ms INTEGER;`,    'ollama_prompt_eval_ms'],
  [`ALTER TABLE chat_logs ADD COLUMN ollama_eval_ms INTEGER;`,           'ollama_eval_ms'],
  [`ALTER TABLE chat_logs ADD COLUMN context_length INTEGER;`,           'context_length'],
  [`ALTER TABLE chat_logs ADD COLUMN response_chars INTEGER;`,           'response_chars'],
  [`ALTER TABLE chat_logs ADD COLUMN error TEXT;`,                       'error'],
]

for (const [sql, col] of newLogColumns) {
  try {
    db.exec(sql)
    console.log(`Added column '${col}' to chat_logs`)
  } catch (e) {
    if (!e.message.includes('duplicate column')) console.error(e.message)
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_chat_logs_conversation
  ON chat_logs(conversation_id);
`)


function legacyConversationTitle(userMessage) {
  const normalized = (userMessage || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'Imported Chat'
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized
}

function sqliteTimestamp(value) {
  if (typeof value === 'string' && value.trim()) return value
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

// Modern chat_logs rows are metrics for an existing conversation. Older
// versions did not store conversation_id, so infer it from matching messages
// before the legacy importer runs.
const modernLogBackfill = db.prepare(`
  UPDATE chat_logs
  SET conversation_id = (
    SELECT real.id
    FROM conversations real
    JOIN messages user_msg
      ON user_msg.conversation_id = real.id
     AND user_msg.role = 'user'
     AND substr(user_msg.content, 1, length(chat_logs.user_message)) = chat_logs.user_message
    JOIN messages assistant_msg
      ON assistant_msg.conversation_id = real.id
     AND assistant_msg.role = 'assistant'
     AND assistant_msg.id > user_msg.id
     AND substr(assistant_msg.content, 1, length(chat_logs.assistant_reply)) = chat_logs.assistant_reply
    WHERE real.user_id = chat_logs.user_id
      AND real.legacy_log_id IS NULL
      AND COALESCE(real.is_deleted, 0) = 0
    ORDER BY real.id DESC, user_msg.id DESC
    LIMIT 1
  )
  WHERE conversation_id IS NULL
    AND user_message IS NOT NULL
    AND assistant_reply IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM conversations real
      JOIN messages user_msg
        ON user_msg.conversation_id = real.id
       AND user_msg.role = 'user'
       AND substr(user_msg.content, 1, length(chat_logs.user_message)) = chat_logs.user_message
      JOIN messages assistant_msg
        ON assistant_msg.conversation_id = real.id
       AND assistant_msg.role = 'assistant'
       AND assistant_msg.id > user_msg.id
       AND substr(assistant_msg.content, 1, length(chat_logs.assistant_reply)) = chat_logs.assistant_reply
      WHERE real.user_id = chat_logs.user_id
        AND real.legacy_log_id IS NULL
        AND COALESCE(real.is_deleted, 0) = 0
    )
`).run()

if (modernLogBackfill.changes > 0) {
  console.log(`Linked ${modernLogBackfill.changes} chat log(s) to existing conversations`)
}

// If a previous restart imported modern metric logs as one-turn conversations,
// hide those exact imported copies. The real conversation and messages remain.
const duplicateImportCleanup = db.prepare(`
  UPDATE conversations
  SET is_deleted = 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE legacy_log_id IS NOT NULL
    AND COALESCE(is_deleted, 0) = 0
    AND EXISTS (
      SELECT 1
      FROM chat_logs l
      WHERE l.id = conversations.legacy_log_id
        AND l.conversation_id IS NOT NULL
        AND l.conversation_id != conversations.id
    )
`).run()

if (duplicateImportCleanup.changes > 0) {
  console.log(`Soft-deleted ${duplicateImportCleanup.changes} duplicate imported conversation(s)`)
}

const importedLogBackfill = db.prepare(`
  UPDATE chat_logs
  SET conversation_id = (
    SELECT c.id
    FROM conversations c
    WHERE c.legacy_log_id = chat_logs.id
      AND COALESCE(c.is_deleted, 0) = 0
    LIMIT 1
  )
  WHERE conversation_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM conversations c
      WHERE c.legacy_log_id = chat_logs.id
        AND COALESCE(c.is_deleted, 0) = 0
    )
`).run()

if (importedLogBackfill.changes > 0) {
  console.log(`Linked ${importedLogBackfill.changes} legacy chat log(s) to imported conversations`)
}

const legacyLogsToImport = db.prepare(`
  SELECT l.id, l.user_id, l.user_message, l.assistant_reply, l.created_at
  FROM chat_logs l
  LEFT JOIN conversations c ON c.legacy_log_id = l.id
  WHERE c.id IS NULL
    AND l.conversation_id IS NULL
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

  const updateImportedLog = db.prepare(`
    UPDATE chat_logs
    SET conversation_id = ?
    WHERE id = ? AND conversation_id IS NULL
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

      updateImportedLog.run(conversationId, log.id)
    }
  })

  importLegacyLogs(legacyLogsToImport)
  console.log(`Imported ${legacyLogsToImport.length} legacy chat log(s) into conversations`)
}

console.log('Database schema ready')
