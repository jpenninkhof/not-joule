const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');

/**
 * Chat Service Implementation
 * Handles chat operations and integrates with SAP AI Core
 */
module.exports = class ChatService extends cds.ApplicationService {
    
    async init() {
        const { Conversations, Messages } = this.entities;
        
        // Filter conversations by current user - use on() handler to query db directly
        this.on('READ', 'Conversations', async (req) => {
            const userId = req.user.id;
            const db = await cds.connect.to('db');
            
            // Check if this is a single entity request (has keys)
            const keys = req.query.SELECT?.from?.ref?.[0]?.where;
            const isSingleEntity = keys && keys.length > 0;
            
            if (isSingleEntity) {
                // Extract the ID from the keys
                const idCondition = keys.find(k => k.ref && k.ref[0] === 'ID');
                const conversationId = idCondition ? keys[2]?.val : null;
                
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
                    
                    // Load attachments for each message (without the content field to save memory)
                    for (const msg of conversation.messages) {
                        const attachments = await db.run(
                            SELECT.from('ai.chat.MessageAttachments')
                                .where({ message_ID: msg.ID })
                                .columns('ID', 'filename', 'mimeType', 'status')
                        );
                        if (attachments.length > 0) {
                            msg.attachments = attachments;
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
            
            // Delete attachments for all messages
            for (const msg of messages) {
                await db.run(DELETE.from('ai.chat.MessageAttachments').where({ message_ID: msg.ID }));
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
        const { AiCoreClient } = require('./ai-core-client');
        const client = new AiCoreClient();
        return await client.chat(messages);
    }
};