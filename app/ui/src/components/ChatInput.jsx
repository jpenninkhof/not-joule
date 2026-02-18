import React, { useState, useRef, useEffect, useCallback } from 'react';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGE_DIMENSION = 1920; // Max width/height for images

/**
 * Compress an image file to be under the size limit
 */
async function compressImage(file, maxSize = MAX_FILE_SIZE) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    img.onload = () => {
      let { width, height } = img;
      
      // Scale down if too large
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        if (width > height) {
          height = (height / width) * MAX_IMAGE_DIMENSION;
          width = MAX_IMAGE_DIMENSION;
        } else {
          width = (width / height) * MAX_IMAGE_DIMENSION;
          height = MAX_IMAGE_DIMENSION;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      // Try different quality levels
      let quality = 0.9;
      const tryCompress = () => {
        canvas.toBlob(
          (blob) => {
            if (blob.size <= maxSize || quality <= 0.1) {
              resolve(new File([blob], file.name, { type: 'image/jpeg' }));
            } else {
              quality -= 0.1;
              tryCompress();
            }
          },
          'image/jpeg',
          quality
        );
      };
      tryCompress();
    };
    
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Convert file to base64
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Chat input component with auto-resize textarea and attachment support
 */
export function ChatInput({ onSend, isStreaming, onStop, disabled, hideBorder = false }) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [message]);

  // Track previous streaming state to detect when streaming completes
  const wasStreamingRef = useRef(isStreaming);
  
  // Auto-focus input when streaming completes
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      // Streaming just completed, focus the input
      textareaRef.current?.focus();
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Process and add files
  const processFiles = useCallback(async (files) => {
    setIsProcessing(true);
    const newAttachments = [];
    
    for (const file of files) {
      try {
        let processedFile = file;
        
        // Compress images if needed
        if (file.type.startsWith('image/')) {
          if (file.size > MAX_FILE_SIZE) {
            processedFile = await compressImage(file);
          }
        } else if (file.size > MAX_FILE_SIZE) {
          alert(`File "${file.name}" is too large (max 5MB)`);
          continue;
        }
        
        const base64 = await fileToBase64(processedFile);
        newAttachments.push({
          id: Date.now() + Math.random(),
          name: file.name,
          type: file.type,
          size: processedFile.size,
          data: base64,
          preview: file.type.startsWith('image/') ? base64 : null
        });
      } catch (err) {
        console.error('Error processing file:', err);
        alert(`Failed to process "${file.name}"`);
      }
    }
    
    setAttachments(prev => [...prev, ...newAttachments]);
    setIsProcessing(false);
  }, []);

  // Handle paste event
  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    
    if (files.length > 0) {
      e.preventDefault();
      await processFiles(files);
    }
  }, [processFiles]);

  // Handle file input change
  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await processFiles(files);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove attachment
  const removeAttachment = (id) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if ((message.trim() || attachments.length > 0) && !isStreaming && !disabled && !isProcessing) {
      onSend(message, attachments);
      setMessage('');
      setAttachments([]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className={`${hideBorder ? '' : 'border-t border-dark-700'} bg-dark-900 p-4`}>
      <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 p-2 bg-dark-800 rounded-lg border border-dark-600">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="relative group flex items-center gap-2 bg-dark-700 rounded-lg p-2 pr-8"
              >
                {attachment.preview ? (
                  <img
                    src={attachment.preview}
                    alt={attachment.name}
                    className="w-12 h-12 object-cover rounded"
                  />
                ) : (
                  <div className="w-12 h-12 bg-dark-600 rounded flex items-center justify-center">
                    <svg className="w-6 h-6 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-dark-200 truncate max-w-[120px]">{attachment.name}</span>
                  <span className="text-xs text-dark-500">{(attachment.size / 1024).toFixed(1)} KB</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="absolute top-1 right-1 p-1 rounded-full bg-dark-600 text-dark-400 
                             hover:bg-red-600 hover:text-white transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        
        <div className="relative flex items-end gap-3 bg-dark-800 rounded-xl border border-dark-600 focus-within:border-dark-500 transition-colors">
          {/* Attachment button */}
          <div className="flex items-center pl-3 pb-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv,.xml"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isProcessing}
              className="p-2 rounded-lg text-dark-400 hover:text-dark-200 hover:bg-dark-700 
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Attach files"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
          </div>
          
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={attachments.length > 0 ? "Add a message or send attachments..." : "Send a message..."}
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent text-dark-100 placeholder-dark-500 
                       resize-none py-4 px-2 focus:outline-none
                       max-h-[200px] overflow-y-auto"
          />
          
          <div className="flex items-center gap-2 pr-3 pb-3">
            {isProcessing && (
              <div className="p-2">
                <svg className="w-5 h-5 text-dark-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            )}
            
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="p-2 rounded-lg bg-red-600 hover:bg-red-700 
                           text-white transition-colors"
                title="Stop generating"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={(!message.trim() && attachments.length === 0) || disabled || isProcessing}
                className={`
                  p-2 rounded-lg transition-colors
                  ${(message.trim() || attachments.length > 0) && !disabled && !isProcessing
                    ? 'bg-accent-primary hover:bg-accent-hover text-white'
                    : 'bg-dark-700 text-dark-500 cursor-not-allowed'
                  }
                `}
                title="Send message"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
        
        <p className="text-xs text-dark-500 text-center mt-3">
          AI can make mistakes. Consider checking important information.
        </p>
      </form>
    </div>
  );
}

export default ChatInput;