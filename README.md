# AI Platform (Nexus AI)

AI Platform is a local-first full-stack chat app for Ollama. The repository is named `ai-platform`, while the product UI is branded as `Nexus AI`.

It combines:

- JWT-based registration and login
- persistent multi-conversation chat stored in SQLite
- streaming Ollama responses with live token output
- automatic conversation titling
- long-term memory extraction and retrieval
- conversation search, pin, rename, and soft delete
- a settings area for appearance, memory review, and active model selection
- an observability/logs page with richer admin visibility

The stack is intentionally simple: Express on the backend, static HTML/CSS/JavaScript on the frontend, and direct integration with a local Ollama instance.

## What It Does

Once the app is running, a user can:

- create an account and sign in
- start multiple conversations and revisit them later
- stream responses from a local Ollama chat model
- search previous chats by title or message content
- pin, rename, or delete conversations from the sidebar
- let the app extract durable user facts into long-term memory
- review and delete saved memories from the settings page
- switch the active local LLM model from the settings page
- view request metrics on the logs page

If the signed-in username matches `ADMIN_USERNAME`, the logs page becomes a broader observability dashboard with aggregate stats and recent logs across users.

## Architecture Overview

The application has two runtime layers:

- `backend/`
  Express API, JWT auth, SQLite persistence, Ollama integration, memory/title/model services
- `frontend/`
  Static HTML/CSS/JavaScript pages for auth, chat, settings, and logs

At runtime:

1. `server.js` at the repo root bootstraps `backend/server.js`.
2. The backend starts on port `3001` by default.
3. API routes are exposed under `/api/...`.
4. The backend also serves the static files from `frontend/`.
5. The browser stores auth state in `localStorage`.
6. Conversations and messages are persisted in SQLite and reloaded on refresh.
7. Chat responses stream from Ollama back to the browser as SSE-style `data:` events.

## Tech Stack

- Backend: Node.js, Express
- Auth: JWT, bcrypt
- Database: SQLite via `better-sqlite3`
- AI runtime: Ollama
- Frontend: Vanilla HTML, CSS, and JavaScript

## Repository Structure

```text
ai-platform/
|-- backend/
|   |-- data/
|   |-- src/
|   |   |-- config.js
|   |   |-- db/
|   |   |   |-- index.js
|   |   |   `-- schema.js
|   |   |-- middleware/
|   |   |   |-- auth.js
|   |   |   `-- error.js
|   |   |-- routes/
|   |   |   |-- auth.js
|   |   |   |-- chat.js
|   |   |   |-- conversations.js
|   |   |   |-- logs.js
|   |   |   |-- memory.js
|   |   |   `-- models.js
|   |   `-- services/
|   |       |-- memoryService.js
|   |       |-- modelService.js
|   |       `-- titleService.js
|   |-- package.json
|   `-- server.js
|-- frontend/
|   |-- index.html
|   |-- login.html
|   |-- register.html
|   |-- chat.html
|   |-- logs.html
|   |-- settings.html
|   |-- api.js
|   |-- auth.js
|   |-- memory-ui.js
|   |-- styles.css
|   `-- theme.js
|-- package.json
|-- server.js
`-- serve.json
```

## Core Features

### Authentication

- Users register with `username`, `email`, and `password`.
- Passwords are hashed with bcrypt before storage.
- Login uses `email` plus `password`.
- Tokens are signed for 7 days.
- The frontend stores `token`, `username`, and a client-side expiry timestamp in `localStorage`.

### Persistent Conversations

- Each conversation belongs to a user and is stored in SQLite.
- Messages are stored separately and loaded back when a conversation is opened.
- Conversations can be:
  - created
  - searched by title or message content
  - renamed
  - pinned and unpinned
  - soft deleted
- The sidebar is sorted by pinned status and recent activity.

### Streaming Chat

- The chat endpoint accepts `conversation_id` and `message`.
- The backend stores the user message, rebuilds the full conversation from the database, and sends it to Ollama.
- Ollama output is streamed back token-by-token.
- After the reply completes, the backend emits a final metrics payload.
- The same stream may also send:
  - `title_update` when an automatic title is generated
  - `memory_update` when new long-term memory entries are saved

### Long-Term Memory

- The backend extracts durable user facts from chat messages.
- Relevant memories are injected as a system prompt on future requests when useful.
- Memories are stored in SQLite with category, context, relevance, last-used tracking, and optional embeddings.
- Embeddings are generated through Ollama's `/api/embed` endpoint using `EMBED_MODEL`.
- The settings page lets users review and delete memories.
- The API also supports manual memory creation, even though the current UI does not include a dedicated add-memory form.

### Automatic Titling

- New conversations can be auto-titled after the first few user messages.
- Titles are generated asynchronously and pushed back to the UI after the main reply stream finishes.
- If `TITLE_MODEL` is not set, title generation uses the active chat model.

### Model Management

- The settings page lists locally pulled Ollama chat models.
- Embedding-focused models are filtered out of the selectable chat-model list.
- The selected active model is persisted in the `app_settings` table.
- If the stored active model is no longer available, the backend falls back to the configured default or the first available local chat model.

### Logs and Observability

- Every completed chat can write timing and token metrics into `chat_logs`.
- The logs page is available to authenticated users.
- Regular users see:
  - their most recent request summary
  - model-wise metrics for their own recent requests
- The admin user sees:
  - the latest logs across users
  - aggregate request stats
  - model-wise grouped views
  - extra fields such as TTFT, throughput, wall time, and Ollama timing breakdowns

### Appearance Settings

- The settings page supports theme selection.
- Built-in themes currently include `indigo`, `emerald`, `rose`, `amber`, and `sky`.
- Dark and light mode are both supported.

## Prerequisites

Before running the project, make sure you have:

- Node.js 18 or newer
- npm
- Ollama installed locally
- at least one Ollama chat model pulled
- an embedding-capable Ollama model pulled if you want memory embeddings

Node 18+ is recommended because the backend uses native `fetch` and ESM.

With the current defaults, a good starting point is:

```bash
ollama pull gemma3:4b
ollama pull nomic-embed-text
```

## Environment Variables

Create `backend/.env`.

Supported variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `3001` | Express server port |
| `JWT_SECRET` | Yes | none | Secret used to sign and verify JWTs |
| `OLLAMA_HOST` | No | `http://localhost:11434` | Base URL for the local Ollama server |
| `OLLAMA_MODEL` | No | `gemma3:4b` | Default chat model used before a different active model is selected |
| `EMBED_MODEL` | No | `nomic-embed-text` | Embedding model used for memory embeddings via `/api/embed` |
| `TITLE_MODEL` | No | active chat model | Optional override model used only for title generation |
| `DB_PATH` | No | `./data/platform.db` | SQLite database path, resolved relative to `backend/` unless absolute |
| `ADMIN_USERNAME` | No | empty string | Username that unlocks the full admin logs dashboard |

Example `backend/.env`:

```env
PORT=3001
JWT_SECRET=change-this-to-a-long-random-secret
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gemma3:4b
EMBED_MODEL=nomic-embed-text
ADMIN_USERNAME=admin
DB_PATH=./data/platform.db
```

Notes:

- `JWT_SECRET` is mandatory. The backend exits if it is missing.
- `EMBED_MODEL` should point to an embedding-capable model, not a chat model.
- If `TITLE_MODEL` is omitted, title generation uses the current active chat model.

## Getting Started

### 1. Install backend dependencies

```bash
cd backend
npm install
```

The frontend is static and does not need its own install step.

### 2. Create `backend/.env`

Use the example above and set a real `JWT_SECRET`.

### 3. Start Ollama

If Ollama is not already running:

```bash
ollama serve
```

Pull the models you want to use:

```bash
ollama pull gemma3:4b
ollama pull nomic-embed-text
```

You can swap the chat model later from the app's settings page.

### 4. Start the application

From the repo root:

```bash
npm run dev
```

Or from `backend/` directly:

```bash
npm run dev
```

Normal start:

```bash
npm start
```

### 5. Open the app

Visit:

```text
http://localhost:3001
```

The root page immediately redirects:

- logged-in users go to `/chat.html`
- logged-out users go to `/login.html`

## Available Pages

| Page | Purpose |
| --- | --- |
| `/` | Redirects to login or chat based on auth state |
| `/login.html` | Sign-in page |
| `/register.html` | Account creation page |
| `/chat.html` | Main chat UI with sidebar, search, pinning, renaming, and streaming replies |
| `/settings.html` | Appearance, memory review, and active-model management |
| `/logs.html` | Request metrics page; richer dashboard for the configured admin user |

## Scripts

### Repo root `package.json`

| Script | Command | Purpose |
| --- | --- | --- |
| `npm run dev` | `node --watch server.js` | Start the app through the root bootstrap file |
| `npm start` | `node server.js` | Start the app through the root bootstrap file |

### `backend/package.json`

| Script | Command | Purpose |
| --- | --- | --- |
| `npm run dev` | `node --watch server.js` | Start the backend with file watching |
| `npm start` | `node server.js` | Start the backend normally |

## API Overview

### `GET /health`

Simple health check.

Response:

```json
{
  "status": "ok"
}
```

### `POST /api/auth/register`

Create a new user and immediately return a token.

Request body:

```json
{
  "username": "demo",
  "email": "demo@example.com",
  "password": "password123"
}
```

Notes:

- all fields are required
- password must be at least 8 characters

### `POST /api/auth/login`

Authenticate an existing user.

Request body:

```json
{
  "email": "demo@example.com",
  "password": "password123"
}
```

### `GET /api/conversations`

Return the current user's conversations ordered by pinned status and recency.

### `POST /api/conversations`

Create a new conversation.

Request body:

```json
{
  "title": "New Chat"
}
```

### `GET /api/conversations/:id`

Return a single conversation and all of its messages.

### `PATCH /api/conversations/:id`

Rename a conversation.

Request body:

```json
{
  "title": "Roadmap Notes"
}
```

### `PATCH /api/conversations/:id/pin`

Toggle pinned state for a conversation.

### `DELETE /api/conversations/:id`

Soft delete a conversation.

### `GET /api/conversations/search?q=...`

Search the current user's conversations by title and message content. Returns match metadata and a snippet for message matches.

### `POST /api/chat`

Authenticated streaming chat endpoint.

Headers:

- `Authorization: Bearer <jwt>`
- `Content-Type: application/json`

Request body:

```json
{
  "conversation_id": 1,
  "message": "Hello"
}
```

Behavior:

- validates the conversation belongs to the current user
- stores the user message
- reloads conversation history from SQLite
- injects relevant memory when available
- forwards the request to Ollama
- streams reply tokens back to the browser
- stores the assistant reply and request metrics
- may emit follow-up `title_update` and `memory_update` events before the stream closes

### `GET /api/memory`

Return all saved memories for the current user.

Response shape:

```json
{
  "memories": []
}
```

### `POST /api/memory`

Manually add a memory entry.

Request body:

```json
{
  "content": "User prefers concise answers",
  "context": "Useful when responding",
  "category": "preference"
}
```

### `DELETE /api/memory/:id`

Delete a single saved memory owned by the current user.

### `GET /api/models`

Return the locally available Ollama chat models and the current active model.

### `POST /api/models/active`

Switch the active chat model.

Request body:

```json
{
  "model": "gemma3:4b"
}
```

The backend rejects models that are not pulled locally.

### `GET /api/logs`

Return logs for the current user, or the richer admin dashboard payload if the signed-in username matches `ADMIN_USERNAME`.

Regular-user response shape:

```json
{
  "admin": false,
  "log": null,
  "modelLogs": []
}
```

Admin response shape:

```json
{
  "admin": true,
  "stats": {},
  "logs": [],
  "modelLogs": []
}
```

## Database

The SQLite database lives at:

```text
backend/data/platform.db
```

Main tables:

### `users`

Stores:

- id
- username
- email
- hashed password
- created timestamp

### `conversations`

Stores:

- user reference
- title
- pinned flag
- soft-delete flag
- auto-title state
- created and updated timestamps
- optional `legacy_log_id` for migrated historical logs

### `messages`

Stores:

- conversation reference
- role (`user`, `assistant`, `system`)
- full message content
- created timestamp
- optional token count column for future use

### `memory`

Stores:

- user reference
- memory content
- optional context
- category
- last-used timestamp
- relevance score
- optional serialized embedding vector
- created timestamp

### `chat_logs`

Stores:

- user and conversation references
- username
- model name
- token metrics
- timing metrics
- context length
- response length
- user-message and assistant-reply excerpts
- optional error text
- created timestamp

### `app_settings`

Stores platform-level settings such as the active Ollama chat model.

## How Conversation State Works

Conversation state is now database-backed.

That means:

- the sidebar is loaded from SQLite, not just browser memory
- message history is restored when you reopen a conversation
- refreshing the page does not erase saved conversations
- deletions are soft deletes at the conversation level
- historical `chat_logs` rows from older versions are migrated into conversations on startup when needed

## Development Notes

- The frontend is served directly by the backend from `frontend/`.
- The repo root `server.js` is a tiny bootstrap that imports `backend/server.js`.
- The API client targets `http://localhost:3001` on localhost, or `http://<current-host>:3001` on other hosts.
- CORS is currently permissive in development.
- Helmet is enabled, with `connect-src` allowing the local frontend to reach Ollama.

## Security and Production Caveats

This project is best suited for local development and experimentation. It is not production hardened yet.

Things to keep in mind:

- JWTs are stored in `localStorage`.
- Admin access to the richer logs dashboard is based on username matching `ADMIN_USERNAME`.
- CORS is permissive.
- There is no role system beyond the admin-username check.
- There is no rate limiting or advanced request validation layer yet.
- Secrets are loaded from `backend/.env`, so that file should never be committed publicly.

## Troubleshooting

### Backend exits on startup

Check that `backend/.env` exists and includes `JWT_SECRET`.

### Chat requests fail

Common causes:

- Ollama is not running
- the selected chat model is not available locally
- `OLLAMA_HOST` is incorrect

Useful checks:

```bash
ollama list
ollama serve
```

### Memory retrieval is weak or embeddings fail

Check that your embedding model is pulled locally and matches `EMBED_MODEL`.

Example:

```bash
ollama pull nomic-embed-text
```

### The model selector is empty

No local chat models were returned from Ollama. Pull at least one chat-capable model first.

### The logs page is not showing the full dashboard

Only the user whose username exactly matches `ADMIN_USERNAME` gets the admin view.

### The page loads but API calls fail

Check:

- the backend is running on port `3001`
- the browser can reach that host and port
- the frontend is calling the backend host you expect

## Current Limitations

- No automated test suite is included yet.
- No Docker or deployment workflow is included.
- The current UI lets users review and delete memory, but not manually add memory from a form.
- Admin privileges are username-based rather than role-based.
- `chat_logs` stores excerpts and metrics; full conversation text lives in `messages`.

## Suggested Next Improvements

- add a `.env.example`
- add role-based authorization instead of username-based admin detection
- add automated tests for auth, conversations, chat, and memory flows
- add a UI for manually creating memory entries
- add deployment and container documentation
- tighten CORS and production security defaults

## Summary

This repository is a local AI workspace with:

- JWT auth
- a static browser UI
- persistent SQLite-backed conversations
- streaming Ollama chat
- long-term memory with embeddings
- settings for themes and active-model switching
- a metrics-focused logs dashboard

If you are extending it, the most useful next steps are usually tests, stronger auth/authorization, better production hardening, and a smoother deployment story.
