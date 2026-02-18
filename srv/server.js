const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const { memoryService } = require('./memory-service');
const { AiCoreClient } = require('./ai-core-client');

// Try to load WebSocket, but don't fail if not available
let WebSocket;
try {
    WebSocket = require('ws');
} catch (e) {
    // WebSocket module not available
}

// Reuse a single AiCoreClient instance across requests
let _aiCoreClient = null;
function getAiCoreClient() {
    if (!_aiCoreClient) {
        _aiCoreClient = new AiCoreClient();
    }
    return _aiCoreClient;
}

// ============ Auth Helpers ============

/**
 * Decode a JWT token and extract user info.
 * Returns { id, email, name } or null if invalid.
 */
function decodeUserFromToken(token) {
    if (!token || token.trim() === '') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        const id = payload.user_name || payload.email || payload.sub;
        if (!id) return null;
        return {
            id,
            email: payload.email,
            name: payload.given_name || payload.user_name,
            given_name: payload.given_name,
            family_name: payload.family_name
        };
    } catch {
        return null;
    }
}

/**
 * Express middleware that extracts the user from the Authorization header.
 * Sets req.user on success; returns 401 on failure.
 */
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = decodeUserFromToken(authHeader.substring(7));
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    req.user = user;
    next();
}

// ============ Shared Chat Logic ============

/**
 * Save attachments for a message.
 */
async function saveAttachments(db, attachments, messageId) {
    for (const att of attachments) {
        let base64Data = att.data;
        if (base64Data && base64Data.includes(',')) {
            base64Data = base64Data.split(',')[1];
        }

        const attachmentId = uuidv4();
        const contentBuffer = base64Data ? Buffer.from(base64Data, 'base64') : null;

        await db.run(INSERT.into('ai.chat.MessageAttachments').entries({
            ID: attachmentId,
            message_ID: messageId,
            filename: att.name || 'attachment',
            mimeType: att.type || 'application/octet-stream',
            content: contentBuffer,
            status: 'Clean',
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
        }));
    }
}

/**
 * Build the AI messages array from conversation history and current attachments/memories.
 */
async function buildAiMessages(db, userId, conversationId, content, attachments) {
    const messages = await db.run(
        SELECT.from('ai.chat.Messages')
            .where({ conversation_ID: conversationId })
            .orderBy('createdAt asc')
            .limit(20)
    );

    const aiMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
    }));

    // Attach current message's files to the last user message
    if (attachments && attachments.length > 0) {
        const lastUserMsg = aiMessages[aiMessages.length - 1];
        if (lastUserMsg && lastUserMsg.role === 'user') {
            lastUserMsg.attachments = attachments;
        }
    }

    // Retrieve relevant memories and inject into system prompt
    let systemPromptAddition = '';
    try {
        const relevantMemories = await memoryService.retrieveRelevantMemories(userId, content || '');
        systemPromptAddition = memoryService.formatMemoriesForPrompt(relevantMemories);
        if (systemPromptAddition) {
            console.log(`Injecting ${relevantMemories.length} memories into system prompt for user ${userId}`);
        }
    } catch (memError) {
        console.error('Error retrieving memories:', memError);
    }

    if (systemPromptAddition) {
        aiMessages.unshift({
            role: 'system',
            content: `You are a helpful AI Assistant.${systemPromptAddition}`
        });
    }

    return aiMessages;
}

/**
 * Generate a conversation title from available sources.
 */
function generateTitle(content, attachments, fullContent) {
    let titleSource = '';

    if (content && content.trim()) {
        titleSource = content.trim();
    } else if (attachments && attachments.length > 0) {
        const attachmentNames = attachments.map(a => a.name).filter(n => n);
        if (attachmentNames.length > 0) {
            titleSource = attachmentNames.length === 1
                ? attachmentNames[0]
                : `${attachmentNames[0]} (+${attachmentNames.length - 1} more)`;
        }
    }
    if (!titleSource && fullContent) {
        const firstLine = fullContent.split('\n')[0].trim();
        titleSource = firstLine.replace(/^#+\s*/, '').trim();
    }

    if (!titleSource) return null;
    return titleSource.substring(0, 50) + (titleSource.length > 50 ? '...' : '');
}

/**
 * Parse streaming SSE chunks from AI Core and extract text deltas.
 */
function parseStreamChunk(buffer, isAnthropic) {
    const deltas = [];
    const lines = buffer.split('\n');
    const remaining = lines.pop() || '';

    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]' || data === '') continue;

            try {
                const json = JSON.parse(data);
                let delta = null;

                if (isAnthropic) {
                    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                        delta = json.delta.text;
                    }
                } else {
                    delta = json.choices?.[0]?.delta?.content;
                }

                if (delta) deltas.push(delta);
            } catch {
                // Ignore parse errors for incomplete chunks
            }
        }
    }

    return { deltas, remaining };
}

/**
 * Process post-stream tasks: save assistant message, update title, extract memories.
 */
async function processStreamEnd(db, { assistantMessageId, conversationId, conversation, content, attachments, fullContent, userId }) {
    // Save assistant message
    await db.run(INSERT.into('ai.chat.Messages').entries({
        ID: assistantMessageId,
        conversation_ID: conversationId,
        role: 'assistant',
        content: fullContent,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString()
    }));

    // Update conversation title if it's still the default
    const needsTitleUpdate = !conversation.title ||
        conversation.title === 'New Conversation' ||
        conversation.title === 'New Chat';

    if (needsTitleUpdate) {
        const title = generateTitle(content, attachments, fullContent);
        if (title) {
            await db.run(
                UPDATE('ai.chat.Conversations')
                    .set({ title, modifiedAt: new Date().toISOString() })
                    .where({ ID: conversationId })
            );
        }
    }

    // Process memory extraction asynchronously
    Promise.resolve().then(async () => {
        try {
            const recentMessages = [
                { role: 'user', content },
                { role: 'assistant', content: fullContent }
            ];
            await memoryService.processConversationTurn(userId, conversationId, recentMessages);
        } catch (memError) {
            console.error('Error processing memories:', memError);
        }
    });
}

// ============ Server Bootstrap ============

cds.on('bootstrap', (app) => {
    const express = require('express');
    app.use(express.json({ limit: '50mb' }));

    // CORS: restrict in production, allow all in development
    app.use((req, res, next) => {
        const origin = process.env.NODE_ENV === 'production'
            ? req.headers.origin || ''
            : '*';
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    });
});

// ============ Endpoint Registration ============

cds.on('served', async () => {
    const app = cds.app;

    // --- Streaming chat endpoint (SSE) ---
    app.post('/api/chat/stream', authMiddleware, async (req, res) => {
        try {
            const { conversationId, content, attachments } = req.body;
            const userId = req.user.id;

            if (!conversationId || (!content && (!attachments || attachments.length === 0))) {
                return res.status(400).json({ error: 'Missing conversationId or content' });
            }

            const db = await cds.connect.to('db');

            // Verify conversation ownership
            const conversation = await db.run(
                SELECT.one.from('ai.chat.Conversations').where({ ID: conversationId, userId })
            );
            if (!conversation) {
                return res.status(404).json({ error: 'Conversation not found or access denied' });
            }

            // Save user message
            const userMessage = {
                ID: uuidv4(),
                conversation_ID: conversationId,
                role: 'user',
                content: content,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            };
            await db.run(INSERT.into('ai.chat.Messages').entries(userMessage));

            if (attachments && attachments.length > 0) {
                await saveAttachments(db, attachments, userMessage.ID);
            }

            const aiMessages = await buildAiMessages(db, userId, conversationId, content, attachments);

            // Set up SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            res.write(`data: ${JSON.stringify({ type: 'user_message', id: userMessage.ID })}\n\n`);

            const assistantMessageId = uuidv4();
            res.write(`data: ${JSON.stringify({ type: 'assistant_start', id: assistantMessageId })}\n\n`);

            const client = getAiCoreClient();
            let fullContent = '';
            const isAnthropic = client.modelType === 'anthropic';

            try {
                const stream = await client.chatStream(aiMessages);
                let buffer = '';

                stream.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const { deltas, remaining } = parseStreamChunk(buffer, isAnthropic);
                    buffer = remaining;

                    for (const delta of deltas) {
                        fullContent += delta;
                        res.write(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`);
                    }
                });

                stream.on('end', async () => {
                    await processStreamEnd(db, {
                        assistantMessageId, conversationId, conversation,
                        content, attachments, fullContent, userId
                    });
                    res.write(`data: ${JSON.stringify({ type: 'done', id: assistantMessageId })}\n\n`);
                    res.end();
                });

                stream.on('error', (error) => {
                    console.error('Stream error:', error);
                    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
                    res.end();
                });

            } catch (error) {
                console.error('AI Core error:', error);
                res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to get AI response' })}\n\n`);
                res.end();
            }

        } catch (error) {
            console.error('Streaming endpoint error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            } else {
                res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
                res.end();
            }
        }
    });

    // --- Health check ---
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // --- Create conversation ---
    app.post('/api/conversation', authMiddleware, async (req, res) => {
        try {
            const { title } = req.body;
            const conversation = {
                ID: uuidv4(),
                title: title || 'New Conversation',
                userId: req.user.id,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            };

            const db = await cds.connect.to('db');
            await db.run(INSERT.into('ai.chat.Conversations').entries(conversation));

            res.json({ ID: conversation.ID, title: conversation.title, createdAt: conversation.createdAt });
        } catch (error) {
            console.error('Error creating conversation:', error);
            res.status(500).json({ error: 'Failed to create conversation' });
        }
    });

    // --- Delete conversation ---
    app.delete('/api/conversation/:id', authMiddleware, async (req, res) => {
        try {
            const conversationId = req.params.id;
            const db = await cds.connect.to('db');

            const conversation = await db.run(
                SELECT.one.from('ai.chat.Conversations').where({ ID: conversationId, userId: req.user.id })
            );
            if (!conversation) {
                return res.status(404).json({ error: 'Conversation not found or access denied' });
            }

            const messages = await db.run(
                SELECT.from('ai.chat.Messages').where({ conversation_ID: conversationId }).columns('ID')
            );

            for (const msg of messages) {
                await db.run(DELETE.from('ai.chat.MessageAttachments').where({ message_ID: msg.ID }));
            }

            await db.run(DELETE.from('ai.chat.Messages').where({ conversation_ID: conversationId }));
            await db.run(DELETE.from('ai.chat.Conversations').where({ ID: conversationId }));

            res.json({ success: true });
        } catch (error) {
            console.error('Error deleting conversation:', error);
            res.status(500).json({ error: 'Failed to delete conversation' });
        }
    });

    // --- User info ---
    app.get('/api/userinfo', authMiddleware, (req, res) => {
        const user = req.user;
        res.json({
            id: user.id,
            email: user.email,
            name: user.given_name
                ? `${user.given_name} ${user.family_name || ''}`.trim()
                : (user.name || user.email || 'User'),
            given_name: user.given_name,
            family_name: user.family_name
        });
    });

    // --- Get attachment data ---
    app.get('/api/attachment/:id', authMiddleware, async (req, res) => {
        try {
            const userId = req.user.id;
            const attachmentId = req.params.id;
            const db = await cds.connect.to('db');

            const attachment = await db.run(
                SELECT.one.from('ai.chat.MessageAttachments')
                    .columns('ID', 'message_ID', 'filename', 'mimeType', 'status')
                    .where({ ID: attachmentId })
            );
            if (!attachment) {
                return res.status(404).json({ error: 'Attachment not found' });
            }

            const message = await db.run(
                SELECT.one.from('ai.chat.Messages').where({ ID: attachment.message_ID })
            );
            if (!message) {
                return res.status(404).json({ error: 'Message not found' });
            }

            const conversation = await db.run(
                SELECT.one.from('ai.chat.Conversations').where({ ID: message.conversation_ID, userId })
            );
            if (!conversation) {
                return res.status(403).json({ error: 'Access denied' });
            }

            let contentData = null;
            try {
                const hana = db.dbc;

                if (hana && hana.exec) {
                    const result = await new Promise((resolve, reject) => {
                        hana.exec(
                            `SELECT "CONTENT" FROM "AI_CHAT_MESSAGEATTACHMENTS" WHERE "ID" = ?`,
                            [attachmentId],
                            (err, rows) => {
                                if (err) reject(err);
                                else resolve(rows);
                            }
                        );
                    });

                    if (result && result.length > 0 && result[0].CONTENT) {
                        const content = result[0].CONTENT;
                        if (Buffer.isBuffer(content)) {
                            contentData = `data:${attachment.mimeType};base64,${content.toString('base64')}`;
                        }
                    }
                } else {
                    const tx = db.tx();
                    try {
                        const fullAttachment = await tx.run(
                            SELECT.one.from('ai.chat.MessageAttachments')
                                .columns('content')
                                .where({ ID: attachmentId })
                        );

                        if (fullAttachment && fullAttachment.content) {
                            const content = fullAttachment.content;

                            if (Buffer.isBuffer(content)) {
                                contentData = `data:${attachment.mimeType};base64,${content.toString('base64')}`;
                            } else if (typeof content === 'string') {
                                contentData = content.startsWith('data:')
                                    ? content
                                    : `data:${attachment.mimeType};base64,${Buffer.from(content).toString('base64')}`;
                            } else if (content.pipe || content[Symbol.asyncIterator] || content.read) {
                                const chunks = [];
                                for await (const chunk of content) {
                                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                                }
                                const buffer = Buffer.concat(chunks);
                                contentData = `data:${attachment.mimeType};base64,${buffer.toString('base64')}`;
                            }
                        }
                        await tx.commit();
                    } catch (txErr) {
                        await tx.rollback();
                        throw txErr;
                    }
                }
            } catch (e) {
                console.error('Failed to retrieve attachment content:', e.message);
            }

            res.json({
                ID: attachment.ID,
                name: attachment.filename,
                type: attachment.mimeType,
                data: contentData
            });

        } catch (error) {
            console.error('Error fetching attachment:', error);
            res.status(500).json({ error: 'Failed to fetch attachment' });
        }
    });

    // ============ Memory Management Endpoints ============

    app.get('/api/memories', authMiddleware, async (req, res) => {
        try {
            const memories = await memoryService.getAllMemories(req.user.id);
            res.json({ memories });
        } catch (error) {
            console.error('Error getting memories:', error);
            res.status(500).json({ error: 'Failed to get memories' });
        }
    });

    app.delete('/api/memories/:id', authMiddleware, async (req, res) => {
        try {
            const success = await memoryService.deleteMemory(req.params.id, req.user.id);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Memory not found or access denied' });
            }
        } catch (error) {
            console.error('Error deleting memory:', error);
            res.status(500).json({ error: 'Failed to delete memory' });
        }
    });

    app.delete('/api/memories', authMiddleware, async (req, res) => {
        try {
            const success = await memoryService.clearAllMemories(req.user.id);
            res.json({ success });
        } catch (error) {
            console.error('Error clearing memories:', error);
            res.status(500).json({ error: 'Failed to clear memories' });
        }
    });

    // --- Model info ---
    app.get('/api/model', async (req, res) => {
        try {
            const client = getAiCoreClient();
            let modelName = process.env.AICORE_MODEL_NAME || 'Unknown Model';

            try {
                const deploymentInfo = await client.getDeploymentInfo();
                if (deploymentInfo && deploymentInfo.configurationName) {
                    modelName = deploymentInfo.configurationName;
                }
            } catch {
                console.log('Could not fetch deployment info, using default model name');
            }

            res.json({
                model: modelName,
                type: client.modelType,
                deploymentId: client.deploymentId
            });
        } catch (error) {
            console.error('Failed to get model info:', error);
            res.status(500).json({ error: 'Failed to get model info' });
        }
    });

    // ============ WebSocket Setup ============

    if (WebSocket) {
        setTimeout(() => {
            try {
                if (cds.app && cds.app.server) {
                    setupWebSocket(cds.app.server);
                }
            } catch (e) {
                console.error('Failed to set up WebSocket server:', e.message);
            }
        }, 1000);
    }
});

/**
 * Set up WebSocket server for streaming chat
 */
function setupWebSocket(httpServer) {
    if (!WebSocket) return;

    const wss = new WebSocket.Server({
        server: httpServer,
        path: '/ws/chat'
    });

    wss.on('connection', async (ws, req) => {
        // Try to get user info from headers (no query string tokens for security)
        let user = null;

        // 1. Try Authorization header (set by approuter)
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            user = decodeUserFromToken(authHeader.substring(7));
        }

        // 2. Try x-approuter-authorization header
        if (!user) {
            const approuterAuth = req.headers['x-approuter-authorization'];
            if (approuterAuth && approuterAuth.startsWith('Bearer ')) {
                user = decodeUserFromToken(approuterAuth.substring(7));
            }
        }

        // 3. Try x-forwarded-user header (sometimes set by proxies)
        if (!user) {
            const forwardedUser = req.headers['x-forwarded-user'] || req.headers['x-user-id'];
            if (forwardedUser) {
                user = { id: forwardedUser, email: null, name: forwardedUser };
            }
        }

        if (!user) {
            ws.send(JSON.stringify({ type: 'error', message: 'No authentication token provided' }));
            ws.close(1008, 'Unauthorized');
            return;
        }

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());

                if (data.type === 'chat') {
                    await handleChatMessage(ws, user, data);
                } else if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                }
            } catch (e) {
                console.error('WebSocket message error:', e);
                ws.send(JSON.stringify({ type: 'error', message: e.message }));
            }
        });

        ws.on('close', () => {});
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });

        ws.send(JSON.stringify({ type: 'connected', userId: user.id }));
    });
}

/**
 * Handle chat message via WebSocket (uses shared helpers)
 */
async function handleChatMessage(ws, user, data) {
    const { conversationId, content, attachments } = data;

    if (!conversationId || (!content && (!attachments || attachments.length === 0))) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing conversationId or content' }));
        return;
    }

    const db = await cds.connect.to('db');

    const conversation = await db.run(
        SELECT.one.from('ai.chat.Conversations').where({ ID: conversationId, userId: user.id })
    );
    if (!conversation) {
        ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found or access denied' }));
        return;
    }

    // Save user message
    const userMessage = {
        ID: uuidv4(),
        conversation_ID: conversationId,
        role: 'user',
        content: content,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString()
    };
    await db.run(INSERT.into('ai.chat.Messages').entries(userMessage));

    if (attachments && attachments.length > 0) {
        await saveAttachments(db, attachments, userMessage.ID);
    }

    ws.send(JSON.stringify({ type: 'user_message', id: userMessage.ID }));

    const aiMessages = await buildAiMessages(db, user.id, conversationId, content, attachments);

    const assistantMessageId = uuidv4();
    ws.send(JSON.stringify({ type: 'assistant_start', id: assistantMessageId }));

    const client = getAiCoreClient();
    let fullContent = '';
    const isAnthropic = client.modelType === 'anthropic';

    try {
        const stream = await client.chatStream(aiMessages);
        let buffer = '';

        stream.on('data', (chunk) => {
            buffer += chunk.toString();
            const { deltas, remaining } = parseStreamChunk(buffer, isAnthropic);
            buffer = remaining;

            for (const delta of deltas) {
                fullContent += delta;
                ws.send(JSON.stringify({ type: 'content', content: delta }));
            }
        });

        stream.on('end', async () => {
            await processStreamEnd(db, {
                assistantMessageId, conversationId, conversation,
                content, attachments, fullContent, userId: user.id
            });
            ws.send(JSON.stringify({ type: 'done', id: assistantMessageId }));
        });

        stream.on('error', (error) => {
            console.error('Stream error:', error);
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
        });

    } catch (error) {
        console.error('AI Core error:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to get AI response' }));
    }
}

module.exports = cds.server;
