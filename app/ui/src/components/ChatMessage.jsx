import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAttachment } from '../services/api';

/**
 * Attachment item component - handles click to view/download
 */
function AttachmentItem({ attachment }) {
  const [loading, setLoading] = useState(false);
  const isImage = attachment.type?.startsWith('image/');
  
  const handleClick = async () => {
    // If we already have the data (from a just-sent message), use it directly
    if (attachment.preview || attachment.data) {
      if (isImage) {
        // Open image in new tab
        const win = window.open();
        win.document.write(`
          <html>
            <head><title>${attachment.name}</title></head>
            <body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a1a;">
              <img src="${attachment.preview || attachment.data}" alt="${attachment.name}" style="max-width:100%;max-height:100vh;"/>
            </body>
          </html>
        `);
      } else {
        // Download file
        downloadFile(attachment.preview || attachment.data, attachment.name, attachment.type);
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
          // Open image in new tab
          const win = window.open();
          win.document.write(`
            <html>
              <head><title>${data.name}</title></head>
              <body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a1a;">
                <img src="${data.data}" alt="${data.name}" style="max-width:100%;max-height:100vh;"/>
              </body>
            </html>
          `);
        } else {
          // Download file
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
              alt={attachment.name}
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
          <span className="text-sm text-dark-200">{attachment.name}</span>
          <svg className="w-4 h-4 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}
    </div>
  );
}

// Chatbot SVG Logo Component (same as in App.jsx)
const ChatbotLogo = ({ className }) => (
  <svg className={className} viewBox="0 0 502 516" fill="currentColor">
    <path d="M 337.0 510.2 C 334.2 509.2, 326.8 511.7, 320.0 504.2 C 313.2 496.7, 301.5 472.8, 296.0 465.0 C 290.5 457.2, 313.7 463.9, 287.0 457.6 C 260.3 451.3, 175.2 437.0, 136.0 427.1 C 96.8 417.2, 71.3 407.6, 52.0 398.2 C 32.7 388.9, 27.9 382.2, 20.2 371.0 C 12.5 359.8, 8.2 344.3, 5.8 331.0 C 3.3 317.7, 4.3 302.5, 5.6 291.0 C 7.0 279.5, 9.1 271.2, 13.8 262.0 C 18.4 252.8, 25.8 242.9, 33.7 236.0 C 41.5 229.1, 54.0 230.0, 61.0 220.5 C 68.0 211.0, 69.9 190.6, 75.7 179.0 C 81.6 167.4, 88.8 157.9, 96.0 150.6 C 103.2 143.3, 109.3 139.6, 119.0 135.0 C 128.7 130.4, 132.7 126.6, 154.0 123.0 C 175.3 119.3, 231.0 119.2, 247.0 113.0 C 263.0 106.7, 252.5 93.0, 250.0 85.3 C 247.5 77.7, 236.0 73.9, 231.9 67.0 C 227.9 60.1, 225.0 52.2, 225.8 44.0 C 226.6 35.8, 230.6 24.5, 236.6 18.0 C 242.6 11.5, 254.8 6.7, 262.0 4.8 C 269.2 2.9, 274.8 5.2, 280.0 6.7 C 285.2 8.2, 289.1 10.5, 293.0 13.7 C 296.9 16.9, 300.6 21.1, 303.2 26.0 C 305.8 30.9, 308.9 35.6, 308.3 43.0 C 307.8 50.4, 305.5 63.0, 300.0 70.5 C 294.5 78.0, 279.5 80.6, 275.2 88.0 C 270.9 95.4, 265.2 108.4, 274.0 114.6 C 282.8 120.8, 311.0 120.6, 328.0 125.0 C 345.0 129.3, 361.8 134.5, 376.0 140.8 C 390.2 147.1, 403.8 154.8, 413.0 162.7 C 422.2 170.6, 426.7 178.8, 431.3 188.0 C 435.8 197.2, 438.7 207.0, 440.2 218.0 C 441.8 229.0, 444.4 243.8, 440.4 254.0 C 436.4 264.2, 421.1 270.5, 416.3 279.0 C 411.5 287.5, 411.3 300.6, 411.6 305.0 C 411.9 309.4, 413.1 309.4, 418.0 305.4 C 422.9 301.4, 434.0 285.6, 441.0 281.0 C 448.0 276.4, 453.2 276.3, 460.0 277.8 C 466.8 279.2, 476.3 283.0, 482.0 289.7 C 487.7 296.4, 492.2 304.4, 494.2 318.0 C 496.3 331.6, 495.1 357.5, 494.2 371.0 C 493.3 384.5, 490.9 392.0, 488.7 399.0 C 486.6 406.0, 488.4 406.7, 481.3 413.0 C 474.1 419.3, 464.0 429.4, 446.0 437.1 C 428.0 444.8, 389.2 448.2, 373.0 459.0 C 356.9 469.8, 355.3 493.5, 349.3 502.0 C 343.3 510.5, 339.1 508.8, 337.0 510.2 C 334.9 511.6, 339.8 511.2, 337.0 510.2 Z M 321.5 364.0 C 327.4 362.3, 348.7 359.3, 357.0 354.0 C 365.2 348.7, 367.7 348.8, 371.1 332.0 C 374.5 315.2, 377.5 271.3, 377.3 253.0 C 377.2 234.7, 373.9 230.8, 370.3 222.0 C 366.7 213.2, 365.9 207.1, 356.0 200.4 C 346.1 193.7, 332.3 186.6, 311.0 181.9 C 289.7 177.3, 255.0 173.7, 228.0 172.5 C 201.0 171.3, 165.3 173.2, 149.0 174.7 C 132.7 176.2, 136.2 177.8, 130.0 181.3 C 123.8 184.9, 117.5 188.2, 111.7 196.0 C 105.9 203.8, 99.3 214.8, 95.3 228.0 C 91.2 241.2, 88.1 261.7, 87.5 275.0 C 86.9 288.3, 87.8 298.6, 91.5 308.0 C 95.3 317.4, 102.6 325.2, 110.0 331.2 C 117.4 337.2, 125.3 340.3, 136.0 344.0 C 146.7 347.7, 150.0 349.8, 174.0 353.2 C 198.0 356.6, 255.4 362.6, 280.0 364.4 C 304.6 366.2, 314.6 364.1, 321.5 364.0 C 328.4 363.9, 315.6 365.7, 321.5 364.0 Z M 310.0 305.1 C 305.3 305.0, 287.9 305.5, 282.0 304.1 C 276.1 302.8, 275.4 307.5, 274.5 297.0 C 273.6 286.5, 275.2 251.9, 276.7 241.0 C 278.1 230.1, 279.1 232.6, 283.0 231.3 C 286.9 230.0, 296.5 229.2, 300.1 233.0 C 303.8 236.8, 301.7 249.2, 304.7 254.0 C 307.6 258.8, 315.8 254.8, 317.8 262.0 C 319.9 269.2, 318.5 289.8, 317.1 297.0 C 315.8 304.2, 311.2 303.8, 310.0 305.1 C 308.8 306.5, 314.7 305.3, 310.0 305.1 Z M 179.0 302.1 C 174.5 302.0, 157.8 302.5, 152.0 301.1 C 146.2 299.8, 145.3 304.7, 144.5 294.0 C 143.6 283.3, 145.2 248.0, 146.8 237.0 C 148.4 226.0, 150.1 229.1, 154.0 228.0 C 157.9 226.8, 166.8 226.3, 170.1 230.0 C 173.5 233.7, 171.1 245.2, 174.1 250.0 C 177.0 254.8, 185.6 251.8, 187.8 259.0 C 190.0 266.2, 188.7 285.8, 187.2 293.0 C 185.7 300.2, 180.4 300.6, 179.0 302.1 C 177.6 303.7, 183.5 302.3, 179.0 302.1 Z" fillRule="evenodd"/>
  </svg>
);

/**
 * Chat message component with markdown support
 */
export function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  const isStreaming = message.isStreaming;
  const isError = message.isError;

  return (
    <div
      className={`
        py-6 px-4 md:px-8 message-enter
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
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-dark-300 mb-1">
            {isUser ? 'You' : 'Not Joule'}
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