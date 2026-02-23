/**
 * API Service for Chat Application
 */

const ODATA_BASE = '/odata/v4/chat';
const API_BASE = '/api';
const csrfTokenCache = new Map();

function fireSessionExpired() {
  window.dispatchEvent(new CustomEvent('session-expired'));
}

async function getCsrfToken(url) {
  const scope = url.startsWith('/odata/') ? 'odata' : 'api';
  if (csrfTokenCache.has(scope)) {
    return csrfTokenCache.get(scope);
  }

  const fetchUrl = scope === 'odata' ? `${ODATA_BASE}/$metadata` : `${API_BASE}/health`;
  const response = await fetch(fetchUrl, {
    method: 'GET',
    headers: {
      'x-csrf-token': 'fetch',
    },
  });

  if (response.status === 401) {
    fireSessionExpired();
    throw new Error('Session expired');
  }

  const token = response.headers.get('x-csrf-token') || '';
  if (token) {
    csrfTokenCache.set(scope, token);
  }
  return token;
}

/**
 * Fetch wrapper with error handling
 */
async function fetchAPI(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  let csrfToken = '';

  if (needsCsrf) {
    csrfToken = await getCsrfToken(url);
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401) {
    fireSessionExpired();
    throw new Error('Session expired');
  }

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
 * Rename a conversation
 */
export async function renameConversation(id, title) {
  await fetchAPI(`${API_BASE}/conversation/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
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
 * @param {Array} attachments - File attachments to include
 * @param {function} onChunk - Callback for each chunk received
 * @param {function} onComplete - Callback when streaming is complete
 * @param {function} onError - Callback for errors
 * @param {function} [onEvent] - Callback for non-content events (e.g. web_search_start)
 */
export function streamMessage(conversationId, message, attachments, onChunk, onComplete, onError, onEvent) {
  const controller = new AbortController();

  getCsrfToken(`${API_BASE}/chat/stream`)
    .then((csrfToken) => fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: JSON.stringify({ conversationId, content: message, attachments: attachments || [] }),
      signal: controller.signal,
    }))
    .then(async (response) => {
      if (response.status === 401) {
        fireSessionExpired();
        throw new Error('Session expired');
      }

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
              } else if (onEvent) {
                onEvent(data);
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

/**
 * Get all memories for the current user
 */
export async function getMemories() {
  const data = await fetchAPI(`${API_BASE}/memories`);
  return data.memories || [];
}

/**
 * Delete a specific memory by ID
 */
export async function deleteMemory(id) {
  await fetchAPI(`${API_BASE}/memories/${id}`, { method: 'DELETE' });
}

/**
 * Clear all memories for the current user
 */
export async function clearMemories() {
  await fetchAPI(`${API_BASE}/memories`, { method: 'DELETE' });
}
