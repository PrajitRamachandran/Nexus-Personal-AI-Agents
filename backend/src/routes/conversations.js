import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../db/index.js'

const router = Router()

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
      SELECT role, content, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
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
      DELETE FROM conversations
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

export default router