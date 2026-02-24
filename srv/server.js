const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const xsenv = require('@sap/xsenv');
const xssec = require('@sap/xssec');
const { memoryService } = require('./memory-service');
const { getSharedAiCoreClient, truncateMessageContent } = require('./ai-core-client');

// Try to load WebSocket, but don't fail if not available
let WebSocket;
try {
    WebSocket = require('ws');
} catch (e) {
    // WebSocket module not available
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

const MAX_ATTACHMENTS = Number(process.env.MAX_ATTACHMENTS || 5);
const MAX_ATTACHMENT_SIZE_BYTES = Number(process.env.MAX_ATTACHMENT_SIZE_BYTES || 5 * 1024 * 1024);
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = Number(process.env.MAX_TOTAL_ATTACHMENT_SIZE_BYTES || 20 * 1024 * 1024);
const MAX_CONTENT_LENGTH = Number(process.env.MAX_CONTENT_LENGTH || 32 * 1024); // 32KB default

// ============ CORS Configuration ============
const CORS_ALLOWED_ORIGINS = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

// Auto-configure CORS from VCAP_APPLICATION (Cloud Foundry)
if (process.env.VCAP_APPLICATION) {
    try {
        const vcapApp = JSON.parse(process.env.VCAP_APPLICATION);
        if (vcapApp.uris && Array.isArray(vcapApp.uris)) {
            vcapApp.uris.forEach(uri => {
                CORS_ALLOWED_ORIGINS.add(`https://${uri}`);
            });
            console.log('Auto-configured CORS origins from VCAP_APPLICATION:', vcapApp.uris.map(u => `https://${u}`).join(', '));
        }
    } catch (e) {
        console.warn('Failed to parse VCAP_APPLICATION for CORS:', e.message);
    }
}

// ============ Rate Limiting ============
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000); // 1 minute
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30); // 30 requests per minute
const rateLimitStore = new Map();

/**
 * Check if a user has exceeded the rate limit.
 * @param {string} userId - The user ID
 * @returns {boolean} True if rate limit exceeded
 */
function isRateLimited(userId) {
    const now = Date.now();
    const userRequests = rateLimitStore.get(userId) || [];
    
    // Filter to only requests within the window
    const recentRequests = userRequests.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    
    if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
        return true;
    }
    
    // Add current request and update store
    recentRequests.push(now);
    rateLimitStore.set(userId, recentRequests);
    
    return false;
}

// Clean up old rate limit entries periodically.
// unref() prevents this interval from keeping the Node.js process alive on shutdown.
setInterval(() => {
    const now = Date.now();
    for (const [userId, requests] of rateLimitStore.entries()) {
        const recent = requests.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
        if (recent.length === 0) {
            rateLimitStore.delete(userId);
        } else {
            rateLimitStore.set(userId, recent);
        }
    }
}, RATE_LIMIT_WINDOW_MS).unref();

// ============ Error Sanitization ============
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Sanitize error message for client response.
 * In production, hide internal details.
 * @param {Error|string} error - The error
 * @param {string} fallbackMessage - Message to show in production
 * @returns {string} Sanitized error message
 */
function sanitizeErrorMessage(error, fallbackMessage = 'An error occurred') {
    if (!IS_PRODUCTION) {
        return error instanceof Error ? error.message : String(error);
    }
    // In production, only show generic messages
    return fallbackMessage;
}

// ============ Auth Helpers ============

let _xsuaaService;
function getXsuaaService() {
    if (_xsuaaService !== undefined) {
        return _xsuaaService;
    }

    try {
        const services = xsenv.getServices({ xsuaa: { tag: 'xsuaa' } });
        _xsuaaService = new xssec.XsuaaService(services.xsuaa);
    } catch (error) {
        _xsuaaService = null;
        console.warn('XSUAA service credentials not available. JWT validation fallback is only allowed in non-production.');
    }

    return _xsuaaService;
}

/**
 * Decode a JWT token payload without signature validation.
 * This must only be used as non-production fallback.
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

function extractBase64Data(data) {
    if (typeof data !== 'string') return '';
    if (data.startsWith('data:')) {
        // Use regex to correctly handle data URLs (data.split(',')[1] breaks on embedded commas)
        const match = data.match(/^data:[^;]+;base64,(.+)$/s);
        return match ? match[1] : '';
    }
    return data;
}

function estimateBytesFromBase64(base64Data) {
    if (!base64Data) return 0;
    const padding = base64Data.endsWith('==') ? 2 : (base64Data.endsWith('=') ? 1 : 0);
    return Math.floor((base64Data.length * 3) / 4) - padding;
}

function validateAndNormalizeAttachments(attachments) {
    if (!attachments) return [];
    if (!Array.isArray(attachments)) {
        throw new Error('Attachments must be an array');
    }
    if (attachments.length > MAX_ATTACHMENTS) {
        throw new Error(`Too many attachments (max ${MAX_ATTACHMENTS})`);
    }

    let totalBytes = 0;
    const normalized = [];

    for (const att of attachments) {
        if (!att || typeof att !== 'object') {
            throw new Error('Invalid attachment format');
        }

        const base64Data = extractBase64Data(att.data);
        if (!base64Data) {
            throw new Error('Attachment data is missing');
        }

        const bytes = estimateBytesFromBase64(base64Data);
        if (bytes <= 0) {
            throw new Error('Attachment data is invalid');
        }
        if (bytes > MAX_ATTACHMENT_SIZE_BYTES) {
            throw new Error(`Attachment exceeds max size (${Math.round(MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024)}MB)`);
        }

        totalBytes += bytes;
        if (totalBytes > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
            throw new Error(`Total attachment size exceeds ${Math.round(MAX_TOTAL_ATTACHMENT_SIZE_BYTES / 1024 / 1024)}MB`);
        }

        normalized.push({
            name: typeof att.name === 'string' && att.name.trim() ? att.name.trim().slice(0, 255) : 'attachment',
            type: typeof att.type === 'string' && att.type.trim() ? att.type.trim().slice(0, 100) : 'application/octet-stream',
            data: base64Data
        });
    }

    return normalized;
}

function userFromPayload(payload) {
    const id = payload.user_name || payload.email || payload.sub;
    if (!id) return null;

    return {
        id,
        email: payload.email,
        name: payload.given_name || payload.user_name,
        given_name: payload.given_name,
        family_name: payload.family_name
    };
}

async function getUserFromRequest(req) {
    const xsuaaService = getXsuaaService();
    if (xsuaaService) {
        const authHeader = req.headers?.authorization || req.headers?.['x-approuter-authorization'];
        const reqForValidation = authHeader
            ? { ...req, headers: { ...req.headers, authorization: authHeader } }
            : req;
        const securityContext = await xssec.createSecurityContext(xsuaaService, { req: reqForValidation });
        return userFromPayload(securityContext.token?.payload || {});
    }

    const fallbackAllowed = process.env.NODE_ENV === 'development';
    if (!fallbackAllowed) {
        return null;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return decodeUserFromToken(authHeader.substring(7));
}

/**
 * Express middleware that extracts the user from the Authorization header.
 * Sets req.user on success; returns 401 on failure.
 */
async function authMiddleware(req, res, next) {
    try {
        const user = await getUserFromRequest(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = user;
        next();
    } catch (error) {
        if (xssec.errors?.ValidationError && error instanceof xssec.errors.ValidationError) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        console.error('Authentication error:', error);
        return res.status(500).json({ error: 'Authentication failed' });
    }
}

// ============ Shared Chat Logic ============

/**
 * Save attachments for a message.
 */
async function saveAttachments(db, attachments, messageId) {
    for (const att of attachments) {
        const attachmentId = uuidv4();
        const contentBuffer = att.data ? Buffer.from(att.data, 'base64') : null;

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
 * Truncates large messages to prevent token limit errors.
 */
async function buildAiMessages(db, userId, conversationId, content, attachments) {
    const messages = await db.run(
        SELECT.from('ai.chat.Messages')
            .where({ conversation_ID: conversationId })
            .orderBy('createdAt asc')
            .limit(20)
    );

    // Truncate large messages in conversation history to prevent token overflow
    const aiMessages = messages.map(msg => ({
        role: msg.role,
        content: truncateMessageContent(msg.content, msg.role)
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
    const events = [];
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
                    } else if (json.type === 'web_search_start') {
                        events.push(json);
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

    return { deltas, events, remaining };
}

function closeAiStream(stream) {
    if (!stream) return;
    if (typeof stream.destroy === 'function') {
        stream.destroy();
        return;
    }
    if (typeof stream.abort === 'function') {
        stream.abort();
        return;
    }
    if (typeof stream.close === 'function') {
        stream.close();
    }
}

function sendWs(ws, payload) {
    if (!WebSocket || !ws || ws.readyState !== WebSocket.OPEN) {
        return false;
    }
    try {
        ws.send(JSON.stringify(payload));
        return true;
    } catch (error) {
        console.error('WebSocket send error:', error);
        return false;
    }
}

function sendSse(res, payload) {
    if (!res || res.writableEnded || res.destroyed) {
        return false;
    }
    try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        return true;
    } catch (error) {
        console.error('SSE send error:', error);
        return false;
    }
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
    }).catch(err => console.error('Unhandled memory processing error:', err));
}

// ============ Server Bootstrap ============

cds.on('bootstrap', (app) => {
    const express = require('express');
    app.use(express.json({ limit: '50mb' }));

    // CORS: allow all in development; enforce allowlist in production.
    app.use((req, res, next) => {
        const origin = req.headers.origin || '';
        const isProd = process.env.NODE_ENV === 'production';

        if (!isProd) {
            res.header('Access-Control-Allow-Origin', '*');
        } else if (origin) {
            if (!CORS_ALLOWED_ORIGINS.has(origin)) {
                if (req.method === 'OPTIONS') {
                    return res.sendStatus(403);
                }
                return res.status(403).json({ error: 'Origin not allowed' });
            }
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Vary', 'Origin');
        }

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

            // Rate limiting check
            if (isRateLimited(userId)) {
                return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
            }

            let normalizedAttachments = [];

            try {
                normalizedAttachments = validateAndNormalizeAttachments(attachments);
            } catch (validationError) {
                return res.status(400).json({ error: validationError.message });
            }

            if (!conversationId || (!content && normalizedAttachments.length === 0)) {
                return res.status(400).json({ error: 'Missing conversationId or content' });
            }
            if (!isValidUUID(conversationId)) {
                return res.status(400).json({ error: 'Invalid conversationId format' });
            }
            if (content && content.length > MAX_CONTENT_LENGTH) {
                return res.status(400).json({ error: `Message too long (max ${MAX_CONTENT_LENGTH} characters)` });
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

            if (normalizedAttachments.length > 0) {
                await saveAttachments(db, normalizedAttachments, userMessage.ID);
            }

            const aiMessages = await buildAiMessages(db, userId, conversationId, content, normalizedAttachments);

            // Set up SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            if (!sendSse(res, { type: 'user_message', id: userMessage.ID })) {
                if (!res.writableEnded) {
                    res.end();
                }
                return;
            }

            const assistantMessageId = uuidv4();
            if (!sendSse(res, { type: 'assistant_start', id: assistantMessageId })) {
                if (!res.writableEnded) {
                    res.end();
                }
                return;
            }

            const client = getSharedAiCoreClient();
            let fullContent = '';
            const isAnthropic = client.modelType === 'anthropic';
            let stream;
            let isClosed = false;
            let detachCloseListeners = () => {};

            try {
                stream = await client.chatStream(aiMessages);
                let buffer = '';
                const cancelUpstream = () => {
                    if (isClosed) return;
                    isClosed = true;
                    detachCloseListeners();
                    closeAiStream(stream);
                };
                const onReqAborted = () => cancelUpstream();
                const onResClose = () => cancelUpstream();
                detachCloseListeners = () => {
                    req.off('aborted', onReqAborted);
                    res.off('close', onResClose);
                };
                req.on('aborted', onReqAborted);
                res.on('close', onResClose);

                stream.on('data', (chunk) => {
                    if (isClosed) return;
                    buffer += chunk.toString();
                    const { deltas, events, remaining } = parseStreamChunk(buffer, isAnthropic);
                    buffer = remaining;

                    for (const event of events) {
                        sendSse(res, event);
                    }

                    for (const delta of deltas) {
                        fullContent += delta;
                        if (!sendSse(res, { type: 'content', content: delta })) {
                            cancelUpstream();
                            return;
                        }
                    }
                });

                stream.on('end', async () => {
                    if (isClosed) return;
                    detachCloseListeners();
                    try {
                        await processStreamEnd(db, {
                            assistantMessageId, conversationId, conversation,
                            content, attachments: normalizedAttachments, fullContent, userId
                        });
                    } catch (endError) {
                        console.error('Error in stream end processing:', endError);
                    }
                    sendSse(res, { type: 'done', id: assistantMessageId });
                    if (!res.writableEnded) {
                        res.end();
                    }
                });

                stream.on('error', (error) => {
                    if (isClosed) return;
                    detachCloseListeners();
                    console.error('Stream error:', error);
                    sendSse(res, { type: 'error', message: sanitizeErrorMessage(error, 'Stream error occurred') });
                    if (!res.writableEnded) {
                        res.end();
                    }
                });

            } catch (error) {
                detachCloseListeners();
                console.error('AI Core error:', error);
                sendSse(res, { type: 'error', message: sanitizeErrorMessage(error, 'Failed to get AI response') });
                if (!res.writableEnded) {
                    res.end();
                }
            }

        } catch (error) {
            console.error('Streaming endpoint error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: sanitizeErrorMessage(error, 'Internal server error') });
            } else {
                sendSse(res, { type: 'error', message: sanitizeErrorMessage(error, 'An error occurred') });
                if (!res.writableEnded) {
                    res.end();
                }
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
            if (!isValidUUID(conversationId)) {
                return res.status(400).json({ error: 'Invalid conversation ID format' });
            }
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

            const messageIds = messages.map(m => m.ID);
            if (messageIds.length > 0) {
                await db.run(DELETE.from('ai.chat.MessageAttachments').where({ message_ID: { in: messageIds } }));
            }

            await db.run(DELETE.from('ai.chat.Messages').where({ conversation_ID: conversationId }));
            await db.run(DELETE.from('ai.chat.Conversations').where({ ID: conversationId }));

            res.json({ success: true });
        } catch (error) {
            console.error('Error deleting conversation:', error);
            res.status(500).json({ error: 'Failed to delete conversation' });
        }
    });

    // --- Rename conversation ---
    app.patch('/api/conversation/:id', authMiddleware, async (req, res) => {
        try {
            const conversationId = req.params.id;
            if (!isValidUUID(conversationId)) {
                return res.status(400).json({ error: 'Invalid conversation ID format' });
            }
            const { title } = req.body;
            if (!title || typeof title !== 'string' || title.trim().length === 0) {
                return res.status(400).json({ error: 'Title is required' });
            }
            const db = await cds.connect.to('db');

            const conversation = await db.run(
                SELECT.one.from('ai.chat.Conversations').where({ ID: conversationId, userId: req.user.id })
            );
            if (!conversation) {
                return res.status(404).json({ error: 'Conversation not found or access denied' });
            }

            await db.run(
                UPDATE('ai.chat.Conversations').set({ title: title.trim().substring(0, 255) }).where({ ID: conversationId })
            );

            res.json({ success: true });
        } catch (error) {
            console.error('Error renaming conversation:', error);
            res.status(500).json({ error: 'Failed to rename conversation' });
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
            if (!isValidUUID(attachmentId)) {
                return res.status(400).json({ error: 'Invalid attachment ID format' });
            }
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
            if (!isValidUUID(req.params.id)) {
                return res.status(400).json({ error: 'Invalid memory ID format' });
            }
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
    app.get('/api/model', authMiddleware, async (req, res) => {
        try {
            const client = getSharedAiCoreClient();
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

});

// ============ WebSocket Setup ============
// Must be registered at the top level using cds.on('listening', ...) so the
// HTTP server instance is available. cds.app.server is NOT set during 'served'.
cds.on('listening', ({ server }) => {
    if (!WebSocket) return;
    try {
        setupWebSocket(server);
    } catch (e) {
        console.error('Failed to set up WebSocket server:', e.message);
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
        const origin = req.headers?.origin || '';
        const isProd = process.env.NODE_ENV === 'production';
        if (isProd) {
            if (!origin || !CORS_ALLOWED_ORIGINS.has(origin)) {
                sendWs(ws, { type: 'error', message: 'Origin not allowed' });
                ws.close(1008, 'Origin not allowed');
                return;
            }
        }

        let user = null;
        try {
            user = await getUserFromRequest(req);
        } catch (error) {
            if (!xssec.errors?.ValidationError || !(error instanceof xssec.errors.ValidationError)) {
                console.error('WebSocket authentication error:', error);
            }
        }

        if (!user) {
            sendWs(ws, { type: 'error', message: 'No authentication token provided' });
            ws.close(1008, 'Unauthorized');
            return;
        }

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());

                if (data.type === 'chat') {
                    await handleChatMessage(ws, user, data);
                } else if (data.type === 'ping') {
                    sendWs(ws, { type: 'pong' });
                }
            } catch (e) {
                console.error('WebSocket message error:', e);
                sendWs(ws, { type: 'error', message: e.message });
            }
        });

        ws.on('close', () => {});
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });

        sendWs(ws, { type: 'connected', userId: user.id });
    });
}

/**
 * Handle chat message via WebSocket (uses shared helpers)
 */
async function handleChatMessage(ws, user, data) {
    const { conversationId, content, attachments } = data;

    // Rate limiting check
    if (isRateLimited(user.id)) {
        sendWs(ws, { type: 'error', message: 'Too many requests. Please wait a moment.' });
        return;
    }

    let normalizedAttachments = [];

    try {
        normalizedAttachments = validateAndNormalizeAttachments(attachments);
    } catch (validationError) {
        sendWs(ws, { type: 'error', message: validationError.message });
        return;
    }

    if (!conversationId || (!content && normalizedAttachments.length === 0)) {
        sendWs(ws, { type: 'error', message: 'Missing conversationId or content' });
        return;
    }
    if (!isValidUUID(conversationId)) {
        sendWs(ws, { type: 'error', message: 'Invalid conversationId format' });
        return;
    }

    const db = await cds.connect.to('db');

    const conversation = await db.run(
        SELECT.one.from('ai.chat.Conversations').where({ ID: conversationId, userId: user.id })
    );
    if (!conversation) {
        sendWs(ws, { type: 'error', message: 'Conversation not found or access denied' });
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

    if (normalizedAttachments.length > 0) {
        await saveAttachments(db, normalizedAttachments, userMessage.ID);
    }

    if (!sendWs(ws, { type: 'user_message', id: userMessage.ID })) {
        return;
    }

    const aiMessages = await buildAiMessages(db, user.id, conversationId, content, normalizedAttachments);

    const assistantMessageId = uuidv4();
    if (!sendWs(ws, { type: 'assistant_start', id: assistantMessageId })) {
        return;
    }

    const client = getSharedAiCoreClient();
    let fullContent = '';
    const isAnthropic = client.modelType === 'anthropic';
    let stream;
    let isClosed = false;
    let detachWsLifecycleListeners = () => {};

    try {
        stream = await client.chatStream(aiMessages);
        let buffer = '';
        const cancelUpstream = () => {
            if (isClosed) return;
            isClosed = true;
            detachWsLifecycleListeners();
            closeAiStream(stream);
        };
        const onWsClose = () => cancelUpstream();
        const onWsError = () => cancelUpstream();
        detachWsLifecycleListeners = () => {
            ws.off('close', onWsClose);
            ws.off('error', onWsError);
        };

        ws.on('close', onWsClose);
        ws.on('error', onWsError);

        stream.on('data', (chunk) => {
            if (isClosed) return;
            buffer += chunk.toString();
            const { deltas, events, remaining } = parseStreamChunk(buffer, isAnthropic);
            buffer = remaining;

            for (const event of events) {
                sendWs(ws, event);
            }

            for (const delta of deltas) {
                fullContent += delta;
                if (!sendWs(ws, { type: 'content', content: delta })) {
                    cancelUpstream();
                    return;
                }
            }
        });

        stream.on('end', async () => {
            if (isClosed) return;
            detachWsLifecycleListeners();
            try {
                await processStreamEnd(db, {
                    assistantMessageId, conversationId, conversation,
                    content, attachments: normalizedAttachments, fullContent, userId: user.id
                });
            } catch (endError) {
                console.error('Error in stream end processing:', endError);
            }
            sendWs(ws, { type: 'done', id: assistantMessageId });
        });

        stream.on('error', (error) => {
            if (isClosed) return;
            detachWsLifecycleListeners();
            console.error('Stream error:', error);
            sendWs(ws, { type: 'error', message: sanitizeErrorMessage(error, 'Stream error occurred') });
        });

    } catch (error) {
        detachWsLifecycleListeners();
        console.error('AI Core error:', error);
        sendWs(ws, { type: 'error', message: sanitizeErrorMessage(error, 'Failed to get AI response') });
    }
}

module.exports = cds.server;
