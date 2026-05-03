import { api } from './api.js'

function escapeHtml(str) {
  return (str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function updateStatus(statusEl, count) {
  if (!statusEl) return
  statusEl.textContent = count === 1 ? '1 memory' : `${count} memories`
}

function memoryEmptyHtml() {
  return `
    <div class="memory-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4; margin-bottom:8px">
        <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
      </svg>
      <p>No memories yet.</p>
      <p style="font-size:12px; margin-top:4px;">Share personal info or preferences and Nexus will remember them.</p>
    </div>`
}

export function renderMemoryList(memories, listEl, options = {}) {
  const statusEl = options.statusEl
  updateStatus(statusEl, memories.length)

  if (memories.length === 0) {
    listEl.innerHTML = memoryEmptyHtml()
    return
  }

  listEl.innerHTML = ''

  memories.forEach(memory => {
    const item = document.createElement('div')
    item.className = 'memory-item'
    item.dataset.id = memory.id

    const categoryStyles = {
      preference: {
        color: 'var(--accent-color)',
        background: 'rgba(var(--accent-rgb), 0.12)',
        border: 'rgba(var(--accent-rgb), 0.28)',
      },
      habit: { color: '#f59e0b', background: '#f59e0b20', border: '#f59e0b40' },
      personal: { color: '#10b981', background: '#10b98120', border: '#10b98140' },
      goal: { color: '#ec4899', background: '#ec489920', border: '#ec489940' },
      skill: { color: '#3b82f6', background: '#3b82f620', border: '#3b82f640' },
      work: { color: '#14b8a6', background: '#14b8a620', border: '#14b8a640' },
      location: { color: '#22c55e', background: '#22c55e20', border: '#22c55e40' },
      project: { color: '#14b8a6', background: '#14b8a620', border: '#14b8a640' },
    }
    const categoryStyle = categoryStyles[memory.category] ?? {
      color: '#6b6b75',
      background: '#6b6b7520',
      border: '#6b6b7540',
    }
    const lastUsed = memory.last_used
      ? new Date(memory.last_used).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'Never used'

    item.innerHTML = `
      <div class="memory-item-header">
        <span class="memory-badge" style="background: ${categoryStyle.background}; color: ${categoryStyle.color}; border: 1px solid ${categoryStyle.border}">${escapeHtml(memory.category)}</span>
        <span class="memory-date">${lastUsed}</span>
      </div>
      <p class="memory-content">${escapeHtml(memory.content)}</p>
      ${memory.context ? `<p class="memory-context">${escapeHtml(memory.context)}</p>` : ''}
      <button class="memory-delete-btn" data-id="${memory.id}" title="Delete this memory">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6l-1 14H6L5 6"></path>
          <path d="M10 11v6M14 11v6"></path>
          <path d="M9 6V4h6v2"></path>
        </svg>
        Delete
      </button>
    `
    listEl.appendChild(item)
  })

  listEl.querySelectorAll('.memory-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation()
      const id = Number(btn.dataset.id)
      const item = listEl.querySelector(`.memory-item[data-id="${id}"]`)
      if (!item) return

      item.style.opacity = '0.4'

      try {
        await api.deleteMemory(id)
        item.classList.add('memory-item-removing')
        setTimeout(() => item.remove(), 250)

        const remaining = listEl.querySelectorAll('.memory-item').length - 1
        updateStatus(statusEl, Math.max(remaining, 0))

        if (remaining <= 0) {
          renderMemoryList([], listEl, options)
        }
      } catch {
        item.style.opacity = '1'
      }
    })
  })
}

export async function loadMemoryList(listEl, options = {}) {
  listEl.innerHTML = `<div class="memory-loading">Loading memories...</div>`

  try {
    const { memories } = await api.getMemory()
    renderMemoryList(memories, listEl, options)
    return memories
  } catch {
    listEl.innerHTML = `<div class="memory-empty">Failed to load memories.</div>`
    updateStatus(options.statusEl, 0)
    return []
  }
}
