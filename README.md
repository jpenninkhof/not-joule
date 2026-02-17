# AI Chat Application

A modern, sleek AI chat interface built with SAP CAP (Cloud Application Programming Model) and React, integrated with SAP AI Core for generative AI capabilities.

## Features

- 🎨 **Modern Dark UI** - Clean, futuristic interface inspired by ChatGPT and Claude
- 💬 **Real-time Streaming** - Progressive response generation with Server-Sent Events (SSE)
- 🔐 **Secure Authentication** - XSUAA-based user authentication
- 💾 **Persistent Storage** - Chat history stored in SAP HANA database
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