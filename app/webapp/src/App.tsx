import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Conversation, Message, StreamEvent, FileAttachment } from './types';
import * as api from './api';

// Icons
const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const SendIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const ChatIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const MenuIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const UserIcon = () => (
  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
  </svg>
);

const BotIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" style={{ fill: '#6625D8' }}>
    <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2M7.5 13A2.5 2.5 0 005 15.5 2.5 2.5 0 007.5 18a2.5 2.5 0 002.5-2.5A2.5 2.5 0 007.5 13m9 0a2.5 2.5 0 00-2.5 2.5 2.5 2.5 0 002.5 2.5 2.5 2.5 0 002.5-2.5 2.5 2.5 0 00-2.5-2.5z"/>
  </svg>
);

const CopyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const AttachIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const FileIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const SapLogo = () => (
  <img 
    src="https://www.sap.com/content/dam/application/shared/logos/sap-logo-svg.svg" 
    alt="SAP" 
    className="h-4"
  />
);

// Typing indicator component
const TypingIndicator = () => (
  <div className="typing-indicator">
    <span></span>
    <span></span>
    <span></span>
  </div>
);

// Helper functions for attachments
const isImage = (type: string) => type.startsWith('image/');

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Maximum image size for AI (Claude has 5MB limit)
const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB to be safe

// Compress image if it exceeds the size limit
const compressImage = async (file: File, maxSize: number = MAX_IMAGE_SIZE): Promise<{ data: string; type: string; size: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    img.onload = () => {
      // Calculate new dimensions while maintaining aspect ratio
      let { width, height } = img;
      const maxDimension = 2048; // Max dimension for good quality
      
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = (height / width) * maxDimension;
          width = maxDimension;
        } else {
          width = (width / height) * maxDimension;
          height = maxDimension;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      
      // Try different quality levels to get under the size limit
      const tryCompress = (quality: number): string => {
        return canvas.toDataURL('image/jpeg', quality);
      };
      
      let quality = 0.9;
      let dataUrl = tryCompress(quality);
      let base64 = dataUrl.split(',')[1];
      let size = Math.ceil(base64.length * 0.75); // Approximate decoded size
      
      // Reduce quality until we're under the limit
      while (size > maxSize && quality > 0.1) {
        quality -= 0.1;
        dataUrl = tryCompress(quality);
        base64 = dataUrl.split(',')[1];
        size = Math.ceil(base64.length * 0.75);
      }
      
      // If still too large, reduce dimensions further
      if (size > maxSize) {
        const scale = Math.sqrt(maxSize / size);
        canvas.width = width * scale;
        canvas.height = height * scale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        dataUrl = tryCompress(0.8);
        base64 = dataUrl.split(',')[1];
        size = Math.ceil(base64.length * 0.75);
      }
      
      resolve({
        data: base64,
        type: 'image/jpeg',
        size: size
      });
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    
    // Create object URL from file
    img.src = URL.createObjectURL(file);
  });
};

// Read file as base64, compressing images if needed
const readFileAsBase64WithCompression = async (file: File): Promise<{ data: string; type: string; size: number }> => {
  // For images, check if compression is needed
  if (file.type.startsWith('image/') && file.size > MAX_IMAGE_SIZE) {
    console.log(`Compressing image from ${formatFileSize(file.size)}...`);
    const compressed = await compressImage(file);
    console.log(`Compressed to ${formatFileSize(compressed.size)}`);
    return compressed;
  }
  
  // For small images or non-images, read directly
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve({
        data: base64,
        type: file.type,
        size: file.size
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Attachment display component with lazy loading
const AttachmentDisplay = ({ attachment }: { attachment: FileAttachment }) => {
  const [loading, setLoading] = useState(false);
  const [imageData, setImageData] = useState<string | null>(attachment.data || null);
  
  // Function to download/view the attachment
  const handleAttachmentClick = async () => {
    // If we already have the data (from a just-sent message), use it directly
    if (attachment.data) {
      openOrDownload(attachment.data);
      return;
    }
    
    // Otherwise, fetch the data from the server
    if (!attachment.ID) {
      console.error('No attachment ID to fetch');
      return;
    }
    
    setLoading(true);
    try {
      const data = await api.fetchAttachmentData(attachment.ID);
      openOrDownload(data.data);
    } catch (err) {
      console.error('Failed to fetch attachment:', err);
      alert('Failed to load attachment');
    } finally {
      setLoading(false);
    }
  };
  
  const openOrDownload = (base64Data: string) => {
    // Create a blob from base64 data
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: attachment.type });
    const url = URL.createObjectURL(blob);
    
    // Open in new tab or download
    const link = document.createElement('a');
    link.href = url;
    if (isImage(attachment.type)) {
      // Open images in new tab
      link.target = '_blank';
    } else {
      // Download other files
      link.download = attachment.name;
    }
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up the URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };
  
  // Load image thumbnail if we have data or it's a small image
  useEffect(() => {
    // If we already have data, use it
    if (attachment.data) {
      setImageData(attachment.data);
    }
  }, [attachment.data]);
  
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 bg-dark-700/50 rounded-lg border border-dark-600 cursor-pointer hover:bg-dark-600/50 transition-colors ${loading ? 'opacity-50' : ''}`}
      onClick={handleAttachmentClick}
      title={isImage(attachment.type) ? 'Click to view' : 'Click to download'}
    >
      {isImage(attachment.type) ? (
        imageData ? (
          <img
            src={`data:${attachment.type};base64,${imageData}`}
            alt={attachment.name}
            className="max-w-[200px] max-h-[150px] object-contain rounded"
          />
        ) : (
          <div className="w-[100px] h-[75px] flex items-center justify-center bg-dark-600 rounded">
            <span className="text-xs text-dark-400">📷 {attachment.name}</span>
          </div>
        )
      ) : (
        <>
          <div className="w-8 h-8 flex items-center justify-center bg-dark-600 rounded">
            <FileIcon />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm text-dark-200 truncate max-w-[200px]">{attachment.name}</span>
            <span className="text-xs text-dark-500">{formatFileSize(attachment.size)}</span>
          </div>
        </>
      )}
      {loading && <span className="text-xs text-dark-400">Loading...</span>}
    </div>
  );
};

// Message component
const MessageBubble = ({ message, isStreaming }: { message: Message; isStreaming?: boolean }) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  return (
    <div className={`group flex gap-4 p-6 message-enter ${isUser ? 'bg-dark-800' : 'bg-dark-900'}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-accent-primary' : 'bg-dark-600'
      }`}>
        {isUser ? <UserIcon /> : <BotIcon />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="font-medium text-sm text-dark-300">
            {isUser ? 'You' : 'Not Joule'}
          </div>
          {/* Copy button for AI responses */}
          {!isUser && message.content && !isStreaming && (
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-dark-700 rounded transition-all text-dark-400 hover:text-dark-200"
              title="Copy to clipboard"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          )}
        </div>
        
        {/* Display attachments if present */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {message.attachments.map((attachment, index) => (
              <AttachmentDisplay key={attachment.ID || index} attachment={attachment} />
            ))}
          </div>
        )}
        
        <div className="markdown-content text-dark-100">
          {isStreaming && !message.content ? (
            <TypingIndicator />
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
};

// User profile component
const UserProfile = ({ userInfo }: { userInfo: { name: string; email: string; givenName?: string; familyName?: string } | null }) => {
  if (!userInfo) return null;
  
  // Generate initials from name
  const getInitials = (name: string, givenName?: string, familyName?: string) => {
    if (givenName && familyName) {
      return `${givenName[0]}${familyName[0]}`.toUpperCase();
    }
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };
  
  const initials = getInitials(userInfo.name, userInfo.givenName, userInfo.familyName);
  
  return (
    <div className="flex items-center gap-3 p-3 mx-3 rounded-lg">
      <div className="w-9 h-9 rounded-full bg-dark-600 border border-dark-500 flex items-center justify-center text-sm font-medium text-dark-200">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-dark-200 truncate">{userInfo.name}</div>
      </div>
    </div>
  );
};

// Sidebar component
const Sidebar = ({
  conversations,
  currentConversation,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onGoHome,
  isOpen,
  onClose,
  userInfo,
}: {
  conversations: Conversation[];
  currentConversation: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onGoHome: () => void;
  isOpen: boolean;
  onClose: () => void;
  userInfo: { name: string; email: string; givenName?: string; familyName?: string } | null;
}) => {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50
        w-72 bg-dark-950 flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* App title - clickable to go home */}
        <div 
          className="p-4 border-b border-dark-700 cursor-pointer hover:bg-dark-800 transition-colors"
          onClick={() => {
            onGoHome();
            onClose();
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center">
              <BotIcon />
            </div>
            <h1 className="text-xl font-semibold text-dark-100">SAP Not Joule</h1>
          </div>
        </div>
        
        {/* New chat button */}
        <div className="p-3">
          <button
            onClick={() => {
              onNewConversation();
              onClose();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-dark-600 hover:bg-dark-800 transition-colors"
          >
            <PlusIcon />
            <span>New chat</span>
          </button>
        </div>
        
        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <div className="space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.ID}
                className={`
                  group flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer
                  transition-colors relative
                  ${currentConversation === conv.ID 
                    ? 'bg-dark-700' 
                    : 'hover:bg-dark-800'
                  }
                `}
                onClick={() => {
                  onSelectConversation(conv.ID);
                  onClose();
                }}
              >
                <ChatIcon />
                <span className="flex-1 truncate text-sm">{conv.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conv.ID);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-dark-600 rounded transition-all"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
        
        {/* User profile and footer */}
        <div>
          {/* User profile */}
          <UserProfile userInfo={userInfo} />
          
          {/* Powered by SAP AI Core */}
          <div className="px-3 pb-3 pt-2 border-t border-dark-700">
            <button
              onClick={() => window.open('https://discovery-center.cloud.sap/serviceCatalog/sap-ai-core', '_blank', 'noopener,noreferrer')}
              className="w-full flex items-center justify-center gap-2 text-xs text-dark-500 hover:text-dark-300 transition-colors cursor-pointer"
            >
              <span>Powered by</span>
              <SapLogo />
              <span>AI Core</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

// Chat input component with file attachment support
const ChatInput = ({
  onSend,
  disabled,
  autoFocus,
  focusTrigger,
}: {
  onSend: (message: string, attachments?: FileAttachment[]) => void;
  disabled: boolean;
  autoFocus?: boolean;
  focusTrigger?: number;
}) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Auto-focus when autoFocus prop changes or component mounts
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);
  
  // Focus when focusTrigger changes (after AI response completes)
  useEffect(() => {
    if (focusTrigger && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [focusTrigger]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((input.trim() || attachments.length > 0) && !disabled) {
      onSend(input.trim(), attachments.length > 0 ? attachments : undefined);
      setInput('');
      setAttachments([]);
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };
  
  // Handle paste event for images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    const newAttachments: FileAttachment[] = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Check if it's an image
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Prevent default paste behavior for images
        
        const file = item.getAsFile();
        if (!file) continue;
        
        // Check file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
          alert('Pasted image is too large. Maximum size is 10MB.');
          continue;
        }
        
        // Read file as base64 (with compression for large images)
        const result = await readFileAsBase64WithCompression(file);
        
        // Generate a name for pasted images
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        newAttachments.push({
          name: `pasted-image-${timestamp}.jpg`,
          type: result.type,
          size: result.size,
          data: result.data,
        });
      }
    }
    
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  };
  
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const newAttachments: FileAttachment[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Check file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
        continue;
      }
      
      // Read file as base64 (with compression for large images)
      const result = await readFileAsBase64WithCompression(file);
      
      newAttachments.push({
        name: file.name,
        type: result.type,
        size: result.size,
        data: result.data,
      });
    }
    
    setAttachments((prev) => [...prev, ...newAttachments]);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };
  
  const isImage = (type: string) => type.startsWith('image/');
  
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  
  return (
    <div className="border-t border-dark-700 bg-dark-900 p-4">
      <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map((attachment, index) => (
              <div
                key={index}
                className="relative group flex items-center gap-2 px-3 py-2 bg-dark-700 rounded-lg border border-dark-600"
              >
                {isImage(attachment.type) ? (
                  <img
                    src={`data:${attachment.type};base64,${attachment.data}`}
                    alt={attachment.name}
                    className="w-10 h-10 object-cover rounded"
                  />
                ) : (
                  <div className="w-10 h-10 flex items-center justify-center bg-dark-600 rounded">
                    <FileIcon />
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-dark-200 truncate max-w-[150px]">{attachment.name}</span>
                  <span className="text-xs text-dark-500">{formatFileSize(attachment.size)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  className="absolute -top-2 -right-2 p-1 bg-dark-600 hover:bg-dark-500 rounded-full transition-colors"
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        )}
        
        <div className="relative flex items-end bg-dark-700 rounded-xl border border-dark-600 focus-within:border-dark-500 transition-colors">
          {/* File attachment button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-3 text-dark-400 hover:text-dark-200 transition-colors disabled:opacity-50"
            title="Attach file"
          >
            <AttachIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.java,.c,.cpp,.h,.hpp"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Send a message..."
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent py-3 resize-none focus:outline-none text-dark-100 placeholder-dark-500"
          />
          <button
            type="submit"
            disabled={(!input.trim() && attachments.length === 0) || disabled}
            className={`
              m-2 p-2 rounded-lg transition-all
              ${(input.trim() || attachments.length > 0) && !disabled
                ? 'bg-accent-primary hover:bg-accent-hover text-white'
                : 'bg-dark-600 text-dark-400 cursor-not-allowed'
              }
            `}
          >
            <SendIcon />
          </button>
        </div>
        <p className="text-xs text-dark-500 text-center mt-2">
          AI can make mistakes. Consider checking important information.
        </p>
      </form>
    </div>
  );
};

// Welcome screen component with input and example prompts
const WelcomeScreen = ({ 
  onStartChat, 
  modelInfo 
}: { 
  onStartChat: (message: string, attachments?: FileAttachment[]) => void;
  modelInfo: { model: string; type: string } | null;
}) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Get random prompts once when component mounts
  const [examplePrompts] = useState(() => getRandomPrompts(4));
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() || attachments.length > 0) {
      onStartChat(input.trim(), attachments.length > 0 ? attachments : undefined);
      setInput('');
      setAttachments([]);
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };
  
  // Handle paste event for images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    const newAttachments: FileAttachment[] = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Check if it's an image
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Prevent default paste behavior for images
        
        const file = item.getAsFile();
        if (!file) continue;
        
        // Check file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
          alert('Pasted image is too large. Maximum size is 10MB.');
          continue;
        }
        
        // Read file as base64 (with compression for large images)
        const result = await readFileAsBase64WithCompression(file);
        
        // Generate a name for pasted images
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        newAttachments.push({
          name: `pasted-image-${timestamp}.jpg`,
          type: result.type,
          size: result.size,
          data: result.data,
        });
      }
    }
    
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  };
  
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const newAttachments: FileAttachment[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Check file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
        continue;
      }
      
      // Read file as base64 (with compression for large images)
      const result = await readFileAsBase64WithCompression(file);
      
      newAttachments.push({
        name: file.name,
        type: result.type,
        size: result.size,
        data: result.data,
      });
    }
    
    setAttachments((prev) => [...prev, ...newAttachments]);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };
  
  const isImage = (type: string) => type.startsWith('image/');
  
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-16 h-16 rounded-full bg-[#6625D8]/20 flex items-center justify-center mb-6">
        <BotIcon className="w-10 h-10" />
      </div>
      <h1 className="text-3xl font-semibold mb-2">SAP Not Joule</h1>
      {/* Model info badge */}
      {modelInfo && (
        <div className="mb-4 px-3 py-1 bg-dark-800/50 rounded-full border border-dark-700">
          <span className="text-xs text-dark-400">{modelInfo.model}</span>
        </div>
      )}
      <p className="text-dark-400 text-center max-w-md mb-8">
        How can I help you today?
      </p>
      
      {/* Input box with attachment support */}
      <form onSubmit={handleSubmit} className="w-full max-w-2xl mb-8">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map((attachment, index) => (
              <div
                key={index}
                className="relative group flex items-center gap-2 px-3 py-2 bg-dark-700 rounded-lg border border-dark-600"
              >
                {isImage(attachment.type) ? (
                  <img
                    src={`data:${attachment.type};base64,${attachment.data}`}
                    alt={attachment.name}
                    className="w-10 h-10 object-cover rounded"
                  />
                ) : (
                  <div className="w-10 h-10 flex items-center justify-center bg-dark-600 rounded">
                    <FileIcon />
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-dark-200 truncate max-w-[150px]">{attachment.name}</span>
                  <span className="text-xs text-dark-500">{formatFileSize(attachment.size)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  className="absolute -top-2 -right-2 p-1 bg-dark-600 hover:bg-dark-500 rounded-full transition-colors"
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        )}
        
        <div className="relative flex items-end bg-dark-700 rounded-xl border border-dark-600 focus-within:border-dark-500 transition-colors">
          {/* File attachment button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-3 text-dark-400 hover:text-dark-200 transition-colors"
            title="Attach file"
          >
            <AttachIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.java,.c,.cpp,.h,.hpp"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Send a message..."
            rows={1}
            className="flex-1 bg-transparent py-3 resize-none focus:outline-none text-dark-100 placeholder-dark-500"
          />
          <button
            type="submit"
            disabled={!input.trim() && attachments.length === 0}
            className={`
              m-2 p-2 rounded-lg transition-all
              ${(input.trim() || attachments.length > 0)
                ? 'bg-accent-primary hover:bg-accent-hover text-white'
                : 'bg-dark-600 text-dark-400 cursor-not-allowed'
              }
            `}
          >
            <SendIcon />
          </button>
        </div>
      </form>
      
      {/* Example prompts grid - dynamically selected */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl w-full">
        {examplePrompts.map((item, index) => (
          <PromptTile
            key={index}
            title={item.title}
            prompt={item.prompt}
            icon={item.icon}
            onClick={() => onStartChat(item.prompt)}
          />
        ))}
      </div>
    </div>
  );
};

// All available example prompts - randomly selected on each page load
const ALL_EXAMPLE_PROMPTS = [
  // Explain concepts
  { title: "Explain a concept", prompt: "Explain quantum computing in simple terms", icon: "💡" },
  { title: "Explain a concept", prompt: "What is machine learning and how does it work?", icon: "💡" },
  { title: "Explain a concept", prompt: "Explain the difference between REST and GraphQL APIs", icon: "💡" },
  { title: "Explain a concept", prompt: "What is blockchain technology and why is it important?", icon: "💡" },
  { title: "Explain a concept", prompt: "Explain microservices architecture vs monolithic", icon: "💡" },
  
  // Write code
  { title: "Write code", prompt: "Write a Python function to calculate the Fibonacci sequence", icon: "💻" },
  { title: "Write code", prompt: "Create a JavaScript function to debounce API calls", icon: "💻" },
  { title: "Write code", prompt: "Write a SQL query to find duplicate records in a table", icon: "💻" },
  { title: "Write code", prompt: "Create a React hook for handling form validation", icon: "💻" },
  { title: "Write code", prompt: "Write a TypeScript function to deep clone an object", icon: "💻" },
  
  // Analyze & advise
  { title: "Analyze data", prompt: "What are the best practices for data visualization?", icon: "📊" },
  { title: "Best practices", prompt: "What are the security best practices for web applications?", icon: "🔒" },
  { title: "Compare options", prompt: "Compare PostgreSQL vs MongoDB for a new project", icon: "⚖️" },
  { title: "Debug help", prompt: "How do I debug memory leaks in a Node.js application?", icon: "🔍" },
  { title: "Architecture", prompt: "Design a scalable notification system architecture", icon: "🏗️" },
  
  // Creative & writing
  { title: "Creative writing", prompt: "Write a short story about a robot learning to paint", icon: "✍️" },
  { title: "Write content", prompt: "Write a professional email to request a project deadline extension", icon: "📧" },
  { title: "Summarize", prompt: "Summarize the key principles of clean code", icon: "📝" },
  { title: "Generate ideas", prompt: "Brainstorm 5 innovative features for a productivity app", icon: "💭" },
  { title: "Documentation", prompt: "Write API documentation for a user authentication endpoint", icon: "📄" },
];

// Function to get random prompts
const getRandomPrompts = (count: number = 4) => {
  const shuffled = [...ALL_EXAMPLE_PROMPTS].sort(() => Math.random() - 0.5);
  // Ensure we get diverse categories by picking from different title groups
  const categories = new Set<string>();
  const selected: typeof ALL_EXAMPLE_PROMPTS = [];
  
  for (const prompt of shuffled) {
    if (!categories.has(prompt.title) && selected.length < count) {
      categories.add(prompt.title);
      selected.push(prompt);
    }
  }
  
  // If we don't have enough diverse prompts, fill with remaining
  if (selected.length < count) {
    for (const prompt of shuffled) {
      if (!selected.includes(prompt) && selected.length < count) {
        selected.push(prompt);
      }
    }
  }
  
  return selected;
};

// Prompt tile component
const PromptTile = ({ 
  title, 
  prompt, 
  icon, 
  onClick 
}: { 
  title: string; 
  prompt: string; 
  icon: string; 
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="flex flex-col items-start gap-2 p-4 bg-dark-800 hover:bg-dark-700 rounded-xl border border-dark-600 transition-colors text-left"
  >
    <span className="text-2xl">{icon}</span>
    <span className="font-medium text-dark-100">{title}</span>
    <span className="text-sm text-dark-400 line-clamp-2">{prompt}</span>
  </button>
);

// Main App component
export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<{ model: string; type: string } | null>(null);
  const [userInfo, setUserInfo] = useState<{ name: string; email: string; givenName?: string; familyName?: string } | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);
  
  // Load conversations on mount and auto-create if none exist
  useEffect(() => {
    loadConversationsAndInit();
    loadModelInfo();
    loadUserInfo();
  }, []);
  
  const loadModelInfo = async () => {
    try {
      const info = await api.fetchModelInfo();
      setModelInfo(info);
    } catch (err) {
      console.error('Failed to load model info:', err);
    }
  };
  
  const loadUserInfo = async () => {
    try {
      const info = await api.fetchUserInfo();
      setUserInfo(info);
    } catch (err) {
      console.error('Failed to load user info:', err);
    }
  };
  
  const loadConversationsAndInit = async () => {
    try {
      const convs = await api.fetchConversations();
      setConversations(convs);
      // Don't auto-select a conversation - show welcome screen instead
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError('Failed to load conversations');
    }
  };
  
  const loadConversations = async () => {
    try {
      const convs = await api.fetchConversations();
      setConversations(convs);
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError('Failed to load conversations');
    }
  };
  
  const loadConversation = async (id: string) => {
    try {
      setIsLoading(true);
      const conv = await api.fetchConversation(id);
      setMessages(conv.messages || []);
      setCurrentConversationId(id);
    } catch (err) {
      console.error('Failed to load conversation:', err);
      setError('Failed to load conversation');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleNewConversation = async () => {
    try {
      const conv = await api.createConversation();
      setConversations((prev) => [conv, ...prev]);
      setCurrentConversationId(conv.ID);
      setMessages([]);
    } catch (err) {
      console.error('Failed to create conversation:', err);
      setError('Failed to create conversation');
    }
  };
  
  const handleDeleteConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.ID !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
      setError('Failed to delete conversation');
    }
  };
  
  // Start a new chat from the welcome screen - creates conversation and sends first message
  const handleStartChat = async (content: string, attachments?: FileAttachment[]) => {
    try {
      // Create a new conversation
      const conv = await api.createConversation();
      setConversations((prev) => [conv, ...prev]);
      setCurrentConversationId(conv.ID);
      setMessages([]);
      
      // Now send the first message
      // We need to wait a tick for the state to update, then send
      setTimeout(() => {
        sendMessageToConversation(conv.ID, content, attachments);
      }, 0);
    } catch (err) {
      console.error('Failed to start chat:', err);
      setError('Failed to start chat');
    }
  };
  
  // Send message to a specific conversation (used by handleStartChat)
  const sendMessageToConversation = async (conversationId: string, content: string, attachments?: FileAttachment[]) => {
    if (isStreaming) return;
    
    // Add user message immediately
    const userMessageId = `temp-${Date.now()}`;
    const userMessage: Message = {
      ID: userMessageId,
      role: 'user',
      content,
      attachments,
    };
    setMessages((prev) => [...prev, userMessage]);
    
    // Add placeholder for assistant message
    const assistantMessageId = `temp-assistant-${Date.now()}`;
    const assistantMessage: Message = {
      ID: assistantMessageId,
      role: 'assistant',
      content: '',
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsStreaming(true);
    setError(null);
    
    // Track the current assistant message ID (may be updated by assistant_start event)
    let currentAssistantId = assistantMessageId;
    
    try {
      // Try WebSocket first, falls back to SSE automatically
      // Pass attachments to the API call
      await api.sendMessageStreamWS(conversationId, content, (event: StreamEvent) => {
        switch (event.type) {
          case 'user_message':
            // Update user message ID
            setMessages((prev) =>
              prev.map((m) =>
                m.ID === userMessageId ? { ...m, ID: event.id! } : m
              )
            );
            break;
          case 'assistant_start':
            // Update assistant message ID and track it
            if (event.id) {
              const oldId = currentAssistantId;
              currentAssistantId = event.id;
              setMessages((prev) =>
                prev.map((m) =>
                  m.ID === oldId ? { ...m, ID: event.id! } : m
                )
              );
            }
            break;
          case 'content':
            // Append content to the last assistant message
            setMessages((prev) => {
              const newMessages = prev.map((m, i) => {
                // Update the last assistant message
                if (i === prev.length - 1 && m.role === 'assistant') {
                  return {
                    ...m,
                    content: m.content + (event.content || '')
                  };
                }
                return m;
              });
              return newMessages;
            });
            break;
          case 'done':
            setIsStreaming(false);
            setFocusTrigger(prev => prev + 1);
            // Refresh conversations to update title
            loadConversations();
            break;
          case 'error':
            setError(event.message || 'An error occurred');
            setIsStreaming(false);
            setFocusTrigger(prev => prev + 1);
            break;
        }
      }, attachments);
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setIsStreaming(false);
      setFocusTrigger(prev => prev + 1);
      // Remove the placeholder messages on error
      setMessages((prev) =>
        prev.filter((m) => m.ID !== userMessageId && m.ID !== currentAssistantId)
      );
    }
  };
  
  const handleSendMessage = async (content: string, attachments?: FileAttachment[]) => {
    if (!currentConversationId || isStreaming) return;
    
    // Add user message immediately
    const userMessageId = `temp-${Date.now()}`;
    const userMessage: Message = {
      ID: userMessageId,
      role: 'user',
      content,
      attachments,
    };
    setMessages((prev) => [...prev, userMessage]);
    
    // Add placeholder for assistant message
    const assistantMessageId = `temp-assistant-${Date.now()}`;
    const assistantMessage: Message = {
      ID: assistantMessageId,
      role: 'assistant',
      content: '',
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsStreaming(true);
    setError(null);
    
    // Track the current assistant message ID (may be updated by assistant_start event)
    let currentAssistantId = assistantMessageId;
    
    try {
      // Try WebSocket first, falls back to SSE automatically
      // Pass attachments to the API call
      await api.sendMessageStreamWS(currentConversationId, content, (event: StreamEvent) => {
        switch (event.type) {
          case 'user_message':
            // Update user message ID
            setMessages((prev) =>
              prev.map((m) =>
                m.ID === userMessageId ? { ...m, ID: event.id! } : m
              )
            );
            break;
          case 'assistant_start':
            // Update assistant message ID and track it
            if (event.id) {
              const oldId = currentAssistantId;
              currentAssistantId = event.id;
              setMessages((prev) =>
                prev.map((m) =>
                  m.ID === oldId ? { ...m, ID: event.id! } : m
                )
              );
            }
            break;
          case 'content':
            // Append content to the last assistant message
            setMessages((prev) => {
              const newMessages = prev.map((m, i) => {
                // Update the last assistant message
                if (i === prev.length - 1 && m.role === 'assistant') {
                  return {
                    ...m,
                    content: m.content + (event.content || '')
                  };
                }
                return m;
              });
              return newMessages;
            });
            break;
          case 'done':
            setIsStreaming(false);
            setFocusTrigger(prev => prev + 1);
            // Refresh conversations to update title
            loadConversations();
            break;
          case 'error':
            setError(event.message || 'An error occurred');
            setIsStreaming(false);
            setFocusTrigger(prev => prev + 1);
            break;
        }
      }, attachments);
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setIsStreaming(false);
      setFocusTrigger(prev => prev + 1);
      // Remove the placeholder messages on error
      setMessages((prev) =>
        prev.filter((m) => m.ID !== userMessageId && m.ID !== currentAssistantId)
      );
    }
  };
  
  return (
    <div className="h-screen flex bg-dark-900 text-dark-100">
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        currentConversation={currentConversationId}
        onSelectConversation={loadConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onGoHome={() => {
          setCurrentConversationId(null);
          setMessages([]);
        }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userInfo={userInfo}
      />
      
      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile menu button */}
        <div className="md:hidden absolute top-4 left-4 z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
          >
            <MenuIcon />
          </button>
        </div>
        
        {/* Messages or welcome screen */}
        {currentConversationId ? (
          <>
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <TypingIndicator />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex-1" />
              ) : (
                <div>
                  {messages.map((message, index) => (
                    <MessageBubble
                      key={message.ID}
                      message={message}
                      isStreaming={isStreaming && index === messages.length - 1 && message.role === 'assistant'}
                    />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
            
            {/* Error message */}
            {error && (
              <div className="px-4 py-2 bg-red-900/50 text-red-200 text-sm text-center">
                {error}
              </div>
            )}
            
            {/* Chat input - auto-focus when conversation is selected or AI response completes */}
            <ChatInput onSend={(msg, attachments) => handleSendMessage(msg, attachments)} disabled={isStreaming} autoFocus={!!currentConversationId} focusTrigger={focusTrigger} />
          </>
        ) : (
          <WelcomeScreen onStartChat={handleStartChat} modelInfo={modelInfo} />
        )}
      </main>
    </div>
  );
}