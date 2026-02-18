/**
 * API Service for Chat Application
 */

const ODATA_BASE = '/odata/v4/chat';
const API_BASE = '/api';

/**
 * Fetch wrapper with error handling
 */
async function fetchAPI(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error?.message || error.message || error.error || 'Request failed');
  }

  return response.json();
}

/**
 * Get all conversations for the current user
 */
export async function getConversations() {
  const data = await fetchAPI(`${ODATA_BASE}/Conversations?$orderby=modifiedAt desc`);
  return data.value || [];
}

/**
 * Get a single conversation with messages and attachments
 */
export async function getConversation(id) {
  const data = await fetchAPI(`${ODATA_BASE}/Conversations(${id})?$expand=messages($orderby=createdAt asc;$expand=attachments)`);
  return data;
}

/**
 * Create a new conversation
 */
export async function createConversation(title = 'New Chat') {
  const data = await fetchAPI(`${API_BASE}/conversation`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return data;
}

/**
 * Delete a conversation
 */
export async function deleteConversation(id) {
  await fetchAPI(`${API_BASE}/conversation/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Send a message (non-streaming)
 */
export async function sendMessage(conversationId, content) {
  const data = await fetchAPI(`${ODATA_BASE}/sendMessage`, {
    method: 'POST',
    body: JSON.stringify({ conversationId, content }),
  });
  return data;
}

/**
 * Stream a message response
 * @param {string} conversationId - The conversation ID
 * @param {string} message - The user message
 * @param {function} onChunk - Callback for each chunk received
 * @param {function} onComplete - Callback when streaming is complete
 * @param {function} onError - Callback for errors
 */
export function streamMessage(conversationId, message, onChunk, onComplete, onError) {
  const controller = new AbortController();
  
  fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ conversationId, content: message }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Stream failed' }));
        throw new Error(error.error || 'Stream failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'content') {
                onChunk(data.content);
              } else if (data.type === 'done') {
                onComplete(data.id);
              } else if (data.type === 'error') {
                onError(new Error(data.message));
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    })
    .catch((error) => {
      if (error.name !== 'AbortError') {
        onError(error);
      }
    });

  // Return abort function
  return () => controller.abort();
}

/**
 * Get user info (for display purposes)
 */
export async function getUserInfo() {
  try {
    const response = await fetch(`${API_BASE}/userinfo`);
    if (response.ok) {
      return await response.json();
    }
    return { id: 'user', name: 'User' };
  } catch {
    return { id: 'anonymous', name: 'Anonymous' };
  }
}

/**
 * Get attachment data by ID
 */
export async function getAttachment(attachmentId) {
  const data = await fetchAPI(`${API_BASE}/attachment/${attachmentId}`);
  return data;
}
