export interface FileAttachment {
  ID?: string;  // ID from database (optional, only present when loaded from DB)
  name: string;
  type: string;
  size: number;
  data: string; // base64 encoded
}

export interface Message {
  ID: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: FileAttachment[];
  createdAt?: string;
}

export interface Conversation {
  ID: string;
  title: string;
  createdAt: string;
  modifiedAt?: string;
  messages?: Message[];
}

export interface StreamEvent {
  type: 'user_message' | 'assistant_start' | 'content' | 'done' | 'error' | 'connected' | 'pong';
  id?: string;
  content?: string;
  message?: string;
  userId?: string;
}

export interface ApiError {
  error: string;
  message?: string;
}