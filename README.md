# AMQPush

A modern desktop client for **AMQP 1.0** brokers — built with Tauri 2 + Rust + React.
Send and receive messages, browse broker queues live, peek messages without consuming
them, manage multiple connection profiles, and inspect every message header.

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24c8db)

---

## Features

| Area | Capabilities |
|---|---|
| **Connection** | Multiple saved profiles · auto-connect to last-used on startup · TLS / AMQPS · idle heartbeat · connect timeout · custom Container ID · SASL ANONYMOUS toggle |
| **Send** | JSON / XML / plain text with live validator and Beautify · binary file send · custom properties (key/value/description table) · user-defined `{{variables}}` · batch send (repeat × delay) · request-reply round-trip with timeout · saved templates |
| **Receive** | Live subscriber with auto-reconnect (exponential backoff) · regex/text filter · OS notifications when window unfocused · auto-scroll toggle |
| **Browser** | Live queue list from broker (Artemis / ActiveMQ Classic) with auto-refresh every 2.5 s · sortable table · message peek (read & release back) · full AMQP property inspection per message |
| **History** | Persisted send log (200 last entries) · Outlook-style split layout (list + preview) · Resend including file attachments · search by ID / profile / queue / body · JSON / CSV export |
| **Stats** | Throughput sparklines (60 s rolling) · per-queue leaderboard · message-size distribution · content-type breakdown · reliability score · peak rates |
| **Logs** | In-app console with level filter · search · auto-scroll · persists across restarts |
| **UI** | Postman-style tabs · light / dark / system theme · collapsible sidebar with smooth animation · global profile switcher in header · text-selectable preview panes |

---

## Requirements

| Tool | Version |
|---|---|
| Rust  | 1.77+ (`rustup update stable`) |
| Node  | 20+ |
| npm   | 10+ |

On macOS you also need Xcode command-line tools:
```bash
xcode-select --install
```

For cross-arch builds (Intel binary on Apple Silicon or vice-versa):
```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
```

---

## Quick start

```bash
git clone https://github.com/DEADover/AMQPush.git
cd AMQPush

# 1. Install JS dependencies
npm install

# 2. Run in dev mode — Vite + Tauri runner with hot reload
npm run tauri dev
```

On first launch the app starts at **127.0.0.1:5672** without TLS or credentials.
Open **Connection** (⌘1), enter your broker host/port, click **Connect**, and you're in.

---

## Building a release

### Current architecture only
```bash
npm run tauri build
```
Output appears in `src-tauri/target/release/bundle/`:
- macOS: `.app` and `.dmg`
- Windows: `.msi` and `.exe`
- Linux: `.deb`, `.AppImage`, `.rpm`

### macOS — universal binary (Intel + Apple Silicon)
```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

### macOS — Intel only (on an Apple Silicon machine)
```bash
rustup target add x86_64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin
```

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘1` | Connection view |
| `⌘2` | Send |
| `⌘3` | Receive |
| `⌘4` | Browser (broker queue browser) |
| `⌘5` | History |
| `⌘6` | Stats |
| `⌘7` | Logs |
| `⌘L` | Toggle Logs view |
| `⌘↵` | Send message (in Send view) |

---

## Broker compatibility

| Broker | AMQP support | Browser / queue management |
|---|---|---|
| Apache **ActiveMQ Artemis** | ✅ AMQP 1.0 (default) | ✅ via AMQP management RPC |
| Apache **ActiveMQ Classic** | ✅ via the AMQP module | ✅ via AMQP management RPC |
| **RabbitMQ** w/ AMQP 1.0 plugin | ✅ | ❌ different management API |
| **Azure Service Bus** | ✅ AMQP 1.0 over TLS | ❌ |

> **Queue auto-creation:** on brokers with `auto-create-queues=true` (Artemis default),
> sending to a non-existent queue creates it on first publish. The Browser view
> shows both bound queues and addresses.

### Artemis broker.xml example acceptor

```xml
<acceptor name="amqp">tcp://0.0.0.0:5672?protocols=AMQP</acceptor>
```

---

## Persistent data

All user data is stored in **`~/.amqpush/`**:

| File | Contents |
|---|---|
| `profiles.json` | Saved broker profiles (host, port, creds, TLS, advanced options) |
| `templates.json` | Send templates |
| `history.json` | Last 200 sent messages (with file content for files ≤ 2 MB) |

Logs and UI preferences live in WebView `localStorage`.

---

## Architecture

```
┌─────────────────┐   IPC commands   ┌──────────────────┐
│ React frontend  │ ───────────────▶ │ Rust backend     │
│ (Tauri WebView) │                  │ (tokio + fe2o3)  │
└─────────────────┘ ◀───── events ── └──────────────────┘
                                              │
                                              ▼
                                      ┌──────────────┐
                                      │ AMQP 1.0     │
                                      │ broker (TLS) │
                                      └──────────────┘
```

- The Rust backend keeps a single long-lived `Connection`/`Session` and a per-address
  cache of `Sender` links. A separate persistent `ManagementChannel` is used for
  Artemis management RPC (queue list / metrics) so polling doesn't churn sessions.
- The frontend uses Tauri events for live receive (`message_received`,
  `subscriber_reconnecting`, `subscriber_reconnected`, `subscriber_error`).
- All views remain mounted between switches — state is preserved without prop drilling.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) |
| AMQP client | [fe2o3-amqp 0.14](https://github.com/minghuaw/fe2o3-amqp) — native Rust, async, AMQP 1.0 |
| Frontend | React 19 + TypeScript + Vite 7 |
| Styling | Tailwind CSS v3 with semantic CSS-variable tokens |
| Editor | CodeMirror 6 (`@uiw/react-codemirror`) — JSON / XML highlighting |
| Icons | [Lucide React](https://lucide.dev) |
| Async runtime | Tokio (full features) |

---

## Contributing

PRs welcome. Run formatters before committing:

```bash
npx tsc --noEmit                    # type-check the frontend
( cd src-tauri && cargo build )     # build the Rust side
```

---

## License

MIT
