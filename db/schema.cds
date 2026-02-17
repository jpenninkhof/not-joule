namespace ai.chat;

using { cuid, managed } from '@sap/cds/common';
using { Attachments } from '@cap-js/attachments';

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
 * Uses @cap-js/attachments for object store storage
 */
entity MessageAttachments : Attachments {
    message      : Association to Messages;
}
