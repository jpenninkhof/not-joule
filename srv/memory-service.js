const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

/**
 * Memory Service
 * Handles extraction, storage, and retrieval of user memories using HANA vector engine
 */
class MemoryService {
    constructor() {
        this.extractionPrompt = null;
        this.embeddingDeploymentId = process.env.AICORE_EMBEDDING_DEPLOYMENT_ID || null;
        this.similarityThreshold = 0.85; // Threshold for deduplication (lowered for better matching)
        this.maxMemoriesPerExtraction = 3;
        this.maxRetrievedMemories = 5;
    }

    /**
     * Load the memory extraction system prompt from file
     * @returns {string} The extraction system prompt
     */
    getExtractionPrompt() {
        if (!this.extractionPrompt) {
            try {
                const promptPath = path.join(__dirname, 'prompts', 'extractMemory.txt');
                this.extractionPrompt = fs.readFileSync(promptPath, 'utf8');
            } catch (error) {
                console.error('Failed to load extraction prompt:', error);
                // Fallback system prompt - conversation passed separately as user message
                this.extractionPrompt = `Extract 0-3 important personal facts from the conversation I provide. Return JSON: {"memories": ["fact1", "fact2"]}

Your response (JSON only):`;
            }
        }
        return this.extractionPrompt;
    }

    /**
     * Extract memories from a conversation exchange
     * @param {Array} messages - Array of message objects with role and content
     * @param {string} userId - The user ID
     * @param {string} conversationId - The conversation ID
     * @returns {Promise<Array<string>>} Array of extracted memory strings
     */
    async extractMemories(messages, userId, conversationId) {
        try {
            // Format conversation as a separate user message to prevent prompt injection
            const conversationText = messages
                .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
                .join('\n\n');

            // System prompt contains only instructions; conversation is isolated as user message
            const { getSharedAiCoreClient } = require('./ai-core-client');

            const response = await getSharedAiCoreClient().chat([
                { role: 'system', content: this.getExtractionPrompt() },
                { role: 'user', content: conversationText }
            ], { maxTokens: 500, temperature: 0.3, enableTools: false });

            // Parse the response
            let memories = [];
            try {
                // Try to extract JSON from the response
                const jsonMatch = response.match(/\{[\s\S]*"memories"[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (Array.isArray(parsed.memories)) {
                        memories = parsed.memories
                            .filter(m => typeof m === 'string' && m.trim().length > 0)
                            .slice(0, this.maxMemoriesPerExtraction);
                    }
                }
            } catch (parseError) {
                console.error('Failed to parse memory extraction response:', parseError);
                console.log('Raw response:', response);
            }

            console.log(`Extracted ${memories.length} memories from conversation ${conversationId}`);
            return memories;

        } catch (error) {
            console.error('Error extracting memories:', error);
            return [];
        }
    }

    /**
     * Generate a vector embedding for text using AI Core
     * Supports both OpenAI-style and Amazon Titan embedding models
     * @param {string} text - The text to embed
     * @returns {Promise<Array<number>|null>} The embedding vector or null on error
     */
    async embedText(text) {
        try {
            const { getSharedAiCoreClient } = require('./ai-core-client');
            const client = getSharedAiCoreClient();

            // Get OAuth token
            const token = await client.getToken();
            const baseUrl = client.credentials.serviceurls.AI_API_URL;

            // Use embedding deployment if configured, otherwise use a default
            const deploymentId = this.embeddingDeploymentId || process.env.AICORE_EMBEDDING_DEPLOYMENT_ID;
            
            if (!deploymentId) {
                console.warn('No embedding deployment ID configured. Using mock embedding.');
                // Return a mock embedding for development/testing
                return this.generateMockEmbedding(text);
            }

            // Detect embedding model type from environment or default to titan
            const embeddingModelType = process.env.AICORE_EMBEDDING_MODEL_TYPE || 'titan';
            
            let url, body;
            
            if (embeddingModelType === 'openai') {
                // OpenAI-style embedding endpoint
                url = new URL(`/v2/inference/deployments/${deploymentId}/embeddings`, baseUrl);
                body = JSON.stringify({
                    input: text,
                    model: 'text-embedding-ada-002'
                });
            } else {
                // Amazon Titan embedding model uses /invoke endpoint
                url = new URL(`/v2/inference/deployments/${deploymentId}/invoke`, baseUrl);
                body = JSON.stringify({
                    inputText: text
                });
            }

            return new Promise((resolve, reject) => {
                const https = require('https');
                const parsedUrl = new URL(url);

                const requestOptions = {
                    hostname: parsedUrl.hostname,
                    port: 443,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'AI-Resource-Group': client.resourceGroup,
                        'Content-Length': Buffer.byteLength(body)
                    }
                };

                const req = https.request(requestOptions, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            if (res.statusCode >= 400) {
                                console.error('Embedding API error:', data);
                                resolve(this.generateMockEmbedding(text));
                                return;
                            }
                            const json = JSON.parse(data);
                            
                            let embedding;
                            if (embeddingModelType === 'openai') {
                                // OpenAI response format: { data: [{ embedding: [...] }] }
                                embedding = json.data?.[0]?.embedding;
                            } else {
                                // Amazon Titan response format: { embedding: [...] }
                                embedding = json.embedding;
                            }
                            
                            if (embedding && Array.isArray(embedding)) {
                                console.log(`Generated embedding with ${embedding.length} dimensions`);
                                resolve(embedding);
                            } else {
                                console.error('Invalid embedding response format:', JSON.stringify(json).substring(0, 200));
                                resolve(this.generateMockEmbedding(text));
                            }
                        } catch (e) {
                            console.error('Error parsing embedding response:', e);
                            resolve(this.generateMockEmbedding(text));
                        }
                    });
                });

                req.on('error', (error) => {
                    console.error('Embedding request error:', error);
                    resolve(this.generateMockEmbedding(text));
                });

                req.write(body);
                req.end();
            });

        } catch (error) {
            console.error('Error generating embedding:', error);
            return this.generateMockEmbedding(text);
        }
    }

    /**
     * Generate a mock embedding for development/testing
     * Uses a simple hash-based approach to create consistent embeddings
     * @param {string} text - The text to embed
     * @returns {Array<number>} A 1024-dimensional mock embedding (matches Amazon Titan)
     */
    generateMockEmbedding(text) {
        const embedding = new Array(1024).fill(0);
        
        // Simple hash-based embedding for consistency
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            const idx = (charCode * (i + 1)) % 1024;
            embedding[idx] += 0.01;
        }

        // Normalize
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        if (magnitude > 0) {
            for (let i = 0; i < embedding.length; i++) {
                embedding[i] /= magnitude;
            }
        }

        return embedding;
    }

    /**
     * Store a memory in the HANA database with vector embedding.
     * Generates the embedding once and reuses it for both deduplication and storage.
     * @param {string} userId - The user ID
     * @param {string} content - The memory content
     * @param {string} conversationId - The source conversation ID
     * @returns {Promise<boolean>} True if stored successfully
     */
    async storeMemory(userId, content, conversationId) {
        try {
            const db = await cds.connect.to('db');

            // Generate embedding once, reuse for dedup check and storage
            const embedding = await this.embedText(content);
            if (!embedding) {
                console.error('Failed to generate embedding for memory');
                return false;
            }

            // Check for duplicates using the pre-computed embedding
            const isDuplicate = await this.checkDuplicate(userId, content, db, embedding);
            if (isDuplicate) {
                console.log('Skipping duplicate memory:', content.substring(0, 50));
                return false;
            }

            // Create memory record
            const memory = {
                ID: uuidv4(),
                userId: userId,
                content: content,
                embedding: embedding,
                sourceConversationId: conversationId,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            };

            // Insert using raw SQL for vector support
            const hana = db.dbc;

            if (hana && hana.exec) {
                const embeddingStr = `[${embedding.join(',')}]`;

                await new Promise((resolve, reject) => {
                    hana.exec(
                        `INSERT INTO "AI_CHAT_USERMEMORIES"
                         ("ID", "USERID", "CONTENT", "EMBEDDING", "SOURCECONVERSATIONID", "CREATEDAT", "MODIFIEDAT")
                         VALUES (?, ?, ?, TO_REAL_VECTOR(?), ?, ?, ?)`,
                        [memory.ID, memory.userId, memory.content, embeddingStr,
                         memory.sourceConversationId, memory.createdAt, memory.modifiedAt],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            } else {
                // Fallback: try CDS insert (may not work with vectors)
                await db.run(INSERT.into('ai.chat.UserMemories').entries({
                    ID: memory.ID,
                    userId: memory.userId,
                    content: memory.content,
                    sourceConversationId: memory.sourceConversationId,
                    createdAt: memory.createdAt,
                    modifiedAt: memory.modifiedAt
                }));
            }

            console.log('Stored memory:', content.substring(0, 50));
            return true;

        } catch (error) {
            console.error('Error storing memory:', error);
            return false;
        }
    }

    /**
     * Normalize text for comparison (lowercase, remove extra spaces, sort words)
     * @param {string} text - The text to normalize
     * @returns {string} Normalized text
     */
    normalizeForComparison(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .split(/\s+/)
            .sort()
            .join(' ')
            .trim();
    }

    /**
     * Check if a similar memory already exists (deduplication).
     * Uses both text normalization and vector similarity.
     * Accepts a pre-computed embedding to avoid redundant API calls.
     * @param {string} userId - The user ID
     * @param {string} content - The memory content to check
     * @param {object} db - Database connection
     * @param {Array<number>} embedding - Pre-computed embedding vector
     * @returns {Promise<boolean>} True if a similar memory exists
     */
    async checkDuplicate(userId, content, db, embedding) {
        try {
            // First, check for text-based duplicates (handles word order differences)
            const normalizedContent = this.normalizeForComparison(content);

            const existingMemories = await db.run(
                SELECT.from('ai.chat.UserMemories')
                    .where({ userId: userId })
                    .columns('content')
            );

            for (const mem of existingMemories) {
                const normalizedExisting = this.normalizeForComparison(mem.content);
                if (normalizedContent === normalizedExisting) {
                    console.log('Found text-based duplicate memory');
                    return true;
                }
            }

            // Then check vector similarity using the pre-computed embedding
            if (!embedding) return false;

            const hana = db.dbc;

            if (hana && hana.exec) {
                const embeddingStr = `[${embedding.join(',')}]`;

                const result = await new Promise((resolve, reject) => {
                    hana.exec(
                        `SELECT TOP 1 "ID", "CONTENT", COSINE_SIMILARITY("EMBEDDING", TO_REAL_VECTOR(?)) AS similarity
                         FROM "AI_CHAT_USERMEMORIES"
                         WHERE "USERID" = ?
                         ORDER BY similarity DESC`,
                        [embeddingStr, userId],
                        (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows);
                        }
                    );
                });

                if (result && result.length > 0 && result[0].SIMILARITY >= this.similarityThreshold) {
                    console.log(`Found vector-similar memory (${(result[0].SIMILARITY * 100).toFixed(1)}%): "${result[0].CONTENT.substring(0, 40)}..."`);
                    return true;
                }
            }

            return false;

        } catch (error) {
            console.error('Error checking for duplicate memory:', error);
            return false;
        }
    }

    /**
     * Retrieve relevant memories for a user based on a query
     * @param {string} userId - The user ID
     * @param {string} query - The query text (e.g., user's first message)
     * @returns {Promise<Array<string>>} Array of relevant memory contents
     */
    async retrieveRelevantMemories(userId, query) {
        try {
            const db = await cds.connect.to('db');
            const hana = db.dbc;

            if (!hana || !hana.exec) {
                console.log('Native HANA connection not available for vector search, using keyword fallback');
                // Fallback: keyword-based relevance filtering
                const keywords = query.toLowerCase().split(/\s+/)
                    .filter(w => w.length > 3)
                    .slice(0, 5);

                const candidates = await db.run(
                    SELECT.from('ai.chat.UserMemories')
                        .where({ userId: userId })
                        .columns('content')
                        .orderBy('createdAt desc')
                        .limit(this.maxRetrievedMemories * 4)
                );

                if (keywords.length > 0) {
                    const scored = candidates
                        .map(m => ({
                            content: m.content,
                            score: keywords.filter(kw => m.content.toLowerCase().includes(kw)).length
                        }))
                        .filter(m => m.score > 0)
                        .sort((a, b) => b.score - a.score)
                        .slice(0, this.maxRetrievedMemories);

                    if (scored.length > 0) {
                        return scored.map(m => m.content);
                    }
                }

                // No keyword matches — return most recent as last resort
                return candidates.slice(0, this.maxRetrievedMemories).map(m => m.content);
            }

            // Generate embedding for the query
            const embedding = await this.embedText(query);
            if (!embedding) {
                console.error('Failed to generate embedding for query');
                return [];
            }

            const embeddingStr = `[${embedding.join(',')}]`;

            // Perform vector similarity search
            const result = await new Promise((resolve, reject) => {
                hana.exec(
                    `SELECT TOP ${this.maxRetrievedMemories} "CONTENT", 
                            COSINE_SIMILARITY("EMBEDDING", TO_REAL_VECTOR(?)) AS similarity
                     FROM "AI_CHAT_USERMEMORIES"
                     WHERE "USERID" = ?
                     ORDER BY similarity DESC`,
                    [embeddingStr, userId],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });

            if (result && result.length > 0) {
                // Filter by minimum similarity threshold (0.5) and return contents
                const memories = result
                    .filter(r => r.SIMILARITY >= 0.5)
                    .map(r => r.CONTENT);
                
                console.log(`Retrieved ${memories.length} relevant memories for user ${userId}`);
                return memories;
            }

            return [];

        } catch (error) {
            console.error('Error retrieving memories:', error);
            return [];
        }
    }

    /**
     * Format memories as a system prompt addition
     * @param {Array<string>} memories - Array of memory strings
     * @returns {string} Formatted memory context for system prompt
     */
    formatMemoriesForPrompt(memories) {
        if (!memories || memories.length === 0) {
            return '';
        }

        const memoryList = memories.map(m => `- ${m}`).join('\n');
        return `\n\nHere is what you remember about this user from previous conversations:\n${memoryList}\n\nUse this context to personalize your responses when relevant, but don't explicitly mention that you "remember" things unless asked.`;
    }

    /**
     * Process a completed conversation turn and extract/store memories
     * @param {string} userId - The user ID
     * @param {string} conversationId - The conversation ID
     * @param {Array} messages - Recent messages from the conversation
     */
    async processConversationTurn(userId, conversationId, messages) {
        try {
            // Only process if we have at least one user and one assistant message
            const hasUserMessage = messages.some(m => m.role === 'user');
            const hasAssistantMessage = messages.some(m => m.role === 'assistant');
            
            if (!hasUserMessage || !hasAssistantMessage) {
                return;
            }

            // Extract memories from the conversation
            const extractedMemories = await this.extractMemories(messages, userId, conversationId);

            // Store each extracted memory
            for (const memory of extractedMemories) {
                await this.storeMemory(userId, memory, conversationId);
            }

        } catch (error) {
            console.error('Error processing conversation turn for memories:', error);
        }
    }

    /**
     * Get all memories for a user (for debugging/admin purposes)
     * @param {string} userId - The user ID
     * @returns {Promise<Array>} Array of memory objects
     */
    async getAllMemories(userId) {
        try {
            const db = await cds.connect.to('db');
            const memories = await db.run(
                SELECT.from('ai.chat.UserMemories')
                    .where({ userId: userId })
                    .columns('ID', 'content', 'sourceConversationId', 'createdAt')
                    .orderBy('createdAt desc')
            );
            return memories;
        } catch (error) {
            console.error('Error getting all memories:', error);
            return [];
        }
    }

    /**
     * Delete a specific memory
     * @param {string} memoryId - The memory ID
     * @param {string} userId - The user ID (for ownership verification)
     * @returns {Promise<boolean>} True if deleted successfully
     */
    async deleteMemory(memoryId, userId) {
        try {
            const db = await cds.connect.to('db');
            const deleted = await db.run(
                DELETE.from('ai.chat.UserMemories')
                    .where({ ID: memoryId, userId: userId })
            );

            if (typeof deleted === 'number') {
                return deleted > 0;
            }
            if (deleted && typeof deleted.affectedRows === 'number') {
                return deleted.affectedRows > 0;
            }
            return false;
        } catch (error) {
            console.error('Error deleting memory:', error);
            return false;
        }
    }

    /**
     * Clear all memories for a user
     * @param {string} userId - The user ID
     * @returns {Promise<boolean>} True if cleared successfully
     */
    async clearAllMemories(userId) {
        try {
            const db = await cds.connect.to('db');
            await db.run(
                DELETE.from('ai.chat.UserMemories')
                    .where({ userId: userId })
            );
            console.log(`Cleared all memories for user ${userId}`);
            return true;
        } catch (error) {
            console.error('Error clearing memories:', error);
            return false;
        }
    }
}

// Export singleton instance
module.exports = { MemoryService, memoryService: new MemoryService() };
