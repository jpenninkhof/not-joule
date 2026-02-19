import { useState, useCallback, useRef, useEffect } from 'react';
import { streamMessage, createConversation, getConversation } from '../services/api';

/**
 * Custom hook for managing chat state and streaming
 * Uses WebSocket as primary method, SSE as fallback
 */
export function useChat() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  // Increments only on successful stream completion — used to trigger sidebar refresh
  const [streamCompletedAt, setStreamCompletedAt] = useState(null);
  const wsRef = useRef(null);
  const abortRef = useRef(null);
  const pendingMessageRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  /**
   * Get WebSocket URL
   */
  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/chat`;
  }, []);

  /**
   * Connect to WebSocket
   */
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(getWsUrl());
      
      ws.onopen = () => {
        console.log('WebSocket connected');
        setWsConnected(true);
        
        // If there's a pending message, send it now
        if (pendingMessageRef.current) {
          const { conversationId, content, attachments } = pendingMessageRef.current;
          ws.send(JSON.stringify({
            type: 'chat',
            conversationId,
            content,
            attachments
          }));
          pendingMessageRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWsMessage(data);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setWsConnected(false);
        wsRef.current = null;

        if (event.code === 1008) {
          // Policy violation — server rejected the connection due to auth failure
          window.dispatchEvent(new CustomEvent('session-expired'));
        } else if (event.code !== 1000) {
          // Unexpected close — probe auth before deciding whether to reconnect
          fetch('/api/health').then((res) => {
            if (res.status === 401) {
              window.dispatchEvent(new CustomEvent('session-expired'));
            } else {
              reconnectTimeoutRef.current = setTimeout(() => {
                connectWebSocket();
              }, 3000);
            }
          }).catch(() => {
            // Network error — still attempt reconnect
            reconnectTimeoutRef.current = setTimeout(() => {
              connectWebSocket();
            }, 3000);
          });
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      setWsConnected(false);
    }
  }, [getWsUrl]);

  /**
   * Handle WebSocket messages
   */
  const handleWsMessage = useCallback((data) => {
    switch (data.type) {
      case 'connected':
        console.log('WebSocket authenticated as:', data.userId);
        break;
        
      case 'user_message':
        // Update user message with real ID
        setMessages((prev) => {
          const updated = [...prev];
          const userMsgIndex = updated.findIndex(m => m.ID?.startsWith('temp-user-'));
          if (userMsgIndex !== -1) {
            updated[userMsgIndex] = {
              ...updated[userMsgIndex],
              ID: data.id
            };
          }
          return updated;
        });
        break;
        
      case 'assistant_start':
        // Update assistant message placeholder with real ID
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex]?.role === 'assistant') {
            updated[lastIndex] = {
              ...updated[lastIndex],
              ID: data.id
            };
          }
          return updated;
        });
        break;
        
      case 'web_search_start':
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex]?.role === 'assistant') {
            updated[lastIndex] = {
              ...updated[lastIndex],
              isSearching: true,
              searchQueries: data.queries,
            };
          }
          return updated;
        });
        break;

      case 'content':
        // Append content and clear any searching indicator
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex]?.role === 'assistant') {
            updated[lastIndex] = {
              ...updated[lastIndex],
              content: updated[lastIndex].content + data.content,
              isSearching: false,
            };
          }
          return updated;
        });
        break;
        
      case 'done':
        // Mark streaming as complete
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex]?.role === 'assistant') {
            updated[lastIndex] = {
              ...updated[lastIndex],
              isStreaming: false
            };
          }
          return updated;
        });
        setIsStreaming(false);
        setStreamCompletedAt(Date.now());
        break;
        
      case 'error':
        setError(data.message);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex]?.role === 'assistant') {
            updated[lastIndex] = {
              ...updated[lastIndex],
              content: updated[lastIndex].content || 'Sorry, an error occurred. Please try again.',
              isStreaming: false,
              isError: true
            };
          }
          return updated;
        });
        setIsStreaming(false);
        break;
        
      case 'pong':
        // Heartbeat response
        break;
        
      default:
        console.warn('Unhandled WebSocket message type:', data.type);
    }
  }, []);

  /**
   * Initialize WebSocket connection on mount
   */
  useEffect(() => {
    connectWebSocket();
    
    // Set up heartbeat
    const heartbeatInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
    
    return () => {
      clearInterval(heartbeatInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
      }
    };
  }, [connectWebSocket]);

  /**
   * Load messages for a conversation
   */
  const loadConversation = useCallback(async (conversationId) => {
    if (!conversationId) {
      setMessages([]);
      setCurrentConversationId(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const conversation = await getConversation(conversationId);
      setMessages(conversation.messages || []);
      setCurrentConversationId(conversationId);
    } catch (err) {
      setError(err.message);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Start a new conversation
   */
  const startNewConversation = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const conversation = await createConversation('New Chat');
      setCurrentConversationId(conversation.ID);
      setMessages([]);
      return conversation;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Send a message via WebSocket (with SSE fallback)
   */
  const sendMessage = useCallback(async (content, attachments = [], overrideConversationId = null) => {
    if ((!content.trim() && attachments.length === 0) || isStreaming) return;

    let conversationId = overrideConversationId || currentConversationId;

    // Create new conversation if needed
    if (!conversationId) {
      try {
        const conversation = await startNewConversation();
        conversationId = conversation.ID;
      } catch {
        return;
      }
    }

    setError(null);
    setIsStreaming(true);

    // Prepare attachments for sending
    const attachmentData = attachments.map(a => ({
      name: a.name,
      type: a.type,
      data: a.data
    }));

    // Add user message immediately
    const userMessage = {
      ID: `temp-user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      attachments: attachments.map(a => ({
        name: a.name,
        type: a.type,
        preview: a.preview
      })),
      createdAt: new Date().toISOString(),
    };

    // Add placeholder for assistant message
    const assistantMessage = {
      ID: `temp-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    // Try WebSocket first, fall back to SSE
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Send via WebSocket
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        conversationId,
        content: content.trim(),
        attachments: attachmentData
      }));
    } else if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      // WebSocket is connecting, queue the message
      pendingMessageRef.current = { conversationId, content: content.trim(), attachments: attachmentData };
    } else {
      // Fall back to SSE streaming
      console.log('WebSocket not available, using SSE fallback');
      abortRef.current = streamMessage(
        conversationId,
        content.trim(),
        attachmentData,
        // On chunk
        (chunk) => {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            if (updated[lastIndex]?.role === 'assistant') {
              updated[lastIndex] = {
                ...updated[lastIndex],
                content: updated[lastIndex].content + chunk,
                isSearching: false,
              };
            }
            return updated;
          });
        },
        // On complete - receives the message ID, not content (content was already streamed)
        (messageId) => {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            if (updated[lastIndex]?.role === 'assistant') {
              updated[lastIndex] = {
                ...updated[lastIndex],
                ID: messageId,
                isStreaming: false,
              };
            }
            return updated;
          });
          setIsStreaming(false);
          setStreamCompletedAt(Date.now());
        },
        // On error
        (err) => {
          setError(err.message);
          setMessages((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            if (updated[lastIndex]?.role === 'assistant') {
              updated[lastIndex] = {
                ...updated[lastIndex],
                content: 'Sorry, an error occurred. Please try again.',
                isStreaming: false,
                isError: true,
              };
            }
            return updated;
          });
          setIsStreaming(false);
        },
        // On event (e.g. web_search_start)
        (event) => {
          if (event.type === 'web_search_start') {
            setMessages((prev) => {
              const updated = [...prev];
              const lastIndex = updated.length - 1;
              if (updated[lastIndex]?.role === 'assistant') {
                updated[lastIndex] = {
                  ...updated[lastIndex],
                  isSearching: true,
                  searchQueries: event.queries,
                };
              }
              return updated;
            });
          }
        }
      );
    }
  }, [currentConversationId, isStreaming, startNewConversation]);

  /**
   * Stop streaming
   */
  const stopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    // For WebSocket, we can't really stop the stream, but we can mark it as stopped
    setIsStreaming(false);
    setMessages((prev) => {
      const updated = [...prev];
      const lastIndex = updated.length - 1;
      if (updated[lastIndex]?.role === 'assistant' && updated[lastIndex]?.isStreaming) {
        updated[lastIndex] = {
          ...updated[lastIndex],
          isStreaming: false,
        };
      }
      return updated;
    });
  }, []);

  /**
   * Clear current conversation
   */
  const clearConversation = useCallback(() => {
    setMessages([]);
    setCurrentConversationId(null);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    isStreaming,
    error,
    currentConversationId,
    wsConnected,
    streamCompletedAt,
    sendMessage,
    loadConversation,
    startNewConversation,
    stopStreaming,
    clearConversation,
    setCurrentConversationId,
  };
}