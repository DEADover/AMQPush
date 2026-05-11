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

## Releases — always do this

**Never tag, push a tag, or publish a release without an explicit user request.**
The CI workflow fires on any `v*` tag push and creates a GitHub Release
automatically — so even just creating a tag is "publishing a release". Don't
do it on your own initiative.

When you finish a feature or batch of changes, summarise what's done and stop.
The user decides when (and whether) to cut a release.

When the user **does** ask for a release (`vX.Y.Z`), do all of the following —
don't ship a half-finished one and wait for the user to nudge:

1. **Bump versions** in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
   (`package.json` stays at `0.1.0`, that's intentional).
2. **Write a Keep-a-Changelog entry** in `CHANGELOG.md` with a `### Highlights`
   block + `### Added` / `### Changed` / `### Fixed` / `### Backend` sections,
   plus a `[X.Y.Z]: https://github.com/DEADover/AMQPush/releases/tag/vX.Y.Z`
   link reference at the bottom.
3. **Verify**: `npx tsc --noEmit` and `cargo build --no-default-features` in
   `src-tauri/` must both be clean.
4. **Commit** with message `release: vX.Y.Z — <subtitle>` and the
   `Co-Authored-By` trailer.
5. **Tag + push** — `git tag -a vX.Y.Z -m "AMQPush vX.Y.Z"` then push both
   `main` and the tag. CI (`.github/workflows/release.yml`) fires on the tag
   push and runs `tauri-action` across macOS / Windows / Linux. Builds take
   ~8 min total.
6. **Format the GitHub release the same way as v1.1.0**, not the placeholder
   body that `tauri-action` writes. Specifically:
   - **Title**: `vX.Y.Z — <subtitle from highlights>`.
   - **Body**: a `## Downloads` table at the top with platform / file / size
     for every artefact, then the security-warning blockquote (Gatekeeper /
     SmartScreen / `chmod +x` for AppImage), a `---` divider, then the
     verbatim `## [X.Y.Z] — DATE` section pulled from `CHANGELOG.md`.
   - Update with `gh release edit vX.Y.Z --title ... --notes-file ...`.
     Extract the changelog block via
     `awk '/^## \[X\.Y\.Z\]/,/^## \[<previous>\]/' CHANGELOG.md | sed '$d'`.

Don't wait to be told to do step 6 — it's part of "doing the release".

## When making changes

- **Always run `npx tsc --noEmit`** after frontend edits to catch type errors.
- **Always run `cargo build --no-default-features`** in `src-tauri/` after Rust edits.
- **Update `src/components/HelpModal.tsx`** whenever you add or rename a
  user-visible feature. The help modal is the in-app guide users open via the
  `?` icon — it must stay in sync, not just the README. Add a new section in
  the `SECTIONS` array, or extend an existing one (e.g. CSV bulk send goes
  inside Send / a sibling of Batch & Schedule; broker selectors go into the
  Receive section; DLQ requeue goes into Browser; new `{{token}}` sets
  extend Variables). Faking it forces the user to ask for the update later.
- After Rust changes, restart with full process kill (else old binary lingers):
  ```
  pkill -9 -f "target/debug/AMQPush"
  pkill -9 -f "tauri dev"
  pkill -9 -f "node.*vite"
  pkill -9 -f "esbuild"
  sleep 2 && lsof -ti:1420 | xargs kill -9
  npm run tauri dev > /tmp/amqpush-run.log 2>&1 &
  ```

## Visual / layout debugging — measure first, guess never

When the user reports a **visual bug** ("rows are different heights", "text
is clipped", "popup is misaligned", "column doesn't line up"), do NOT
iterate on CSS by re-reading source files and guessing. Open the running
app in Chrome via the **claude-in-chrome MCP** (Vite dev server is on
`http://localhost:1420`) and measure the actual rendered DOM with
`javascript_tool`. One `getBoundingClientRect()` + `getComputedStyle()`
call answers the question; guessing takes 5-15 iterations and frustrates
the user.

The pattern:
1. Ensure `npm run tauri dev` is running (Vite serves the same React app
   at `http://localhost:1420` that the Tauri WebView consumes).
2. `tabs_context_mcp` → grab a tab id.
3. `navigate` to `http://localhost:1420` (with a small `setTimeout` for
   render).
4. `javascript_tool` with a snippet that programmatically navigates to
   the affected view, triggers the state the user described (click Add,
   open a tab, etc.), and returns the computed measurements. Wrap in
   `(async () => { ... })()` and `await` between clicks.
5. Compare numbers. If they match, the bug is in the user's render
   target — usually a stale WebView, a Tauri-only CSS quirk, or HMR
   miss. Diagnose accordingly. If they differ, the numbers tell you
   exactly which property is wrong.

**Tauri uses WebKit on macOS, Chrome uses Blink.** Measurements from
Chrome are necessary but not sufficient — visual bugs that only show in
the Tauri window are likely WebKit-specific. The most common one is
`<input type="text">` rendering at `-webkit-appearance: textfield`
native size, ignoring CSS `line-height` / `height` / `padding`. Defensive
fix: explicit `h-N` + `box-border` + `appearance-none` on inputs that
need to match other elements pixel-for-pixel.

**Real example from history.** A row-height mismatch between Properties
and Variables tabs in the Send view ate 15 commits of CSS guessing
(`ch` units, canvas `measureText`, padding overrides, `!important`,
re-themes) before measurements in Chrome DevTools proved the rows were
already pixel-identical at 36.54 px — the divergence was only visible in
Tauri's WebView because of `<input>`'s native sizing. The right move was
to measure the rendered DOM on the very first iteration.
