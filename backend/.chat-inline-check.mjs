
    import { api } from './api.js'
    import { auth } from './auth.js'

    if (!auth.isLoggedIn()) window.location.href = './login.html'

    const messagesEl = document.getElementById('messages')
    const inputEl = document.getElementById('input')
    const sendBtn = document.getElementById('send-btn')
    const emptyHint = document.getElementById('empty-hint')
    const statsBar = document.getElementById('stats-bar')
    const usernameEl = document.getElementById('username-display')
    const logoutBtn = document.getElementById('logout-btn')
    const convoList = document.getElementById('conversation-list')
    const newChatBtn = document.getElementById('new-chat-btn')

    let currentConversationId = null

    usernameEl.textContent = auth.getUsername()

    logoutBtn.addEventListener('click', () => {
      auth.logout()
      window.location.href = './login.html'
    })

    sendBtn.addEventListener('click', () => {
      void sendMessage()
    })

    newChatBtn.addEventListener('click', () => {
      void createNewConversation()
    })

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void sendMessage()
      }
    })

    document.addEventListener('click', () => {
      document.querySelectorAll('.dropdown').forEach((dropdown) => {
        dropdown.classList.add('hidden')
      })
    })

    function conversationTitle(text) {
      const normalized = (text || '').replace(/\s+/g, ' ').trim()
      if (!normalized) return 'New Chat'
      return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized
    }

    function createBubble(role) {
      const div = document.createElement('div')
      div.className = `message ${role}`

      const label = document.createElement('span')
      label.className = 'role-label'
      label.textContent = role === 'user' ? 'You' : 'AI'

      const p = document.createElement('p')

      div.appendChild(label)
      div.appendChild(p)
      messagesEl.appendChild(div)
      return div
    }

    function appendMessage(role, content) {
      const div = createBubble(role)
      div.querySelector('p').textContent = content
      div.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }

    function clearMessages() {
      messagesEl.innerHTML = ''
    }

    function showEmptyState() {
      emptyHint.style.display = 'block'
    }

    function hideEmptyState() {
      emptyHint.style.display = 'none'
    }

    function showStats(meta) {
      statsBar.classList.remove('hidden')
      statsBar.innerHTML = `
        <span>Model: <strong>${meta.model ?? '-'}</strong></span>
        <span>Prompt tokens: <strong>${meta.prompt_tokens ?? '-'}</strong></span>
        <span>Response tokens: <strong>${meta.response_tokens ?? '-'}</strong></span>
        <span>Total tokens: <strong>${meta.total_tokens ?? '-'}</strong></span>
        <span>Duration: <strong>${meta.duration_ms ? `${meta.duration_ms} ms` : '-'}</strong></span>
      `
    }

    function setLoading(on) {
      sendBtn.disabled = on
      sendBtn.textContent = on ? '...' : 'Send'
    }

    async function loadConversations() {
  const convos = await api.conversations()

  sidebar.innerHTML = ''

  convos.forEach(c => {

    const item = document.createElement('div')
    item.className = 'conversation-item'

    const title = document.createElement('span')
    title.textContent = c.title

    const menu = document.createElement('div')

    // PIN
    const pinBtn = document.createElement('button')
    pinBtn.className = 'menu-btn'
    pinBtn.textContent = 'Pin'
    pinBtn.onclick = async () => {
      await api.togglePin(c.id)
      await loadConversations()
    }

    // DELETE
    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'menu-btn'
    deleteBtn.textContent = 'Delete'
    deleteBtn.onclick = async () => {
      await api.deleteConversation(c.id)
      await loadConversations()
    }

    // ✅ RENAME (FIXED SCOPE)
    const renameBtn = document.createElement('button')
    renameBtn.className = 'menu-btn'
    renameBtn.textContent = 'Rename'

    renameBtn.onclick = async () => {
      const newTitle = prompt('Enter new chat name:')
      if (!newTitle) return

      await api.renameConversation(c.id, newTitle)
      await loadConversations()

      if (c.id === currentConversationId) {
        await loadConversation(c.id)
      }
    }

    menu.append(pinBtn, renameBtn, deleteBtn)
    item.append(title, menu)

    sidebar.appendChild(item)
  })
}

    async function loadConversation(id) {
      const data = await api.getConversation(id)
      currentConversationId = data.id

      clearMessages()
      statsBar.classList.add('hidden')

      if (!data.messages.length) {
        showEmptyState()
      } else {
        hideEmptyState()
        data.messages.forEach((message) => {
          appendMessage(message.role, message.content)
        })
      }

      await loadConversations(currentConversationId)
    }

    async function createNewConversation() {
      const conversation = await api.createConversation('New Chat')
      currentConversationId = conversation.id
      clearMessages()
      statsBar.classList.add('hidden')
      showEmptyState()
      await loadConversations(currentConversationId)
      inputEl.focus()
    }

    async function deleteConversation(id) {
      await api.deleteConversation(id)

      if (currentConversationId !== id) {
        await loadConversations(currentConversationId)
        return
      }

      currentConversationId = null
      clearMessages()
      statsBar.classList.add('hidden')

      const conversations = await loadConversations()
      if (conversations.length > 0) {
        await loadConversation(conversations[0].id)
      } else {
        showEmptyState()
      }
    }

    async function sendMessage() {
      const text = inputEl.value.trim()
      if (!text || sendBtn.disabled) return

      if (!currentConversationId) {
        const conversation = await api.createConversation(conversationTitle(text))
        currentConversationId = conversation.id
        await loadConversations(currentConversationId)
      }

      hideEmptyState()
      statsBar.classList.add('hidden')
      inputEl.value = ''
      setLoading(true)

      appendMessage('user', text)

      const assistantBubble = createBubble('assistant')
      const contentEl = assistantBubble.querySelector('p')
      let fullReply = ''

      try {
        await api.chatStream({
          conversation_id: currentConversationId,
          message: text,
          onToken(token) {
            fullReply += token
            contentEl.textContent = fullReply
            assistantBubble.scrollIntoView({ behavior: 'smooth', block: 'end' })
          },
          onDone(meta) {
            showStats(meta)
          },
          onError(errMsg) {
            contentEl.textContent = `Error: ${errMsg}`
            contentEl.style.color = '#ff6b6b'
          },
        })

        if (!fullReply && !contentEl.textContent) {
          contentEl.textContent = '(No response)'
        }

        await loadConversations(currentConversationId)
      } catch (err) {
        contentEl.textContent = `Error: ${err.message}`
        contentEl.style.color = '#ff6b6b'
      } finally {
        setLoading(false)
        inputEl.focus()
      }
    }

    async function init() {
      try {
        const conversations = await loadConversations()
        if (conversations.length > 0) {
          await loadConversation(conversations[0].id)
        } else {
          clearMessages()
          showEmptyState()
        }
      } catch (err) {
        clearMessages()
        const errorBubble = createBubble('assistant')
        const contentEl = errorBubble.querySelector('p')
        contentEl.textContent = `Failed to load chats: ${err.message}`
        contentEl.style.color = '#ff6b6b'
      }
    }

    void init()
  