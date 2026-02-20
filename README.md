# Not Joule - AI Chat Application

A modern AI chat interface built with SAP CAP (Cloud Application Programming Model) and React, integrated with SAP AI Core for generative AI capabilities.

## Features

- **Modern Dark UI** - Clean, responsive interface with conversation sidebar
- **Real-time Streaming** - WebSocket primary transport with SSE fallback for progressive responses
- **Web Search** - Live web search via Perplexity Sonar with a "Searching the web…" indicator in the UI
- **File Attachments** - Upload and send files (images, documents) alongside messages
- **Secure Authentication** - XSUAA-based user authentication via SAP App Router
- **Persistent Storage** - Chat history stored in SAP HANA database
- **Persistent Memory** - AI remembers user preferences and context across conversations using HANA vector engine
- **Rate Limiting** - Per-user request rate limiting to prevent abuse
- **Cloud-Ready** - Deployable to SAP BTP Cloud Foundry

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SAP BTP Cloud Foundry                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Standalone │  │   CAP       │  │    SAP HANA         │  │
│  │  App Router │──│   Backend   │──│    Database         │  │
│  │  (Node.js)  │  │   (Node.js) │  │    (HDI Container)  │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────────┘  │
│                          │                                  │
│                    ┌─────┴─────┐                            │
│                    │  SAP AI   │                            │
│                    │   Core    │                            │
│                    └───────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 20+
- SAP BTP Account with:
  - Cloud Foundry environment
  - SAP HANA Cloud instance
  - SAP AI Core service
  - XSUAA service
- CF CLI and MBT (`npm install -g mbt`) installed and logged in

## Project Structure

```
ai-chat-app/
├── app/
│   ├── ui/                  # React frontend (Vite + Tailwind)
│   │   ├── src/
│   │   │   ├── App.jsx          # Main application component
│   │   │   ├── hooks/
│   │   │   │   └── useChat.js   # WebSocket/SSE chat hook
│   │   │   ├── services/
│   │   │   │   └── api.js       # API client
│   │   │   └── components/      # UI components
│   │   └── vite.config.js
│   ├── router/              # Standalone App Router
│   │   └── xs-app.json          # Route configuration (incl. WebSocket)
│   └── xs-app.json          # App router configuration (CDS build source)
├── db/
│   ├── schema.cds           # Database schema
│   └── undeploy.json        # HDI undeploy allowlist
├── srv/
│   ├── chat-service.cds     # OData service definition
│   ├── chat-service.js      # OData service implementation
│   ├── ai-core-client.js    # SAP AI Core integration
│   ├── memory-service.js    # Persistent memory service
│   ├── prompts/
│   │   └── extractMemory.txt    # Memory extraction prompt
│   ├── server.js            # Custom server: streaming, WebSocket, auth
│   └── server.test.js       # Unit tests for server utilities
├── mta.yaml                 # MTA deployment descriptor
├── xs-security.json         # XSUAA configuration
├── package.json
└── default-env.json         # Local development credentials (git-ignored)
```

## Local Development

### 1. Install Dependencies

```bash
npm install
cd app/ui && npm install
```

### 2. Configure AI Core Credentials

Copy the template and add your credentials:

```bash
cp default-env.json.template default-env.json
```

Edit `default-env.json` with your AI Core service credentials and deployment IDs.

### 3. Start the Backend

```bash
npm run watch
```

The CAP server will start at http://localhost:4004.

### 4. Start the Frontend (separate terminal)

```bash
cd app/ui && npm run dev
```

The React app will start at http://localhost:5173.

### 5. Access the Application

Open http://localhost:5173. For local development, use the mocked users:
- Username: `alice`, Password: `alice`
- Username: `bob`, Password: `bob`

### 6. Run Tests

```bash
npm test
```

## Deployment to SAP BTP

### 1. Create Required Services

The AI Core service must be created as a user-provided service with your credentials:

```bash
cf cups ai-chat-app-aicore -p '{
  "serviceurls": { "AI_API_URL": "<AI_API_URL>" },
  "clientid": "<CLIENT_ID>",
  "clientsecret": "<CLIENT_SECRET>",
  "url": "<AUTH_URL>"
}'
```

The other services (XSUAA, HANA, Object Store) are created automatically by the MTA deployer.

### 2. Build and Deploy

```bash
cd app/ui && npm run build && cd ../..
cp -r app/ui/dist/* app/router/webapp/
mbt build
cf deploy mta_archives/ai-chat-app_1.0.0.mtar
```

> **Note:** The `cp` step is required because `mbt` snapshots the `app/router` directory before copying in the fresh UI build artifacts. Without it, the deployed router will serve a stale bundle.

### 3. Assign Role Collection

After deployment, assign the "AI Chat User" role collection to users in the SAP BTP Cockpit.

### 4. Access the Application

The application is available at the App Router URL shown after deployment (e.g. `https://notjoule.cfapps.eu10-004.hana.ondemand.com`).

## Configuration

### AI Core Deployment

Set these environment variables (or configure them in `mta.yaml`):

| Variable | Description |
|---|---|
| `AICORE_DEPLOYMENT_ID` | Deployment ID for the chat model |
| `AICORE_EMBEDDING_DEPLOYMENT_ID` | Deployment ID for the embedding model (memory) |
| `AICORE_PERPLEXITY_DEPLOYMENT_ID` | Deployment ID for Perplexity Sonar (web search). Omit to disable web search. |
| `AICORE_RESOURCE_GROUP` | AI Core resource group (default: `default`) |
| `AICORE_MODEL_NAME` | Display name for the model (shown in UI) |

### Security & Limits

| Variable | Default | Description |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | _(none)_ | Comma-separated origin allowlist. Auto-populated from `VCAP_APPLICATION` in CF. |
| `MAX_ATTACHMENTS` | `5` | Max attachments per message |
| `MAX_ATTACHMENT_SIZE_BYTES` | `5242880` | Max size per attachment (5 MB) |
| `MAX_TOTAL_ATTACHMENT_SIZE_BYTES` | `20971520` | Max total attachment payload (20 MB) |
| `MAX_CONTENT_LENGTH` | `32768` | Max message text length (32 KB) |
| `RATE_LIMIT_MAX_REQUESTS` | `30` | Max requests per user per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms (1 minute) |

## API Endpoints

### OData Service (`/odata/v4/chat`)

- `GET /Conversations` - List user's conversations
- `GET /Conversations({id})?$expand=messages` - Get conversation with messages

### Custom REST Endpoints (`/api`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/conversation` | Create a new conversation |
| `DELETE` | `/api/conversation/:id` | Delete a conversation |
| `POST` | `/api/chat/stream` | Send message, stream response via SSE |
| `GET` | `/api/userinfo` | Get current user info |
| `GET` | `/api/model` | Get active model info |
| `GET` | `/api/attachment/:id` | Fetch attachment data |
| `GET` | `/api/memories` | List all memories for current user |
| `DELETE` | `/api/memories/:id` | Delete a specific memory |
| `DELETE` | `/api/memories` | Clear all memories for current user |
| `GET` | `/api/health` | Health check |

### WebSocket (`/ws/chat`)

The primary transport for chat. The client connects and sends JSON messages:

```json
{ "type": "chat", "conversationId": "<uuid>", "content": "Hello", "attachments": [] }
```

The server streams back events:

```json
{ "type": "connected", "userId": "..." }
{ "type": "user_message", "id": "<uuid>" }
{ "type": "assistant_start", "id": "<uuid>" }
{ "type": "web_search_start", "queries": ["search query"] }
{ "type": "content", "content": "Hello..." }
{ "type": "done", "id": "<uuid>" }
```

`web_search_start` is emitted when the model triggers a Perplexity web search. The UI displays a spinning globe with the search query while the search is in progress.

If WebSocket is unavailable, the frontend automatically falls back to SSE via `POST /api/chat/stream`.

## Persistent Memory System

After each conversation turn, the system asynchronously extracts 0–3 memory-worthy facts using the AI model, generates vector embeddings via Amazon Titan or OpenAI-compatible models, and stores them in HANA.

At the start of each conversation, the user's message is embedded and the top 5 most relevant memories are retrieved and injected into the system prompt.

### Extraction

Each extracted memory carries three fields:

| Field | Description |
|---|---|
| `content` | Standalone fact written in third person |
| `category` | `personal_fact` · `preference` · `goal` · `project` · `episodic` |
| `confidence` | `1.0` = explicitly stated · `0.7` = clearly implied · `0.4` = uncertain |

Facts with confidence below 0.4 are not extracted at all.

### Storage & Deduplication

| Cosine similarity to existing memory | Action |
|---|---|
| ≥ 0.85 | Duplicate — skip |
| 0.55 – 0.84 | LLM classifies as **duplicate** / **update** (overwrites) / **new** |
| < 0.55 | New — insert |

### Retrieval Scoring

Memories are ranked by a combined score computed in HANA:

```
score = (cosine_similarity + accessCount × 0.01) × recency_decay × confidence
```

- **Recency decay**: `EXP(-0.005 × days_since_created)` — ~14% drop at 30 days, ~59% at 180 days
- `personal_fact` category is **exempt from decay** (name, employer, location always surface)
- **Access tracking**: `accessCount` and `lastAccessedAt` are updated on every retrieval hit
- Memories scoring below 0.4 are filtered out

### Database Schema (key tables)

```
UserMemories: ID, userId, content, embedding REAL_VECTOR(1024),
              sourceConversationId, category, confidence,
              accessCount, lastAccessedAt, createdAt, modifiedAt
Conversations: ID, title, userId, createdAt, modifiedAt
Messages:      ID, conversation_ID, role, content, createdAt, modifiedAt
MessageAttachments: ID, message_ID, filename, mimeType, content, status
```

### Memory Management

```bash
# Get all memories
curl -H "Authorization: Bearer $TOKEN" https://your-app/api/memories

# Delete specific memory
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://your-app/api/memories/{id}

# Clear all memories
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://your-app/api/memories
```

## Troubleshooting

### Local Development

1. **AI Core connection fails**: Verify credentials in `default-env.json`
2. **Database errors**: Ensure SQLite is working (`npm run watch` creates an in-memory DB)
3. **CORS errors**: The server allows all origins in development mode (`NODE_ENV !== 'production'`)

### Deployment

1. **Service binding errors**: Ensure `ai-chat-app-aicore` user-provided service exists in your CF space
2. **Authentication errors**: Verify XSUAA configuration and role assignments in BTP Cockpit
3. **AI Core errors**: Check deployment status in AI Launchpad; verify `AICORE_DEPLOYMENT_ID`
4. **WebSocket not connecting**: Check that the App Router `xs-app.json` has `"websockets": { "enabled": true }` and a route for `/ws/(.*)`

## License

MIT
