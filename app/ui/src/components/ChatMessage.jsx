import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAttachment } from '../services/api';
import { ChatbotLogo } from './ChatbotLogo';

/**
 * Attachment item component - handles click to view/download
 * Supports both old field names (name, type) and new @cap-js/attachments field names (filename, mimeType)
 */
function AttachmentItem({ attachment }) {
  const [loading, setLoading] = useState(false);
  // Support both old and new field names
  const attachmentName = attachment.name || attachment.filename || 'attachment';
  const attachmentType = attachment.type || attachment.mimeType || 'application/octet-stream';
  const isImage = attachmentType?.startsWith('image/');
  
  /**
   * Safely open an image in a new tab using DOM APIs (avoids XSS via document.write).
   */
  const openImageInNewTab = (src, alt) => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.title = alt;
    const style = win.document.createElement('style');
    style.textContent = 'body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a1a;}';
    win.document.head.appendChild(style);
    const img = win.document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100vh';
    win.document.body.appendChild(img);
  };

  const handleClick = async () => {
    // If we already have the data (from a just-sent message), use it directly
    if (attachment.preview || attachment.data) {
      if (isImage) {
        openImageInNewTab(attachment.preview || attachment.data, attachmentName);
      } else {
        downloadFile(attachment.preview || attachment.data, attachmentName, attachmentType);
      }
      return;
    }

    // Otherwise, fetch from server
    if (!attachment.ID) {
      console.error('No attachment ID available');
      return;
    }

    setLoading(true);
    try {
      const data = await getAttachment(attachment.ID);
      if (data && data.data) {
        if (isImage) {
          openImageInNewTab(data.data, data.name);
        } else {
          downloadFile(data.data, data.name, data.type);
        }
      }
    } catch (error) {
      console.error('Failed to fetch attachment:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const downloadFile = (dataUrl, filename, mimeType) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  return (
    <div className="relative group">
      {isImage ? (
        <div 
          className="cursor-pointer relative"
          onClick={handleClick}
        >
          {(attachment.preview || attachment.data) ? (
            <img
              src={attachment.preview || attachment.data}
              alt={attachmentName}
              className="max-w-[200px] max-h-[200px] rounded-lg border border-dark-600 object-cover hover:opacity-90 transition-opacity"
            />
          ) : (
            <div className="w-[100px] h-[100px] rounded-lg border border-dark-600 bg-dark-700 flex items-center justify-center hover:bg-dark-600 transition-colors">
              {loading ? (
                <svg className="w-6 h-6 text-dark-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-8 h-8 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 transition-opacity rounded-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
        </div>
      ) : (
        <button
          onClick={handleClick}
          disabled={loading}
          className="flex items-center gap-2 bg-dark-700 rounded-lg p-3 border border-dark-600 hover:bg-dark-600 transition-colors cursor-pointer"
        >
          {loading ? (
            <svg className="w-5 h-5 text-dark-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="w-5 h-5 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
          <span className="text-sm text-dark-200">{attachmentName}</span>
          <svg className="w-4 h-4 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * Chat message component with markdown support
 */
export function ChatMessage({ message }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isStreaming = message.isStreaming;
  const isError = message.isError;

  const handleCopyMessage = async () => {
    if (message.content) {
      try {
        await navigator.clipboard.writeText(message.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  };

  return (
    <div
      className={`
        py-6 px-4 md:px-8 message-enter group/message
        ${isUser ? 'bg-dark-900' : 'bg-dark-800'}
      `}
    >
      <div className="max-w-3xl mx-auto flex gap-4 md:gap-6">
        {/* Avatar */}
        <div
          className={`
            w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center
            ${isUser ? 'bg-accent-primary' : 'bg-dark-700'}
          `}
        >
          {isUser ? (
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          ) : (
            <ChatbotLogo className="w-5 h-5 text-accent-primary" />
          )}
        </div>

        {/* Message content */}
        <div className="flex-1 min-w-0 relative">
          <div className="flex items-center justify-between">
            <div className="font-medium text-sm text-dark-300 mb-1">
              {isUser ? 'You' : 'Not Joule'}
            </div>
            
            {/* Copy button for assistant messages - top right */}
            {!isUser && message.content && !isStreaming && (
              <button
                onClick={handleCopyMessage}
                className="p-1.5 rounded text-dark-400 hover:text-dark-200 hover:bg-dark-700 transition-all opacity-0 group-hover/message:opacity-100"
                title={copied ? 'Copied!' : 'Copy response'}
              >
                {copied ? (
                  <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            )}
          </div>
          
          {/* Attachments display */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {message.attachments.map((attachment, index) => (
                <AttachmentItem key={attachment.ID || index} attachment={attachment} />
              ))}
            </div>
          )}
          
          <div
            className={`
              markdown-content text-dark-100
              ${isError ? 'text-red-400' : ''}
            `}
          >
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Custom table rendering
                  table({ children }) {
                    return (
                      <div className="overflow-x-auto my-4">
                        <table className="min-w-full border-collapse border border-dark-600 rounded-lg overflow-hidden">
                          {children}
                        </table>
                      </div>
                    );
                  },
                  thead({ children }) {
                    return <thead className="bg-dark-700">{children}</thead>;
                  },
                  tbody({ children }) {
                    return <tbody className="divide-y divide-dark-600">{children}</tbody>;
                  },
                  tr({ children }) {
                    return <tr className="hover:bg-dark-700/50 transition-colors">{children}</tr>;
                  },
                  th({ children }) {
                    return (
                      <th className="px-4 py-3 text-left text-sm font-semibold text-dark-200 border-b border-dark-600">
                        {children}
                      </th>
                    );
                  },
                  td({ children }) {
                    return (
                      <td className="px-4 py-3 text-sm text-dark-100 border-b border-dark-700">
                        {children}
                      </td>
                    );
                  },
                  // Custom code block rendering
                  code({ node, inline, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline ? (
                      <div className="relative group">
                        {match && (
                          <div className="absolute top-0 right-0 px-2 py-1 text-xs text-dark-400 bg-dark-700 rounded-bl">
                            {match[1]}
                          </div>
                        )}
                        <pre className={className}>
                          <code {...props}>{children}</code>
                        </pre>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(String(children));
                          }}
                          className="absolute top-2 right-2 p-1.5 rounded bg-dark-700 text-dark-400 
                                     opacity-0 group-hover:opacity-100 transition-opacity
                                     hover:text-white hover:bg-dark-600"
                          title="Copy code"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            ) : isStreaming ? (
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" />
                <span className="w-2 h-2 bg-accent-primary rounded-full animate-pulse delay-75" />
                <span className="w-2 h-2 bg-accent-primary rounded-full animate-pulse delay-150" />
              </span>
            ) : null}
            
            {/* Streaming cursor */}
            {isStreaming && message.content && (
              <span className="typing-cursor inline-block w-2 h-5 bg-accent-primary ml-0.5 align-middle" />
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default ChatMessage;