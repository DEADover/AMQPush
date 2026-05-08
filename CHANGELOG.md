# Changelog

All notable changes to AMQPush are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-05-08

### Highlights
- **Receive view rebuilt from a single-field log into a full message inspector** — multi-queue subscribe, split-pane preview, highlight rules, format-aware body viewer, message diff, persistent log.
- **Browser, Receive, and History now share a unified design system** — same toolbar layout, same collapsible sections, same property list with hover-Copy on every value, same body view-mode toggle.
- **Connection resilience** — TLS skip-verify is now wired end-to-end; publishers transparently re-open the session on broker idle timeouts so you no longer have to manually reconnect.

### Added — Receive view

#### Multi-queue
- Subscribe to several queues at once. Each subscription is its own background task with an independent reconnect loop. Per-queue chips show live / reconnecting status; click `×` to stop one without affecting the others.
- Mixed feed tags every message with its source queue (visible badge appears once you have 2+ subscriptions active).
- New Tauri commands: `start_subscriber(address)` adds a sub, `stop_subscriber(address?)` stops one (or all), `list_subscribers()` lists active.

#### Message inspection
- Full AMQP metadata extraction for every received message — `message_id`, `correlation_id`, `reply_to`, `content_type`, `creation_time`, `priority`, `durable`, `ttl`, `delivery_count`, plus all application properties.
- Outlook-style split layout (list left / preview right). Preview has collapsible Properties / Application Properties / Body sections, each with hover-Copy on every value.
- **Reply** button on any message with a `reply-to` — opens the Send view with target pre-filled and the original `correlation-id` carried over as a custom property.
- **Pause / Resume** without dropping the link — UI freezes while broker delivery continues; counter shows how many were dropped during the pause.

#### Body viewer
- Segmented `AUTO | RAW | HEX` toggle in the Body section.
- AUTO detects content-type / leading character and pretty-prints JSON or XML.
- HEX renders the classic 16-bytes-per-row hex+ASCII dump (capped at 4 KB for UI responsiveness).

#### Search, stats, export
- Filter input now matches across body / message-id / correlation-id / content-type / application-properties (regex with case-insensitive fallback).
- Session stats live in the status bar: total received, total bytes, average size, rolling rate (5 s window), session duration.
- Export received messages to JSON or CSV via a dropdown in the filter bar.

#### Highlight rules
- Define regex rules with a colour and name; matching messages get a coloured `border-l-2` and dot on their list row.
- Rules manager modal with add / edit / delete, live regex validation, six colours (red / amber / green / blue / purple / pink).
- Rules persist across restarts in `localStorage`.

#### Persistent log (opt-in)
- Toggle `Persist` in the filter bar — last 500 received messages are saved to `localStorage` and restored on next launch.
- Off by default to avoid storing potentially sensitive payloads without consent.

#### Diff between messages
- Mark any message as the comparison reference, then select another and click **Compare**.
- Side-by-side modal showing standard properties + application properties (delta-highlighted on amber) plus a line-level body diff (LCS algorithm, JSON / XML pretty-printed before diffing for meaningful alignment).

### Added — Browser view
- Property hover-Copy on every field in the message details pane (parity with Receive).
- `AUTO | RAW | HEX` body viewer for peeked messages.
- Text selection in queue list and peeked-messages list (click no longer swallows drag selection).

### Added — History view
- Outlook-style split with full preview pane, including all auto-set / custom properties captured at send time.
- Collapsible sections (Properties / Auto-set / Custom / Body) with chevron + uppercase tracking-wider labels matching the rest of the app.
- Hover-Copy on every property; previously read-only.
- `AUTO | RAW | HEX` body viewer with XML pretty-print and hex dump.
- Search now covers body content too (full-text), not just metadata.

### Added — Connection
- TLS skip-verify is now actually wired through `connect`, `start_subscriber`, `list_broker_queues`, `peek_messages`, `await_reply` — previously the UI flag had no backend effect for self-signed certs.
- Publisher auto-reopens the connection / session transparently on dead-session errors (`Illegal session state`, `Connection has stopped`, idle timeout, etc.) and retries the send once before reporting failure.
- Added `native-tls` and `tokio-native-tls` direct deps for the manual TLS handshake path.

### Changed — design unification
- Browser, Receive, and History are now visually cohesive — same `px-3 py-1.5` pane headers, same `border-b border-t-line/40` row borders, same `hover:bg-t-hover/50`, same 140 px property-list key column, same empty-state icon size.
- BrowserView's native checkboxes (`<input type="checkbox">`) replaced with pill-toggle buttons matching Receive's style.
- HistoryView preview header collapsed from two rows (`px-4 py-2.5` chunky) into one row at the standard padding; Resend is a ghost button instead of filled-blue.
- Extracted shared primitives:
  - `src/components/CollapsibleSection.tsx`
  - `src/components/PropsList.tsx`
  - `src/components/EmptyState.tsx`
  - `src/utils/format.ts` — `fmtBytes`, `fmtDuration`, `csvEscape`
  - `src/utils/bodyView.ts` — `tryPrettyJson`, `tryPrettyXml`, `hexDump`, `detectFormat`

### Fixed
- Username / password authentication path no longer breaks when the password contains URL-reserved characters (`@`, `:`, `/`, `#`, `?`). The non-TLS connection path now uses an explicit `SaslProfile::Plain` instead of embedding credentials in the URL, so passwords are passed as raw bytes.
- Long-lived management channel reused across `list_broker_queues` polls — eliminates the stream of `SESSION_CLOSED` notifications that Artemis would route to DLQ when polling churned sessions.
- Removed leftover `msgCount` plumbing and the green badge on the Receive sidebar item.

### Backend
- `subscriber.rs` rewritten around a `HashMap<queue, SubscriberHandle>` model.
- `ReceivedMessage` extended with `queue` field plus the full `MessageMeta` extracted via the same helper Browser uses for peek (`broker::extract_peeked` is now `pub(crate)`).
- Per-queue lifecycle events carry a `SubEvent { queue, message? }` payload so the UI can show per-queue reconnect indicators.
- `AmqpClient` stores `container_id`, `sasl_anonymous`, `heartbeat_secs` so its new `reopen()` path can re-establish the connection with the same settings the user originally chose.

---

## [1.0.0] — 2026-04 (initial public release)

### Added
- Tauri 2 + React 19 + TypeScript desktop app for AMQP 1.0 brokers.
- Send view (Postman-style) with JSON / XML / plain text bodies, live validator, Beautify, binary file send, custom properties, `{{variables}}`, batch send (repeat × delay), request-reply round-trip, saved templates.
- Receive view (live subscriber with auto-reconnect and exponential backoff).
- Browser view — live broker queue list with auto-refresh, sortable, peek-and-release inspection.
- History view — last 200 sent messages persisted to disk with Outlook-style preview, JSON/CSV export.
- Stats view — throughput sparklines, per-queue leaderboard, message-size distribution, content-type breakdown.
- Profile management (multiple saved brokers, auto-connect to last-used) with global header switcher.
- Light / dark / system theme.
- Logs view with persistent localStorage backing.

[1.1.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.1.0
[1.0.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.0.0
