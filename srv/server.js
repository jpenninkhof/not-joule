const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const { memoryService } = require('./memory-service');

// Try to load WebSocket, but don't fail if not available
let WebSocket;
try {
    WebSocket = require('ws');
} catch (e) {
    // WebSocket module not available
}

/**
 * Custom server configuration
 * Adds streaming endpoint for chat completions with WebSocket support
 */
cds.on('bootstrap', (app) => {
    // Add JSON body parser for custom endpoints with increased limit for file attachments
    const express = require('express');
    app.use(express.json({ limit: '50mb' }));
    
    // Add CORS headers for development
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    });
});

// Register custom endpoints after CDS is served (authentication middleware is active)
cds.on('served', async () => {
    const app = cds.app;
    
    // Streaming chat endpoint - using manual JWT decoding
    app.post('/api/chat/stream', async (req, res) => {
        try {
            // Use CDS to handle authentication
            // Create a mock CDS request to leverage CDS auth
            let user = null;
            
            try {
                // Get the authorization header
                const authHeader = req.headers.authorization;
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    console.log('No Bearer token found in Authorization header');
                    return res.status(401).json({ error: 'Unauthorized - No Bearer token provided' });
                }
                
                const token = authHeader.substring(7);
                if (!token || token.trim() === '') {
                    console.log('Empty token');
                    return res.status(401).json({ error: 'Unauthorized - Empty token' });
                }
                
                // Decode the JWT to get user info (without full validation - approuter already validated)
                // The approuter validates the token, so we just need to extract the user info
                const parts = token.split('.');
                if (parts.length !== 3) {
                    console.log('Invalid JWT format');
                    return res.status(401).json({ error: 'Unauthorized - Invalid token format' });
                }
                
                try {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                    user = {
                        id: payload.user_name || payload.email || payload.sub,
                        email: payload.email,
                        name: payload.given_name || payload.user_name
                    };
                    console.log('Decoded user from JWT:', user.id);
                } catch (decodeError) {
                    console.error('Failed to decode JWT payload:', decodeError.message);
                    return res.status(401).json({ error: 'Unauthorized - Invalid token' });
                }
                
                if (!user || !user.id) {
                    console.log('No user ID in token');
                    return res.status(401).json({ error: 'Unauthorized - No user ID in token' });
                }
                
            } catch (authError) {
                console.error('Auth error:', authError.message);
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            const { conversationId, content, attachments } = req.body;
            
            if (!conversationId || (!content && (!attachments || attachments.length === 0))) {
                return res.status(400).json({ error: 'Missing conversationId or content' });
            }
            
            const userId = user.id;
            const db = await cds.connect.to('db');
            
            // Verify conversation ownership
            const conversation = await db.run(
                SELECT.one.from('ai.chat.Conversations').where({ ID: conversationId, userId: userId })
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
            
            // Save attachments if any - using @cap-js/attachments plugin
            // The plugin stores content in Object Store (S3/Azure/GCP) automatically
            if (attachments && attachments.length > 0) {
                for (const att of attachments) {
                    let base64Data = att.data;
                    if (base64Data && base64Data.includes(',')) {
                        base64Data = base64Data.split(',')[1];
                    }
                    
                    const attachmentId = uuidv4();
                    const contentBuffer = base64Data ? Buffer.from(base64Data, 'base64') : null;
                    
                    // Insert attachment with content - the @cap-js/attachments plugin
                    // will automatically store the content in Object Store
                    await db.run(INSERT.into('ai.chat.MessageAttachments').entries({
                        ID: attachmentId,
                        message_ID: userMessage.ID,
                        filename: att.name || 'attachment',
                        mimeType: att.type || 'application/octet-stream',
                        content: contentBuffer,
                        status: 'Clean',
                        createdAt: new Date().toISOString(),
                        modifiedAt: new Date().toISOString()
                    }));
                    
                    console.log('Stored attachment via attachments plugin:', attachmentId);
                }
            }
            
            // Get conversation history (without attachment data to save memory)
            const messages = await db.run(
                SELECT.from('ai.chat.Messages')
                    .where({ conversation_ID: conversationId })
                    .orderBy('createdAt asc')
                    .limit(20)
            );
            
            // Build messages array for AI
            // Only include attachments from the current message (which we already have in memory)
            const aiMessages = messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
            
            // Add current message's attachments to the last user message in aiMessages
            if (attachments && attachments.length > 0) {
                const lastUserMsg = aiMessages[aiMessages.length - 1];
                if (lastUserMsg && lastUserMsg.role === 'user') {
                    lastUserMsg.attachments = attachments;
                }
            }
            
            // Retrieve relevant memories for this user and inject into system prompt
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
            
            // Add system message with memories if we have any
            if (systemPromptAddition) {
                // Prepend system message with memory context
                aiMessages.unshift({
                    role: 'system',
                    content: `You are a helpful AI Assistant.${systemPromptAddition}`
                });
            }
            
            // Set up SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();
            
            // Send user message ID first
            res.write(`data: ${JSON.stringify({ type: 'user_message', id: userMessage.ID })}\n\n`);
            
            // Create assistant message placeholder
            const assistantMessageId = uuidv4();
            res.write(`data: ${JSON.stringify({ type: 'assistant_start', id: assistantMessageId })}\n\n`);
            
            // Get streaming response from AI Core
            const { AiCoreClient } = require('./ai-core-client');
            const client = new AiCoreClient();
            
            let fullContent = '';
            const isAnthropic = client.modelType === 'anthropic';
            
            try {
                const stream = await client.chatStream(aiMessages);
                
                let buffer = '';
                
                stream.on('data', (chunk) => {
                    buffer += chunk.toString();
                    
                    // Process complete SSE events
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6).trim();
                            
                            if (data === '[DONE]' || data === '') {
                                continue;
                            }
                            
                            try {
                                const json = JSON.parse(data);
                                let delta = null;
                                
                                if (isAnthropic) {
                                    // Anthropic streaming format
                                    // Events: message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop
                                    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                                        delta = json.delta.text;
                                    }
                                } else {
                                    // OpenAI streaming format
                                    delta = json.choices?.[0]?.delta?.content;
                                }
                                
                                if (delta) {
                                    fullContent += delta;
                                    res.write(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`);
                                }
                            } catch (e) {
                                // Ignore parse errors for incomplete chunks
                            }
                        }
                    }
                });
                
                stream.on('end', async () => {
                    // Save assistant message
                    const assistantMessage = {
                        ID: assistantMessageId,
                        conversation_ID: conversationId,
                        role: 'assistant',
                        content: fullContent,
                        createdAt: new Date().toISOString(),
                        modifiedAt: new Date().toISOString()
                    };
                    
                    await db.run(INSERT.into('ai.chat.Messages').entries(assistantMessage));
                    
                    // Update conversation title if it's still the default
                    // Check if title needs updating (is default or empty)
                    const needsTitleUpdate = !conversation.title || 
                                            conversation.title === 'New Conversation' || 
                                            conversation.title === 'New Chat';
                    
                    if (needsTitleUpdate) {
                        // Determine the best title source
                        let titleSource = '';
                        
                        // Priority 1: User's text content
                        if (content && content.trim()) {
                            titleSource = content.trim();
                        }
                        // Priority 2: Attachment name(s)
                        else if (attachments && attachments.length > 0) {
                            const attachmentNames = attachments.map(a => a.name).filter(n => n);
                            if (attachmentNames.length > 0) {
                                titleSource = attachmentNames.length === 1 
                                    ? attachmentNames[0] 
                                    : `${attachmentNames[0]} (+${attachmentNames.length - 1} more)`;
                            }
                        }
                        // Priority 3: First part of AI response
                        if (!titleSource && fullContent) {
                            // Extract first meaningful sentence or phrase from AI response
                            const firstLine = fullContent.split('\n')[0].trim();
                            // Remove markdown headers
                            titleSource = firstLine.replace(/^#+\s*/, '').trim();
                        }
                        
                        if (titleSource) {
                            // Clean up the title
                            const title = titleSource.substring(0, 50) + (titleSource.length > 50 ? '...' : '');
                            await db.run(
                                UPDATE('ai.chat.Conversations').set({ title: title, modifiedAt: new Date().toISOString() }).where({ ID: conversationId })
                            );
                        }
                    }
                    
                    res.write(`data: ${JSON.stringify({ type: 'done', id: assistantMessageId })}\n\n`);
                    res.end();
                    
                    // Process memory extraction asynchronously (don't block the response)
                    setImmediate(async () => {
                        try {
                            // Get the last few messages for memory extraction
                            const recentMessages = [
                                { role: 'user', content: content },
                                { role: 'assistant', content: fullContent }
                            ];
                            await memoryService.processConversationTurn(userId, conversationId, recentMessages);
                        } catch (memError) {
                            console.error('Error processing memories:', memError);
                        }
                    });
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
    
    // Health check endpoint
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    // Create conversation endpoint - custom endpoint to bypass OData action issues
    app.post('/api/conversation', async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            const token = authHeader.substring(7);
            const parts = token.split('.');
            if (parts.length !== 3) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            let userId;
            try {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                userId = payload.user_name || payload.email || payload.sub;
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            const { title } = req.body;
            
            const conversation = {
                ID: uuidv4(),
                title: title || 'New Conversation',
                userId: userId,
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
    
    // Delete conversation endpoint - custom endpoint
    app.delete('/api/conversation/:id', async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            const token = authHeader.substring(7);
            const parts = token.split('.');
            if (parts.length !== 3) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            let userId;
            try {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                userId = payload.user_name || payload.email || payload.sub;
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            const conversationId = req.params.id;
            const db = await cds.connect.to('db');
            
            // Verify ownership
            const conversation = await db.run(
                SELECT.one.from('ai.chat.Conversations').where({ ID: conversationId, userId: userId })
            );
            
            if (!conversation) {
                return res.status(404).json({ error: 'Conversation not found or access denied' });
            }
            
            // Get all message IDs for this conversation
            const messages = await db.run(
                SELECT.from('ai.chat.Messages').where({ conversation_ID: conversationId }).columns('ID')
            );
            
            // Delete attachments for all messages
            // The @cap-js/attachments plugin will handle cleanup from Object Store
            for (const msg of messages) {
                await db.run(DELETE.from('ai.chat.MessageAttachments').where({ message_ID: msg.ID }));
            }
            
            // Delete messages
            await db.run(DELETE.from('ai.chat.Messages').where({ conversation_ID: conversationId }));
            // Delete conversation
            await db.run(DELETE.from('ai.chat.Conversations').where({ ID: conversationId }));
            
            res.json({ success: true });
        } catch (error) {
            console.error('Error deleting conversation:', error);
            res.status(500).json({ error: 'Failed to delete conversation' });
        }
    });
    
    // User info endpoint - returns current user info from JWT
    app.get('/api/userinfo', (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            const token = authHeader.substring(7);
            const parts = token.split('.');
            if (parts.length !== 3) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            try {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                res.json({
                    id: payload.user_name || payload.email || payload.sub,
                    email: payload.email,
                    name: payload.given_name ? `${payload.given_name} ${payload.family_name || ''}`.trim() : (payload.user_name || payload.email || 'User'),
                    given_name: payload.given_name,
                    family_name: payload.family_name
                });
            } catch (decodeError) {
                return res.status(401).json({ error: 'Invalid token' });
            }
        } catch (error) {
            console.error('Error getting user info:', error);
            res.status(500).json({ error: 'Failed to get user info' });
        }
    });
    
    // Get attachment data endpoint - fetches content from Object Store via @cap-js/attachments plugin
    app.get('/api/attachment/:id', async (req, res) => {
        try {
            // Get user from JWT
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            const token = authHeader.substring(7);
            const parts = token.split('.');
            if (parts.length !== 3) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            let userId;
            try {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                userId = payload.user_name || payload.email || payload.sub;
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            const attachmentId = req.params.id;
            const db = await cds.connect.to('db');
            
            // Get the attachment metadata
            const attachment = await db.run(
                SELECT.one.from('ai.chat.MessageAttachments')
                    .columns('ID', 'message_ID', 'filename', 'mimeType', 'status')
                    .where({ ID: attachmentId })
            );
            
            if (!attachment) {
                return res.status(404).json({ error: 'Attachment not found' });
            }
            
            // Verify the user owns the conversation this attachment belongs to
            const message = await db.run(
                SELECT.one.from('ai.chat.Messages').where({ ID: attachment.message_ID })
            );
            
            if (!message) {
                return res.status(404).json({ error: 'Message not found' });
            }
            
            const conversation = await db.run(
                SELECT.one.from('ai.chat.Conversations').where({ ID: message.conversation_ID, userId: userId })
            );
            
            if (!conversation) {
                return res.status(403).json({ error: 'Access denied' });
            }
            
            // Get the attachment content directly from the database
            // Use raw SQL to avoid LOB locator issues with streaming
            let contentData = null;
            
            try {
                console.log('Fetching attachment content for ID:', attachmentId);
                
                // Use cds.run with raw SQL to get the content as a single operation
                // This avoids the LOB locator invalidation issue
                const hana = db.dbc; // Get the underlying HANA connection
                
                if (hana && hana.exec) {
                    // Use HANA native query
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
                            console.log('Retrieved attachment via native HANA query:', attachmentId, 'size:', content.length);
                        }
                    }
                } else {
                    // Fallback: try CDS query with immediate stream consumption
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
                                console.log('Retrieved attachment from database as Buffer:', attachmentId, 'size:', content.length);
                            } else if (typeof content === 'string') {
                                contentData = content.startsWith('data:') 
                                    ? content 
                                    : `data:${attachment.mimeType};base64,${Buffer.from(content).toString('base64')}`;
                                console.log('Retrieved attachment as string from database:', attachmentId, 'length:', content.length);
                            } else if (content.pipe || content[Symbol.asyncIterator] || content.read) {
                                // It's a stream - collect it immediately within the transaction
                                console.log('Content is a stream, collecting chunks...');
                                const chunks = [];
                                for await (const chunk of content) {
                                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                                }
                                const buffer = Buffer.concat(chunks);
                                contentData = `data:${attachment.mimeType};base64,${buffer.toString('base64')}`;
                                console.log('Retrieved attachment as stream from database:', attachmentId, 'size:', buffer.length);
                            }
                        }
                        await tx.commit();
                    } catch (txErr) {
                        await tx.rollback();
                        throw txErr;
                    }
                }
                
                if (!contentData) {
                    console.log('No content found for attachment:', attachmentId);
                }
            } catch (e) {
                console.log('Failed to retrieve attachment content:', e.message);
                console.log('Error stack:', e.stack);
            }
            
            // Return the attachment data
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
    
    // Get all memories for the current user
    app.get('/api/memories', async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            const token = authHeader.substring(7);
            const parts = token.split('.');
            if (parts.length !== 3) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            let userId;
            try {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                userId = payload.user_name || payload.email || payload.sub;
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            const memories = await memoryService.getAllMemories(userId);
            res.json({ memories });
        } catch (error) {
            console.error('Error getting memories:', error);
            res.status(500).json({ error: 'Failed to get memories' });
        }
    });
    
    // Delete a specific memory
    app.delete('/api/memories/:id', async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            const token = authHeader.substring(7);
            const parts = token.split('.');
            if (parts.length !== 3) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            let userId;
            try {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                userId = payload.user_name || payload.email || payload.sub;
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            const memoryId = req.params.id;
            const success = await memoryService.deleteMemory(memoryId, userId);
            
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
    
    // Clear all memories for the current user
    app.delete('/api/memories', async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            const token = authHeader.substring(7);
            const parts = token.split('.');
            if (parts.length !== 3) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            let userId;
            try {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                userId = payload.user_name || payload.email || payload.sub;
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            
            const success = await memoryService.clearAllMemories(userId);
            res.json({ success });
        } catch (error) {
            console.error('Error clearing memories:', error);
            res.status(500).json({ error: 'Failed to clear memories' });
        }
    });
    
    // Model info endpoint - fetches deployment details from AI Core
    app.get('/api/model', async (req, res) => {
        try {
            const { AiCoreClient } = require('./ai-core-client');
            const client = new AiCoreClient();
            
            // Try to get the model name from AI Core deployment details
            let modelName = process.env.AICORE_MODEL_NAME || 'Unknown Model';
            
            try {
                const deploymentInfo = await client.getDeploymentInfo();
                if (deploymentInfo && deploymentInfo.configurationName) {
                    modelName = deploymentInfo.configurationName;
                }
            } catch (e) {
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
    
    // Set up WebSocket server for real-time streaming
    if (WebSocket) {
        // Use setTimeout to ensure the HTTP server is ready
        setTimeout(() => {
            try {
                const server = require('http').Server;
                // Get the server from the app
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
    if (!WebSocket) {
        return;
    }
    
    const wss = new WebSocket.Server({ 
        server: httpServer,
        path: '/ws/chat'
    });
    
    wss.on('connection', async (ws, req) => {
        
        // Try to get user info from various sources
        let user = null;
        
        // 1. Try Authorization header (set by approuter)
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            try {
                const parts = token.split('.');
                if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                    user = {
                        id: payload.user_name || payload.email || payload.sub,
                        email: payload.email,
                        name: payload.given_name || payload.user_name
                    };
                }
            } catch (e) {
                // Failed to decode JWT from header
            }
        }
        
        // 2. Try x-approuter-authorization header
        if (!user) {
            const approuterAuth = req.headers['x-approuter-authorization'];
            if (approuterAuth && approuterAuth.startsWith('Bearer ')) {
                const token = approuterAuth.substring(7);
                try {
                    const parts = token.split('.');
                    if (parts.length === 3) {
                        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                        user = {
                            id: payload.user_name || payload.email || payload.sub,
                            email: payload.email,
                            name: payload.given_name || payload.user_name
                        };
                    }
                } catch (e) {
                    // Failed to decode JWT from x-approuter-authorization
                }
            }
        }
        
        // 3. Try query string token
        if (!user) {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const token = url.searchParams.get('token');
            if (token) {
                try {
                    const parts = token.split('.');
                    if (parts.length === 3) {
                        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                        user = {
                            id: payload.user_name || payload.email || payload.sub,
                            email: payload.email,
                            name: payload.given_name || payload.user_name
                        };
                    }
                } catch (e) {
                    // Failed to decode JWT from query
                }
            }
        }
        
        // 4. Try x-forwarded-user header (sometimes set by proxies)
        if (!user) {
            const forwardedUser = req.headers['x-forwarded-user'] || req.headers['x-user-id'];
            if (forwardedUser) {
                user = {
                    id: forwardedUser,
                    email: null,
                    name: forwardedUser
                };
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
        
        ws.on('close', () => {
            // Connection closed
        });
        
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
        
        // Send connection confirmation
        ws.send(JSON.stringify({ type: 'connected', userId: user.id }));
    });
}

/**
 * Handle chat message via WebSocket
 */
async function handleChatMessage(ws, user, data) {
    const { conversationId, content, attachments } = data;
    
    if (!conversationId || (!content && (!attachments || attachments.length === 0))) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing conversationId or content' }));
        return;
    }
    
    const db = await cds.connect.to('db');
    
    // Verify conversation ownership
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
    
    // Save attachments if any - using @cap-js/attachments plugin
    // The plugin stores content in Object Store (S3/Azure/GCP) automatically
    if (attachments && attachments.length > 0) {
        for (const att of attachments) {
            let base64Data = att.data;
            if (base64Data && base64Data.includes(',')) {
                base64Data = base64Data.split(',')[1];
            }
            
            const attachmentId = uuidv4();
            const contentBuffer = base64Data ? Buffer.from(base64Data, 'base64') : null;
            
            // Insert attachment with content - the @cap-js/attachments plugin
            // will automatically store the content in Object Store
            await db.run(INSERT.into('ai.chat.MessageAttachments').entries({
                ID: attachmentId,
                message_ID: userMessage.ID,
                filename: att.name || 'attachment',
                mimeType: att.type || 'application/octet-stream',
                content: contentBuffer,
                status: 'Clean',
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            }));
            
            console.log('WS: Stored attachment via attachments plugin:', attachmentId);
        }
    }
    
    // Send user message confirmation
    ws.send(JSON.stringify({ type: 'user_message', id: userMessage.ID }));
    
    // Get conversation history (without attachment data to save memory)
    const messages = await db.run(
        SELECT.from('ai.chat.Messages')
            .where({ conversation_ID: conversationId })
            .orderBy('createdAt asc')
            .limit(20)
    );
    
    // Build messages array for AI
    // Only include attachments from the current message (which we already have in memory)
    const aiMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
    }));
    
    // Add current message's attachments to the last user message in aiMessages
    if (attachments && attachments.length > 0) {
        const lastUserMsg = aiMessages[aiMessages.length - 1];
        if (lastUserMsg && lastUserMsg.role === 'user') {
            lastUserMsg.attachments = attachments;
        }
    }
    
    // Retrieve relevant memories for this user and inject into system prompt
    let systemPromptAddition = '';
    try {
        const relevantMemories = await memoryService.retrieveRelevantMemories(user.id, content || '');
        systemPromptAddition = memoryService.formatMemoriesForPrompt(relevantMemories);
        if (systemPromptAddition) {
            console.log(`WS: Injecting ${relevantMemories.length} memories into system prompt for user ${user.id}`);
        }
    } catch (memError) {
        console.error('WS: Error retrieving memories:', memError);
    }
    
    // Add system message with memories if we have any
    if (systemPromptAddition) {
        // Prepend system message with memory context
        aiMessages.unshift({
            role: 'system',
            content: `You are a helpful AI Assistant.${systemPromptAddition}`
        });
    }
    
    // Create assistant message placeholder
    const assistantMessageId = uuidv4();
    ws.send(JSON.stringify({ type: 'assistant_start', id: assistantMessageId }));
    
    // Get streaming response from AI Core
    const { AiCoreClient } = require('./ai-core-client');
    const client = new AiCoreClient();
    
    let fullContent = '';
    const isAnthropic = client.modelType === 'anthropic';
    
    try {
        const stream = await client.chatStream(aiMessages);
        
        let buffer = '';
        
        stream.on('data', (chunk) => {
            buffer += chunk.toString();
            
            // Process complete SSE events
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    
                    if (data === '[DONE]' || data === '') {
                        continue;
                    }
                    
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
                        
                        if (delta) {
                            fullContent += delta;
                            // Send each token immediately via WebSocket
                            ws.send(JSON.stringify({ type: 'content', content: delta }));
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }
        });
        
        stream.on('end', async () => {
            // Save assistant message
            const assistantMessage = {
                ID: assistantMessageId,
                conversation_ID: conversationId,
                role: 'assistant',
                content: fullContent,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            };
            
            await db.run(INSERT.into('ai.chat.Messages').entries(assistantMessage));
            
            // Update conversation title if it's still the default
            const needsTitleUpdate = !conversation.title || 
                                    conversation.title === 'New Conversation' || 
                                    conversation.title === 'New Chat';
            
            if (needsTitleUpdate) {
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
                
                if (titleSource) {
                    const title = titleSource.substring(0, 50) + (titleSource.length > 50 ? '...' : '');
                    await db.run(
                        UPDATE('ai.chat.Conversations').set({ title: title, modifiedAt: new Date().toISOString() }).where({ ID: conversationId })
                    );
                }
            }
            
            ws.send(JSON.stringify({ type: 'done', id: assistantMessageId }));
            
            // Process memory extraction asynchronously (don't block the response)
            setImmediate(async () => {
                try {
                    console.log('WS: Extracting memories from conversation for user:', user.id);
                    const recentMessages = [
                        { role: 'user', content: content },
                        { role: 'assistant', content: fullContent }
                    ];
                    await memoryService.processConversationTurn(user.id, conversationId, recentMessages);
                } catch (memError) {
                    console.error('WS: Error processing memories:', memError);
                }
            });
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
