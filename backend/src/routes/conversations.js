import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../db/index.js'

const router = Router()

function makeSnippet(text, query, radius = 48) {
  const content = String(text ?? '')
  const term = String(query ?? '').trim()
  const idx = content.toLowerCase().indexOf(term.toLowerCase())

  if (idx === -1) return content.slice(0, radius * 2).trim()

  const start = Math.max(0, idx - radius)
  const end = Math.min(content.length, idx + term.length + radius)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < content.length ? '...' : ''

  return `${prefix}${content.slice(start, end).trim()}${suffix}`
}

// CREATE conversation
router.post('/', requireAuth, (req, res, next) => {
  try {
    const { title } = req.body

    const result = db.prepare(`
      INSERT INTO conversations (user_id, title, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(req.user.id, title || 'New Chat')

    res.status(201).json({
      id: result.lastInsertRowid,
      title: title || 'New Chat'
    })
  } catch (err) {
    next(err)
  }
})

// SEARCH conversations by title or message content
router.get('/search', requireAuth, (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim()

    if (!q) {
      return res.json([])
    }

    const pattern = `%${q}%`
    const rows = db.prepare(`
      SELECT
        c.id,
        c.title,
        c.created_at,
        c.updated_at,
        c.pinned,
        m.id AS message_id,
        m.role AS message_role,
        m.content AS message_content,
        CASE
          WHEN c.title LIKE ? THEN 'title'
          ELSE 'message'
        END AS match_type
      FROM conversations c
      LEFT JOIN messages m
        ON m.conversation_id = c.id
       AND m.content LIKE ?
       AND m.id = (
         SELECT first_match.id
         FROM messages first_match
         WHERE first_match.conversation_id = c.id
           AND first_match.content LIKE ?
         ORDER BY first_match.created_at ASC, first_match.id ASC
         LIMIT 1
       )
      WHERE c.user_id = ?
        AND (c.is_deleted IS NULL OR c.is_deleted = 0)
        AND (c.title LIKE ? OR m.id IS NOT NULL)
      ORDER BY c.pinned DESC, COALESCE(c.updated_at, c.created_at) DESC, c.id DESC
      LIMIT 50
    `).all(pattern, pattern, pattern, req.user.id, pattern)

    const results = rows.map(row => ({
      id: row.id,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      pinned: row.pinned,
      match_type: row.match_type,
      message_id: row.message_id,
      message_role: row.message_role,
      snippet: row.match_type === 'title'
        ? row.title
        : makeSnippet(row.message_content, q),
    }))

    res.json(results)
  } catch (err) {
    next(err)
  }
})

// GET all conversations
router.get('/', requireAuth, (req, res, next) => {
  try {
    const conversations = db.prepare(`
      SELECT id, title, created_at, updated_at, pinned
      FROM conversations
      WHERE user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)
      ORDER BY pinned DESC, COALESCE(updated_at, created_at) DESC, id DESC
    `).all(req.user.id)

    res.json(conversations)
  } catch (err) {
    next(err)
  }
})

// GET single conversation
router.get('/:id', requireAuth, (req, res, next) => {
  try {
    const { id } = req.params

    const convo = db.prepare(`
      SELECT id, title
      FROM conversations
      WHERE id = ? AND user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)
    `).get(id, req.user.id)

    if (!convo) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const messages = db.prepare(`
      SELECT id, role, content, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(id)

    res.json({
      id: convo.id,
      title: convo.title,
      messages
    })
  } catch (err) {
    next(err)
  }
})

// DELETE conversation
router.delete('/:id', requireAuth, (req, res, next) => {
  try {
    const { id } = req.params

    const result = db.prepare(`
      UPDATE conversations
      SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(id, req.user.id)

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// TOGGLE PIN
router.patch('/:id/pin', requireAuth, (req, res, next) => {
  try {
    const { id } = req.params

    const convo = db.prepare(`
      SELECT pinned FROM conversations
      WHERE id = ? AND user_id = ?
    `).get(id, req.user.id)

    if (!convo) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const newValue = convo.pinned ? 0 : 1

    db.prepare(`
      UPDATE conversations
      SET pinned = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(newValue, id, req.user.id)

    res.json({ pinned: !!newValue })
  } catch (err) {
    next(err)
  }
})

// ✅ RENAME conversation (separate route)
router.patch('/:id', requireAuth, (req, res, next) => {
  try {
    const { id } = req.params
    const { title } = req.body

    if (!title) {
      return res.status(400).json({ error: 'Title required' })
    }

    const result = db.prepare(`
      UPDATE conversations
      SET title = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(title, id, req.user.id)

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
