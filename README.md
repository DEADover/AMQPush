# AMQPush

A modern desktop client for **AMQP 1.0** brokers (Apache ActiveMQ, Artemis, RabbitMQ, Azure Service Bus, etc.).  
Built with **Tauri 2 + Rust + React + TypeScript**.

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

---

## Features

| Feature | Details |
|---|---|
| **Publisher** | Send text, JSON (with live validator + formatter), or binary files to any queue/address |
| **Subscriber** | Real-time message listener with JSON auto-prettify and expand/collapse cards |
| **Queue Manager** | Save, label and annotate queues; test broker connectivity with one click |
| **History** | Full send log with resend, copy and full-body viewer |
| **Profiles** | Save connection profiles (host, port, credentials, TLS) to disk |
| **Multi-queue** | Publisher keeps a sender cache per address — no reconnect when switching queues |
| **Batch send** | Send N copies with configurable inter-message delay |
| **Custom properties** | Attach arbitrary AMQP application-properties to each message |
| **File send** | Read any file and send its bytes as an AMQP Data section |
| **Light / Dark / System theme** | Instant switching, preference persisted, no flash on startup |

---

## Screenshots

> _Add screenshots here after first build_

---

## Requirements

| Tool | Version |
|---|---|
| Rust | 1.77+ (`rustup update stable`) |
| Node.js | 18+ |
| Tauri CLI | 2.x (`cargo install tauri-cli`) |

---

## Getting Started

```bash
# Clone
git clone https://github.com/DEADover/AMQPush.git
cd AMQPush

# Install JS dependencies
npm install

# Run in development mode (hot-reload for both frontend and Rust)
npm run tauri dev

# Build a production binary
npm run tauri build
```

The binary ends up in `src-tauri/target/release/` (and a platform installer in `src-tauri/target/release/bundle/`).

---

## Project Structure

```
AMQPush/
├── src/                          # React frontend
│   ├── App.tsx                   # Root layout + theme + routing
│   ├── App.css                   # Design tokens (CSS variables) + Tailwind
│   ├── hooks/
│   │   └── useTheme.ts           # Light / dark / system theme hook
│   ├── components/
│   │   ├── Sidebar.tsx           # Icon navigation
│   │   ├── LogPanel.tsx          # Console log at the bottom
│   │   ├── QueuePicker.tsx       # Smart combobox with saved-queue autocomplete
│   │   └── views/
│   │       ├── ConnectionView.tsx
│   │       ├── PublisherView.tsx
│   │       ├── SubscriberView.tsx
│   │       ├── HistoryView.tsx
│   │       └── QueuesView.tsx
│   └── types.ts
└── src-tauri/                    # Rust backend
    └── src/
        ├── lib.rs                # Tauri commands + app state
        ├── amqp.rs               # AMQP client (connection, sender cache, history)
        ├── subscriber.rs         # Background receiver task + Tauri events
        ├── profiles.rs           # Connection profile persistence
        └── queues.rs             # Saved queue persistence
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) |
| AMQP client | [fe2o3-amqp 0.14](https://github.com/minghuaw/fe2o3-amqp) (native Rust, async) |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v3 with semantic CSS-variable tokens |
| Icons | [Lucide React](https://lucide.dev) |
| Async runtime | Tokio (full features) |

---

## Theming

AMQPush uses a single-source-of-truth token system — all colors are CSS custom properties defined in `App.css` for both `light` and `.dark` scopes. Tailwind utility classes reference these tokens via `rgb(var(--t-*) / <alpha>)`, which means opacity modifiers (`bg-t-card/50`) work out of the box.

The chosen theme is stored in `localStorage` under the key `amqpush-theme` (`"light"`, `"dark"`, or `"system"`). A synchronous inline script in `index.html` applies the class before any React render, eliminating flash-of-wrong-theme.

---

## Data Storage

All persistent data is stored in `~/.amqpush/`:

| File | Contents |
|---|---|
| `profiles.json` | Connection profiles |
| `queues.json` | Saved queue definitions |

---

## Broker Compatibility

Tested / expected to work with:

- Apache ActiveMQ Classic (OpenWire + AMQP 1.0 on port 5672)
- Apache ActiveMQ Artemis
- RabbitMQ with the AMQP 1.0 plugin
- Azure Service Bus (AMQP 1.0 over TLS)

> **Queue auto-creation**: on brokers with `auto-create-queues=true` (Artemis default), the "Test connection" button in the Queues view will create the queue if it doesn't exist yet.

---

## License

MIT
