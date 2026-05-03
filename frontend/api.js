import { auth } from './auth.js'

function resolveApiBase() {
  const host = window.location.hostname

  if (host === 'localhost') {
    return 'http://localhost:3001'
  }

  // for your Tailscale / LAN IP
  return `http://${host}:3001`
}

const BASE = resolveApiBase()

async function readJsonOrText(res) {
  const text = await res.text()
  const contentType = res.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')

  if (isJson && text) {
    try {
      return { json: JSON.parse(text), text }
    } catch { }
  }

  return { json: null, text }
}

async function request(path, options = {}) {
  const token = auth.getToken()
  const url = `${BASE}${path}`

  let res
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch (err) {
    throw new Error(`Could not reach API at ${url}. Make sure the backend is running on port 3001 and that the browser is allowed to access it.`)
  }

  const { json, text } = await readJsonOrText(res)

  if (!res.ok) {
    throw new Error(
      json?.error ||
      (text.trim().startsWith('<')
        ? `Expected API JSON from ${url}, but received HTML. Check that the frontend is calling the backend on port 3001.`
        : text || 'Request failed')
    )
  }

  if (!json) {
    throw new Error(`Expected JSON response from ${url}`)
  }

  return json
}

export const api = {
  // ===== AUTH =====
  register: (body) => request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body)
  }),

  login: (body) => request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body)
  }),

  // ===== LOGS =====
  // Changed from 'logs' to 'getLogs' to fix the "api.getLogs is not a function" error
  // Returns { admin, stats?, logs? } for admin or { admin, log } for regular users
  getLogs: () => request('/api/logs'),

  // ===== MODELS =====
  getModels: () => request('/api/models'),

  setActiveModel: (model) =>
    request('/api/models/active', {
      method: 'POST',
      body: JSON.stringify({ model })
    }),

  // ===== CONVERSATIONS =====
  conversations: () => request('/api/conversations'),

  searchConversations: (query) =>
    request(`/api/conversations/search?q=${encodeURIComponent(query)}`),

  createConversation: (title) =>
    request('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title })
    }),

  getConversation: (id) =>
    request(`/api/conversations/${id}`),

  deleteConversation: (id) =>
    request(`/api/conversations/${id}`, {
      method: 'DELETE'
    }),

  togglePin: (id) =>
    request(`/api/conversations/${id}/pin`, {
      method: 'PATCH'
    }),

  renameConversation: (id, title) =>
    request(`/api/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title })
    }),


  // ===== MEMORY =====
  getMemory: () => request('/api/memory'),

  deleteMemory: (id) =>
    request(`/api/memory/${id}`, { method: 'DELETE' }),

  addMemory: (body) =>
    request('/api/memory', { method: 'POST', body: JSON.stringify(body) }),

  // ===== CHAT (STREAMING) =====
  async chatStream({ conversation_id, message, onToken, onDone, onError, onTitleUpdate, onMemoryUpdate }) {
    const token = auth.getToken()
    const url = `${BASE}/api/chat`

    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conversation_id, message }),
      })
    } catch (err) {
      throw new Error(`Could not reach API at ${url}. Make sure the backend is running on port 3001 and that the browser is allowed to access it.`)
    }

    if (!res.ok) {
      const { json, text } = await readJsonOrText(res)
      throw new Error(
        json?.error ||
        (text.trim().startsWith('<')
          ? `Expected API JSON from ${url}, but received HTML. Check that the frontend is calling the backend on port 3001.`
          : text || 'Chat failed')
      )
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const json = JSON.parse(line.slice(5).trim())

            if (json.token !== undefined) {
              onToken?.(json.token)
            }

            // Metrics done event (contains model name)
            if (json.model) {
              onDone?.(json)
            }

            // Title update event (arrives separately after done, no model field)
            if (json.title_update) {
              onTitleUpdate?.(json.title_update)
            }

            if (json.memory_update) {
              onMemoryUpdate?.(json.memory_update)
            }

          } catch { }
        }

        if (line.startsWith('event: error')) {
          const nextLine = lines[lines.indexOf(line) + 1]
          if (nextLine?.startsWith('data:')) {
            try {
              onError?.(JSON.parse(nextLine.slice(5).trim()).error)
            } catch { }
          }
        }
      }
    }
  }
}
