const https = require('https');

// Token estimation: ~2.3 characters per token (very conservative for PDF content)
// Actual Claude tokenization is much more aggressive than typical estimates
// PDF content with special characters, formatting, and structured data tokenizes poorly
const CHARS_PER_TOKEN = 2.3;
// Maximum tokens for the model (Claude 3.5 Sonnet on Bedrock has 200K limit)
const MAX_MODEL_TOKENS = 200000;
// Reserve tokens for the response
const RESPONSE_TOKEN_RESERVE = 8192;
// Maximum input tokens we'll allow (with 25% safety margin to account for tokenization variance)
const MAX_INPUT_TOKENS = Math.floor((MAX_MODEL_TOKENS - RESPONSE_TOKEN_RESERVE) * 0.75);
// Maximum characters we'll allow in input
const MAX_INPUT_CHARS = MAX_INPUT_TOKENS * CHARS_PER_TOKEN;

/**
 * Estimate token count from text (rough approximation)
 * @param {string} text - The text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Maximum characters per message in conversation history
// Be very aggressive - allow only ~4K tokens per historical message
const MAX_HISTORY_MESSAGE_CHARS = 4000 * CHARS_PER_TOKEN;

/**
 * Truncate message content from conversation history to prevent token overflow.
 * This is applied when loading messages from the database.
 * @param {string} content - The message content
 * @param {string} role - The message role (user/assistant)
 * @returns {string} Truncated content if necessary
 */
function truncateMessageContent(content, role = 'user') {
    if (!content) return content;
    
    // Log message sizes for debugging
    const contentLength = content.length;
    const estimatedTokens = estimateTokens(content);
    
    if (contentLength > 10000) {
        console.log(`Message (${role}): ${contentLength} chars, ~${estimatedTokens} tokens`);
    }
    
    if (contentLength <= MAX_HISTORY_MESSAGE_CHARS) {
        return content;
    }

    // Find a good break point
    let truncateAt = MAX_HISTORY_MESSAGE_CHARS;
    const lastParagraph = content.lastIndexOf('\n\n', MAX_HISTORY_MESSAGE_CHARS);
    const lastSentence = content.lastIndexOf('. ', MAX_HISTORY_MESSAGE_CHARS);
    
    if (lastParagraph > MAX_HISTORY_MESSAGE_CHARS * 0.8) {
        truncateAt = lastParagraph;
    } else if (lastSentence > MAX_HISTORY_MESSAGE_CHARS * 0.8) {
        truncateAt = lastSentence + 1;
    }

    const truncated = content.substring(0, truncateAt);
    const originalTokens = estimateTokens(content);
    const truncatedTokens = estimateTokens(truncated);
    
    console.warn(`Truncated ${role} message from ${originalTokens} to ${truncatedTokens} tokens in conversation history`);
    
    return truncated + `\n\n[... content truncated from ${originalTokens.toLocaleString()} to ${truncatedTokens.toLocaleString()} tokens ...]`;
}

/**
 * AI Core Client
 * Handles communication with SAP AI Core for chat completions
 * Supports both streaming and non-streaming responses
 * Supports both OpenAI and Anthropic models
 * Supports web search via Perplexity Sonar (tool use)
 */
class AiCoreClient {
    constructor() {
        this.deploymentId = process.env.AICORE_DEPLOYMENT_ID;
        if (!this.deploymentId) {
            throw new Error('AICORE_DEPLOYMENT_ID environment variable is required');
        }
        this.resourceGroup = process.env.AICORE_RESOURCE_GROUP || 'default';
        // Model type: 'anthropic' or 'openai' - detect from deployment or set explicitly
        this.modelType = process.env.AICORE_MODEL_TYPE || 'anthropic';
        // Optional: Perplexity Sonar deployment for web search tool use
        this.perplexityDeploymentId = process.env.AICORE_PERPLEXITY_DEPLOYMENT_ID;

        // Load credentials from environment or service binding
        this.credentials = this.loadCredentials();

        // Token cache: avoid fetching a new token on every request
        this._cachedToken = null;
        this._tokenExpiresAt = 0;
        // Deduplicates concurrent token fetches - all callers share one in-flight request
        this._pendingTokenFetch = null;
    }

    /**
     * Load AI Core credentials from environment or VCAP_SERVICES
     */
    loadCredentials() {
        // Check for direct environment variables (local development)
        if (process.env.AICORE_SERVICE_URL && process.env.AICORE_CLIENT_ID) {
            return {
                serviceurls: {
                    AI_API_URL: process.env.AICORE_SERVICE_URL
                },
                clientid: process.env.AICORE_CLIENT_ID,
                clientsecret: process.env.AICORE_CLIENT_SECRET,
                url: process.env.AICORE_AUTH_URL
            };
        }

        // Check VCAP_SERVICES for Cloud Foundry deployment
        if (process.env.VCAP_SERVICES) {
            try {
                const vcap = JSON.parse(process.env.VCAP_SERVICES);

                // Check for managed aicore service
                const aicore = vcap.aicore?.[0]?.credentials;
                if (aicore) {
                    return aicore;
                }

                // Check for user-provided service (ai-chat-app-aicore)
                const userProvided = vcap['user-provided'];
                if (userProvided) {
                    const aicoreUps = userProvided.find(s => s.name === 'ai-chat-app-aicore');
                    if (aicoreUps?.credentials) {
                        return aicoreUps.credentials;
                    }
                }
            } catch (e) {
                console.error('Error parsing VCAP_SERVICES:', e);
            }
        }

        // Fallback to default credentials file for local development
        try {
            const fs = require('fs');
            const path = require('path');
            const credPath = path.join(__dirname, '..', 'default-env.json');
            if (fs.existsSync(credPath)) {
                const defaultEnv = JSON.parse(fs.readFileSync(credPath, 'utf8'));
                // Also pick up Perplexity deployment ID from default-env.json if not set
                if (!this.perplexityDeploymentId && defaultEnv.AICORE_PERPLEXITY_DEPLOYMENT_ID) {
                    this.perplexityDeploymentId = defaultEnv.AICORE_PERPLEXITY_DEPLOYMENT_ID;
                }
                return defaultEnv.VCAP_SERVICES?.aicore?.[0]?.credentials;
            }
        } catch (e) {
            console.error('Error loading default-env.json:', e);
        }

        return null;
    }

    /**
     * Get OAuth token from XSUAA (cached until 60s before expiry).
     * Concurrent callers share a single in-flight fetch to avoid duplicate requests.
     */
    async getToken() {
        // Return cached token if still valid (with 60s safety margin)
        if (this._cachedToken && Date.now() < this._tokenExpiresAt - 60000) {
            return this._cachedToken;
        }

        // Deduplicate concurrent token fetches
        if (this._pendingTokenFetch) {
            return this._pendingTokenFetch;
        }

        if (!this.credentials) {
            throw new Error('AI Core credentials not configured');
        }

        const tokenUrl = new URL('/oauth/token', this.credentials.url);
        const auth = Buffer.from(`${this.credentials.clientid}:${this.credentials.clientsecret}`).toString('base64');

        this._pendingTokenFetch = new Promise((resolve, reject) => {
            const postData = 'grant_type=client_credentials';

            const options = {
                hostname: tokenUrl.hostname,
                port: 443,
                path: tokenUrl.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${auth}`,
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.access_token) {
                            // Cache the token with its expiry time
                            const expiresIn = json.expires_in || 3600; // default 1 hour
                            this._cachedToken = json.access_token;
                            this._tokenExpiresAt = Date.now() + expiresIn * 1000;
                            resolve(json.access_token);
                        } else {
                            reject(new Error('No access token in response'));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        }).finally(() => {
            this._pendingTokenFetch = null;
        });

        return this._pendingTokenFetch;
    }

    /**
     * Truncate text to fit within token limit, adding a notice if truncated
     * @param {string} text - The text to potentially truncate
     * @param {number} maxChars - Maximum characters allowed
     * @param {string} filename - Name of the file (for the truncation notice)
     * @returns {object} { text: string, wasTruncated: boolean }
     */
    truncateText(text, maxChars, filename = 'document') {
        if (!text || text.length <= maxChars) {
            return { text, wasTruncated: false };
        }

        // Find a good break point (end of sentence or paragraph)
        let truncateAt = maxChars;
        const lastParagraph = text.lastIndexOf('\n\n', maxChars);
        const lastSentence = text.lastIndexOf('. ', maxChars);
        
        if (lastParagraph > maxChars * 0.8) {
            truncateAt = lastParagraph;
        } else if (lastSentence > maxChars * 0.8) {
            truncateAt = lastSentence + 1;
        }

        const truncatedText = text.substring(0, truncateAt);
        const originalTokens = estimateTokens(text);
        const truncatedTokens = estimateTokens(truncatedText);
        
        const notice = `\n\n[⚠️ DOCUMENT TRUNCATED: "${filename}" was ${originalTokens.toLocaleString()} tokens, truncated to ${truncatedTokens.toLocaleString()} tokens (${Math.round(truncatedTokens/originalTokens*100)}% of original) to fit model context limit. Consider summarizing in sections or using a smaller document.]`;
        
        return { 
            text: truncatedText + notice, 
            wasTruncated: true,
            originalTokens,
            truncatedTokens
        };
    }

    /**
     * Convert OpenAI-style messages to Anthropic format
     * Supports file attachments (images) in the content
     * Automatically truncates large documents to fit within token limits
     */
    convertToAnthropicFormat(messages) {
        // Extract system message if present
        let systemPrompt = '';
        const anthropicMessages = [];
        let totalEstimatedTokens = 0;
        const truncationWarnings = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemPrompt = msg.content;
                totalEstimatedTokens += estimateTokens(msg.content);
            } else {
                // Check if message has attachments
                if (msg.attachments && msg.attachments.length > 0) {
                    // Build content array with text and images
                    const contentParts = [];

                    // Add attachments first
                    for (const attachment of msg.attachments) {
                        console.log(`Processing attachment: ${attachment.name}, type: ${attachment.type}, data length: ${attachment.data?.length || 0}`);
                        if (attachment.type && attachment.type.startsWith('image/')) {
                            // Image attachment - use Anthropic's image format
                            // Extract base64 data from data URL if present
                            let base64Data = attachment.data;
                            let mediaType = attachment.type;

                            if (base64Data && base64Data.startsWith('data:')) {
                                // Parse data URL: data:image/jpeg;base64,/9j/4AAQ...
                                const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
                                if (matches) {
                                    mediaType = matches[1];
                                    base64Data = matches[2];
                                }
                            }

                            contentParts.push({
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: mediaType,
                                    data: base64Data
                                }
                            });
                            // Images are tokenized differently, rough estimate
                            totalEstimatedTokens += 1000;
                        } else {
                            // Non-image file - include as text with file info
                            // Try to decode text files
                            let fileContent = '';
                            let rawData = attachment.data;

                            // Extract base64 from data URL if present
                            if (rawData && rawData.startsWith('data:')) {
                                const matches = rawData.match(/^data:[^;]+;base64,(.+)$/);
                                if (matches) {
                                    rawData = matches[1];
                                }
                            }

                            try {
                                fileContent = Buffer.from(rawData, 'base64').toString('utf8');
                            } catch (e) {
                                fileContent = '[Binary file content]';
                            }

                            // Calculate remaining token budget for this file
                            // Use a very conservative budget because:
                            // 1. PDF binary decoded as UTF-8 contains many special characters
                            // 2. JSON escaping can 2-6x the size of special characters
                            // 3. We need to leave room for other messages and system prompt
                            const remainingTokenBudget = Math.min(
                                MAX_INPUT_TOKENS - totalEstimatedTokens - 1000,
                                50000 // Hard cap at 50K tokens per file to be safe
                            );
                            // Use a much more conservative char budget (0.5 chars per token)
                            // to account for JSON escaping of binary data interpreted as UTF-8
                            const remainingCharBudget = remainingTokenBudget * 0.5;
                            
                            console.log(`File budget: ${remainingTokenBudget} tokens, ${remainingCharBudget} chars. File content: ${fileContent.length} chars`);

                            // Truncate if necessary
                            const { text: processedContent, wasTruncated, originalTokens, truncatedTokens } = 
                                this.truncateText(fileContent, remainingCharBudget, attachment.name);

                            if (wasTruncated) {
                                console.warn(`Document "${attachment.name}" truncated from ${originalTokens} to ${truncatedTokens} tokens`);
                                truncationWarnings.push({
                                    filename: attachment.name,
                                    originalTokens,
                                    truncatedTokens
                                });
                            }

                            const formattedContent = `[File: ${attachment.name}]\n\`\`\`\n${processedContent}\n\`\`\``;
                            contentParts.push({
                                type: 'text',
                                text: formattedContent
                            });
                            totalEstimatedTokens += estimateTokens(formattedContent);
                            
                            // IMPORTANT: Clear the original attachment data to prevent it from being
                            // included in the JSON request (it was already decoded and processed above)
                            attachment.data = null;
                        }
                    }

                    // Add text content if present
                    if (msg.content) {
                        contentParts.push({
                            type: 'text',
                            text: msg.content
                        });
                        totalEstimatedTokens += estimateTokens(msg.content);
                    }

                    anthropicMessages.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: contentParts
                    });
                } else {
                    // Simple text message
                    anthropicMessages.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: msg.content
                    });
                    totalEstimatedTokens += estimateTokens(msg.content);
                }
            }
        }

        // Log token usage summary
        console.log(`Total estimated input tokens: ${totalEstimatedTokens.toLocaleString()} / ${MAX_INPUT_TOKENS.toLocaleString()}`);

        return { systemPrompt, messages: anthropicMessages, truncationWarnings };
    }

    /**
     * The web_search tool definition passed to Claude
     */
    get _webSearchTool() {
        return [{
            name: 'web_search',
            description: 'Search the web for current, real-time, or recent information. Use this when the user asks about recent events, current news, live data, prices, or anything that may have changed after your training cutoff.',
            input_schema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'The search query' }
                },
                required: ['query']
            }
        }];
    }

    /**
     * Call Perplexity Sonar via AI Core for web search.
     * Returns the answer text with sources appended.
     */
    async callPerplexity(query) {
        if (!this.perplexityDeploymentId) {
            throw new Error('AICORE_PERPLEXITY_DEPLOYMENT_ID not configured');
        }

        const token = await this.getToken();
        const baseUrl = this.credentials.serviceurls.AI_API_URL;
        const url = new URL(`/v2/inference/deployments/${this.perplexityDeploymentId}/chat/completions`, baseUrl);

        const body = JSON.stringify({
            model: 'sonar',
            messages: [{ role: 'user', content: query }],
            max_tokens: 1024
        });

        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: 443,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'AI-Resource-Group': this.resourceGroup,
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            const req = https.request(requestOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 400) {
                            console.error('Perplexity error response:', data);
                            reject(new Error(`Perplexity API error: ${res.statusCode}`));
                            return;
                        }
                        const json = JSON.parse(data);
                        const answer = json.choices?.[0]?.message?.content || '';
                        const citations = json.citations || [];

                        let result = answer;
                        if (citations.length > 0) {
                            result += '\n\nSources:\n' + citations.map((u, i) => `[${i + 1}] ${u}`).join('\n');
                        }
                        resolve(result);
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Non-streaming Anthropic invoke. Returns the full parsed JSON response.
     *
     * toolBehavior controls how tools are included in the request:
     *   'auto' → offer tools and let Claude decide (first call)
     *   'none' → include tool definitions but forbid usage (required when messages
     *             already contain tool_use blocks, to satisfy Anthropic's API contract)
     *   false  → no tools at all (e.g. for memory extraction)
     */
    async _invokeAnthropic(anthropicMessages, systemPrompt, options, toolBehavior = 'auto') {
        const token = await this.getToken();
        const baseUrl = this.credentials.serviceurls.AI_API_URL;
        const url = new URL(`/v2/inference/deployments/${this.deploymentId}/invoke`, baseUrl);

        const requestBody = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: options.maxTokens || 4096,
            system: systemPrompt || 'You are a helpful AI Assistant.',
            messages: anthropicMessages
        };

        if (toolBehavior && this.perplexityDeploymentId) {
            requestBody.tools = this._webSearchTool;
            requestBody.tool_choice = { type: toolBehavior };
        }

        const body = JSON.stringify(requestBody);

        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: 443,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'AI-Resource-Group': this.resourceGroup,
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            const req = https.request(requestOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 400) {
                            console.error('AI Core error response:', data);
                            reject(new Error(`AI Core API error: ${res.statusCode}`));
                            return;
                        }
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Streaming Anthropic invoke. Returns a Promise<stream>.
     * toolBehavior: 'none' must be used when messages contain tool_use blocks
     * (Anthropic requires tool definitions to be present even when forbidding usage).
     */
    async _streamAnthropic(anthropicMessages, systemPrompt, options, toolBehavior = false) {
        const token = await this.getToken();
        const baseUrl = this.credentials.serviceurls.AI_API_URL;
        const url = new URL(`/v2/inference/deployments/${this.deploymentId}/invoke-with-response-stream`, baseUrl);

        const requestBody = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: options.maxTokens || 4096,
            system: systemPrompt || 'You are a helpful AI Assistant.',
            messages: anthropicMessages
        };

        if (toolBehavior && this.perplexityDeploymentId) {
            requestBody.tools = this._webSearchTool;
            requestBody.tool_choice = { type: toolBehavior };
        }

        const body = JSON.stringify(requestBody);

        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: 443,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'AI-Resource-Group': this.resourceGroup,
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            const req = https.request(requestOptions, (res) => {
                if (res.statusCode >= 400) {
                    let errorData = '';
                    res.on('data', chunk => errorData += chunk);
                    res.on('end', () => {
                        console.error('AI Core streaming error:', errorData);
                        reject(new Error(`AI Core API error: ${res.statusCode}`));
                    });
                    return;
                }
                resolve(res);
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Transparent pass-through stream that enables true streaming for text-only responses
     * while intercepting tool use transparently.
     *
     * - Text delta events are forwarded to the output immediately (real streaming).
     * - If a tool_use block is detected, forwarding stops, Perplexity is called,
     *   and the final answer is emitted as a single synthetic event.
     */
    _interceptToolUseStream(inputStream, anthropicMessages, systemPrompt, options) {
        const { PassThrough } = require('stream');
        const output = new PassThrough();

        let lineBuffer = '';
        let hasToolUse = false;
        let contentByIndex = {};
        let accumulatedContent = [];

        const handleEvent = (json) => {
            switch (json.type) {
                case 'content_block_start': {
                    const cb = json.content_block;
                    if (cb?.type === 'tool_use') {
                        hasToolUse = true;
                        const block = { type: 'tool_use', id: cb.id, name: cb.name, input: {}, _partial: '' };
                        contentByIndex[json.index] = block;
                        accumulatedContent.push(block);
                        // Emit indicator immediately when tool use is detected — the query text
                        // isn't known yet (it arrives via input_json_delta) but this ensures the
                        // client shows "Searching the web..." BEFORE yielding to await, giving
                        // React enough time to render it before the final content arrives.
                        if (!output.destroyed) {
                            output.push(`data: ${JSON.stringify({ type: 'web_search_start', queries: [] })}\n\n`);
                        }
                    } else if (cb?.type === 'text') {
                        const block = { type: 'text', text: '' };
                        contentByIndex[json.index] = block;
                        accumulatedContent.push(block);
                    }
                    break;
                }
                case 'content_block_delta': {
                    const block = contentByIndex[json.index];
                    if (!block) break;
                    if (json.delta?.type === 'text_delta') {
                        block.text = (block.text ?? '') + json.delta.text;
                    } else if (json.delta?.type === 'input_json_delta') {
                        block._partial = (block._partial ?? '') + json.delta.partial_json;
                    }
                    break;
                }
                case 'content_block_stop': {
                    const block = contentByIndex[json.index];
                    if (block?._partial !== undefined) {
                        try { block.input = JSON.parse(block._partial); } catch (_) { block.input = {}; }
                        delete block._partial;
                    }
                    break;
                }
            }
        };

        inputStream.on('data', (chunk) => {
            lineBuffer += chunk.toString();
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop() ?? '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const raw = line.slice(6).trim();
                    if (raw && raw !== '[DONE]') {
                        try { handleEvent(JSON.parse(raw)); } catch (_) {}
                    }
                }
                // Forward events to the client immediately — unless tool use has been detected
                if (!hasToolUse && !output.destroyed) {
                    output.push(line + '\n');
                }
            }
        });

        inputStream.on('end', async () => {
            if (!hasToolUse) {
                if (lineBuffer && !output.destroyed) output.push(lineBuffer);
                if (!output.destroyed) output.push(null);
                return;
            }

            // Tool use path: call Perplexity for every web_search block, then get final answer
            try {
                const webSearchBlocks = accumulatedContent.filter(b => b.type === 'tool_use' && b.name === 'web_search');
                if (webSearchBlocks.length === 0) {
                    if (!output.destroyed) output.push(null);
                    return;
                }

                console.log(`Web search triggered (stream, ${webSearchBlocks.length} queries): ${webSearchBlocks.map(b => `"${b.input?.query}"`).join(', ')}`);

                // Signal the client that a web search is in progress
                if (!output.destroyed) {
                    const searchingEvent = JSON.stringify({
                        type: 'web_search_start',
                        queries: webSearchBlocks.map(b => b.input?.query)
                    });
                    output.push(`data: ${searchingEvent}\n\n`);
                }

                const searchResults = await Promise.all(
                    webSearchBlocks.map(b => this.callPerplexity(b.input.query).catch(e => `Search failed: ${e.message}`))
                );

                const toolResults = webSearchBlocks.map((block, i) => ({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: [{ type: 'text', text: searchResults[i] }]
                }));

                // Strip internal fields before sending to API
                const cleanContent = accumulatedContent.map(b =>
                    b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: b.input } : b
                );

                const followUpMessages = [
                    ...anthropicMessages,
                    { role: 'assistant', content: cleanContent },
                    { role: 'user', content: toolResults }
                ];

                const finalJson = await this._invokeAnthropic(followUpMessages, systemPrompt, options, 'none');
                const finalText = finalJson.content?.[0]?.text || '';

                if (!output.destroyed) {
                    const event = JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: finalText } });
                    output.push(`data: ${event}\n\n`);
                    output.push(null);
                }
            } catch (e) {
                if (!output.destroyed) output.destroy(e);
            }
        });

        inputStream.on('error', (e) => { if (!output.destroyed) output.destroy(e); });

        return output;
    }

    /**
     * Get deployment information from AI Core
     */
    async getDeploymentInfo() {
        const token = await this.getToken();
        const baseUrl = this.credentials.serviceurls.AI_API_URL;

        const url = new URL(`/v2/lm/deployments/${this.deploymentId}`, baseUrl);

        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);

            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: 443,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'AI-Resource-Group': this.resourceGroup
                }
            };

            const req = https.request(requestOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 400) {
                            console.error('AI Core deployment info error:', data);
                            reject(new Error(`AI Core API error: ${res.statusCode}`));
                            return;
                        }
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.end();
        });
    }

    /**
     * Non-streaming chat completion.
     * For Anthropic models with Perplexity configured, automatically handles
     * tool use: if Claude requests a web search, Perplexity is called and
     * the result is fed back for the final answer.
     */
    async chat(messages, options = {}) {
        if (this.modelType === 'anthropic') {
            const { systemPrompt, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);

            // Allow callers (e.g. memory service) to opt out of tool use
            const toolBehavior = options.enableTools === false ? false : 'auto';
            const json = await this._invokeAnthropic(anthropicMessages, systemPrompt, options, toolBehavior);

            if (json.stop_reason === 'tool_use') {
                const toolUseBlocks = json.content.filter(b => b.type === 'tool_use' && b.name === 'web_search');
                if (toolUseBlocks.length > 0) {
                    console.log(`Web search triggered (${toolUseBlocks.length} queries): ${toolUseBlocks.map(b => `"${b.input.query}"`).join(', ')}`);

                    // Run all searches in parallel, one result per tool_use block
                    const searchResults = await Promise.all(
                        toolUseBlocks.map(b => this.callPerplexity(b.input.query).catch(e => `Search failed: ${e.message}`))
                    );

                    const toolResults = toolUseBlocks.map((block, i) => ({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: [{ type: 'text', text: searchResults[i] }]
                    }));

                    const followUpMessages = [
                        ...anthropicMessages,
                        { role: 'assistant', content: json.content },
                        { role: 'user', content: toolResults }
                    ];

                    const finalJson = await this._invokeAnthropic(followUpMessages, systemPrompt, options, 'none');
                    return finalJson.content?.[0]?.text || '';
                }
            }

            return json.content?.[0]?.text || '';
        }

        // OpenAI-compatible endpoint
        const token = await this.getToken();
        const baseUrl = this.credentials.serviceurls.AI_API_URL;
        const url = new URL(`/v2/inference/deployments/${this.deploymentId}/chat/completions`, baseUrl);

        const body = JSON.stringify({
            messages: messages,
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature || 0.7,
            stream: false
        });

        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);

            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: 443,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'AI-Resource-Group': this.resourceGroup,
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            const req = https.request(requestOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 400) {
                            console.error('AI Core error response:', data);
                            reject(new Error(`AI Core API error: ${res.statusCode}`));
                            return;
                        }
                        const json = JSON.parse(data);
                        resolve(json.choices?.[0]?.message?.content || '');
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Streaming chat completion.
     * Returns a readable stream that emits SSE events compatible with
     * the parseStreamChunk helper in server.js.
     *
     * For Anthropic models: uses the streaming endpoint directly so text responses
     * appear token-by-token in real time. Tool use is intercepted transparently via
     * _interceptToolUseStream — Perplexity is called and the final answer is emitted
     * as a single event, with no change needed in server.js.
     */
    async chatStream(messages, options = {}) {
        if (this.modelType === 'anthropic') {
            const { systemPrompt, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);

            const toolBehavior = this.perplexityDeploymentId ? 'auto' : false;
            const inputStream = await this._streamAnthropic(anthropicMessages, systemPrompt, options, toolBehavior);
            return this._interceptToolUseStream(inputStream, anthropicMessages, systemPrompt, options);
        }

        // OpenAI-compatible streaming endpoint (unchanged)
        const token = await this.getToken();
        const baseUrl = this.credentials.serviceurls.AI_API_URL;
        const url = new URL(`/v2/inference/deployments/${this.deploymentId}/chat/completions`, baseUrl);

        const body = JSON.stringify({
            messages: messages,
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature || 0.7,
            stream: true
        });

        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);

            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: 443,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'AI-Resource-Group': this.resourceGroup,
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            const req = https.request(requestOptions, (res) => {
                if (res.statusCode >= 400) {
                    let errorData = '';
                    res.on('data', chunk => errorData += chunk);
                    res.on('end', () => {
                        console.error('AI Core streaming error:', errorData);
                        reject(new Error(`AI Core API error: ${res.statusCode}`));
                    });
                    return;
                }

                // Return the response stream directly
                resolve(res);
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }
}

let _sharedClient = null;
function getSharedAiCoreClient() {
    if (!_sharedClient) {
        _sharedClient = new AiCoreClient();
    }
    return _sharedClient;
}

module.exports = { AiCoreClient, getSharedAiCoreClient, truncateMessageContent };
