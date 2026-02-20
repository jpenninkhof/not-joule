const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

/**
 * Memory Service
 * Handles extraction, storage, and retrieval of user memories using HANA vector engine.
 *
 * Features:
 *  - Semantic memory extraction from conversation turns
 *  - Vector-based deduplication and LLM-assisted contradiction detection
 *  - Decay-weighted retrieval (personal_fact category is exempt from decay)
 *  - Access-count frequency boost on retrieval
 *  - Memory categorisation: personal_fact, preference, goal, project, episodic
 */
class MemoryService {
    constructor() {
        this.extractionPrompt = null;
        this.embeddingDeploymentId = process.env.AICORE_EMBEDDING_DEPLOYMENT_ID || null;
        this.similarityThreshold = 0.85;     // Cosine similarity >= this → duplicate, skip
        this.contradictionThreshold = 0.55;  // Cosine similarity in [this, 0.85) → LLM check
        this.maxMemoriesPerExtraction = 3;
        this.maxRetrievedMemories = 5;
        this.minRetrievalScore = 0.4;        // Combined retrieval score minimum
    }

    // ─── Prompt loading ───────────────────────────────────────────────────────

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
                this.extractionPrompt = `Extract 0-3 important personal facts from the conversation I provide. Return JSON: {"memories": [{"content": "fact", "category": "personal_fact"}]}

Your response (JSON only):`;
            }
        }
        return this.extractionPrompt;
    }

    // ─── Memory Extraction ────────────────────────────────────────────────────

    /**
     * Extract memories from a conversation exchange.
     * @param {Array} messages - Array of {role, content} message objects
     * @param {string} userId
     * @param {string} conversationId
     * @returns {Promise<Array<{content: string, category: string|null}>>}
     */
    async extractMemories(messages, userId, conversationId) {
        try {
            const conversationText = messages
                .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
                .join('\n\n');

            const { getSharedAiCoreClient } = require('./ai-core-client');
            const response = await getSharedAiCoreClient().chat([
                { role: 'system', content: this.getExtractionPrompt() },
                { role: 'user', content: conversationText }
            ], { maxTokens: 500, temperature: 0.3, enableTools: false });

            let memories = [];
            try {
                const jsonMatch = response.match(/\{[\s\S]*"memories"[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (Array.isArray(parsed.memories)) {
                        memories = parsed.memories
                            .map(m => {
                                // Support both old format (plain string) and new format ({content, category, confidence})
                                if (typeof m === 'string' && m.trim().length > 0) {
                                    return { content: m.trim(), category: null, confidence: 1.0 };
                                }
                                if (typeof m === 'object' && m && typeof m.content === 'string' && m.content.trim().length > 0) {
                                    const confidence = typeof m.confidence === 'number'
                                        ? Math.min(1.0, Math.max(0.0, m.confidence))
                                        : 1.0;
                                    return { content: m.content.trim(), category: m.category || null, confidence };
                                }
                                return null;
                            })
                            .filter(Boolean)
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

    // ─── Embedding ────────────────────────────────────────────────────────────

    /**
     * Generate a vector embedding for text using AI Core.
     * Supports both OpenAI-style and Amazon Titan embedding models.
     * @param {string} text - The text to embed
     * @returns {Promise<Array<number>|null>} The embedding vector or null on error
     */
    async embedText(text) {
        try {
            const { getSharedAiCoreClient } = require('./ai-core-client');
            const client = getSharedAiCoreClient();

            const token = await client.getToken();
            const baseUrl = client.credentials.serviceurls.AI_API_URL;

            const deploymentId = this.embeddingDeploymentId || process.env.AICORE_EMBEDDING_DEPLOYMENT_ID;
            if (!deploymentId) {
                console.warn('No embedding deployment ID configured. Using mock embedding.');
                return this.generateMockEmbedding(text);
            }

            const embeddingModelType = process.env.AICORE_EMBEDDING_MODEL_TYPE || 'titan';
            let url, body;

            if (embeddingModelType === 'openai') {
                url = new URL(`/v2/inference/deployments/${deploymentId}/embeddings`, baseUrl);
                body = JSON.stringify({ input: text, model: 'text-embedding-ada-002' });
            } else {
                url = new URL(`/v2/inference/deployments/${deploymentId}/invoke`, baseUrl);
                body = JSON.stringify({ inputText: text });
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
                            const embedding = embeddingModelType === 'openai'
                                ? json.data?.[0]?.embedding
                                : json.embedding;

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
     * Generate a mock embedding for development/testing.
     * Uses a hash-based approach to create consistent 1024-dimensional embeddings.
     * @param {string} text
     * @returns {Array<number>}
     */
    generateMockEmbedding(text) {
        const embedding = new Array(1024).fill(0);
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            const idx = (charCode * (i + 1)) % 1024;
            embedding[idx] += 0.01;
        }
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        if (magnitude > 0) {
            for (let i = 0; i < embedding.length; i++) {
                embedding[i] /= magnitude;
            }
        }
        return embedding;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    /**
     * Store a memory, with deduplication and contradiction detection.
     *
     * Flow:
     *  1. Text-based exact dedup (fast)
     *  2. Vector similarity check against existing memories
     *     >= similarityThreshold (0.85)         → duplicate, skip
     *     [contradictionThreshold (0.55), 0.85) → LLM classifies as duplicate/update/new
     *     < contradictionThreshold              → insert as new
     *
     * @param {string} userId
     * @param {string} content
     * @param {string} conversationId
     * @param {string|null} category - 'personal_fact'|'preference'|'goal'|'project'|'episodic'
     * @param {number} confidence - Extraction confidence: 1.0=explicit, 0.7=implied, 0.4=uncertain
     * @returns {Promise<boolean>} True if stored or updated
     */
    async storeMemory(userId, content, conversationId, category = null, confidence = 1.0) {
        try {
            const db = await cds.connect.to('db');

            const embedding = await this.embedText(content);
            if (!embedding) {
                console.error('Failed to generate embedding for memory');
                return false;
            }

            // Fast text-based exact dedup
            if (await this._isTextDuplicate(userId, content, db)) {
                console.log('Skipping text-duplicate memory:', content.substring(0, 50));
                return false;
            }

            // Vector similarity check
            const similar = await this._findSimilarMemory(userId, embedding, db);

            if (similar) {
                if (similar.similarity >= this.similarityThreshold) {
                    console.log(`Skipping duplicate memory (${(similar.similarity * 100).toFixed(1)}%): "${similar.content.substring(0, 40)}"`);
                    return false;
                }

                if (similar.similarity >= this.contradictionThreshold) {
                    // Potentially related — ask LLM to classify
                    const classification = await this._classifyMemoryRelation(similar.content, content);

                    if (classification.action === 'duplicate') {
                        console.log('LLM classified as duplicate, skipping');
                        return false;
                    }

                    if (classification.action === 'update') {
                        const updatedContent = classification.updatedContent || content;
                        const updatedEmbedding = classification.updatedContent
                            ? await this.embedText(classification.updatedContent)
                            : embedding;
                        await this._updateExistingMemory(db, similar.id, updatedContent, updatedEmbedding, category, confidence);
                        return true;
                    }
                    // 'new' — fall through to insert
                }
            }

            await this._insertMemory(db, userId, content, embedding, conversationId, category, confidence);
            return true;

        } catch (error) {
            console.error('Error storing memory:', error);
            return false;
        }
    }

    // ─── Private storage helpers ──────────────────────────────────────────────

    async _isTextDuplicate(userId, content, db) {
        const normalizedContent = this.normalizeForComparison(content);
        const existingMemories = await db.run(
            SELECT.from('ai.chat.UserMemories').where({ userId }).columns('content')
        );
        return existingMemories.some(mem =>
            this.normalizeForComparison(mem.content) === normalizedContent
        );
    }

    async _findSimilarMemory(userId, embedding, db) {
        const hana = db.dbc;
        if (!hana || !hana.exec) return null;

        const embeddingStr = `[${embedding.join(',')}]`;
        const result = await new Promise((resolve, reject) => {
            hana.exec(
                `SELECT TOP 1 "ID", "CONTENT", COSINE_SIMILARITY("EMBEDDING", TO_REAL_VECTOR(?)) AS similarity
                 FROM "AI_CHAT_USERMEMORIES"
                 WHERE "USERID" = ?
                 ORDER BY similarity DESC`,
                [embeddingStr, userId],
                (err, rows) => { if (err) reject(err); else resolve(rows); }
            );
        });

        if (result && result.length > 0) {
            return {
                id: result[0].ID,
                content: result[0].CONTENT,
                similarity: result[0].SIMILARITY
            };
        }
        return null;
    }

    /**
     * Ask the LLM to classify the relationship between an existing memory and new information.
     * @param {string} existingContent
     * @param {string} newContent
     * @returns {Promise<{action: 'duplicate'|'update'|'new', updatedContent?: string}>}
     */
    async _classifyMemoryRelation(existingContent, newContent) {
        try {
            const { getSharedAiCoreClient } = require('./ai-core-client');
            const prompt = `You are a memory manager. Determine the relationship between an existing memory and new information.

Existing memory: "${existingContent}"
New information: "${newContent}"

- "duplicate": the new info is essentially the same fact already captured
- "update": the new info supersedes or corrects the existing memory (e.g. moved cities, changed jobs, changed preference)
- "new": the new info is distinct and complementary to the existing memory

If "update", provide the best merged statement as updatedContent.

Respond with JSON only: {"action": "duplicate"|"update"|"new", "updatedContent": "merged statement, only when action is update"}`;

            const response = await getSharedAiCoreClient().chat([
                { role: 'user', content: prompt }
            ], { maxTokens: 200, temperature: 0.1, enableTools: false });

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    action: ['duplicate', 'update', 'new'].includes(parsed.action) ? parsed.action : 'new',
                    updatedContent: parsed.updatedContent || null
                };
            }
        } catch (e) {
            console.error('Memory relation classification failed:', e);
        }
        return { action: 'new' };
    }

    async _updateExistingMemory(db, id, content, embedding, category, confidence) {
        const hana = db.dbc;
        if (!hana || !hana.exec) return;

        const embeddingStr = `[${embedding.join(',')}]`;
        const now = new Date().toISOString();

        // Build SET clause dynamically — only overwrite category/confidence if provided
        const setClauses = [`"CONTENT" = ?`, `"EMBEDDING" = TO_REAL_VECTOR(?)`, `"MODIFIEDAT" = ?`];
        const params = [content, embeddingStr, now];
        if (category != null)    { setClauses.push(`"CATEGORY" = ?`);    params.push(category); }
        if (confidence != null)  { setClauses.push(`"CONFIDENCE" = ?`);  params.push(confidence); }
        params.push(id);

        await new Promise((resolve, reject) => {
            hana.exec(
                `UPDATE "AI_CHAT_USERMEMORIES" SET ${setClauses.join(', ')} WHERE "ID" = ?`,
                params,
                (err) => { if (err) reject(err); else resolve(); }
            );
        });
        console.log('Updated memory (contradiction resolved):', content.substring(0, 50));
    }

    async _insertMemory(db, userId, content, embedding, conversationId, category, confidence = 1.0) {
        const hana = db.dbc;
        const id = uuidv4();
        const now = new Date().toISOString();

        if (hana && hana.exec) {
            const embeddingStr = `[${embedding.join(',')}]`;
            await new Promise((resolve, reject) => {
                hana.exec(
                    `INSERT INTO "AI_CHAT_USERMEMORIES"
                     ("ID", "USERID", "CONTENT", "EMBEDDING", "SOURCECONVERSATIONID", "CREATEDAT", "MODIFIEDAT", "CATEGORY", "CONFIDENCE", "ACCESSCOUNT")
                     VALUES (?, ?, ?, TO_REAL_VECTOR(?), ?, ?, ?, ?, ?, 0)`,
                    [id, userId, content, embeddingStr, conversationId, now, now, category || null, confidence],
                    (err) => { if (err) reject(err); else resolve(); }
                );
            });
        } else {
            // Fallback: CDS insert (no vector support)
            await db.run(INSERT.into('ai.chat.UserMemories').entries({
                ID: id, userId, content, sourceConversationId: conversationId,
                createdAt: now, modifiedAt: now, category: category || null, confidence, accessCount: 0
            }));
        }
        console.log('Stored memory:', content.substring(0, 50));
    }

    /**
     * Increment accessCount and update lastAccessedAt for a set of memory IDs.
     * Fire-and-forget — errors are logged but not propagated.
     */
    _updateAccessCounts(hana, ids) {
        if (!hana || !hana.exec || ids.length === 0) return;
        const now = new Date().toISOString();
        const placeholders = ids.map(() => '?').join(', ');
        hana.exec(
            `UPDATE "AI_CHAT_USERMEMORIES"
             SET "ACCESSCOUNT" = COALESCE("ACCESSCOUNT", 0) + 1, "LASTACCESSEDAT" = ?
             WHERE "ID" IN (${placeholders})`,
            [now, ...ids],
            (err) => { if (err) console.error('Failed to update access counts:', err); }
        );
    }

    // ─── Text normalisation ───────────────────────────────────────────────────

    /**
     * Normalize text for comparison (lowercase, remove punctuation, sort words).
     * @param {string} text
     * @returns {string}
     */
    normalizeForComparison(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .sort()
            .join(' ')
            .trim();
    }

    // ─── Retrieval ────────────────────────────────────────────────────────────

    /**
     * Retrieve relevant memories for a user, ranked by a combined score:
     *
     *   score = (cosine_similarity + accessCount × 0.01) × recency_decay
     *
     * Recency decay: EXP(-0.005 × days_since_created)
     *   - At 30 days:  ~0.86×  (slow decay for recent memories)
     *   - At 180 days: ~0.41×
     *   - personal_fact category is always 1.0 (no decay)
     *
     * @param {string} userId
     * @param {string} query
     * @param {string|null} categoryFilter - optional: restrict to one category
     * @returns {Promise<string[]>}
     */
    async retrieveRelevantMemories(userId, query, categoryFilter = null) {
        try {
            const db = await cds.connect.to('db');
            const hana = db.dbc;

            if (!hana || !hana.exec) {
                return this._keywordFallbackRetrieval(db, userId, query, categoryFilter);
            }

            const embedding = await this.embedText(query);
            if (!embedding) {
                console.error('Failed to generate embedding for query');
                return [];
            }

            const embeddingStr = `[${embedding.join(',')}]`;

            // Combined score: (similarity + frequency boost) × recency decay × confidence
            // personal_fact is exempt from decay (stable identity facts should always surface)
            const scoreExpr = `(COSINE_SIMILARITY("EMBEDDING", TO_REAL_VECTOR(?)) + COALESCE("ACCESSCOUNT", 0) * 0.01) *
                CASE WHEN "CATEGORY" = 'personal_fact'
                     THEN 1.0
                     ELSE EXP(-0.005 * DAYS_BETWEEN("CREATEDAT", CURRENT_TIMESTAMP))
                END *
                COALESCE("CONFIDENCE", 1.0)`;

            const whereParts = ['"USERID" = ?'];
            const params = [embeddingStr, userId];
            if (categoryFilter) {
                whereParts.push('"CATEGORY" = ?');
                params.push(categoryFilter);
            }

            const result = await new Promise((resolve, reject) => {
                hana.exec(
                    `SELECT TOP ${this.maxRetrievedMemories} "ID", "CONTENT",
                            ${scoreExpr} AS score
                     FROM "AI_CHAT_USERMEMORIES"
                     WHERE ${whereParts.join(' AND ')}
                     ORDER BY score DESC`,
                    params,
                    (err, rows) => { if (err) reject(err); else resolve(rows); }
                );
            });

            const filtered = (result || []).filter(r => r.SCORE >= this.minRetrievalScore);

            if (filtered.length > 0) {
                this._updateAccessCounts(hana, filtered.map(r => r.ID));
            }

            console.log(`Retrieved ${filtered.length} relevant memories for user ${userId}`);
            return filtered.map(r => r.CONTENT);

        } catch (error) {
            console.error('Error retrieving memories:', error);
            return [];
        }
    }

    async _keywordFallbackRetrieval(db, userId, query, categoryFilter) {
        console.log('Native HANA connection not available for vector search, using keyword fallback');
        const keywords = query.toLowerCase().split(/\s+/)
            .filter(w => w.length > 3)
            .slice(0, 5);

        const whereClause = categoryFilter ? { userId, category: categoryFilter } : { userId };
        const candidates = await db.run(
            SELECT.from('ai.chat.UserMemories')
                .where(whereClause)
                .columns('ID', 'content', 'category', 'accessCount', 'createdAt')
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

            if (scored.length > 0) return scored.map(m => m.content);
        }

        return candidates.slice(0, this.maxRetrievedMemories).map(m => m.content);
    }

    // ─── Prompt formatting ────────────────────────────────────────────────────

    /**
     * Format memories as a system prompt addition.
     * @param {string[]} memories
     * @returns {string}
     */
    formatMemoriesForPrompt(memories) {
        if (!memories || memories.length === 0) return '';
        const memoryList = memories.map(m => `- ${m}`).join('\n');
        return `\n\nHere is what you remember about this user from previous conversations:\n${memoryList}\n\nUse this context to personalize your responses when relevant, but don't explicitly mention that you "remember" things unless asked.`;
    }

    // ─── Conversation processing ──────────────────────────────────────────────

    /**
     * Process a completed conversation turn: extract memories and store them.
     * @param {string} userId
     * @param {string} conversationId
     * @param {Array} messages - Recent messages [{role, content}]
     */
    async processConversationTurn(userId, conversationId, messages) {
        try {
            const hasUserMessage = messages.some(m => m.role === 'user');
            const hasAssistantMessage = messages.some(m => m.role === 'assistant');
            if (!hasUserMessage || !hasAssistantMessage) return;

            const extractedMemories = await this.extractMemories(messages, userId, conversationId);
            for (const memory of extractedMemories) {
                await this.storeMemory(userId, memory.content, conversationId, memory.category, memory.confidence);
            }
        } catch (error) {
            console.error('Error processing conversation turn for memories:', error);
        }
    }

    // ─── Admin / management ───────────────────────────────────────────────────

    /**
     * Get all memories for a user.
     * @param {string} userId
     * @returns {Promise<Array>}
     */
    async getAllMemories(userId) {
        try {
            const db = await cds.connect.to('db');
            return await db.run(
                SELECT.from('ai.chat.UserMemories')
                    .where({ userId })
                    .columns('ID', 'content', 'category', 'confidence', 'accessCount', 'lastAccessedAt', 'sourceConversationId', 'createdAt')
                    .orderBy('createdAt desc')
            );
        } catch (error) {
            console.error('Error getting all memories:', error);
            return [];
        }
    }

    /**
     * Delete a specific memory (ownership verified by userId).
     * @param {string} memoryId
     * @param {string} userId
     * @returns {Promise<boolean>}
     */
    async deleteMemory(memoryId, userId) {
        try {
            const db = await cds.connect.to('db');
            const deleted = await db.run(
                DELETE.from('ai.chat.UserMemories').where({ ID: memoryId, userId })
            );
            if (typeof deleted === 'number') return deleted > 0;
            if (deleted && typeof deleted.affectedRows === 'number') return deleted.affectedRows > 0;
            return false;
        } catch (error) {
            console.error('Error deleting memory:', error);
            return false;
        }
    }

    /**
     * Clear all memories for a user.
     * @param {string} userId
     * @returns {Promise<boolean>}
     */
    async clearAllMemories(userId) {
        try {
            const db = await cds.connect.to('db');
            await db.run(DELETE.from('ai.chat.UserMemories').where({ userId }));
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
