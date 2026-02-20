import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { ChatbotLogo } from './components/ChatbotLogo';
import { MemoryPanel } from './components/MemoryPanel';
import { useChat } from './hooks/useChat';
import { getConversations, deleteConversation, createConversation } from './services/api';

/**
 * Main App Component
 */
function App() {
  const [conversations, setConversations] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showMemories, setShowMemories] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [user, setUser] = useState(null);
  const [modelName, setModelName] = useState('Unknown model');
  const [sessionExpired, setSessionExpired] = useState(false);
  const messagesEndRef = useRef(null);

  const {
    messages,
    isLoading,
    isStreaming,
    error,
    currentConversationId,
    streamCompletedAt,
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

  // Listen for session expiry from any layer (HTTP, SSE, WebSocket)
  useEffect(() => {
    const handler = () => setSessionExpired(true);
    window.addEventListener('session-expired', handler);
    return () => window.removeEventListener('session-expired', handler);
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Refresh conversations list only after a successful stream completion
  useEffect(() => {
    if (streamCompletedAt) {
      loadConversationsList();
    }
  }, [streamCompletedAt]);

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

  const handleOpenMemories = () => {
    setShowMemories(true);
    setSidebarOpen(false);
  };

  const handleExampleClick = async (text) => {
    // Create a new conversation and send the example message
    try {
      const conv = await createConversation('New Conversation');
      await loadConversationsList();
      if (conv && conv.ID) {
        await loadConversation(conv.ID);
        // Pass conv.ID directly to avoid stale currentConversationId closure
        sendMessage(text, [], conv.ID);
      }
    } catch (err) {
      console.error('Failed to start conversation with example:', err);
    }
  };

  return (
    <div className="h-screen flex bg-dark-900">
      {/* Session expired overlay */}
      {sessionExpired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm">
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 max-w-sm w-full mx-4 text-center shadow-2xl">
            <div className="w-14 h-14 mx-auto mb-4 bg-amber-500/10 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-dark-100 mb-2">Session timed out</h2>
            <p className="text-dark-400 text-sm mb-6">
              Your session has expired. Please refresh the page to re-authenticate and continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 bg-accent-primary hover:bg-accent-primary/90 text-white font-medium rounded-lg transition-colors"
            >
              Refresh page
            </button>
          </div>
        </div>
      )}
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onNavigateHome={handleNavigateHome}
        onOpenMemories={handleOpenMemories}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        ChatbotLogo={ChatbotLogo}
      />

      {/* Memory panel */}
      {showMemories && <MemoryPanel onClose={() => setShowMemories(false)} />}

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