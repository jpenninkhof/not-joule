const https = require('https');
const http = require('http');

/**
 * AI Core Client
 * Handles communication with SAP AI Core for chat completions
 * Supports both streaming and non-streaming responses
 * Supports both OpenAI and Anthropic models
 */
class AiCoreClient {
    constructor() {
        this.deploymentId = process.env.AICORE_DEPLOYMENT_ID || 'd76331514e34ae4c';
        this.resourceGroup = process.env.AICORE_RESOURCE_GROUP || 'default';
        // Model type: 'anthropic' or 'openai' - detect from deployment or set explicitly
        this.modelType = process.env.AICORE_MODEL_TYPE || 'anthropic';
        
        // Load credentials from environment or service binding
        this.credentials = this.loadCredentials();
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
                return defaultEnv.VCAP_SERVICES?.aicore?.[0]?.credentials;
            }
        } catch (e) {
            console.error('Error loading default-env.json:', e);
        }
        
        return null;
    }
    
    /**
     * Get OAuth token from XSUAA
     */
    async getToken() {
        if (!this.credentials) {
            throw new Error('AI Core credentials not configured');
        }
        
        const tokenUrl = new URL('/oauth/token', this.credentials.url);
        const auth = Buffer.from(`${this.credentials.clientid}:${this.credentials.clientsecret}`).toString('base64');
        
        return new Promise((resolve, reject) => {
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
        });
    }
    
    /**
     * Convert OpenAI-style messages to Anthropic format
     * Supports file attachments (images) in the content
     */
    convertToAnthropicFormat(messages) {
        // Extract system message if present
        let systemPrompt = '';
        const anthropicMessages = [];
        
        for (const msg of messages) {
            if (msg.role === 'system') {
                systemPrompt = msg.content;
            } else {
                // Check if message has attachments
                if (msg.attachments && msg.attachments.length > 0) {
                    // Build content array with text and images
                    const contentParts = [];
                    
                    // Add attachments first
                    for (const attachment of msg.attachments) {
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
                            contentParts.push({
                                type: 'text',
                                text: `[File: ${attachment.name}]\n\`\`\`\n${fileContent}\n\`\`\``
                            });
                        }
                    }
                    
                    // Add text content if present
                    if (msg.content) {
                        contentParts.push({
                            type: 'text',
                            text: msg.content
                        });
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
                }
            }
        }
        
        return { systemPrompt, messages: anthropicMessages };
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
     * Non-streaming chat completion
     */
    async chat(messages, options = {}) {
        const token = await this.getToken();
        const baseUrl = this.credentials.serviceurls.AI_API_URL;
        
        let url, body;
        
        if (this.modelType === 'anthropic') {
            // Use Anthropic invoke endpoint
            url = new URL(`/v2/inference/deployments/${this.deploymentId}/invoke`, baseUrl);
            
            const { systemPrompt, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);
            
            body = JSON.stringify({
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: options.maxTokens || 4096,
                system: systemPrompt || "You are a helpful AI Assistant.",
                messages: anthropicMessages
            });
        } else {
            // Use OpenAI-compatible endpoint
            url = new URL(`/v2/inference/deployments/${this.deploymentId}/chat/completions`, baseUrl);
            
            body = JSON.stringify({
                messages: messages,
                max_tokens: options.maxTokens || 4096,
                temperature: options.temperature || 0.7,
                stream: false
            });
        }
        
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
                        
                        // Handle different response formats
                        let content;
                        if (this.modelType === 'anthropic') {
                            // Anthropic response format
                            content = json.content?.[0]?.text || '';
                        } else {
                            // OpenAI response format
                            content = json.choices?.[0]?.message?.content || '';
                        }
                        resolve(content);
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
     * Streaming chat completion
     * Returns a readable stream that emits SSE events
     */
    async chatStream(messages, options = {}) {
        const token = await this.getToken();
        const baseUrl = this.credentials.serviceurls.AI_API_URL;
        
        let url, body;
        
        if (this.modelType === 'anthropic') {
            // Use Anthropic invoke-with-response-stream endpoint
            url = new URL(`/v2/inference/deployments/${this.deploymentId}/invoke-with-response-stream`, baseUrl);
            
            const { systemPrompt, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);
            
            body = JSON.stringify({
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: options.maxTokens || 4096,
                system: systemPrompt || "You are a helpful AI Assistant.",
                messages: anthropicMessages
            });
        } else {
            // Use OpenAI-compatible endpoint
            url = new URL(`/v2/inference/deployments/${this.deploymentId}/chat/completions`, baseUrl);
            
            body = JSON.stringify({
                messages: messages,
                max_tokens: options.maxTokens || 4096,
                temperature: options.temperature || 0.7,
                stream: true
            });
        }
        
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

module.exports = { AiCoreClient };