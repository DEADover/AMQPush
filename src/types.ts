export interface Profile {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  queue: string;          // optional — empty allowed
  use_tls: boolean;

  // Advanced — all optional in the form, defaulted by Rust
  container_id?: string;
  heartbeat_secs?: number;
  connect_timeout_secs?: number;
  tls_skip_verify?: boolean;
  sasl_anonymous?: boolean;
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
  profile: string | null;
  body_preview: string;
  body_full: string | null;
  is_file: boolean;
  file_name: string | null;
  file_data_b64: string | null;
  properties: Record<string, string>;
  auto_properties: Record<string, string>;
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
  enabled?: boolean;
  key: string;
  value: string;
  description?: string;
}

export interface SavedQueue {
  name: string;
  label: string;
  notes: string;
}

export interface Template {
  name: string;
  address: string;
  body: string;
  properties: Record<string, string>;
}

export type View = "publisher" | "subscriber" | "history" | "connection" | "stats" | "console" | "browser";
