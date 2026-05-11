# Changelog

All notable changes to AMQPush are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] — 2026-05-12

### Highlights
- **Clients inspector** (new `⌘5` sidebar item) — see everyone currently attached to the broker, including AMQPush itself. Left pane lists active connections (client address, user, inferred protocol, session count, age). Click a row to see the consumers attached to that connection on the right, with **Credit** showing how many messages each consumer is currently holding. AMQPush's own management / notification consumers are filtered out by default (toggle via a header button). A "Raw" debug overlay surfaces the verbatim broker response when you need to diagnose field-name mismatches across Artemis versions.
- **"Who holds it?" drill-down on peeked messages** — every expanded peek message in Browser gets a Users chip that, on click, loads the consumers attached to that queue, joined to their client connection. Rows with non-zero credit (the practical "who is sitting on this message right now?" answer) are highlighted. Companion feature to Clients.
- **Live broker latency indicator** — a small `Xms` chip in the header next to the green "Connected" dot, polled every 5 s via a trivial management RPC. Goes amber at >100 ms, red at >500 ms — surfaces degrading network / broker conditions before a send or subscribe stalls.
- **Send progress sparkline** — Batch and CSV sends now render a tiny throughput sparkline next to the running counter, so you can see when the broker starts throttling instead of staring at a flat "247 / 1000 sent".
- **Body diff against previous send** — every History entry now has a **Compare with previous to <queue>** action that opens a side-by-side LCS diff vs. the most recent prior send to the same destination. Useful for "wait, what changed since last time this worked?" moments.
- **Configurable subscriber reconnect backoff** — per-profile base / max / multiplier knobs (Advanced tab in Connection). Defaults match the old hard-coded behaviour (1 s → 30 s, ×2) but you can now tune them down for fast-iteration dev work or up to spare the broker log during long outages.

### Added — Clients view
- New `⌘5` sidebar item **Clients**, between Browser and History.
- Two Tauri commands `list_broker_connections` / `list_broker_consumers` calling Artemis's `listConnectionsAsJSON` / `listAllConsumersAsJSON` over the same long-lived management channel as Browser. Field extraction is tolerant of cross-version key renames (`connectionID` vs `connectionId` vs `id`; `consumerID` vs `sequentialId`; `messagesInTransit` vs `deliveringCount`; etc.) and copes with `users` returned as a `Set<String>`.
- Protocol is inferred from the implementation class when the broker omits the `protocol` field (e.g. `ActiveMQProtonRemotingConnection` → AMQP, `Stomp*` → STOMP).
- Internal AMQPush consumers (UUID-named dynamic-source receivers for management RPC, the notifications drainer, and request-reply) are hidden by default with a `(+N internal)` counter; toggle with the **Internal** header button.
- Raw JSON debug overlay — toggle via the **`<>` Raw** header button to see exactly what the broker returned for both RPCs.
- Filter input narrows connections by user / host / protocol / connection-id.
- Auto-refresh every 3 s while the view is visible; 1 Hz tick keeps "ago" timestamps fresh in place.

### Added — Browser view
- **Who holds it?** chip in the expanded peek-message header. Lazy-loaded panel listing consumers attached to this queue (joined to their connection's `clientAddress` / `users`) with credit outstanding and last-RX timestamp. Non-zero credit rows highlighted in blue.
- The **Requeue all** button on DLQ queues is now always rendered (disabled when the queue is empty) so its location is discoverable even before messages arrive — the existing DLQ banner mentions it explicitly, a hidden button was confusing.

### Added — Header / status bar
- Broker latency chip (`Xms`) next to the green Connected dot — colours: ≤100 ms green, ≤500 ms amber, otherwise red. Polled via `broker.getName` over the existing management channel so the broker doesn't see extra connections.

### Added — Send view
- Live throughput sparkline alongside batch and CSV progress counters. Auto-scales Y to the running max, fills in as samples accumulate, hides when below 2 samples.

### Added — History view
- **Compare with previous to <queue>** action on each entry — opens a modal with the side-by-side LCS diff of the two bodies, JSON / XML pretty-printed before diffing.
- New `src/utils/diff.ts` module shares the LCS implementation between History and the existing two-message compare on Receive.

### Added — Connection / Advanced tab
- New **Subscriber reconnect backoff** card with three numeric inputs: base ms, max ms, multiplier. Persisted per profile.
- `Profile` schema (Rust + TS) gained `reconnect_base_ms`, `reconnect_max_ms`, `reconnect_multiplier`, all optional with sensible defaults — old `profiles.json` files keep working unchanged.

### Changed
- Sidebar shortcuts shifted down to accommodate Clients: History → `⌘6`, Stats → `⌘7`, Logs → `⌘8`.
- `subscriber::start` reads the backoff knobs from the `AmqpClient` state on each call rather than using compile-time constants.
- Help modal grew a new **Clients** section and a **Who holds this message?** subsection inside Browser. Pre-script docs were rewritten with seven worked examples, an API reference, and best-practices guidance.

### Fixed
- Pre-script now runs as an async function — `await crypto.subtle.digest(...)` and other async APIs work as the docs claim. Three call sites updated to `await runPreScript(...)`.
- Templates table: dropped the always-narrow Props column (moved into Features icons), Kind rendered as plain text instead of a chip, every column left-aligned, row heights pinned, Features icon order matches the Send tab strip exactly.
- Properties / Variables row alignment in the Send view — the WebKit-only render gap (15-iteration saga) is recorded in `CLAUDE.md` as the "measure first" rule.
- Format helpers (`fmtBytes` / `fmtDuration`) are now imported from `src/utils/format.ts` everywhere instead of being re-implemented inside PublisherView.

### Backend
- `BrokerConnection` / `BrokerConsumer` types in `broker.rs` are populated via hand-walked `serde_json::Value` extraction so AMQPush survives the dozen+ slightly-different field naming conventions across Artemis 2.x versions and ActiveMQ Classic.
- Long-lived management channel now handles four call shapes: `list_queues_via`, `ping_via`, `list_connections_via`, `list_consumers_via`. All four reuse the same `Sender` + dynamic-source `Receiver`, avoiding the SESSION_CLOSED notification storm that comes with per-call channels.
- New Tauri commands: `list_broker_connections`, `list_broker_consumers`, `fetch_broker_connections_raw`, `fetch_broker_consumers_raw`, `ping_broker`. The two `*_raw` commands return the unparsed JSON string for the Clients view's debug overlay.
- Foundation hardening landed alongside the headline features:
  - schema migration scaffolding (`version: u32` + `migrate_*_v1_to_v2`) in `profiles.rs` and `templates.rs`;
  - `#[serde(flatten)] extra: HashMap<String, Value>` on Profile / Template so manually-added fields survive save round-trips;
  - one-time history trim on load so pre-cap installations don't keep growing `history.json` past 200 entries;
  - subscriber permanent-failure detection — surfaces "address deleted" / "permission denied" as a non-retried red-banner event instead of looping forever.

## [1.3.0] — 2026-05-10

### Highlights
- **CSV-driven bulk send** — load a spreadsheet, each row becomes a message. Column headers turn into `{{column_name}}` tokens that resolve per-row in Body and Properties; live progress, abort, and a dry-run preview let you sanity-check substitutions before kicking off a thousand-message batch.
- **Broker-side selectors in Subscribe** — JMS-style filter expression (`priority > 5 AND application_property:type = 'order'`) attached as an AMQP 1.0 source filter via `apache.org:selector-filter:string`. The broker filters; you only pay the wire cost for messages you care about.
- **DLQ inspector + requeue** — Browser detects dead-letter queues by name (`DLQ`, `*.DLQ`, `_dlq`, `dead`, etc.) and surfaces a banner plus a green **Requeue all** button. Each message is republished to its `_AMQ_ORIG_ADDRESS` (Artemis) / `originalDestination` (Classic) with internal markers stripped so the broker doesn't immediately re-DLQ the copy. Per-message **Requeue → \<origin\>** action on the details pane too.
- **Profile workspaces** — group your saved brokers under labels like `Dev` / `Staging` / `Prod` (or per service / project). Workspaces drive sectioned headers in the global profile picker and the Cmd+K palette so a setup with 20+ profiles stops feeling unwieldy.
- **Faker tokens in Variables** — 35+ new built-in tokens for realistic-looking test data: `{{faker.email}}`, `{{faker.fullName}}`, `{{faker.creditCardNumber}}`, `{{faker.iban}}`, `{{faker.streetAddress}}`, `{{faker.lorem(N)}}`, and many more. Powered by `@faker-js/faker`.

### Added — Send view

#### CSV bulk send (new tab)
- New **CSV** tab in the Send view with a dropzone / file picker for any well-formed CSV (parsed via `papaparse`, RFC 4180-compliant).
- Header row drives the column-token catalogue: clicking a `{{column_name}}` chip copies it to the clipboard for paste into Body / Properties.
- **Preview table** shows the first 5 rows with click-to-select; the highlighted row drives the **Dry-run preview** that shows exactly how the Body resolves after substitution (so you spot a mistyped column before you blast 10 000 messages out).
- **Send N messages** action loops over every row, runs Pre-script per iteration with column values available via `ctx.get("col_name")`, applies token substitution to Body and every Property value, sends. Live progress bar with ok / fail counts.
- **Cancel** mid-batch via an `AbortController` — the loop exits cleanly at the next iteration boundary.
- Configurable per-row delay (`csv_delay`), useful for pacing against rate-limited consumers.
- Schema validation is intentionally skipped in CSV mode — the tab is optimised for throughput; validate on a single representative row in the regular Send view first if you need a guard.

### Added — Variables

- **Faker token namespace** — `{{faker.<path>}}` and `{{faker.<path>(<arg>)}}` covering people (firstName / lastName / fullName / jobTitle / gender), internet (email / username / url / domain / userAgent / password / ip / ipv6 / macAddress / phone), address (streetAddress / city / state / country / countryCode / zipCode / latitude / longitude), finance (creditCardNumber / creditCardCvv / creditCardExpiry / iban / bic / currency / amount), commerce (companyName / productName / productPrice / department), and text (lorem / loremParagraph / word).
- All faker tokens surface in the existing autocompletion dropdown and the Variables tab "Built-in presets" list with descriptions.
- Auto-detect of the Raw subtype now keeps a manual JSON / XML pick when the editor is empty (regression noticed in 1.2.0): the dropdown sticks until you actually clear non-empty content.

### Added — Subscribe view

- New **Selector** input — toggleable input below the queue picker accepts a JMS-style filter expression. Sent to `start_subscriber` as the new `selector` parameter; the Rust side packages it into an AMQP source filter set with descriptor `apache.org:selector-filter:string`.
- Active-subscription chips now show a small filter-icon badge when a selector is set; the tooltip surfaces the actual selector text so you can confirm what's running.
- Compatible with Artemis, ActiveMQ Classic, Qpid Broker-J. Brokers that don't support the filter typically reject the attach with a clear error message we surface in the log.

### Added — Browser view (DLQ tooling)

- **DLQ detection** — the peek pane recognises queues named `DLQ`, `*.DLQ`, `*_dlq`, `ActiveMQ.DLQ`, `ExpiryQueue`, or anything containing "dlq" / "dead" (case-insensitive).
- **DLQ banner** appears under the peek-pane header explaining how requeue works and which property carries the original destination on the user's broker.
- **Requeue all** button (next to Purge) — iterates the peeked messages, looks up `_AMQ_ORIG_ADDRESS` / `_AMQ_ORIG_QUEUE` (Artemis) or `originalDestination` / `JMSXOriginalDestination` (Classic), republishes each to its origin via the existing `send_message` command. Internal markers are stripped from the republished copy so the broker doesn't re-DLQ it on first failure.
- **Requeue → \<origin\>** chip on the per-message details pane for selective requeue.
- Progress counter (`Requeue 7/24`) replaces the button label while a bulk requeue is in flight.

### Added — Connection / profiles

- New **Workspace** field on every profile (free-form text, datalist autocomplete from existing labels). Empty → `Default`.
- The **header profile picker** groups profiles under `<DropdownSection>` headers per workspace; user-named groups float to the top, `Default` always last.
- The **Cmd+K palette** uses workspace as the category for profile-switch actions: `Profiles · Dev`, `Profiles · Staging`, etc., so fuzzy search like `dev p` matches Dev profiles before others.
- Backward-compatible: legacy profiles without a `workspace` key are loaded as `Default` via Rust `#[serde(default)]`.

### Backend
- New direct dep `serde_amqp = "0.14"` (already pulled in transitively by `fe2o3-amqp-types`, zero compile cost) — used to construct `Described<Value>` + `Descriptor` for the JMS-selector filter set.
- New direct deps on the frontend: `@faker-js/faker` (English locale, ~700 KB) and `papaparse` (RFC 4180 CSV parser, ~30 KB).
- `subscriber::start` signature gained a `selector: String` parameter; `Receiver::builder().source(Source { filter, ... }).attach(...)` is used when the selector is non-empty, falling back to the simpler `Receiver::attach` path otherwise.
- `start_subscriber` Tauri command takes an optional `selector: Option<String>` (backward compat: callers that omit it get no-filter behaviour).
- `Profile` struct (Rust + TS) gained a `workspace` field with `#[serde(default = "default_workspace")]` so older `profiles.json` files load as `Default`.

### Fixed
- Auto-detect of the Send view's Raw subtype no longer reverts the user's manual JSON / XML pick when they clear the editor before content arrives — picking a type in an empty buffer now sticks.

---

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

[1.4.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.4.0
[1.3.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.3.0
[1.2.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.2.0
[1.1.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.1.0
[1.0.0]: https://github.com/DEADover/AMQPush/releases/tag/v1.0.0
