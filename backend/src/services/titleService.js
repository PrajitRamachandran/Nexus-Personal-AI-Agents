import { db } from '../db/index.js'
import { config } from '../config.js'
import { getActiveModel } from './modelService.js'

/**
 * Generates a concise 3-6 word title for a conversation based on message history.
 * Returns null on failure — never throws.
 */
export async function generateTitle(messages) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)

  try {
    // Build a compact conversation summary (exclude system messages, cap content length)
    const turns = messages
      .filter(m => m.role !== 'system')
      .slice(0, 6)
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 200)}`)
      .join('\n')

    if (!turns.trim()) return null

    const prompt = `Generate a concise 3-6 word title for this conversation. Return ONLY the title — no quotes, no punctuation, no explanation.

Conversation:
${turns}

Title:`

    const res = await fetch(`${config.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.TITLE_MODEL ? config.titleModel : getActiveModel(),
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    })

    if (!res.ok) return null

    const data = await res.json()
    const raw = data.message?.content ?? ''

    // Clean: strip surrounding quotes, punctuation, excess whitespace, newlines
    const title = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')   // strip surrounding quotes
      .replace(/[.!?]+$/, '')             // strip trailing punctuation
      .replace(/\s+/g, ' ')              // normalize whitespace
      .trim()

    if (!title || title.length < 2 || title.length > 80) return null
    return title
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Updates the conversation title in the DB and marks it as auto-titled.
 * Uses correct better-sqlite3 API (db.prepare().run()).
 * Returns the title string, or null if not updated.
 */
export function updateTitle(conversationId, title) {
  if (!title) return null

  db.prepare(
    `UPDATE conversations
     SET title = ?, auto_titled = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(title, conversationId)

  return title
}
