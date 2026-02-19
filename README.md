# AI Chat Application

A modern, sleek AI chat interface built with SAP CAP (Cloud Application Programming Model) and React, integrated with SAP AI Core for generative AI capabilities.

## Features

- 🎨 **Modern Dark UI** - Clean, futuristic interface inspired by ChatGPT and Claude
- 💬 **Real-time Streaming** - Progressive response generation with Server-Sent Events (SSE)
- 🔐 **Secure Authentication** - XSUAA-based user authentication
- 💾 **Persistent Storage** - Chat history stored in SAP HANA database
- 🧠 **Persistent Memory** - AI remembers user preferences and context across conversations using HANA vector engine
- 🚀 **Cloud-Ready** - Deployable to SAP BTP Cloud Foundry with managed app-router

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SAP BTP Cloud Foundry                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Managed    │  │   CAP       │  │    SAP HANA         │  │
│  │  App Router │──│   Backend   │──│    Database         │  │
│  │  (HTML5)    │  │   (Node.js) │  │    (HDI Container)  │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────────┘  │
│                          │                                   │
│                    ┌─────┴─────┐                             │
│                    │  SAP AI   │                             │
│                    │   Core    │                             │
│                    └───────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 20+ 
- SAP BTP Account with:
  - Cloud Foundry environment
  - SAP HANA Cloud instance
  - SAP AI Core service
  - XSUAA service
- CF CLI installed and logged in

## Project Structure

```
ai-chat-app/
├── app/
│   ├── webapp/              # React frontend
│   │   ├── src/
│   │   │   ├── App.tsx      # Main application component
│   │   │   ├── api.ts       # API client
│   │   │   ├── types.ts     # TypeScript types
│   │   │   └── index.css    # Tailwind CSS styles
│   │   ├── vite.config.ts   # Vite configuration
│   │   └── tailwind.config.js
│   └── xs-app.json          # App router configuration
├── db/
│   └── schema.cds           # Database schema
├── srv/
│   ├── chat-service.cds     # Service definition
│   ├── chat-service.js      # Service implementation
│   ├── ai-core-client.js    # AI Core integration
│   └── server.js            # Custom server with streaming
├── mta.yaml                 # MTA deployment descriptor
├── xs-security.json         # XSUAA configuration
├── package.json
└── default-env.json         # Local development credentials
```

## Local Development

### 1. Install Dependencies

```bash
npm install
cd app/webapp && npm install
```

### 2. Configure AI Core Credentials

Copy the template and add your credentials:

```bash
cp default-env.json.template default-env.json
```

Edit `default-env.json` with your AI Core service credentials.

### 3. Start the Backend

```bash
npm run watch
```

The CAP server will start at http://localhost:4004

### 4. Start the Frontend (in a separate terminal)

```bash
cd app/webapp
npm run dev
```

The React app will start at http://localhost:5173

### 5. Access the Application

Open http://localhost:5173 in your browser. For local development, use the mocked users:
- Username: `alice`, Password: `alice`
- Username: `bob`, Password: `bob`

## Deployment to SAP BTP

### 1. Create AI Core Service Instance

If you don't have an AI Core service instance, create one:

```bash
cf create-service aicore standard aicore
```

### 2. Build the Application

```bash
npm run build
cd app/webapp && npm run build
```

### 3. Build the MTA Archive

```bash
mbt build
```

### 4. Deploy to Cloud Foundry

```bash
cf deploy mta_archives/ai-chat-app_1.0.0.mtar
```

### 5. Assign Role Collection

After deployment, assign the "AI Chat User" role collection to users in the SAP BTP Cockpit.

### 6. Access the Application

The application URL will be displayed after deployment. It follows the pattern:
```
https://<subdomain>.launchpad.cfapps.<region>.hana.ondemand.com/ai-chat-app.webapp/
```

## Configuration

### AI Core Deployment

The application is configured to use:
- **Deployment ID**: `d76331514e34ae4c`
- **Executable**: `aws-bedrock`
- **Model**: `anthropic--claude-4.5-opus`

To change these settings, update the environment variables:
- `AICORE_DEPLOYMENT_ID`
- `AICORE_RESOURCE_GROUP`

### Customization

- **UI Theme**: Edit `app/webapp/tailwind.config.js` and `app/webapp/src/index.css`
- **AI Parameters**: Modify `srv/ai-core-client.js` to adjust temperature, max tokens, etc.

### Security & Limits

Set these environment variables for safer production behavior:

- `CORS_ALLOWED_ORIGINS`: Comma-separated allowlist of origins (for example `https://app.example.com,https://admin.example.com`). Required in production for browser access.
- `MAX_ATTACHMENTS`: Max attachments per request (default `5`).
- `MAX_ATTACHMENT_SIZE_BYTES`: Max size per attachment in bytes (default `5242880`, 5 MB).
- `MAX_TOTAL_ATTACHMENT_SIZE_BYTES`: Max total attachment payload per request in bytes (default `20971520`, 20 MB).

Example:

```bash
export CORS_ALLOWED_ORIGINS="https://app.example.com"
export MAX_ATTACHMENTS=5
export MAX_ATTACHMENT_SIZE_BYTES=5242880
export MAX_TOTAL_ATTACHMENT_SIZE_BYTES=20971520
```

## API Endpoints

### OData Service (ChatService)

- `GET /odata/v4/chat/Conversations` - List user's conversations
- `GET /odata/v4/chat/Conversations({id})?$expand=messages` - Get conversation with messages
- `POST /odata/v4/chat/createConversation` - Create new conversation
- `POST /odata/v4/chat/deleteConversation` - Delete conversation
- `POST /odata/v4/chat/sendMessage` - Send message (non-streaming)

### Custom Endpoints

- `POST /api/chat/stream` - Send message with streaming response (SSE)
- `GET /api/health` - Health check
- `GET /api/memories` - Get all memories for current user
- `DELETE /api/memories/:id` - Delete a specific memory
- `DELETE /api/memories` - Clear all memories for current user

## Persistent Memory System

The application includes a persistent memory system that allows the AI to remember important facts about users across conversations.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Memory Flow                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. EXTRACTION (after each conversation turn)                        │
│     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐        │
│     │ User Message │───▶│ AI Extracts  │───▶│ Store in     │        │
│     │ + AI Response│    │ 0-3 Facts    │    │ HANA Vector  │        │
│     └──────────────┘    └──────────────┘    └──────────────┘        │
│                                                                      │
│  2. RETRIEVAL (at conversation start)                                │
│     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐        │
│     │ User's First │───▶│ Vector       │───▶│ Inject into  │        │
│     │ Message      │    │ Similarity   │    │ System Prompt│        │
│     └──────────────┘    └──────────────┘    └──────────────┘        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Memory Extraction

After each conversation turn, the system:
1. Analyzes the user message and AI response
2. Extracts 0-3 memory-worthy facts (personal attributes, preferences, goals)
3. Generates vector embeddings for semantic search
4. Stores in HANA with deduplication (cosine similarity > 0.92 = duplicate)

**What gets remembered:**
- Personal attributes (name, job, company, location)
- Preferences (communication style, technical level)
- Goals and projects
- Important context for future conversations

**What doesn't get remembered:**
- Trivial or one-off questions
- Generic information
- Temporary states

### Memory Retrieval

At the start of each new conversation:
1. The user's first message is embedded as a vector
2. HANA performs cosine similarity search against stored memories
3. Top 5 most relevant memories are retrieved
4. Memories are injected into the system prompt

### Database Schema

```sql
CREATE TABLE USER_MEMORIES (
    ID NVARCHAR(36) PRIMARY KEY,
    USER_ID NVARCHAR(255) NOT NULL,
    CONTENT NCLOB NOT NULL,
    EMBEDDING REAL_VECTOR(1536),
    SOURCE_CONVERSATION_ID NVARCHAR(36),
    CREATED_AT TIMESTAMP,
    MODIFIED_AT TIMESTAMP
);
```

### Configuration

Set the embedding deployment ID for vector generation:
```bash
export AICORE_EMBEDDING_DEPLOYMENT_ID=your-embedding-deployment-id
```

If not configured, the system uses mock embeddings for development.

### Memory Management API

```bash
# Get all memories
curl -H "Authorization: Bearer $TOKEN" https://your-app/api/memories

# Delete specific memory
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://your-app/api/memories/{id}

# Clear all memories
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://your-app/api/memories
```

### Files

- `srv/memory-service.js` - Core memory service with extraction, embedding, storage, and retrieval
- `srv/prompts/extractMemory.txt` - Prompt template for memory extraction (easily tunable)
- `db/schema.cds` - Includes UserMemories entity with Vector type

## Troubleshooting

### Local Development Issues

1. **AI Core connection fails**: Verify credentials in `default-env.json`
2. **Database errors**: Ensure SQLite is working (`npm run watch` creates in-memory DB)
3. **CORS errors**: The server includes CORS headers for development

### Deployment Issues

1. **Service binding errors**: Ensure all required services exist in your space
2. **Authentication errors**: Verify XSUAA configuration and role assignments
3. **AI Core errors**: Check deployment status in AI Launchpad

## License

UNLICENSED - Internal use only
