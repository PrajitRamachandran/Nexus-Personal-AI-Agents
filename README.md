# AI Platform

AI Platform is a lightweight full-stack chat application that combines:

- user registration and login
- a modern, redesigned browser-based chat interface with multi-thread support
- streaming AI responses from Ollama with agentic background processing
- intelligent persistent user memory extraction
- automatic dialogue titling support
- a highly detailed observability dashboard for LLM performance tracking
- SQLite-backed chat logging and platform settings

The project is designed to be a robust local AI gateway: using Express on the backend, Vanilla JS/CSS for a native-feeling frontend, and interacting directly with Ollama.

## What It Does

Once the app is running, a user can:

- create an account and sign in securely
- maintain separate concurrent chat sessions managed via a dynamic sidebar
- send messages to a local Ollama model and see live streamed responses
- benefit from intelligent memory: the AI remembers personalized facts across sessions
- see AI-generated conversation titles
- (as an admin) inspect an advanced observability dashboard capturing TTFT, exact latency, and Ollama metrics

## Architecture Overview

The application has two main parts:

- `backend/`
  Express API, JWT authentication, SQLite database, Ollama integration
- `frontend/`
  Static HTML/CSS/JavaScript pages for auth, chat, and logs

At runtime:

1. The backend starts on port `3001` by default.
2. The backend exposes API routes under `/api/...`.
3. The backend also serves the static files in `frontend/`.
4. The frontend stores the JWT token in `localStorage` after login.
5. Authenticated chat requests are forwarded to Ollama and streamed back to the browser with Server-Sent Events style response chunks.
6. The backend stores chat metadata and message excerpts in SQLite.

## Tech Stack

- Backend: Node.js, Express
- Authentication: JWT, bcrypt
- Database: SQLite via `better-sqlite3`
- AI runtime: Ollama
- Frontend: Vanilla HTML, CSS, and JavaScript

## Repository Structure

```text
ai-platform/
|-- backend/
|   |-- data/
|   |   `-- platform.db
|   |-- src/
|   |   |-- db/
|   |   |   |-- index.js
|   |   |   `-- schema.js
|   |   |-- middleware/
|   |   |   `-- auth.js
|   |   `-- routes/
|   |       |-- auth.js
|   |       |-- chat.js
|   |       |-- conversations.js
|   |       |-- logs.js
|   |       `-- memory.js
|   |   `-- services/
|   |       |-- memoryService.js
|   |       `-- titleService.js
|   |-- .env
|   |-- package.json
|   `-- server.js
`-- frontend/
    |-- index.html
    |-- login.html
    |-- register.html
    |-- chat.html
    |-- logs.html
    |-- api.js
    |-- auth.js
    `-- styles.css
```

## Core Features

### Authentication

- Users register with `username`, `email`, and `password`.
- Passwords are hashed with bcrypt before being stored.
- Users log in with `email` and `password`.
- Successful auth returns a JWT token valid for 7 days.
- The frontend stores the token and username in `localStorage`.

### Streaming Chat

- The chat page sends the current conversation history to the backend.
- The backend forwards the request to Ollama's `/api/chat` endpoint.
- Ollama replies in a streaming format.
- The backend forwards streamed token chunks to the browser as they arrive.
- The frontend appends the response live into the assistant message bubble.

### Intelligent Persistent Memory

- An integrated background extraction pipeline asynchronously reviews chat content to identify long-term user facts and context.
- Persistent context is saved in SQLite and actively appended to future chats.
- Users can view extracted facts right from their frontend interface panel.

### Conversation Management

- Auto-generated conversation titles via a background AI parser (`titleService`).
- Concurrent chat sessions tracked in a sidebar, allowing the user to seamlessly swap contexts.

### Observability Dashboard

- Highly detailed `logs.js` platform capturing extensive operational metrics (Time to First Token, throughput, inference latency, token counts).
- Secure logs page (`logs.html`) that cleanly surfaces execution details, strictly access-controlled for system administrators.

### Chat Logging

For each completed chat response, the backend stores:

- user id and username
- model name
- prompt, response, and total token counts when provided by Ollama
- response duration
- number of messages in the submitted conversation
- a truncated copy of the latest user prompt
- a truncated copy of the assistant reply
- timestamp

## Prerequisites

Before running the project, make sure you have:

- Node.js 18 or newer
- npm
- Ollama installed and available locally
- at least one Ollama chat model pulled, such as `llama3`

Node 18+ is recommended because the backend uses native `fetch` and modern ESM features.

## Environment Variables

The backend expects a `.env` file inside `backend/`.

Supported variables:

| Variable     | Required | Default                                          | Purpose                                        |
| ------------ | -------- | ------------------------------------------------ | ---------------------------------------------- |
| PORT         | No       | 3001                                             | Port used by the Express server                |
| JWT_SECRET   | Yes      | —                                                | Secret used to sign and verify JWT tokens      |
| OLLAMA_HOST  | No       | [http://localhost:11434](http://localhost:11434) | Base URL for the local Ollama server           |
| OLLAMA_MODEL | No       | llama3                                           | Model name used for chat requests              |
| DB_PATH      | No       | ./data/platform.db                               | SQLite database file path relative to backend/ |


Example `backend/.env`:

```env
PORT=3001
JWT_SECRET=change-this-to-a-long-random-secret
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3
DB_PATH=./data/platform.db
```

Important note:

- `JWT_SECRET` is mandatory. The backend exits immediately if it is missing.

## Getting Started

### 1. Install backend dependencies

```bash
cd backend
npm install
```

The frontend is static and does not need a separate install step.

### 2. Create or update `backend/.env`

Use the example above and provide a real secret for `JWT_SECRET`.

### 3. Start Ollama

If Ollama is not already running, start it:

```bash
ollama serve
```

In another terminal, pull the model you want to use if you do not already have it:

```bash
ollama pull llama3
```

If you choose a different model, make sure `OLLAMA_MODEL` in `backend/.env` matches it.

### 4. Start the application

For development:

```bash
cd backend
npm run dev
```

For a normal start:

```bash
cd backend
npm start
```

### 5. Open the app

Visit:

```text
http://localhost:3001
```

The root page redirects automatically:

- logged-in users go to `/chat.html`
- logged-out users go to `/login.html`

## First-Run User Flow

1. Open the app in the browser.
2. Create an account on the registration page.
3. You are logged in automatically after registration.
4. Send a message from the chat screen.
5. Watch the AI response stream in real time.
6. Open the logs page to review recent stored conversations and response metrics.

## Available Pages

| Page | Purpose |
| --- | --- |
| `/` | Redirects to login or chat based on auth state |
| `/login.html` | Sign-in page |
| `/register.html` | Account creation page |
| `/chat.html` | Main modern chat UI with sidebar, memory, and multi-chat support |
| `/logs.html` | Advanced internal observability and logging dashboard |

## Backend Scripts

Defined in `backend/package.json`:

| Script | Command | Purpose |
| --- | --- | --- |
| `npm run dev` | `node --watch server.js` | Start the backend with file watching |
| `npm start` | `node server.js` | Start the backend normally |

## API Overview

### `GET /health`

Simple health check.

Example response:

```json
{
  "status": "ok"
}
```

### `POST /api/auth/register`

Create a new user and immediately return an auth token.

Request body:

```json
{
  "username": "demo",
  "email": "demo@example.com",
  "password": "password123"
}
```

Response:

```json
{
  "token": "<jwt>",
  "username": "demo"
}
```

### `POST /api/auth/login`

Authenticate an existing user by email and password.

Request body:

```json
{
  "email": "demo@example.com",
  "password": "password123"
}
```

Response:

```json
{
  "token": "<jwt>",
  "username": "demo"
}
```

### `POST /api/chat`

Authenticated streaming chat endpoint.

Headers:

- `Authorization: Bearer <jwt>`
- `Content-Type: application/json`

Request body:

```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

Behavior:

- validates that `messages` is an array
- forwards the conversation to Ollama
- streams token chunks back to the client
- logs usage metadata into SQLite

### `GET /api/logs`

Authenticated endpoint that returns the latest 100 stored chat logs.

The current implementation returns recent platform logs ordered by newest first.

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

### `chat_logs`

Stores:

- user reference
- username
- model name
- token metrics
- duration
- number of messages sent in the request
- latest user prompt excerpt
- assistant reply excerpt
- created timestamp

The database is opened in WAL mode and foreign keys are enabled on startup.

## How Conversation State Works

The current chat session is tracked in the browser while the user stays on the chat page.

That means:

- the browser keeps the active conversation history in memory
- each new message sends the accumulated `history` array to the backend
- refreshing the page clears the in-memory conversation from the UI
- logs are stored separately in SQLite as historical records

## Development Notes

- The frontend is served directly by the backend from the repository's `frontend/` folder.
- API requests in the frontend use relative paths such as `/api/auth/login`.
- The backend includes a small CORS allowlist for `http://localhost:5173` and `http://192.168.1.5:5173`.
- If you serve the frontend from a different origin during development, update the CORS configuration in `backend/server.js`.

## Security and Production Caveats

This project is well suited for local development and experimentation, but it is not production hardened yet.

Things to keep in mind:

- JWTs are stored in `localStorage`, which is simple but not ideal for high-security environments.
- The backend currently disables Helmet's CSP and some cross-origin protections for simplicity.
- The logs endpoint is authenticated, but the current implementation returns recent platform logs rather than filtering to the current user.
- There is no role system, rate limiting, or advanced input validation yet.
- Secrets are loaded from `backend/.env`, so that file should not be committed publicly.

## Troubleshooting

### Backend exits on startup

Check that `backend/.env` exists and includes `JWT_SECRET`.

### Chat requests fail

Common causes:

- Ollama is not running
- the configured model does not exist locally
- `OLLAMA_HOST` is incorrect

Useful checks:

```bash
ollama list
ollama serve
```

### The page loads but API calls fail

Check:

- the backend is running on the expected port
- you are opening the app from the backend host
- the frontend origin is allowed by CORS if you are serving it separately

### Logs page is empty

The logs page only shows data after successful chat completions have been recorded.

### Database issues

If you want to reset local data during development, stop the server and inspect the files in `backend/data/`.

## Current Limitations

- No automated test suite is configured in the repository.
- No frontend build pipeline is included; the UI is shipped as static files.
- Active chat history is not restored after a page refresh.
- Log records store excerpts, not full long-form conversation history.

## Suggested Next Improvements

- add a `.env.example` file
- add user-scoped log filtering
- restore saved conversations in the UI
- add validation and rate limiting
- add tests for auth and chat routes
- add deployment instructions or Docker support

## Summary

This repository is a simple local AI chat platform with:

- JWT-based auth
- a static browser UI
- streaming Ollama chat responses
- SQLite-backed usage logging

If you want to extend it, the cleanest next steps are usually improving log privacy, saving full conversations, and adding a repeatable deployment and test story.
