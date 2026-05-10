# Changelog

All notable changes to AMQPush are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-05-10

### Highlights
- **Schema-validated bodies** — paste or upload a JSON Schema or XSD into the new Body schema modal; AMQPush validates every send against it (ajv for JSON, lazy-loaded `xmllint-wasm` for XML) and gates the Send button on the result.
- **Cmd+K command palette** — fuzzy-searchable index of every view, action, profile and theme. Keyboard-only navigation, sticky category headers, kbd-shortcut hints inline.
- **In-app Help** — `?` icon (and bare-key `?` shortcut) opens a 17-section guide with sidebar nav, full-text search, and copy-pasteable examples for every feature.
- **Browser purge** — `Purge` button in the queue browser wipes a queue via Artemis management RPC, with a confirm modal showing the broker-reported message count.
- **Scheduled & delayed sends** — first-send delay with a cancellable countdown; combine with Batch for scheduled bursts.
- **Pre-script tab** — small JS sandbox runs before each send (`ctx.set` / `ctx.get` / `ctx.iter`), perfect for counters, derived IDs, randomized routing keys.
- **Update checker** — silent GitHub Releases poll on startup; new versions surface as a non-intrusive header pill with a "Skip this version" option.

### Added — Send view

#### Body validation (schema modal)
- New shield-pill in the Body sub-toolbar opens a per-language schema editor — JSON Schema for JSON bodies, XSD for XML.
- Modal supports paste and file upload (`.json` / `.xsd` / `.xml`); Clear / Close buttons; Esc to dismiss.
- JSON Schema validation runs synchronously via `ajv` (Draft-07 + 2020-12); errors show with `instancePath` (e.g. `/order/lines/0/qty`).
- XSD validation runs asynchronously via `xmllint-wasm` (libxml2 in WebAssembly, ~500 KB) — lazy-loaded only when both an XSD and a non-empty body exist, so startup is unaffected.
- Both schemas are saved per-template under `body_schema_json` / `body_schema_xsd`. Older templates with the legacy `body_schema` field migrate transparently into the JSON slot.
- Status pill states: grey "Schema…" (none), blue "schema" (configured / waiting), green "schema ✓", red "schema ✗ (N)", spinner during async XSD validation.

#### Variables
- New **Variables** tab — user-defined `{{name}}` substitutions with enable toggle, key, value (chains other tokens), description.
- Built-in token catalogue (`{{uuid}}`, `{{timestamp}}`, `{{date}}`, `{{now}}`, `{{random}}`, `{{int}}`) is always available in Body / Properties without registration.
- Body editor autocomplete pops up on `{{` — surfaces user vars first, then built-ins, with descriptions.
- Auto-detect of the active subtype now keeps a manual JSON / XML pick when the editor is empty (previously it snapped back to `text`).

#### Pre-script
- New **Pre-script** tab with a CodeMirror-edited JS snippet that runs before every send.
- API: `ctx.set(key, value)`, `ctx.get(key)`, `ctx.iter` (1-based index in Batch loops).
- Runs in a sandboxed evaluator — no DOM, no `fetch`, pure computation.

#### Schedule
- New **Schedule** toggle — delays the first send by N seconds (independent of the Batch loop's per-iteration delay).
- Countdown is shown inside the Send button; **Cancel** aborts the wait via `AbortController` so nothing is sent.

### Added — Browser view
- **Purge queue** (red button on the peek pane header) — calls Artemis `removeAllMessages` via the persistent management channel.
- Confirm modal shows the broker-reported message count and a destructive-action warning before executing.
- After purge the queue list and peek pane refresh automatically.

### Added — Logs view
- **Sortable table** — Time / Level / Message columns, click headers to flip direction.
- Date column added (legacy `HH:MM:SS`-only entries migrate into a synthesised today-stamp on load).
- **Date-preset filter** — All / Today / Last hour / Last 24h / Last 7 days.
- Per-column substring search; level filter dropdown (info / ok / err).
- **Pause vs Follow** are now two distinct controls with clear tooltips:
  - Pause freezes the table (snapshot mode); new events keep arriving in the buffer.
  - Follow keeps the view scrolled to the newest row; turn off when scrolling up to read older entries.
- **Export** dropdown — JSON / CSV / `.log` plain-text; export respects the current filter.

### Added — Command Palette (Cmd+K)
- Fuzzy subsequence matching with word-start / consecutive-match bonuses ("gss" matches "Go-to Send" better than "Logs Stats Subscriber").
- Categorised list (Navigation / Actions / Profiles / Theme) with sticky headers.
- Up / Down skip disabled rows; Enter runs; Esc closes.
- Surfaces every reachable action: switch view, connect / disconnect, switch profile, change theme, send now, clear logs, open Help, show update notes.

### Added — Help modal
- Opens via the new `?` icon in the header (or the bare-key `?` shortcut, or Cmd+K → "Open Help").
- Left pane: searchable section navigation; right pane: full content; Esc closes.
- 17 sections covering Getting Started, Connection, Send (Body / Variables / Pre-script / Batch & Schedule / Reply / Templates / Body validation), Receive, Browser, History, Stats, Logs, Keyboard shortcuts, Tips & Tricks, Files & Storage.
- All shortcuts, file paths and JSON Schema / XSD examples documented in-app — no need to leave the window.

### Added — Update checker
- On startup AMQPush hits `https://api.github.com/repos/DEADover/AMQPush/releases/latest` and compares against the running version.
- New version → blue header pill `vX.Y.Z`; click opens a release-notes modal with **Open on GitHub** and **Skip this version**.
- Dismissed versions persist in `localStorage.amqpush.dismissedUpdateVersion` so the same release won't re-prompt.
- Falls through silently on offline / rate-limit; no telemetry, no signing keys, no auto-installer (manual download from GitHub).

### Added — UI primitives & polish
- New shared components: `CommandPalette`, `HelpModal`, `Callout`, `CopyButton` (with success animation), `Dropdown` / `DropdownItem` / `DropdownSection` / `DropdownFooter`, `SectionLabel`, `SegmentedControl`, `Toggle`, `ViewTopBar`.
- Connection view split into General / Advanced tabs with an Activity log pane.
- Sidebar collapses smoothly via CSS (single render tree, no layout thrash).
- Theme dropdown replaces the cycle-through-themes button (Light / Dark / Use system preference shown explicitly).
- All long property keys in the Help modal break cleanly inside their column — no text overlap on entries like `amqpush.dismissedUpdateVersion`.

### Added — macOS polish

#### Icon at runtime
- Custom `dock_icon` module sets `NSApplication.applicationIconImage` from the embedded `icon.png` at startup, so dev-mode runs (raw binary, no `.app` bundle) show the AMQPush logo in the Dock and Cmd-Tab instead of the generic blue-folder placeholder.
- The same image is registered under the `NSApplicationIcon` named-image cache, so the standard About panel shows the logo too.

#### About dialog with build date
- `build.rs` stamps `AMQPUSH_BUILD_DATE` (format `ddMMyyyy`) into the binary at compile time.
- Setup hook installs a custom Tauri menu whose About item uses an `AboutMetadata` with `short_version` set to the build date — the parenthesised slot now shows `(10052026)` instead of repeating the version.

### Fixed
- Send view's Raw subtype dropdown now sticks when picked on an empty editor (previously the auto-detect would immediately revert to `text`).
- Variable substitution inside JSON bodies is now schema-validated against the *template* form — `{"id": "{{uuid}}"}` reports as valid even though the unsubstituted token wouldn't satisfy a strict parser.
- Auto-detect of the Raw subtype no longer toggles the type while a manual pick is in effect (only releases on explicit clear after content existed).

### Backend
- New `dock_icon.rs` module (~30 LoC) using `objc2` + `objc2-app-kit` + `objc2-foundation` (already pulled in transitively by Tauri — zero extra compile cost).
- New `notif_drainer.rs` — silent consumer of `activemq.notifications` to prevent unrouted notifications from filling the DLQ on Artemis brokers with `send-to-dla-on-no-route` enabled.
- New `purge_queue` Tauri command using the persistent `ManagementChannel` pattern (lazy-open, drop on error).
- `AboutMetadataBuilder` plumbed through a custom macOS menu in `lib.rs::install_macos_menu` — replicates Tauri's default app menu with our injected metadata.
- `build.rs` extended to emit `AMQPUSH_BUILD_DATE` via `chrono` (added under `[build-dependencies]`, `default-features = false`, `clock` feature only).
- `Template` struct (Rust + TS) gained `body_schema_json` / `body_schema_xsd` with `#[serde(default)]`; legacy `body_schema` retained for backward compat.
- `LogEntry` migrated from `ts: "HH:MM:SS"` string to `tsMs: number` for date-aware filtering / sorting; loader migrates legacy entries.

---

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

[1.2.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.2.0
[1.1.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.1.0
[1.0.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.0.0
