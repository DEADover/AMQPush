# AMQPush — Claude project context

Quick context for AI assistants picking up this project. Focuses on architecture
decisions, gotchas, and where things live.

## Stack

- **Tauri 2** (Rust backend + WebView frontend, single window desktop app)
- **fe2o3-amqp 0.14** — pure Rust AMQP 1.0 client (`fe2o3-amqp` + `fe2o3-amqp-types`)
- **React 19 + TypeScript + Vite 7** — UI
- **Tailwind v3** — styling via `--t-*` CSS variables (light + dark themes)
- **CodeMirror 6** via `@uiw/react-codemirror` — JSON/XML editor in Send view

## Project layout

```
src-tauri/                      # Rust backend
  src/
    main.rs                     # entry — calls amqpush_lib::run()
    lib.rs                      # Tauri commands + AppState
    amqp.rs                     # AmqpClient: Connection + per-address senders
    subscriber.rs               # background subscriber w/ auto-reconnect
    broker.rs                   # Artemis management RPC + peek_messages
    profiles.rs                 # ~/.amqpush/profiles.json
    queues.rs                   # ~/.amqpush/queues.json (saved bookmarks — UI removed)
    templates.rs                # ~/.amqpush/templates.json
    history_store.rs            # ~/.amqpush/history.json (persistent send log)
  tauri.conf.json               # window: 1080×780 fixed-min, productName "AMQPush"
  Cargo.toml                    # binary name = "AMQPush" (Capitalized; affects macOS Dock)

src/                            # React frontend
  App.tsx                       # root — state lifted here for cross-view persistence
  components/
    Sidebar.tsx                 # collapsible nav (single render tree, CSS-driven anim)
    QueuePicker.tsx             # autocompletes from broker queues + addresses
    Tabs.tsx                    # reusable tab strip
    CodeEditor.tsx              # CodeMirror wrapper using --t-* vars
    views/
      ConnectionView.tsx        # Profile + General/Advanced tabs + Activity log
      PublisherView.tsx         # Send: tabs Body / Properties / Variables / Batch / Reply / Templates
      SubscriberView.tsx        # Receive: live messages + filter
      BrowserView.tsx           # broker queues table + peek messages (auto-refresh 2.5s)
      HistoryView.tsx           # split list / preview pane (Outlook-style)
      StatsView.tsx             # 6 cards + sparklines + per-queue + reliability
      ConsoleView.tsx           # logs ("Logs" sidebar item)
  hooks/useTheme.ts             # light/dark/system, localStorage-persisted
  utils/variables.ts            # `{{var}}` substitution incl. user vars
  types.ts                      # shared TS types matching Rust serde shapes
```

## Persistence

- **JSON files in `~/.amqpush/`** (created lazily):
  - `profiles.json` — saved broker profiles (host, port, creds, TLS, advanced opts)
  - `templates.json` — saved Send templates
  - `queues.json` — legacy bookmarks (UI removed; file may exist but is ignored)
  - `history.json` — last 200 sent messages (incl. small file content ≤ 2 MB base64 for resend)
- **localStorage** (in WebView):
  - `amqpush.lastProfile` — auto-connect target on startup
  - `amqpush.sidebarCollapsed`
  - `amqpush.logs` — last 500 log entries
  - `amqpush-theme`

## State / view lifecycle

- **All views stay mounted** — visibility toggled via CSS `hidden` class. State of
  every view (form values, scroll, filters, peeked messages, etc.) survives view
  switching. See App.tsx render — each view in its own pane with conditional class.
- Connection form values are lifted to App.tsx (`connForm`), shared with the global
  profile picker in the header.
- Profiles + activeProfile lifted to App.tsx.

## Tauri command surface (lib.rs)

Connection:    `connect`, `disconnect`, `connection_info`
Send:          `send_message`, `verify_queue`
Subscriber:    `start_subscriber`, `stop_subscriber`
History:       `get_history`, `clear_history`, `export_history`
Profiles:      `get_profiles`, `save_profile`, `delete_profile`
Queues:        `get_saved_queues`, `save_queue`, `delete_queue` (Rust kept; UI gone)
Templates:     `get_templates`, `save_template`, `delete_template`
Broker mgmt:   `list_broker_queues`, `peek_messages`
RR:            `await_reply`

## Gotchas

- **Tauri 2 nightly disables `window.prompt`/`confirm`** — use inline UI flows.
- **`.gitignore` `dist/` is ignored** — frontend build artifacts must not be committed.
- **Tauri config is embedded at compile time** via `tauri::generate_context!()` —
  changes to `tauri.conf.json` require a Rust rebuild (`touch build.rs` to force).
- **macOS Dock label** = binary name (Cargo `[[bin]] name`). Must be `AMQPush` (cap).
  `mainBinaryName` in tauri.conf.json must match.
- **macOS retina** — physical ≠ logical pixels; window sizes in conf are logical points.
- **Artemis SESSION_CLOSED notifications** route to DLQ if `send-to-dla-on-no-route`
  is on — we keep a long-lived `ManagementChannel` (broker.rs) to avoid spam.
- **fe2o3-amqp 0.14 API**:
  - `Connection::open(container_id, url)` or `Connection::builder()...open(url)`
  - `Session::begin(&mut conn)` returns `SessionHandle<()>`
  - `Sender::attach(&mut session_handle, name, address)`
  - `Receiver::builder().source(...).attach(&mut session_handle)`
  - `ApplicationProperties` wraps `OrderedMap<String, SimpleValue>` (NOT `Value`)
  - For body: `Body::Data(Batch<Data>)`, `Body::Value(AmqpValue<Value>)`
  - `receiver.modify(&delivery, Modified { ... })` — for "release without redeliver-here"
- **Filtering temp queues**: Artemis assigns UUID names to dynamic-source receivers
  (used for management RPC, request-reply). `is_internal_or_temp()` in broker.rs
  filters them so the user sees only real queues/addresses.

## Auto-set message properties

Every send adds (see amqp.rs + lib.rs):
- AMQP standard `Properties`: `message_id` (UUID), `creation_time`, `priority=4`, `durable=false`, optionally `reply_to`
- Application properties: `_AMQ_ROUTING_TYPE: 1` (ANYCAST), `is_file: bool`, `file_name` if file
- These are stored on the HistoryEntry as `auto_properties` for inspection.

## Window / dock

- Min size = default size = **1080×780** logical points (no shrink possible).
- macOS title bar uses default decorations (no Overlay) — drag works on system bar.
- Theme: 3-option dropdown in App header (Light / Dark / System).

## Build

- Dev: `npm run tauri dev` — Vite + Tauri runner; HMR for frontend, `cargo run` for Rust.
- Release: `npm run tauri build` — produces `.app` + `.dmg` in `src-tauri/target/release/bundle/`.
- Universal (Intel + ARM) macOS: `npm run tauri build -- --target universal-apple-darwin`.
- For Intel-only: target `x86_64-apple-darwin` (need `rustup target add x86_64-apple-darwin`).

## When making changes

- **Always run `npx tsc --noEmit`** after frontend edits to catch type errors.
- **Always run `cargo build --no-default-features`** in `src-tauri/` after Rust edits.
- After Rust changes, restart with full process kill (else old binary lingers):
  ```
  pkill -9 -f "target/debug/AMQPush"
  pkill -9 -f "tauri dev"
  pkill -9 -f "node.*vite"
  pkill -9 -f "esbuild"
  sleep 2 && lsof -ti:1420 | xargs kill -9
  npm run tauri dev > /tmp/amqpush-run.log 2>&1 &
  ```
