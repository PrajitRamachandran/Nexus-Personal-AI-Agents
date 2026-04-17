import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { config } from '../config.js'
import {
  shouldExtractMemory,
  extractMemory,
  saveMemory,
  getRelevantMemory,
} from '../services/memoryService.js'
import { generateTitle, updateTitle } from '../services/titleService.js'

const router = Router()

router.post('/', requireAuth, async (req, res) => {
  const { conversation_id, message } = req.body

  if (!conversation_id || !message) {
    return res.status(400).json({ error: 'conversation_id and message required' })
  }

  const wallStart = Date.now()
  let firstTokenAt = null
  let errorMessage = null

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    // 1. Validate conversation ownership
    const convo = db.prepare(`
      SELECT id, auto_titled FROM conversations
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
      UPDATE conversations SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(conversation_id, req.user.id)

    // 3. Load full history from DB
    const history = db.prepare(`
      SELECT role, content FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversation_id)

    // 🧠 Inject relevant memory into system prompt
    const memories = getRelevantMemory(req.user.id, message)
    if (memories.length > 0) {
      const memoryContext = memories
        .map(m => `- ${m.content}${m.context ? ` (${m.context})` : ''}`)
        .join('\n')

      history.unshift({
        role: 'system',
        content: `You remember the following about the user:\n${memoryContext}\n\nUse this only when naturally relevant. Never say you have a memory system.`,
      })
    }

    const contextLength = history.length
    const userMessage = message

    // 4. Stream from Ollama
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
    let ollamaTimings = {}

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
            if (firstTokenAt === null) firstTokenAt = Date.now()
            fullReply += parsed.message.content
            res.write(`data: ${JSON.stringify({ token: parsed.message.content })}\n\n`)
          }

          if (parsed.done) {
            ollamaTimings = {
              load_ms:        parsed.load_duration        ? Math.round(parsed.load_duration / 1e6)        : null,
              prompt_eval_ms: parsed.prompt_eval_duration ? Math.round(parsed.prompt_eval_duration / 1e6) : null,
              eval_ms:        parsed.eval_duration        ? Math.round(parsed.eval_duration / 1e6)        : null,
            }
            const evalCount     = parsed.eval_count    ?? 0
            const evalDurationS = parsed.eval_duration ? parsed.eval_duration / 1e9 : null
            usage = {
              prompt_tokens:     parsed.prompt_eval_count ?? null,
              response_tokens:   evalCount || null,
              total_tokens:      ((parsed.prompt_eval_count ?? 0) + evalCount) || null,
              tokens_per_second: (evalDurationS && evalCount)
                ? Math.round((evalCount / evalDurationS) * 10) / 10 : null,
            }
          }
        } catch {}
      }
    }

    const wallEnd = Date.now()
    const wallDuration = wallEnd - wallStart
    const ttft = firstTokenAt !== null ? firstTokenAt - wallStart : null

    // 5. Save assistant reply
    db.prepare(`INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)`)
      .run(conversation_id, fullReply)
    db.prepare(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .run(conversation_id, req.user.id)

    // 6. Log metrics
    try {
      db.prepare(`
        INSERT INTO chat_logs (
          user_id, conversation_id, username, model,
          prompt_tokens, response_tokens, total_tokens,
          duration_ms, message_count,
          user_message, assistant_reply,
          time_to_first_token_ms, total_wall_ms,
          tokens_per_second,
          ollama_load_ms, ollama_prompt_eval_ms, ollama_eval_ms,
          context_length, response_chars, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id, conversation_id, req.user.username, config.ollamaModel,
        usage.prompt_tokens    ?? null, usage.response_tokens  ?? null, usage.total_tokens     ?? null,
        ollamaTimings.eval_ms  ?? wallDuration, history.length,
        userMessage.slice(0, 1000), fullReply.slice(0, 2000),
        ttft, wallDuration,
        usage.tokens_per_second      ?? null,
        ollamaTimings.load_ms        ?? null,
        ollamaTimings.prompt_eval_ms ?? null,
        ollamaTimings.eval_ms        ?? null,
        contextLength, fullReply.length, null,
      )
    } catch (logErr) {
      console.error('Log write failed:', logErr.message)
    }

    // 7. ✅ Send METRICS done event immediately — don't wait for title/memory
    res.write(`data: ${JSON.stringify({
      model:                  config.ollamaModel,
      prompt_tokens:          usage.prompt_tokens,
      response_tokens:        usage.response_tokens,
      total_tokens:           usage.total_tokens,
      duration_ms:            ollamaTimings.eval_ms ?? wallDuration,
      total_wall_ms:          wallDuration,
      time_to_first_token_ms: ttft,
      tokens_per_second:      usage.tokens_per_second,
    })}\n\n`)

    // ────────────────────────────────────────────────────────────
    // 8. POST-STREAM: memory + title (stream stays open; these SSE events
    //    arrive after the metrics "done" event).
    // ────────────────────────────────────────────────────────────

    // Save durable user facts before title generation so the memory panel can
    // update as soon as long-term memories are stored.
    if (shouldExtractMemory(userMessage)) {
      try {
        const extracted = await extractMemory(userMessage)
        if (extracted.length > 0) {
          const memoryResult = saveMemory(req.user.id, extracted)
          if (memoryResult.saved > 0) {
            res.write(`data: ${JSON.stringify({
              memory_update: {
                saved: memoryResult.saved,
                memories: memoryResult.memories,
              },
            })}\n\n`)
          }
        } else {
          console.log('[Memory] No long-term facts found')
        }
      } catch (err) {
        console.error('[Memory] Extraction failed:', err.message)
      }
    }

    // Auto-title fires once per conversation and pushes via SSE after done.
    if (!convo.auto_titled) {
      const msgCount = db.prepare(
        `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND role = 'user'`
      ).get(conversation_id)?.cnt ?? 0

      if (msgCount >= 2 && msgCount <= 4) {
        try {
          const title = await Promise.race([
            generateTitle(history.filter(m => m.role !== 'system')),
            new Promise(resolve => setTimeout(() => resolve(null), 15_000)),
          ])
          if (title) {
            updateTitle(conversation_id, title)
            // Send separate title_update event (frontend handles this via onTitleUpdate)
            res.write(`data: ${JSON.stringify({ title_update: { id: conversation_id, title } })}\n\n`)
            console.log(`[Title] Auto-titled conversation ${conversation_id}: "${title}"`)
          }
        } catch (err) {
          console.error('[Title] Generation failed:', err.message)
        }
      }
    }

    res.end()

  } catch (err) {
    errorMessage = err.message
    try {
      db.prepare(`INSERT INTO chat_logs (user_id, conversation_id, username, model, total_wall_ms, error) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(req.user.id, conversation_id ?? null, req.user.username, config.ollamaModel, Date.now() - wallStart, errorMessage)
    } catch {}
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

export default router
