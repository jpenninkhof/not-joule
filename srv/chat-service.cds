using { ai.chat as db } from '../db/schema';

/**
 * Chat Service - handles all chat operations
 */
@requires: 'authenticated-user'
service ChatService {
    
    // Expose conversations (filtered by user in handler)
    @readonly
    entity Conversations as projection on db.Conversations {
        *,
        messages: redirected to Messages
    } excluding { userId };
    
    // Expose messages (read-only, managed through conversations)
    @readonly
    entity Messages as projection on db.Messages {
        *,
        attachments: redirected to Attachments
    };
    
    // Expose attachments (uses @cap-js/attachments for object store)
    entity Attachments as projection on db.MessageAttachments;
    
    // Create a new conversation
    action createConversation(title: String) returns Conversations;
    
    // Delete a conversation
    action deleteConversation(conversationId: UUID) returns Boolean;
    
    // Send a message and get AI response (streaming handled separately)
    action sendMessage(conversationId: UUID, content: String) returns Messages;
    
    // Get chat completion with streaming (custom endpoint)
    // This will be handled via custom Express route for SSE streaming
}