import { Conversation, Message, StreamEvent, FileAttachment } from './types';

const API_BASE = '';

// User info
export interface UserInfo {
  id: string;
  name: string;
  email: string;
  givenName?: string;
  familyName?: string;
}

// Model info
export interface ModelInfo {
  model: string;
  type: string;
  deploymentId: string;
}

export async function fetchModelInfo(): Promise<ModelInfo> {
  const response = await fetch('/api/model');
  if (!response.ok) {
    throw new Error('Failed to fetch model info');
  }
  return response.json();
}

/**
 * Fetch current user info from the approuter
 */
export async function fetchUserInfo(): Promise<UserInfo> {
  const response = await fetch('/user-api/currentUser');
  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }
  const data = await response.json();
  return {
    id: data.name || data.email || 'Unknown',
    name: data.firstname && data.lastname 
      ? `${data.firstname} ${data.lastname}` 
      : data.name || data.email || 'Unknown User',
    email: data.email || '',
    givenName: data.firstname,
    familyName: data.lastname,
  };
}

// CSRF token cache
let csrfToken: string | null = null;

// WebSocket connection
let ws: WebSocket | null = null;
let wsMessageHandler: ((event: StreamEvent) => void) | null = null;
let wsResolve: (() => void) | null = null;
let wsReject: ((error: Error) => void) | null = null;

/**
 * Fetch CSRF token from the server
 */
async function fetchCsrfToken(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }
  
  const response = await fetch(`${API_BASE}/odata/v4/chat/`, {
    method: 'HEAD',
    headers: {
      'X-CSRF-Token': 'Fetch',
    },
  });
  
  const token = response.headers.get('X-CSRF-Token');
  if (token) {
    csrfToken = token;
    return token;
  }
  
  throw new Error('Failed to fetch CSRF token');
}

/**
 * Clear cached CSRF token (call on 403 errors to retry)
 */
function clearCsrfToken(): void {
  csrfToken = null;
}


/**
 * Initialize WebSocket connection
 */
async function initWebSocket(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  }
  
  // Close existing connection if any
  if (ws) {
    ws.close();
    ws = null;
  }
  
  return new Promise((resolve, reject) => {
    // Construct WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Connect directly to the backend service for WebSocket (bypassing approuter)
    const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      resolve(ws!);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      reject(new Error('WebSocket connection failed'));
    };
    
    ws.onclose = () => {
      ws = null;
    };
    
    ws.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);
        
        if (data.type === 'connected') {
          // WebSocket authenticated
        } else if (data.type === 'error') {
          console.error('WebSocket error:', data.message);
          if (wsReject) {
            wsReject(new Error(data.message || 'WebSocket error'));
            wsReject = null;
            wsResolve = null;
          }
        } else if (data.type === 'done') {
          if (wsMessageHandler) {
            wsMessageHandler(data);
          }
          if (wsResolve) {
            wsResolve();
            wsResolve = null;
            wsReject = null;
          }
        } else if (wsMessageHandler) {
          wsMessageHandler(data);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
  });
}

/**
 * Fetch all conversations for the current user
 */
export async function fetchConversations(): Promise<Conversation[]> {
  const response = await fetch(`${API_BASE}/odata/v4/chat/Conversations?$orderby=modifiedAt desc`);
  if (!response.ok) {
    throw new Error('Failed to fetch conversations');
  }
  const data = await response.json();
  return data.value || [];
}

/**
 * Fetch a single conversation with its messages
 */
export async function fetchConversation(id: string): Promise<Conversation & { messages: Message[] }> {
  const response = await fetch(
    `${API_BASE}/odata/v4/chat/Conversations(${id})?$expand=messages($orderby=createdAt asc)`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch conversation');
  }
  return response.json();
}

/**
 * Create a new conversation
 */
export async function createConversation(title?: string): Promise<Conversation> {
  const token = await fetchCsrfToken();
  
  const response = await fetch(`${API_BASE}/odata/v4/chat/createConversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    body: JSON.stringify({ title: title || 'New Conversation' }),
  });
  
  if (response.status === 403) {
    // Token might be expired, clear and retry once
    clearCsrfToken();
    const newToken = await fetchCsrfToken();
    const retryResponse = await fetch(`${API_BASE}/odata/v4/chat/createConversation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      body: JSON.stringify({ title: title || 'New Conversation' }),
    });
    if (!retryResponse.ok) {
      throw new Error('Failed to create conversation');
    }
    return retryResponse.json();
  }
  
  if (!response.ok) {
    throw new Error('Failed to create conversation');
  }
  return response.json();
}

/**
 * Delete a conversation
 */
export async function deleteConversation(id: string): Promise<void> {
  const token = await fetchCsrfToken();
  
  const response = await fetch(`${API_BASE}/odata/v4/chat/deleteConversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    body: JSON.stringify({ conversationId: id }),
  });
  
  if (response.status === 403) {
    clearCsrfToken();
    const newToken = await fetchCsrfToken();
    const retryResponse = await fetch(`${API_BASE}/odata/v4/chat/deleteConversation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      body: JSON.stringify({ conversationId: id }),
    });
    if (!retryResponse.ok) {
      throw new Error('Failed to delete conversation');
    }
    return;
  }
  
  if (!response.ok) {
    throw new Error('Failed to delete conversation');
  }
}

/**
 * Send a message with streaming response via WebSocket
 */
export async function sendMessageStreamWS(
  conversationId: string,
  content: string,
  onEvent: (event: StreamEvent) => void,
  attachments?: FileAttachment[]
): Promise<void> {
  try {
    const socket = await initWebSocket();
    
    wsMessageHandler = onEvent;
    
    return new Promise((resolve, reject) => {
      wsResolve = resolve;
      wsReject = reject;
      
      // Send chat message with optional attachments
      socket.send(JSON.stringify({
        type: 'chat',
        conversationId,
        content,
        attachments
      }));
    });
  } catch (error) {
    console.error('WebSocket streaming failed, falling back to SSE:', error);
    // Fall back to SSE if WebSocket fails
    return sendMessageStream(conversationId, content, onEvent, attachments);
  }
}

/**
 * Send a message with streaming response via SSE (fallback)
 */
export async function sendMessageStream(
  conversationId: string,
  content: string,
  onEvent: (event: StreamEvent) => void,
  attachments?: FileAttachment[]
): Promise<void> {
  const token = await fetchCsrfToken();
  
  let response = await fetch(`${API_BASE}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    body: JSON.stringify({ conversationId, content, attachments }),
  });
  
  if (response.status === 403) {
    clearCsrfToken();
    const newToken = await fetchCsrfToken();
    response = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      body: JSON.stringify({ conversationId, content, attachments }),
    });
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

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
        const data = line.slice(6).trim();
        if (data) {
          try {
            const event: StreamEvent = JSON.parse(data);
            onEvent(event);
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }
}

/**
 * Send a message without streaming (fallback)
 */
export async function sendMessage(conversationId: string, content: string): Promise<Message> {
  const token = await fetchCsrfToken();
  
  const response = await fetch(`${API_BASE}/odata/v4/chat/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    body: JSON.stringify({ conversationId, content }),
  });
  
  if (response.status === 403) {
    clearCsrfToken();
    const newToken = await fetchCsrfToken();
    const retryResponse = await fetch(`${API_BASE}/odata/v4/chat/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      body: JSON.stringify({ conversationId, content }),
    });
    if (!retryResponse.ok) {
      throw new Error('Failed to send message');
    }
    return retryResponse.json();
  }
  
  if (!response.ok) {
    throw new Error('Failed to send message');
  }
  return response.json();
}

/**
 * Fetch attachment data on demand (base64 content)
 */
export async function fetchAttachmentData(attachmentId: string): Promise<{ ID: string; name: string; type: string; size: number; data: string }> {
  const response = await fetch(`${API_BASE}/api/attachment/${attachmentId}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch attachment');
  }
  
  return response.json();
}
