export interface Profile {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  queue: string;
  use_tls: boolean;
}

export interface SendResult {
  message_id: string;
  timestamp: string;
  address: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  address: string;
  body_preview: string;
  body_full: string | null;
  is_file: boolean;
  file_name: string | null;
  properties: Record<string, string>;
}

export interface ReceivedMessage {
  id: string;
  body: string;
  timestamp: string;
  is_truncated: boolean;
}

export interface LogEntry {
  id: number;
  ts: string;
  kind: "info" | "ok" | "err";
  text: string;
}

export interface PropertyRow {
  id: number;
  key: string;
  value: string;
}

export interface SavedQueue {
  name: string;
  label: string;
  notes: string;
}

export type View = "publisher" | "subscriber" | "history" | "queues" | "connection";
