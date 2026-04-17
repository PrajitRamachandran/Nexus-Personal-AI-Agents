import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { config } from '../config.js'

const router = Router()

router.get('/', requireAuth, (req, res, next) => {
  try {
    const isAdmin = req.user.username === config.adminUsername

    if (isAdmin) {
      // Admin: full logs for all users, all metrics
      const logs = db.prepare(`
        SELECT
          l.id, l.username, l.model, l.created_at,
          l.prompt_tokens, l.response_tokens, l.total_tokens,
          l.duration_ms, l.message_count,
          l.user_message, l.assistant_reply,
          l.time_to_first_token_ms, l.total_wall_ms,
          l.tokens_per_second,
          l.ollama_load_ms, l.ollama_prompt_eval_ms, l.ollama_eval_ms,
          l.context_length, l.response_chars, l.error
        FROM chat_logs l
        ORDER BY l.created_at DESC
        LIMIT 500
      `).all()

      // Aggregate stats for the admin dashboard
      const stats = db.prepare(`
        SELECT
          COUNT(*)                          AS total_requests,
          AVG(time_to_first_token_ms)       AS avg_ttft_ms,
          AVG(tokens_per_second)            AS avg_tokens_per_second,
          AVG(total_wall_ms)                AS avg_wall_ms,
          SUM(total_tokens)                 AS total_tokens_consumed,
          COUNT(CASE WHEN error IS NOT NULL THEN 1 END) AS error_count
        FROM chat_logs
      `).get()

      return res.json({ admin: true, stats, logs })
    }

    // Non-admin: only their single most recent log, limited fields
    const log = db.prepare(`
      SELECT
        model, created_at,
        prompt_tokens, response_tokens, total_tokens,
        duration_ms, time_to_first_token_ms, total_wall_ms,
        tokens_per_second,
        SUBSTR(user_message, 1, 200)    AS user_message,
        SUBSTR(assistant_reply, 1, 200) AS assistant_reply
      FROM chat_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(req.user.id)

    return res.json({ admin: false, log: log || null })

  } catch (err) {
    next(err)
  }
})

export default router