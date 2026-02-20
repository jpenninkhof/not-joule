import React, { useState } from 'react';

/**
 * Sidebar component for conversation list
 */
export function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onNavigateHome,
  onOpenMemories,
  isOpen,
  onClose,
  user,
  ChatbotLogo,
}) {
  const [showAICorePopup, setShowAICorePopup] = useState(false);
  
  // Get user initials
  const getUserInitials = () => {
    if (!user || !user.name) return 'U';
    const names = user.name.split(' ');
    if (names.length >= 2) {
      return (names[0][0] + names[names.length - 1][0]).toUpperCase();
    }
    return names[0].substring(0, 2).toUpperCase();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-72 bg-dark-950 border-r border-dark-700
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          flex flex-col
        `}
      >
        {/* Header with Logo and Title */}
        <div className="p-4 border-b border-dark-700">
          <button
            onClick={onNavigateHome}
            className="flex items-center gap-3 mb-4 hover:opacity-80 transition-opacity w-full"
          >
            {/* Chatbot Logo in Circle */}
            <div className="w-10 h-10 rounded-full bg-dark-800 flex items-center justify-center p-2">
              {ChatbotLogo && <ChatbotLogo className="w-full h-full text-accent-primary" />}
            </div>
            <h1 className="text-lg font-semibold text-dark-100">SAP Not Joule</h1>
          </button>
          
          <button
            onClick={onNewConversation}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg
                       border border-dark-600 hover:bg-dark-800
                       transition-colors duration-200 group"
          >
            <svg
              className="w-5 h-5 text-dark-400 group-hover:text-white transition-colors"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span className="text-dark-200 group-hover:text-white transition-colors">
              New Chat
            </span>
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="text-center text-dark-500 py-8 px-4">
              <svg
                className="w-12 h-12 mx-auto mb-3 text-dark-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs mt-1">Start a new chat to begin</p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => (
                <ConversationItem
                  key={conv.ID}
                  conversation={conv}
                  isActive={conv.ID === currentConversationId}
                  onSelect={() => onSelectConversation(conv.ID)}
                  onDelete={() => onDeleteConversation(conv.ID)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer with User and Powered By */}
        <div className="p-4">
          {/* User info */}
          <div className="flex items-center gap-3 text-dark-400 text-sm mb-3">
            <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white text-xs font-medium">
              {getUserInitials()}
            </div>
            <span className="truncate">{user?.name || 'User'}</span>
          </div>

          {/* Memories button */}
          <button
            onClick={onOpenMemories}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg mb-3
                       text-dark-400 hover:text-dark-100 hover:bg-dark-800
                       transition-colors duration-150 text-sm"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span>Memories</span>
          </button>

          {/* Divider line */}
          <div className="border-t border-dark-700 mb-3"></div>
          
          {/* Powered by SAP AI Core - centered with SAP logo */}
          <button
            onClick={() => setShowAICorePopup(true)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-dark-500 hover:text-dark-400 transition-colors"
          >
            <span>Powered by</span>
            <img 
              src="https://www.sap.com/content/dam/application/shared/logos/sap-logo-svg.svg" 
              alt="SAP" 
              className="h-3 opacity-60"
            />
            <span>AI Core</span>
          </button>
        </div>
      </aside>

      {/* AI Core Popup */}
      {showAICorePopup && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
          <div className="bg-dark-900 rounded-xl border border-dark-700 max-w-lg w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-dark-700">
              <h2 className="text-lg font-semibold text-dark-100">SAP AI Core</h2>
              <button
                onClick={() => setShowAICorePopup(false)}
                className="p-1 rounded hover:bg-dark-800 text-dark-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <p className="text-dark-300 mb-4">
                This application is powered and built by SAP AI Core, a service in SAP Business Technology Platform 
                designed to handle the execution and operations of AI assets.
              </p>
              <a
                href="https://discovery-center.cloud.sap/serviceCatalog/sap-ai-core"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 transition-colors"
              >
                <span>Learn more about SAP AI Core</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Individual conversation item
 */
function ConversationItem({ conversation, isActive, onSelect, onDelete }) {
  const [showDelete, setShowDelete] = React.useState(false);

  return (
    <div
      className={`
        group relative flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer
        transition-colors duration-150
        ${isActive ? 'bg-dark-800' : 'hover:bg-dark-800/50'}
      `}
      onClick={onSelect}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <svg
        className="w-5 h-5 text-dark-500 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      <span className="flex-1 truncate text-sm text-dark-200">
        {conversation.title || 'New Chat'}
      </span>
      
      {/* Delete button */}
      {showDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 rounded hover:bg-dark-700 text-dark-500 hover:text-red-400
                     transition-colors duration-150"
          title="Delete conversation"
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
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

export default Sidebar;