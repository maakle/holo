/**
 * Pylon API response shapes — projected to the fields the spec actually reads.
 */

export interface PylonIssue {
  id: string;
  number: number;
  title: string;
  body_html: string;
  type: 'conversation' | 'ticket';
  state: string;
  source: string;
  created_at: string;
  updated_at: string;
  link: string;
  assignee?: { id: string; email: string };
  requester?: { id: string; email: string };
  tags: string[];
}

export interface PylonMessage {
  id: string;
  thread_id: string;
  message_html: string;
  is_private: boolean;
  source: string;
  timestamp: string;
  file_urls: string[];
  author: {
    name: string;
    avatar_url: string;
    user?: { id: string; email: string };
    contact?: { id: string; email: string };
  };
}

export interface IssuesPage {
  data: PylonIssue[];
  pagination: { cursor: string | null; has_next_page: boolean };
}

export interface MessagesPage {
  data: PylonMessage[];
  pagination: { cursor: string | null; has_next_page: boolean };
}
