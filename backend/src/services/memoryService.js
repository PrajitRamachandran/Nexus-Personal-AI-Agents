import { db } from '../db/index.js'
import { config } from '../config.js'
import { getActiveModel } from './modelService.js'

const MAX_MEMORIES_PER_USER = 200
const DEFAULT_RETRIEVAL_LIMIT = 10

const VALID_CATEGORIES = new Set([
  'personal',
  'preference',
  'habit',
  'goal',
  'skill',
  'work',
  'location',
  'project',
])

const MEMORY_SIGNALS = [
  // Identity and profile
  /\bmy name is\b/i,
  /\bcall me\b/i,
  /\bi(?:'m| am) called\b/i,
  /\bi(?:'m| am)\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3}\b/,
  /\bmy (?:birthday|birthdate|age|pronouns)\b/i,
  /\bmy [a-z][a-z -]{2,30}\s+(?:is|are)\b/i,
  /\bi(?:'m| am) \d{1,3} years? old\b/i,

  // Location and background
  /\bi(?:'m| am) (?:from|based in|living in|located in)\b/i,
  /\bi live in\b/i,
  /\bmy (?:city|country|hometown|location)\b/i,

  // Work, education, skills
  /\bi work(?:ed)? (?:as|at|in|for)\b/i,
  /\bmy (?:job|role|company|college|university|school)\b/i,
  /\bi(?:'m| am) (?:a |an )?(?:student|developer|engineer|designer|teacher|doctor|founder|manager|researcher|writer)\b/i,
  /\bi(?:'m| am) studying\b/i,
  /\bi study (?:at|in)\b/i,
  /\bi(?:'m| am) (?:good|experienced|familiar) (?:with|in)\b/i,
  /\bi know\b/i,

  // Preferences and durable opinions
  /\bi (?:prefer|love|like|enjoy|hate|dislike|can't stand)\b/i,
  /\bmy (?:favorite|favourite|preferred)\b/i,
  /\bi(?:'m| am) not (?:a fan|into|good at)\b/i,

  // Habits and routines
  /\bi (?:usually|always|never)\b/i,
  /\bi tend to\b/i,
  /\bmy (?:routine|habit|workflow|setup)\b/i,
  /\bevery (?:day|morning|evening|week)\b/i,

  // Goals and ongoing projects
  /\bmy (?:(?:current|recent|ongoing)\s+)?project\b/i,
  /\b(?:current|recent|ongoing) project\b/i,
  /\bproject (?:called|named)\b/i,
  /\bi(?:'m| am) (?:currently )?working on\b/i,
  /\bmy goal is\b/i,
  /\bi(?:'m| am) trying to\b/i,
  /\bi want to (?:become|learn|build|create|improve|master|practice)\b/i,
  /\bi(?:'m| am) (?:learning|studying|building)\b/i,

  // Tools and setup
  /\bi use\b/i,
  /\bmy (?:stack|tools?|editor|os|machine|laptop|pc|phone)\b/i,

  // Explicit memory request
  /\bremember (?:this|that|me|my)\b/i,
  /\bsave (?:this|that|my)\b/i,
  /\blong.?term memory\b/i,
  /\bkeep this in mind\b/i,
]

const EXPLICIT_MEMORY_SIGNALS = [
  /\bremember (?:this|that|me|my)\b/i,
  /\bsave (?:this|that|my)\b/i,
  /\blong.?term memory\b/i,
  /\bkeep this in mind\b/i,
]

const TRANSIENT_ONLY_SIGNALS = [
  /\bjust for (?:this|the) (?:chat|conversation|session)\b/i,
  /\bfor now\b/i,
  /\btemporar(?:y|ily)\b/i,
  /\bright now\b/i,
  /\bthis (?:morning|afternoon|evening|week|month)\b/i,
]

const SENSITIVE_PATTERNS = [
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bsecret\b/i,
  /\bapi[_ -]?key\b/i,
  /\baccess token\b/i,
  /\brefresh token\b/i,
  /\bprivate key\b/i,
  /\bcredit card\b/i,
  /\bdebit card\b/i,
  /\bssn\b/i,
  /\bsocial security\b/i,
  /\botp\b/i,
]

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'because',
  'but',
  'can',
  'could',
  'does',
  'for',
  'from',
  'have',
  'how',
  'into',
  'know',
  'like',
  'memory',
  'mine',
  'name',
  'please',
  'remember',
  'that',
  'the',
  'this',
  'user',
  'what',
  'when',
  'where',
  'with',
  'you',
  'your',
])

function hasSensitiveContent(text = '') {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(text))
}

function hasExplicitMemoryRequest(text = '') {
  return EXPLICIT_MEMORY_SIGNALS.some(pattern => pattern.test(text))
}

function isLikelyTransientOnly(text = '') {
  return TRANSIENT_ONLY_SIGNALS.some(pattern => pattern.test(text))
}

export function shouldExtractMemory(userMessage) {
  const msg = (userMessage || '').replace(/\s+/g, ' ').trim()
  if (msg.split(/\s+/).length < 3) return false
  if (hasSensitiveContent(msg)) return false

  const hasMemorySignal = MEMORY_SIGNALS.some(pattern => pattern.test(msg))
  if (!hasMemorySignal) return false

  if (isLikelyTransientOnly(msg) && !hasExplicitMemoryRequest(msg)) return false

  console.log(`[Memory] Extraction candidate: "${msg.slice(0, 100)}"`)
  return true
}

function parseJsonArray(raw) {
  if (!raw || typeof raw !== 'string') return []

  const stripped = raw.replace(/```(?:json)?/gi, '').trim()
  const coerceArray = (parsed) => {
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed?.memories)) return parsed.memories
    if (Array.isArray(parsed?.memory)) return parsed.memory
    if (parsed && typeof parsed === 'object' && parsed.content) return [parsed]
    return []
  }

  try {
    const parsed = JSON.parse(stripped)
    const coerced = coerceArray(parsed)
    if (coerced.length > 0) return coerced
  } catch { }

  const match = raw.match(/\[[\s\S]*\]/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      const coerced = coerceArray(parsed)
      if (coerced.length > 0) return coerced
    } catch { }
  }

  return []
}

function splitClauses(message) {
  return message
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?:[.;!?]\s+)|(?:,\s+(?=(?:i|i'm|i am|my|we|our)\b))|(?:\s+and\s+(?=(?:i|i'm|i am|my|we|our)\b))/i)
    .map(part => part.trim())
    .filter(Boolean)
}

function cleanValue(value = '') {
  return value
    .replace(/\s+(?:and|but|because|so|also)\s+(?:i\b|i'm\b|i am\b|my\b|please\b|give\b|tell\b|can\b|could\b|remember\b|save\b)[\s\S]*$/i, '')
    .replace(/[,\s]+(?:please\s+)?(?:remember|keep this in mind)\b[\s\S]*$/i, '')
    .replace(/[,\s]+(?:please\s+)?save\s+(?:this|that|it|to memory|in memory|for later)\b[\s\S]*$/i, '')
    .replace(/\b(?:please\s+)?(?:remember|keep this in mind)\b[\s\S]*$/i, '')
    .replace(/\b(?:please\s+)?save\s+(?:this|that|it|to memory|in memory|for later)\b[\s\S]*$/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUsefulValue(value = '') {
  const cleaned = cleanValue(value)
  if (cleaned.length < 2 || cleaned.length > 140) return false
  if (/^(?:this|that|it|you|me|my|mine|something|anything|nothing)$/i.test(cleaned)) return false
  if (/^(?:this|that|it)\b/i.test(cleaned)) return false
  if (isLikelyTransientOnly(cleaned)) return false
  if (hasSensitiveContent(cleaned)) return false
  return true
}

function cleanProjectValue(value = '') {
  return cleanValue(value)
    .replace(/^(?:a|an|the)\s+/i, '')
    .replace(/^(?:current|recent|ongoing)\s+project\s+(?:called|named|is\s+called|is\s+named)?\s*/i, '')
    .replace(/^project\s+(?:called|named)?\s*/i, '')
    .trim()
}

function addCandidate(candidates, content, context, category) {
  const normalizedContent = content.replace(/\s+/g, ' ').trim()
  if (!normalizedContent || hasSensitiveContent(normalizedContent)) return

  candidates.push({
    content: normalizedContent,
    context: context || '',
    category: VALID_CATEGORIES.has(category) ? category : 'personal',
  })
}

function addProjectCandidate(candidates, rawValue) {
  const project = cleanProjectValue(rawValue)
  if (!isUsefulValue(project)) return
  const content = /^(?:to|for|about|around)\b/i.test(project)
    ? `User is working on a project ${project}`
    : `User is working on ${project}`

  addCandidate(
    candidates,
    content,
    "when discussing the user's projects",
    'project'
  )
}

function extractHeuristicMemory(userMessage) {
  const candidates = []
  const clauses = splitClauses(userMessage)

  for (const clause of clauses) {
    let match

    match = clause.match(/\b(?:my name is|i(?:'m| am) called|call me)\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(
        candidates,
        `User's name is ${cleanValue(match[1])}`,
        'when addressing the user',
        'personal'
      )
      continue
    }

    match = clause.match(/\bi(?:'m| am)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3})\b/)
    if (match && isUsefulValue(match[1])) {
      addCandidate(
        candidates,
        `User's name is ${cleanValue(match[1])}`,
        'when addressing the user',
        'personal'
      )
      continue
    }

    match = clause.match(/\bi(?:'m| am)\s+(\d{1,3})\s+years?\s+old\b/i)
    if (match) {
      addCandidate(candidates, `User is ${match[1]} years old`, 'when age is relevant', 'personal')
      continue
    }

    match = clause.match(/\bmy pronouns are\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(
        candidates,
        `User's pronouns are ${cleanValue(match[1])}`,
        'when referring to the user',
        'personal'
      )
      continue
    }

    match = clause.match(/\bi(?:'m| am)\s+(?:from|based in|living in|located in)\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(
        candidates,
        `User is based in ${cleanValue(match[1])}`,
        'when location is relevant',
        'location'
      )
      continue
    }

    match = clause.match(/\bi live in\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(
        candidates,
        `User lives in ${cleanValue(match[1])}`,
        'when location is relevant',
        'location'
      )
      continue
    }

    match = clause.match(/\bi work\s+(as|at|for|in)\s+(.+)/i)
    if (match && isUsefulValue(match[2])) {
      addCandidate(
        candidates,
        `User works ${match[1].toLowerCase()} ${cleanValue(match[2])}`,
        'when discussing work or career',
        'work'
      )
      continue
    }

    match = clause.match(/\bi(?:'m| am)\s+(?:a|an)\s+(.+)/i)
    if (
      match &&
      /\b(?:student|developer|engineer|designer|teacher|doctor|founder|manager|researcher|writer|nurse|analyst|consultant)\b/i.test(match[1]) &&
      isUsefulValue(match[1])
    ) {
      addCandidate(
        candidates,
        `User is a ${cleanValue(match[1])}`,
        'when discussing background or work',
        'work'
      )
      continue
    }

    match = clause.match(/\bi(?:'m| am) studying\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(candidates, `User is studying ${cleanValue(match[1])}`, 'when discussing education', 'skill')
      continue
    }

    match = clause.match(/\bi study\s+(?:at|in)\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(candidates, `User studies at ${cleanValue(match[1])}`, 'when discussing education', 'skill')
      continue
    }

    match = clause.match(/\bmy (favorite|favourite|preferred)\s+([a-z][a-z -]{1,40})\s+is\s+(.+)/i)
    if (match && isUsefulValue(match[3])) {
      addCandidate(
        candidates,
        `User's ${match[1].toLowerCase()} ${match[2].trim()} is ${cleanValue(match[3])}`,
        `when discussing ${match[2].trim()}`,
        'preference'
      )
      continue
    }

    match = clause.match(/\bi prefer\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(candidates, `User prefers ${cleanValue(match[1])}`, 'when tailoring recommendations', 'preference')
      continue
    }

    match = clause.match(/\bi (love|like|enjoy|hate|dislike|can't stand)\s+(.+)/i)
    if (match && isUsefulValue(match[2])) {
      const verb = match[1].toLowerCase()
      const phrase = {
        love: 'loves',
        like: 'likes',
        enjoy: 'enjoys',
        hate: 'hates',
        dislike: 'dislikes',
        "can't stand": "can't stand",
      }[verb]
      addCandidate(candidates, `User ${phrase} ${cleanValue(match[2])}`, 'when tailoring recommendations', 'preference')
      continue
    }

    match = clause.match(/\bi (usually|always|never)\s+(.+)/i)
    if (match && isUsefulValue(match[2])) {
      addCandidate(candidates, `User ${match[1].toLowerCase()} ${cleanValue(match[2])}`, 'when considering habits', 'habit')
      continue
    }

    match = clause.match(/\bi tend to\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(candidates, `User tends to ${cleanValue(match[1])}`, 'when considering habits', 'habit')
      continue
    }

    match = clause.match(/\bmy goal is\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(candidates, `User's goal is ${cleanValue(match[1])}`, 'when helping with goals', 'goal')
      continue
    }

    match = clause.match(/\bmy (?:(?:current|recent|ongoing)\s+)?project\s+(?:is|called|named)\s+(.+)/i)
    if (match) {
      addProjectCandidate(candidates, match[1])
      continue
    }

    match = clause.match(/\b(?:current|recent|ongoing) project\s+(?:is|called|named)\s+(.+)/i)
    if (match) {
      addProjectCandidate(candidates, match[1])
      continue
    }

    match = clause.match(/\bproject\s+(?:called|named)\s+(.+)/i)
    if (match) {
      addProjectCandidate(candidates, match[1])
      continue
    }

    match = clause.match(/\bi(?:'m| am)\s+(?:currently\s+)?working on\s+(.+)/i)
    if (match) {
      addProjectCandidate(candidates, match[1])
      continue
    }

    match = clause.match(/\bi(?:'m| am) trying to\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(candidates, `User is trying to ${cleanValue(match[1])}`, 'when helping with goals', 'goal')
      continue
    }

    match = clause.match(/\bi want to (become|learn|build|create|improve|master|practice)\s+(.+)/i)
    if (match && isUsefulValue(match[2])) {
      addCandidate(
        candidates,
        `User wants to ${match[1].toLowerCase()} ${cleanValue(match[2])}`,
        'when helping with goals',
        'goal'
      )
      continue
    }

    match = clause.match(/\bi(?:'m| am) learning\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(candidates, `User is learning ${cleanValue(match[1])}`, 'when helping with learning', 'goal')
      continue
    }

    match = clause.match(/\bi use\s+(.+)/i)
    if (match && isUsefulValue(match[1])) {
      addCandidate(candidates, `User uses ${cleanValue(match[1])}`, 'when discussing tools or setup', 'skill')
      continue
    }

    match = clause.match(/\bmy (stack|tools?|editor|os|machine|laptop|pc|phone|workflow|setup)\s+(?:is|are)\s+(.+)/i)
    if (match && isUsefulValue(match[2])) {
      addCandidate(
        candidates,
        `User's ${match[1].toLowerCase()} is ${cleanValue(match[2])}`,
        'when discussing tools or setup',
        'skill'
      )
      continue
    }

    match = clause.match(/\bmy ([a-z][a-z -]{2,30})\s+(?:is|are)\s+(.+)/i)
    if (match && isUsefulValue(match[2])) {
      const key = match[1].trim().toLowerCase()
      const ignoredKeys = new Set([
        'bug',
        'code',
        'error',
        'file',
        'issue',
        'message',
        'problem',
        'question',
        'request',
        'task',
      ])

      if (!ignoredKeys.has(key)) {
        addCandidate(
          candidates,
          `User's ${key} is ${cleanValue(match[2])}`,
          `when discussing ${key}`,
          'personal'
        )
      }
    }
  }

  return normalizeMemoryCandidates(candidates)
}

function normalizeCategory(category) {
  const normalized = String(category || '').toLowerCase().trim()
  const aliases = {
    preferences: 'preference',
    habits: 'habit',
    goals: 'goal',
    skills: 'skill',
    tools: 'skill',
    career: 'work',
    education: 'skill',
    projects: 'project',
    current_project: 'project',
    recent_project: 'project',
  }
  if (aliases[normalized]) return aliases[normalized]
  return VALID_CATEGORIES.has(normalized) ? normalized : 'personal'
}

function normalizeMemoryCandidates(memories = []) {
  const seen = new Set()
  const normalized = []

  for (const memory of memories) {
    const content = String(memory?.content || '').replace(/\s+/g, ' ').trim()
    if (!content || content.length < 8 || content.length > 220) continue
    if (hasSensitiveContent(content)) continue

    const key = content.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    normalized.push({
      content,
      context: String(memory?.context || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      category: normalizeCategory(memory?.category),
    })
  }

  return normalized
}

function mergeMemoryCandidates(...groups) {
  const merged = []
  const seen = new Set()

  for (const group of groups) {
    for (const memory of normalizeMemoryCandidates(group)) {
      const key = memory.content.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(memory)
    }
  }

  return merged
}

export async function extractMemory(userMessage) {
  const heuristic = extractHeuristicMemory(userMessage)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const escapedMsg = userMessage.replace(/`/g, "'").slice(0, 1200)

    const prompt = `Extract durable, reusable long-term user facts from the message.

INCLUDE information that remains useful across future conversations:
- Identity: name, age, background
- Location (stable, not temporary)
- Preferences: consistent likes/dislikes
- Habits & routines
- Skills, tools, tech stack
- Education & career details
- Goals or learning paths
- Projects (capture even if briefly mentioned, assume ongoing unless clearly temporary)

EXCLUDE:
- One-time requests or current task context
- Time-bound details (e.g., "today", "right now")
- Sensitive data (passwords, tokens, financial info)
- Assumptions beyond reasonable interpretation
- Anything about the assistant or general knowledge

RULES:
- Be precise and atomic: one fact per item
- Avoid duplicates or overlapping facts
- Keep wording concise and normalized
- Store facts that are likely useful in future conversations
- If uncertain but potentially useful, include it
- Prefer extracting useful information rather than returning empty

OUTPUT FORMAT:
Return ONLY a JSON array. No explanations.

Each item:
{
  "content": "<clear fact>",
  "context": "<when/how this is useful>",
  "category": "<one of: personal | preference | habit | goal | skill | work | location | project>"
}

If absolutely nothing useful → return []

Message: "${escapedMsg}"
JSON:`


    const res = await fetch(`${config.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: getActiveModel(),
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
      }),
    })

    if (!res.ok) {
      console.error(`[Memory] Ollama returned ${res.status}`)
      return heuristic
    }

    const data = await res.json()
    const raw = data.message?.content ?? ''
    const llm = parseJsonArray(raw)

    let extracted = []

    if (llm && llm.length > 0) {
      extracted = normalizeMemoryCandidates(llm)
    } else {
      extracted = heuristic
    }
    console.log(`[Memory] Source: ${llm.length > 0 ? 'LLM' : 'HEURISTIC'}`)
    return extracted
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[Memory] Extraction timed out; using heuristic memories')
    } else {
      console.error('[Memory] Extraction error:', err.message)
    }
    return heuristic
  } finally {
    clearTimeout(timeout)
  }
}

function wordSet(text = '') {
  return new Set(
    (text.toLowerCase().match(/\b[a-z0-9]{3,}\b/g) ?? [])
      .filter(word => !STOP_WORDS.has(word))
  )
}

function overlapRatio(a, b) {
  const wordsA = wordSet(a)
  const wordsB = wordSet(b)
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let shared = 0
  for (const word of wordsA) if (wordsB.has(word)) shared++
  return shared / Math.max(wordsA.size, wordsB.size)
}

// ─── Semantic embedding helpers ───────────────────────────────────────────────

/**
 * Requests an embedding vector from Ollama's /api/embed endpoint.
 * Always uses config.embedModel (nomic-embed-text by default).
 * Returns a plain number[] on success, or null on any failure.
 */
async function generateEmbedding(text) {
  try {
    const res = await fetch(`${config.ollamaHost}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.embedModel,
        input: text.slice(0, 2000), // guard against oversized inputs
      }),
    })
    if (!res.ok) {
      console.error(`[Embed] Ollama /api/embed returned ${res.status}`)
      return null
    }
    const data = await res.json()
    const vec = data?.embeddings?.[0]
    if (!Array.isArray(vec) || vec.length === 0) {
      console.error('[Embed] Empty or invalid embedding response')
      return null
    }
    return vec
  } catch (err) {
    console.error('[Embed] generateEmbedding failed:', err.message)
    return null
  }
}

/**
 * Cosine similarity between two vectors.
 * Ollama's /api/embed returns L2-normalised vectors, so this is a dot product.
 * Returns a value in [0, 1] for unit vectors (higher = more similar).
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  // Clamp to [0, 1] — negative cosine similarity means unrelated/opposite
  return Math.max(0, dot)
}

function getImportance(memory) {
  const content = memory.content.toLowerCase()

  // Highest priority (never lose)
  if (content.includes("name")) return 5
  if (content.includes("goal")) return 4.5

  // High priority
  if (memory.category === "project") return 4.5
  if (memory.category === "work") return 4
  if (memory.category === "skill") return 3.5

  // Medium
  if (memory.category === "habit") return 3
  if (memory.category === "preference") return 2.5

  // Low
  return 2
}

export function saveMemory(userId, memories) {
  const toStore = normalizeMemoryCandidates(memories)
  if (toStore.length === 0) {
    return { saved: 0, memories: [] }
  }

  const existing = db.prepare(
    `SELECT id, content, category, relevance_score
     FROM memory
     WHERE user_id = ?
     ORDER BY relevance_score ASC, created_at ASC`
  ).all(userId)

  const insert = db.prepare(
    `INSERT INTO memory (user_id, content, context, category, relevance_score, last_used)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  )
  const touch = db.prepare(
    `UPDATE memory
     SET relevance_score = MIN(COALESCE(relevance_score, 1.0) + 0.05, 5.0),
         last_used = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
  const evict = db.prepare(`DELETE FROM memory WHERE id = ?`)

  const insertAll = db.transaction((items) => {
    const saved = []

    for (const memory of items) {
      const duplicate = existing.find(stored =>
        stored.content.toLowerCase() === memory.content.toLowerCase() ||
        overlapRatio(stored.content, memory.content) > 0.92
      )

      if (duplicate) {
        touch.run(duplicate.id)
        console.log(`[Memory] Skipped duplicate: "${memory.content}"`)
        continue
      }

      while (existing.length >= MAX_MEMORIES_PER_USER) {
        const lowest = existing.shift()
        if (lowest?.id) evict.run(lowest.id)
      }

      const importance = getImportance(memory)

      const result = insert.run(
        userId,
        memory.content,
        memory.context,
        memory.category,
        importance
      )
      const stored = {
        id: result.lastInsertRowid,
        ...memory,
      }

      existing.push({
        id: stored.id,
        content: stored.content,
        relevance_score: importance,
      })
      saved.push(stored)
    }

    console.log(`[Memory] Saved ${saved.length} new memories for user ${userId}`)
    return saved
  })

  const savedMemories = insertAll(toStore)

  // Async: generate and persist embeddings for each newly saved memory.
  // Runs after the synchronous response so it never blocks the caller.
  if (savedMemories.length > 0) {
    const embedUpdate = db.prepare(`UPDATE memory SET embedding = ? WHERE id = ?`)
    ;(async () => {
      for (const mem of savedMemories) {
        const vec = await generateEmbedding(mem.content)
        if (vec) {
          embedUpdate.run(JSON.stringify(vec), mem.id)
          console.log(`[Embed] Stored embedding for memory id=${mem.id} ("${mem.content.slice(0, 50)}")`)
        }
      }
    })()
  }

  return { saved: savedMemories.length, memories: savedMemories }
}

function isMemoryRecallRequest(message = '') {
  return /\b(?:what do you (?:know|remember) about me|what have you remembered|who am i|what is my name|my memories|memory tab|remember about me|what (?:project|projects) (?:am i|i am) working on|what am i working on|current project|recent project)\b/i.test(message)
}

export async function getRelevantMemory(userId, currentMessage, limit = DEFAULT_RETRIEVAL_LIMIT) {
  const all = db.prepare(
    `SELECT id, content, context, category, relevance_score, last_used, created_at, embedding
     FROM memory
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(userId, MAX_MEMORIES_PER_USER)

  if (all.length === 0) return []

  const effectiveLimit = isMemoryRecallRequest(currentMessage)
    ? Math.max(limit, 20)
    : limit

  console.log(`[Memory] Retrieving for user ${userId}: ${all.length} total memories`)

  // ── Semantic query embedding ───────────────────────────────────────────────
  const queryVec = await generateEmbedding(currentMessage)
  if (queryVec) {
    console.log(`[Embed] Query vector generated (dim=${queryVec.length})`)
  } else {
    console.warn('[Embed] No query embedding — falling back to keyword-only scoring')
  }

  const queryWords = wordSet(currentMessage)
  const now = Date.now()
  const message = currentMessage.toLowerCase()

  // ── Category intent detection ──────────────────────────────────────────────
  const categoryBoostMap = {}
  if (message.includes('project') || message.includes('working on')) categoryBoostMap.project = 0.4
  if (message.includes('like') || message.includes('favorite'))       categoryBoostMap.preference = 0.3
  if (message.includes('goal') || message.includes('trying to'))      categoryBoostMap.goal = 0.4
  if (message.includes('who am i') || message.includes('my name'))    categoryBoostMap.personal = 0.5

  const scored = all.map(memory => {
    // ── Semantic score (80% weight) ──────────────────────────────────────────
    let semanticScore = 0
    if (queryVec && memory.embedding) {
      try {
        const memVec = JSON.parse(memory.embedding)
        semanticScore = cosineSimilarity(queryVec, memVec)
      } catch {
        // malformed stored embedding — ignore
      }
    }

    // ── Keyword score (20% weight) ────────────────────────────────────────────
    const memoryText = `${memory.content} ${memory.context}`
    const memoryWords = wordSet(memoryText)
    let overlap = 0
    for (const word of memoryWords) {
      if (queryWords.has(word)) overlap++
    }
    const keywordScore = memoryWords.size > 0
      ? overlap / Math.max(1, Math.min(memoryWords.size, Math.max(queryWords.size, 1)))
      : 0

    // ── Blended primary score: 80% semantic, 20% keyword ────────────────────
    // If no embedding exists yet for this memory, use keyword-only as a bridge
    // until the async backfill stores the embedding.
    const primaryScore = (queryVec && memory.embedding)
      ? 0.8 * semanticScore + 0.2 * keywordScore
      : keywordScore

    // ── Exact phrase boost ────────────────────────────────────────────────────
    const exactMatch = message.includes(memory.content.toLowerCase().slice(0, 25)) ? 0.4 : 0

    // ── Recency bonus ─────────────────────────────────────────────────────────
    const ageMs = memory.last_used ? now - new Date(memory.last_used).getTime() : now
    const ageDays = Number.isFinite(ageMs) ? ageMs / (1000 * 60 * 60 * 24) : 30
    const recencyBonus = Math.max(0, 0.25 * (1 - ageDays / 45))

    // ── Importance / usage boost ──────────────────────────────────────────────
    const relevanceBonus = Math.min(Number(memory.relevance_score || 1), 5) * 0.25

    // ── Recall intent boost ───────────────────────────────────────────────────
    const recallBonus = isMemoryRecallRequest(currentMessage) ? 0.5 : 0

    // ── Category intent boost ─────────────────────────────────────────────────
    const categoryBoost = categoryBoostMap[memory.category] || 0

    return {
      ...memory,
      embedding: undefined, // strip raw blob from returned objects
      semanticScore,
      score: primaryScore + exactMatch + recencyBonus + relevanceBonus + recallBonus + categoryBoost,
    }
  })

  const selected = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, effectiveLimit)

  console.log(
    `[Memory] Injecting ${selected.length} memories | ` +
    selected.map(m => `"${m.content.slice(0, 35)}" (sem=${m.semanticScore.toFixed(2)})`).join(', ')
  )

  const bump = db.prepare(
    `UPDATE memory
     SET relevance_score = MIN(COALESCE(relevance_score, 1.0) + 0.1, 5.0),
         last_used = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
  const bumpAll = db.transaction((ids) => ids.forEach(id => bump.run(id)))
  bumpAll(selected.map(memory => memory.id))

  return selected
}

export function deleteMemory(memoryId, userId) {
  const result = db.prepare(
    `DELETE FROM memory WHERE id = ? AND user_id = ?`
  ).run(memoryId, userId)
  return result.changes > 0
}

export function getAllMemory(userId) {
  return db.prepare(
    `SELECT id, content, context, category, relevance_score, last_used, created_at
     FROM memory
     WHERE user_id = ?
     ORDER BY created_at DESC`
  ).all(userId)
}
