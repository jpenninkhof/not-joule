const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');

function extractReadKey(req, keyName = 'ID') {
    if (req.data && req.data[keyName]) {
        return req.data[keyName];
    }

    const where = req.query?.SELECT?.from?.ref?.[0]?.where;
    if (!Array.isArray(where)) {
        return null;
    }

    for (let i = 0; i < where.length - 2; i++) {
        const left = where[i];
        const op = where[i + 1];
        const right = where[i + 2];
        if (left?.ref?.[0] === keyName && op === '=' && right?.val !== undefined) {
            return right.val;
        }
    }

    return null;
}

/**
 * Chat Service Implementation
 * Handles chat operations and integrates with SAP AI Core
 */
module.exports = class ChatService extends cds.ApplicationService {
    
    async init() {
        // Filter conversations by current user - use on() handler to query db directly
        this.on('READ', 'Conversations', async (req) => {
            const userId = req.user.id;
            const db = await cds.connect.to('db');
            
            // Check if this is a single entity request (has keys)
            const keys = req.query.SELECT?.from?.ref?.[0]?.where;
            const isSingleEntity = keys && keys.length > 0;
            
            if (isSingleEntity) {
                const conversationId = extractReadKey(req, 'ID');
                
                if (!conversationId) {
                    return null;
                }
                
                // Get the single conversation with user filter
                const conversation = await db.run(
                    SELECT.one.from('ai.chat.Conversations')
                        .where({ ID: conversationId, userId: userId })
                        .columns('ID', 'title', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy')
                );
                
                if (!conversation) {
                    return null;
                }
                
                // Check if messages should be expanded
                const expand = req.query.SELECT?.columns?.find(c => c.expand);
                if (expand && expand.ref && expand.ref[0] === 'messages') {
                    // Get messages for this conversation
                    let messagesQuery = SELECT.from('ai.chat.Messages')
                        .where({ conversation_ID: conversationId })
                        .columns('ID', 'role', 'content', 'createdAt', 'modifiedAt');
                    
                    // Apply orderby from expand if present
                    if (expand.expand?.orderBy) {
                        messagesQuery = messagesQuery.orderBy(expand.expand.orderBy);
                    } else {
                        messagesQuery = messagesQuery.orderBy('createdAt asc');
                    }
                    
                    conversation.messages = await db.run(messagesQuery);

                    // Load attachments for all messages in a single query (avoids N+1)
                    const messageIds = conversation.messages.map(m => m.ID);
                    if (messageIds.length > 0) {
                        const allAttachments = await db.run(
                            SELECT.from('ai.chat.MessageAttachments')
                                .where({ message_ID: { in: messageIds } })
                                .columns('ID', 'filename', 'mimeType', 'status', 'message_ID')
                        );
                        // Group attachments by message_ID
                        const attachmentsByMsg = {};
                        for (const att of allAttachments) {
                            if (!attachmentsByMsg[att.message_ID]) attachmentsByMsg[att.message_ID] = [];
                            attachmentsByMsg[att.message_ID].push(att);
                        }
                        for (const msg of conversation.messages) {
                            if (attachmentsByMsg[msg.ID]) {
                                msg.attachments = attachmentsByMsg[msg.ID];
                            }
                        }
                    }
                }
                
                return conversation;
            }
            
            // Query the database table directly with user filter (list query)
            let query = SELECT.from('ai.chat.Conversations')
                .where({ userId: userId })
                .columns('ID', 'title', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy');
            
            // Apply $orderby if present
            if (req.query.SELECT?.orderBy) {
                query = query.orderBy(req.query.SELECT.orderBy);
            }
            
            const results = await db.run(query);
            return results;
        });
        
        // Create a new conversation
        this.on('createConversation', async (req) => {
            const { title } = req.data;
            const userId = req.user.id;
            
            const conversation = {
                ID: uuidv4(),
                title: title || 'New Conversation',
                userId: userId,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            };
            
            const db = await cds.connect.to('db');
            await db.run(INSERT.into('ai.chat.Conversations').entries(conversation));
            
            return { ID: conversation.ID, title: conversation.title, createdAt: conversation.createdAt };
        });
        
        // Delete a conversation
        this.on('deleteConversation', async (req) => {
            const { conversationId } = req.data;
            const userId = req.user.id;
            
            const db = await cds.connect.to('db');
            
            // Verify ownership
            const conversation = await db.run(
                SELECT.one.from('ai.chat.Conversations').where({ ID: conversationId, userId: userId })
            );
            
            if (!conversation) {
                req.error(404, 'Conversation not found or access denied');
                return false;
            }
            
            // Get all message IDs for this conversation
            const messages = await db.run(
                SELECT.from('ai.chat.Messages').where({ conversation_ID: conversationId }).columns('ID')
            );
            
            // Delete attachments for all messages in a single query
            const messageIds = messages.map(m => m.ID);
            if (messageIds.length > 0) {
                await db.run(DELETE.from('ai.chat.MessageAttachments').where({ message_ID: { in: messageIds } }));
            }
            
            // Delete messages
            await db.run(DELETE.from('ai.chat.Messages').where({ conversation_ID: conversationId }));
            // Delete conversation
            await db.run(DELETE.from('ai.chat.Conversations').where({ ID: conversationId }));
            
            return true;
        });
        
        // Send a message (non-streaming version for fallback)
        this.on('sendMessage', async (req) => {
            const { conversationId, content } = req.data;
            const userId = req.user.id;
            
            const db = await cds.connect.to('db');
            
            // Verify ownership
            const conversation = await db.run(
                SELECT.one.from('ai.chat.Conversations').where({ ID: conversationId, userId: userId })
            );
            
            if (!conversation) {
                req.error(404, 'Conversation not found or access denied');
                return null;
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
            
            // Get AI response
            const aiResponse = await this.getAIResponse(conversationId, content, db);
            
            // Save assistant message
            const assistantMessage = {
                ID: uuidv4(),
                conversation_ID: conversationId,
                role: 'assistant',
                content: aiResponse,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            };
            
            await db.run(INSERT.into('ai.chat.Messages').entries(assistantMessage));
            
            // Update conversation title if it's the first message
            const messageCount = await db.run(
                SELECT.from('ai.chat.Messages').where({ conversation_ID: conversationId }).columns('count(*) as count')
            );
            
            if (messageCount[0].count <= 2 && conversation.title === 'New Conversation') {
                // Generate a title from the first message
                const title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
                await db.run(
                    UPDATE('ai.chat.Conversations').set({ title: title, modifiedAt: new Date().toISOString() }).where({ ID: conversationId })
                );
            }
            
            return assistantMessage;
        });
        
        await super.init();
    }
    
    /**
     * Get AI response from SAP AI Core
     */
    async getAIResponse(conversationId, userMessage, db) {
        try {
            // Get conversation history for context
            const messages = await db.run(
                SELECT.from('ai.chat.Messages')
                    .where({ conversation_ID: conversationId })
                    .orderBy('createdAt asc')
                    .limit(20) // Limit context window
            );
            
            // Build messages array for AI
            const aiMessages = messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
            
            // Add current user message
            aiMessages.push({ role: 'user', content: userMessage });
            
            // Call AI Core
            const response = await this.callAICore(aiMessages);
            return response;
            
        } catch (error) {
            console.error('Error getting AI response:', error);
            return 'I apologize, but I encountered an error processing your request. Please try again.';
        }
    }
    
    /**
     * Call SAP AI Core API
     */
    async callAICore(messages) {
        const { getSharedAiCoreClient } = require('./ai-core-client');
        return await getSharedAiCoreClient().chat(messages);
    }
};
