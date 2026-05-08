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

/** Full AMQP metadata extracted from a delivery — mirrors Rust `PeekedMessage`. */
export interface MessageMeta {
  message_id: string | null;
  user_id: string | null;
  to: string | null;
  subject: string | null;
  reply_to: string | null;
  correlation_id: string | null;
  content_type: string | null;
  content_encoding: string | null;
  absolute_expiry_time: number | null;
  creation_time: number | null;
  group_id: string | null;
  group_sequence: number | null;
  reply_to_group_id: string | null;
  application_properties: Record<string, string>;
  body_text: string | null;
  body_kind: string;
  body_size: number;
  priority: number | null;
  durable: boolean | null;
  ttl_ms: number | null;
  delivery_count: number;
}

export interface ReceivedMessage {
  /** UUID generated on receive — used as React key. */
  id: string;
  /** HH:MM:SS at receive time. */
  timestamp: string;
  /** Truncated body text for compact list display. */
  body: string;
  is_truncated: boolean;
  /** Full extracted AMQP metadata. */
  meta: MessageMeta;
  /** Queue (source address) this message arrived on. */
  queue: string;
}

/** Per-queue subscriber lifecycle event — for reconnecting/reconnected/error/stopped. */
export interface SubEvent {
  queue: string;
  message: string | null;
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
