import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { useChat } from './hooks/useChat';
import { getConversations, deleteConversation, createConversation } from './services/api';

// Chatbot SVG Logo Component
const ChatbotLogo = ({ className }) => (
  <svg className={className} viewBox="0 0 502 516" fill="currentColor">
    <path d="M 337.0 510.2 C 334.2 509.2, 326.8 511.7, 320.0 504.2 C 313.2 496.7, 301.5 472.8, 296.0 465.0 C 290.5 457.2, 313.7 463.9, 287.0 457.6 C 260.3 451.3, 175.2 437.0, 136.0 427.1 C 96.8 417.2, 71.3 407.6, 52.0 398.2 C 32.7 388.9, 27.9 382.2, 20.2 371.0 C 12.5 359.8, 8.2 344.3, 5.8 331.0 C 3.3 317.7, 4.3 302.5, 5.6 291.0 C 7.0 279.5, 9.1 271.2, 13.8 262.0 C 18.4 252.8, 25.8 242.9, 33.7 236.0 C 41.5 229.1, 54.0 230.0, 61.0 220.5 C 68.0 211.0, 69.9 190.6, 75.7 179.0 C 81.6 167.4, 88.8 157.9, 96.0 150.6 C 103.2 143.3, 109.3 139.6, 119.0 135.0 C 128.7 130.4, 132.7 126.6, 154.0 123.0 C 175.3 119.3, 231.0 119.2, 247.0 113.0 C 263.0 106.7, 252.5 93.0, 250.0 85.3 C 247.5 77.7, 236.0 73.9, 231.9 67.0 C 227.9 60.1, 225.0 52.2, 225.8 44.0 C 226.6 35.8, 230.6 24.5, 236.6 18.0 C 242.6 11.5, 254.8 6.7, 262.0 4.8 C 269.2 2.9, 274.8 5.2, 280.0 6.7 C 285.2 8.2, 289.1 10.5, 293.0 13.7 C 296.9 16.9, 300.6 21.1, 303.2 26.0 C 305.8 30.9, 308.9 35.6, 308.3 43.0 C 307.8 50.4, 305.5 63.0, 300.0 70.5 C 294.5 78.0, 279.5 80.6, 275.2 88.0 C 270.9 95.4, 265.2 108.4, 274.0 114.6 C 282.8 120.8, 311.0 120.6, 328.0 125.0 C 345.0 129.3, 361.8 134.5, 376.0 140.8 C 390.2 147.1, 403.8 154.8, 413.0 162.7 C 422.2 170.6, 426.7 178.8, 431.3 188.0 C 435.8 197.2, 438.7 207.0, 440.2 218.0 C 441.8 229.0, 444.4 243.8, 440.4 254.0 C 436.4 264.2, 421.1 270.5, 416.3 279.0 C 411.5 287.5, 411.3 300.6, 411.6 305.0 C 411.9 309.4, 413.1 309.4, 418.0 305.4 C 422.9 301.4, 434.0 285.6, 441.0 281.0 C 448.0 276.4, 453.2 276.3, 460.0 277.8 C 466.8 279.2, 476.3 283.0, 482.0 289.7 C 487.7 296.4, 492.2 304.4, 494.2 318.0 C 496.3 331.6, 495.1 357.5, 494.2 371.0 C 493.3 384.5, 490.9 392.0, 488.7 399.0 C 486.6 406.0, 488.4 406.7, 481.3 413.0 C 474.1 419.3, 464.0 429.4, 446.0 437.1 C 428.0 444.8, 389.2 448.2, 373.0 459.0 C 356.9 469.8, 355.3 493.5, 349.3 502.0 C 343.3 510.5, 339.1 508.8, 337.0 510.2 C 334.9 511.6, 339.8 511.2, 337.0 510.2 Z M 321.5 364.0 C 327.4 362.3, 348.7 359.3, 357.0 354.0 C 365.2 348.7, 367.7 348.8, 371.1 332.0 C 374.5 315.2, 377.5 271.3, 377.3 253.0 C 377.2 234.7, 373.9 230.8, 370.3 222.0 C 366.7 213.2, 365.9 207.1, 356.0 200.4 C 346.1 193.7, 332.3 186.6, 311.0 181.9 C 289.7 177.3, 255.0 173.7, 228.0 172.5 C 201.0 171.3, 165.3 173.2, 149.0 174.7 C 132.7 176.2, 136.2 177.8, 130.0 181.3 C 123.8 184.9, 117.5 188.2, 111.7 196.0 C 105.9 203.8, 99.3 214.8, 95.3 228.0 C 91.2 241.2, 88.1 261.7, 87.5 275.0 C 86.9 288.3, 87.8 298.6, 91.5 308.0 C 95.3 317.4, 102.6 325.2, 110.0 331.2 C 117.4 337.2, 125.3 340.3, 136.0 344.0 C 146.7 347.7, 150.0 349.8, 174.0 353.2 C 198.0 356.6, 255.4 362.6, 280.0 364.4 C 304.6 366.2, 314.6 364.1, 321.5 364.0 C 328.4 363.9, 315.6 365.7, 321.5 364.0 Z M 310.0 305.1 C 305.3 305.0, 287.9 305.5, 282.0 304.1 C 276.1 302.8, 275.4 307.5, 274.5 297.0 C 273.6 286.5, 275.2 251.9, 276.7 241.0 C 278.1 230.1, 279.1 232.6, 283.0 231.3 C 286.9 230.0, 296.5 229.2, 300.1 233.0 C 303.8 236.8, 301.7 249.2, 304.7 254.0 C 307.6 258.8, 315.8 254.8, 317.8 262.0 C 319.9 269.2, 318.5 289.8, 317.1 297.0 C 315.8 304.2, 311.2 303.8, 310.0 305.1 C 308.8 306.5, 314.7 305.3, 310.0 305.1 Z M 179.0 302.1 C 174.5 302.0, 157.8 302.5, 152.0 301.1 C 146.2 299.8, 145.3 304.7, 144.5 294.0 C 143.6 283.3, 145.2 248.0, 146.8 237.0 C 148.4 226.0, 150.1 229.1, 154.0 228.0 C 157.9 226.8, 166.8 226.3, 170.1 230.0 C 173.5 233.7, 171.1 245.2, 174.1 250.0 C 177.0 254.8, 185.6 251.8, 187.8 259.0 C 190.0 266.2, 188.7 285.8, 187.2 293.0 C 185.7 300.2, 180.4 300.6, 179.0 302.1 C 177.6 303.7, 183.5 302.3, 179.0 302.1 Z" fillRule="evenodd"/>
  </svg>
);

/**
 * Main App Component
 */
function App() {
  const [conversations, setConversations] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [user, setUser] = useState(null);
  const [modelName, setModelName] = useState('Unknown model');
  const messagesEndRef = useRef(null);

  const {
    messages,
    isLoading,
    isStreaming,
    error,
    currentConversationId,
    sendMessage,
    loadConversation,
    startNewConversation,
    stopStreaming,
    clearConversation,
    setCurrentConversationId,
  } = useChat();

  // Load conversations and user info on mount
  useEffect(() => {
    loadConversationsList();
    loadUserInfo();
    loadModelInfo();
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Refresh conversations list after sending a message
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      loadConversationsList();
    }
  }, [isStreaming]);

  const loadConversationsList = async () => {
    try {
      const convs = await getConversations();
      setConversations(convs);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoadingConversations(false);
    }
  };

  const loadUserInfo = async () => {
    try {
      const response = await fetch('/api/userinfo');
      if (response.ok) {
        const userInfo = await response.json();
        setUser({
          id: userInfo.id || userInfo.email || userInfo.sub,
          name: userInfo.name || userInfo.given_name || userInfo.email || 'User',
          email: userInfo.email
        });
      }
    } catch (err) {
      console.log('Could not load user info, using default');
      setUser({ id: 'user', name: 'User' });
    }
  };

  const loadModelInfo = async () => {
    try {
      const response = await fetch('/api/model');
      if (response.ok) {
        const modelInfo = await response.json();
        setModelName(modelInfo.model || 'Unknown model');
      }
    } catch (err) {
      console.log('Could not load model info');
      setModelName('Unknown model');
    }
  };

  const handleSelectConversation = async (id) => {
    await loadConversation(id);
    setSidebarOpen(false);
  };

  const handleNewConversation = async () => {
    try {
      const conv = await createConversation('New Conversation');
      await loadConversationsList();
      if (conv && conv.ID) {
        await loadConversation(conv.ID);
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
      // Fallback to just clearing the current conversation
      clearConversation();
    }
    setSidebarOpen(false);
  };

  const handleDeleteConversation = async (id) => {
    try {
      await deleteConversation(id);
      if (currentConversationId === id) {
        clearConversation();
      }
      await loadConversationsList();
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const handleNavigateHome = () => {
    clearConversation();
    setSidebarOpen(false);
  };

  const handleExampleClick = async (text) => {
    // Create a new conversation and send the example message
    try {
      const conv = await createConversation('New Conversation');
      await loadConversationsList();
      if (conv && conv.ID) {
        await loadConversation(conv.ID);
        // Send the example message after a short delay to ensure conversation is loaded
        setTimeout(() => {
          sendMessage(text);
        }, 100);
      }
    } catch (err) {
      console.error('Failed to start conversation with example:', err);
    }
  };

  return (
    <div className="h-screen flex bg-dark-900">
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onNavigateHome={handleNavigateHome}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        ChatbotLogo={ChatbotLogo}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header - Mobile menu button only */}
        <header className="flex items-center gap-4 px-4 py-3 border-b border-dark-700 bg-dark-900 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-dark-800 text-dark-400 hover:text-white transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <span className="text-lg font-semibold text-dark-100">SAP Not Joule</span>
        </header>

        {/* Messages area */}
        {messages.length === 0 ? (
          <div className="flex-1 overflow-y-auto flex flex-col">
            <WelcomeScreen 
              onExampleClick={handleExampleClick} 
              ChatbotLogo={ChatbotLogo}
              modelName={modelName}
              onSend={sendMessage}
              isStreaming={isStreaming}
              onStop={stopStreaming}
              isLoading={isLoading}
            />
          </div>
        ) : (
          <>
            {/* Scrollable messages container */}
            <div className="flex-1 overflow-y-auto">
              {messages.map((msg, index) => (
                <ChatMessage key={msg.ID || index} message={msg} />
              ))}
              <div ref={messagesEndRef} />
              
              {/* Error display */}
              {error && (
                <div className="px-4 py-3 mx-4 my-2 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>
            
            {/* Input area - fixed at bottom when there are messages */}
            <div className="flex-shrink-0">
              <ChatInput
                onSend={sendMessage}
                isStreaming={isStreaming}
                onStop={stopStreaming}
                disabled={isLoading}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// Icon components for suggestions
const SuggestionIcons = {
  lightbulb: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  code: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  question: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  mobile: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  document: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  chart: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  globe: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  pencil: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  ),
  chat: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  database: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
    </svg>
  ),
  shield: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  rocket: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
    </svg>
  ),
};

// All available suggestions pool
const allSuggestions = [
  // Technology & Science
  { text: "Explain quantum computing in simple terms", icon: "lightbulb", gradient: "from-purple-500/20 to-blue-500/20" },
  { text: "What is machine learning and how does it work?", icon: "lightbulb", gradient: "from-purple-500/20 to-blue-500/20" },
  { text: "Explain the difference between AI and machine learning", icon: "lightbulb", gradient: "from-purple-500/20 to-blue-500/20" },
  { text: "How does blockchain technology work?", icon: "lightbulb", gradient: "from-purple-500/20 to-blue-500/20" },
  { text: "What are the latest trends in cloud computing?", icon: "globe", gradient: "from-cyan-500/20 to-blue-500/20" },
  
  // Programming & Development
  { text: "Write a Python function to sort a list", icon: "code", gradient: "from-green-500/20 to-teal-500/20" },
  { text: "Explain the difference between REST and GraphQL", icon: "code", gradient: "from-green-500/20 to-teal-500/20" },
  { text: "How do I implement authentication in a web app?", icon: "shield", gradient: "from-red-500/20 to-orange-500/20" },
  { text: "What are microservices and when should I use them?", icon: "database", gradient: "from-indigo-500/20 to-purple-500/20" },
  { text: "Help me debug this JavaScript code", icon: "code", gradient: "from-green-500/20 to-teal-500/20" },
  { text: "What are the best practices for REST API design?", icon: "question", gradient: "from-orange-500/20 to-yellow-500/20" },
  { text: "Explain Docker containers and how to use them", icon: "database", gradient: "from-indigo-500/20 to-purple-500/20" },
  
  // Business & Productivity
  { text: "Help me brainstorm ideas for a mobile app", icon: "mobile", gradient: "from-pink-500/20 to-rose-500/20" },
  { text: "Write a professional email to a client", icon: "pencil", gradient: "from-amber-500/20 to-orange-500/20" },
  { text: "Create a project plan for a software launch", icon: "document", gradient: "from-blue-500/20 to-indigo-500/20" },
  { text: "Help me prepare for a job interview", icon: "chat", gradient: "from-teal-500/20 to-cyan-500/20" },
  { text: "Summarize the key points of agile methodology", icon: "rocket", gradient: "from-violet-500/20 to-purple-500/20" },
  
  // Data & Analytics
  { text: "How do I analyze data with Python pandas?", icon: "chart", gradient: "from-emerald-500/20 to-green-500/20" },
  { text: "Explain SQL joins with examples", icon: "database", gradient: "from-indigo-500/20 to-purple-500/20" },
  { text: "What are the best data visualization practices?", icon: "chart", gradient: "from-emerald-500/20 to-green-500/20" },
  
  // Creative & Writing
  { text: "Help me write a compelling product description", icon: "pencil", gradient: "from-amber-500/20 to-orange-500/20" },
  { text: "Generate creative names for my startup", icon: "lightbulb", gradient: "from-purple-500/20 to-blue-500/20" },
  { text: "Write a blog post outline about technology trends", icon: "document", gradient: "from-blue-500/20 to-indigo-500/20" },
  
  // SAP Specific
  { text: "Explain SAP HANA and its benefits", icon: "database", gradient: "from-indigo-500/20 to-purple-500/20" },
  { text: "What is SAP BTP and how can I use it?", icon: "globe", gradient: "from-cyan-500/20 to-blue-500/20" },
  { text: "Help me understand SAP Fiori design principles", icon: "mobile", gradient: "from-pink-500/20 to-rose-500/20" },
  { text: "How do I create a CAP application?", icon: "code", gradient: "from-green-500/20 to-teal-500/20" },
];

/**
 * Shuffle array using Fisher-Yates algorithm
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Welcome screen shown when no conversation is active
 */
function WelcomeScreen({ onExampleClick, ChatbotLogo, modelName, onSend, isStreaming, onStop, isLoading }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  
  // Randomly select 4 suggestions on component mount
  const suggestions = useMemo(() => {
    const shuffled = shuffleArray(allSuggestions);
    return shuffled.slice(0, 4).map(s => ({
      ...s,
      icon: SuggestionIcons[s.icon]
    }));
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center">
        {/* Logo with pulse animation */}
        <div className="mb-8">
          <div className="w-20 h-20 mx-auto bg-dark-800 rounded-full flex items-center justify-center mb-4 p-3 relative">
            <div className="absolute inset-0 rounded-full bg-accent-primary/20 animate-ping opacity-75"></div>
            <ChatbotLogo className="w-full h-full text-accent-primary relative z-10" />
          </div>
          <h2 className="text-2xl font-bold text-dark-100 mb-2">
            How can I help you today?
          </h2>
          <p className="text-dark-400 mb-1">
            Start a conversation with Not Joule
          </p>
          <p className="text-dark-500 text-sm">
            Model: {modelName}
          </p>
        </div>

        {/* Animated suggestion cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => onExampleClick(suggestion.text)}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className={`
                p-4 text-left rounded-xl border border-dark-700 
                bg-gradient-to-br ${hoveredIndex === index ? suggestion.gradient : 'from-dark-800/50 to-dark-800/50'}
                hover:border-dark-500 transition-all duration-300 ease-out
                group flex items-start gap-3 relative overflow-hidden
                transform hover:scale-[1.02] hover:-translate-y-0.5
              `}
              style={{
                animationDelay: `${index * 100}ms`,
              }}
            >
              {/* Animated background glow */}
              <div 
                className={`
                  absolute inset-0 bg-gradient-to-br ${suggestion.gradient} 
                  opacity-0 group-hover:opacity-100 transition-opacity duration-300
                `}
              />
              
              {/* Icon with bounce animation on hover */}
              <div className={`
                text-accent-primary mt-0.5 flex-shrink-0 relative z-10
                transition-transform duration-300
                ${hoveredIndex === index ? 'scale-110' : ''}
              `}>
                {suggestion.icon}
              </div>
              
              {/* Text */}
              <p className="text-sm text-dark-300 group-hover:text-dark-100 transition-colors relative z-10">
                {suggestion.text}
              </p>
              
              {/* Arrow indicator on hover */}
              <div className={`
                absolute right-3 top-1/2 -translate-y-1/2 text-accent-primary
                transition-all duration-300 opacity-0 translate-x-2
                ${hoveredIndex === index ? 'opacity-100 translate-x-0' : ''}
              `}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>
        
        {/* Input area - centered with examples, no border */}
        <div className="mt-8 w-full">
          <ChatInput
            onSend={onSend}
            isStreaming={isStreaming}
            onStop={onStop}
            disabled={isLoading}
            hideBorder={true}
          />
        </div>
      </div>
    </div>
  );
}

export default App;