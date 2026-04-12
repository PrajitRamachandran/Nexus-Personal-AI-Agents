import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { config } from '../config.js'

const router = Router()

router.post('/', requireAuth, async (req, res) => {
  const { conversation_id, message } = req.body

  if (!conversation_id || !message) {
    return res.status(400).json({ error: 'conversation_id and message required' })
  }

  const startTime = Date.now()

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    // 1. Validate conversation ownership
    const convo = db.prepare(`
      SELECT id FROM conversations
      WHERE id = ? AND user_id = ?
    `).get(conversation_id, req.user.id)

    if (!convo) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Conversation not found' })}\n\n`)
      return res.end()
    }

    // 2. Save user message
    db.prepare(`
      INSERT INTO messages (conversation_id, role, content)
      VALUES (?, 'user', ?)
    `).run(conversation_id, message)
    db.prepare(`
      UPDATE conversations
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(conversation_id, req.user.id)

    // 3. Load full history from DB
    const history = db.prepare(`
      SELECT role, content
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversation_id)

    const userMessage = message

    // 4. Call Ollama
    const ollamaRes = await fetch(`${config.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages: history,
        stream: true,
      }),
    })

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text()
      res.write(`event: error\ndata: ${JSON.stringify({ error: text })}\n\n`)
      return res.end()
    }

    let fullReply = ''
    let usage = {}

    const reader = ollamaRes.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.trim())

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)

          if (parsed.message?.content) {
            fullReply += parsed.message.content
            res.write(`data: ${JSON.stringify({ token: parsed.message.content })}\n\n`)
          }

          if (parsed.done && parsed.prompt_eval_count !== undefined) {
            usage = {
              prompt_tokens: parsed.prompt_eval_count,
              response_tokens: parsed.eval_count,
              total_tokens: (parsed.prompt_eval_count ?? 0) + (parsed.eval_count ?? 0),
              duration_ms: Math.round((parsed.eval_duration ?? 0) / 1e6),
            }
          }

        } catch {}
      }
    }

    const wallDuration = Date.now() - startTime

    // 5. Save assistant reply
    db.prepare(`
      INSERT INTO messages (conversation_id, role, content)
      VALUES (?, 'assistant', ?)
    `).run(conversation_id, fullReply)
    db.prepare(`
      UPDATE conversations
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(conversation_id, req.user.id)

    // 6. Log
    try {
      db.prepare(`
        INSERT INTO chat_logs
          (user_id, username, model, prompt_tokens, response_tokens,
           total_tokens, duration_ms, message_count, user_message, assistant_reply)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id, // ✅ FIXED
        req.user.username,
        config.ollamaModel,
        usage.prompt_tokens ?? null,
        usage.response_tokens ?? null,
        usage.total_tokens ?? null,
        usage.duration_ms ?? wallDuration,
        history.length,
        userMessage.slice(0, 1000),
        fullReply.slice(0, 2000),
      )
    } catch (logErr) {
      console.error('Log write failed:', logErr.message)
    }

    // 7. Done event
    res.write(`event: done\ndata: ${JSON.stringify({
      model: config.ollamaModel,
      prompt_tokens: usage.prompt_tokens,
      response_tokens: usage.response_tokens,
      total_tokens: usage.total_tokens,
      duration_ms: usage.duration_ms ?? wallDuration,
    })}\n\n`)

    res.end()

  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

export default router
