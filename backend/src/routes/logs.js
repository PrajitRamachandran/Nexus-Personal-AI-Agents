import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../db/index.js'

const router = Router()

router.get('/', requireAuth, (req, res, next) => {
  try {
    const logs = db.prepare(`
      SELECT id, username, model, prompt_tokens, response_tokens,
             total_tokens, duration_ms, message_count,
             user_message, assistant_reply, created_at
      FROM chat_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(req.user.id)

    res.json(logs)
  } catch (err) {
    next(err)
  }
})

export default router