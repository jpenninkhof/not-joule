namespace ai.chat;

using { cuid, managed } from '@sap/cds/common';

/**
 * Conversations - represents a chat session
 */
entity Conversations : cuid, managed {
    title       : String(255);
    userId      : String(255) not null;  // User ID from XSUAA
    messages    : Composition of many Messages on messages.conversation = $self;
}

/**
 * Messages - individual messages within a conversation
 */
entity Messages : cuid, managed {
    conversation : Association to Conversations;
    role         : String(20) not null;  // 'user' or 'assistant'
    content      : LargeString not null;
    tokenCount   : Integer;
    attachments  : Composition of many MessageAttachments on attachments.message = $self;
}

/**
 * MessageAttachments - file attachments for messages
 * Binary content is stored directly in HANA database
 */
entity MessageAttachments : cuid, managed {
    message      : Association to Messages;
    filename     : String(255);
    mimeType     : String(100);
    content      : LargeBinary;
    status       : String(20) default 'Clean';  // For compatibility
    note         : String(500);
}

/**
 * UserMemories - persistent user memories stored as vector embeddings
 * Used for semantic retrieval of relevant context at conversation start
 */
entity UserMemories : cuid, managed {
    userId                : String(255) not null;  // User ID from XSUAA
    content               : LargeString not null;  // The raw memory text
    embedding             : Vector(1024);          // Vector embedding (1024 dimensions for Amazon Titan)
    sourceConversationId  : String(36);            // UUID of the conversation this memory came from
}
