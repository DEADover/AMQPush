import { useEffect, useMemo, useRef, useState, ReactNode } from "react";
import {
  X, Search, BookOpen, Plug, Send, Inbox, ListTree, History as HistoryIcon,
  BarChart3, Terminal, Keyboard, Sparkles, ShieldCheck, Braces, Code2,
  Repeat2, CornerDownLeft, BookMarked, Database, FileSpreadsheet, Filter,
  AlertTriangle, Lightbulb,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Section model                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

interface HelpSection {
  id: string;
  title: string;
  icon: ReactNode;
  /** Plain text used by the search index. */
  searchText: string;
  /** Rendered React content. */
  content: ReactNode;
}

/* Small layout primitives used by every section ─ keeps content tidy. */

function H({ children }: { children: ReactNode }) {
  return <h2 className="text-[16px] font-semibold text-t-ink mb-3 flex items-center gap-2">{children}</h2>;
}
function H3({ children }: { children: ReactNode }) {
  return <h3 className="text-[13px] font-semibold text-t-ink mt-5 mb-2">{children}</h3>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-t-ink2 leading-relaxed mb-2.5">{children}</p>;
}
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-[12px] text-blue-500 mb-3">
      <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div className="text-t-ink2 leading-relaxed">{children}</div>
    </div>
  );
}
function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[12px] mb-3">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
      <div className="text-t-ink2 leading-relaxed">{children}</div>
    </div>
  );
}
function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="font-mono text-[11px] px-1.5 py-0.5 mx-0.5 border border-t-line rounded bg-t-card text-t-ink2 align-middle">
      {children}
    </kbd>
  );
}
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="font-mono text-[12px] px-1 py-0.5 rounded bg-t-card text-t-ink border border-t-line">
      {children}
    </code>
  );
}
function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-5 mb-3 space-y-1.5 text-[13px] text-t-ink2 leading-relaxed">{children}</ul>;
}
function Li({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 py-1.5 border-b border-t-line/60 last:border-0">
      <div className="text-[12px] text-t-ink4 break-all min-w-0">{label}</div>
      <div className="text-[12px] text-t-ink2 min-w-0">{children}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Sections                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

const SECTIONS: HelpSection[] = [
  /* ── Getting Started ──────────────────────────────────────────────────── */
  {
    id: "getting-started",
    title: "Getting started",
    icon: <BookOpen className="w-3.5 h-3.5" />,
    searchText: "getting started overview connect first message profile broker amqp 1.0 artemis",
    content: (
      <>
        <H><BookOpen className="w-4 h-4 text-blue-500" />Getting started</H>
        <P>
          AMQPush is a desktop client for AMQP&nbsp;1.0 brokers (ActiveMQ Artemis, Azure Service Bus,
          Solace, RabbitMQ with the AMQP&nbsp;1.0 plugin, etc.). Use it to publish messages, subscribe
          to queues, browse pending messages, replay history, and inspect broker state.
        </P>
        <H3>The 60-second tour</H3>
        <UL>
          <Li>Open <b>Connection</b> (sidebar) → fill host / port / credentials → <b>Save profile</b> → <b>Connect</b>.</Li>
          <Li>Switch to <b>Send</b>, type a queue name (autocompletes from broker), put text in the Body, hit <b>Send</b> or <Kbd>⌘</Kbd><Kbd>Enter</Kbd>.</Li>
          <Li><b>Receive</b> shows live messages. <b>Browser</b> peeks at queue contents without consuming. <b>History</b> keeps the last 200 sends with full payload for resend.</Li>
        </UL>
        <Note>
          Press <Kbd>⌘</Kbd><Kbd>K</Kbd> anywhere to open the command palette — every action,
          view, profile and theme is reachable from there.
        </Note>
        <H3>Where data lives</H3>
        <P>
          Profiles, templates and history are stored as JSON under <Code>~/.amqpush/</Code>.
          Logs and UI preferences live in the WebView's <Code>localStorage</Code>. No telemetry, no
          cloud sync — everything is on your machine.
        </P>
      </>
    ),
  },

  /* ── Connection ───────────────────────────────────────────────────────── */
  {
    id: "connection",
    title: "Connection",
    icon: <Plug className="w-3.5 h-3.5" />,
    searchText: "connection profile host port username password tls ssl heartbeat container id sasl anonymous certificate verify advanced workspace group dev staging prod",
    content: (
      <>
        <H><Plug className="w-4 h-4 text-blue-500" />Connection &amp; profiles</H>
        <P>
          A <b>profile</b> is a saved set of broker credentials and options. The dropdown at the top
          of the header switches the active profile globally; the same profile is what's auto-loaded
          on next launch.
        </P>
        <H3>General fields</H3>
        <Row label="Name">Display name for the profile (used in the dropdown / palette).</Row>
        <Row label="Host">Broker hostname or IP. <Code>localhost</Code> for local Artemis.</Row>
        <Row label="Port">Default <Code>5672</Code> (plain), <Code>5671</Code> (TLS).</Row>
        <Row label="Username / Password">SASL PLAIN credentials. Leave blank with <i>Anonymous</i> on.</Row>
        <Row label="Default queue">Optional. Pre-fills the destination on the Send view.</Row>
        <Row label="Use TLS">Negotiates AMQPS. Pair with <i>Skip cert verify</i> for self-signed dev brokers.</Row>
        <Row label="Workspace">Free-form group label (e.g. <Code>Dev</Code> / <Code>Staging</Code> / <Code>Prod</Code>). Drives sectioned headers in the global profile picker and Cmd+K palette categories. Empty / missing falls back to <Code>Default</Code>. The input has datalist autocomplete from existing workspaces.</Row>
        <H3>Advanced</H3>
        <Row label="Container ID">AMQP container identifier — defaults to a random UUID. Set this when the broker authorizes by container.</Row>
        <Row label="Heartbeat">Idle-timeout for keep-alive frames, seconds. <Code>0</Code> disables.</Row>
        <Row label="Connect timeout">How long to wait before giving up on connect (seconds).</Row>
        <Row label="SASL Anonymous">Authenticates without credentials when the broker allows it.</Row>
        <Row label="Skip cert verify">Disables TLS chain verification — dev only.</Row>
        <Note>
          The Activity panel under the form is a per-connection log. It stays mounted, so switching
          views and coming back keeps the trace.
        </Note>
      </>
    ),
  },

  /* ── Send view ────────────────────────────────────────────────────────── */
  {
    id: "send",
    title: "Send",
    icon: <Send className="w-3.5 h-3.5" />,
    searchText: "send publish publisher message body json xml text binary file properties application properties tabs subtype raw beautify format codemirror",
    content: (
      <>
        <H><Send className="w-4 h-4 text-blue-500" />Send (publisher)</H>
        <P>
          The Send view is organized as tabs. Body and Properties are the essentials; everything
          else (Variables, Pre-script, Batch, CSV, Reply, Templates) is opt-in.
        </P>
        <H3>Body</H3>
        <UL>
          <Li><b>None</b> — empty payload. Useful for queue probes / wake-up signals.</Li>
          <Li><b>Raw</b> — text body with subtype <Code>text</Code> / <Code>json</Code> / <Code>xml</Code>. The subtype drives editor highlighting, validation and the Beautify button.</Li>
          <Li><b>Binary</b> — file upload (click or drag from Finder/Explorer). Sent as <Code>Body::Data</Code>.</Li>
        </UL>
        <P>
          The subtype is auto-detected from the first non-whitespace character (<Code>{"{"}</Code>/<Code>[</Code> → JSON,
          <Code>&lt;</Code> → XML). Picking from the dropdown overrides auto-detect; clearing the editor
          releases the override so the next paste is detected fresh.
        </P>
        <H3>Properties</H3>
        <P>
          Application properties (key/value) attached to every send. Toggle a row off to keep the
          values handy without sending them. AMQPush also auto-sets standard AMQP properties on
          every message — see <i>Auto-set properties</i> below.
        </P>
        <H3>Auto-set properties</H3>
        <P>Every send adds these without you having to type them:</P>
        <Row label="message-id">Random UUID per send.</Row>
        <Row label="creation-time">Wall-clock at send.</Row>
        <Row label="priority / durable">Defaults to <Code>4</Code> / <Code>false</Code>.</Row>
        <Row label="reply-to">Set when the Reply tab is on.</Row>
        <Row label="_AMQ_ROUTING_TYPE">App property <Code>1</Code> (ANYCAST) — Artemis routing hint.</Row>
        <Row label="is_file / file_name">App properties set when sending Binary.</Row>
      </>
    ),
  },

  /* ── Variables ────────────────────────────────────────────────────────── */
  {
    id: "variables",
    title: "Variables",
    icon: <Braces className="w-3.5 h-3.5" />,
    searchText: "variables substitution placeholders user variables built-in uuid timestamp now date prebuilt template tokens curly braces faker email name address credit card iban lorem ipsum phone username password",
    content: (
      <>
        <H><Braces className="w-4 h-4 text-blue-500" />Variables</H>
        <P>
          Anywhere in the Body and Properties you can reference variables with double-brace tokens:
          <Code>{"{{name}}"}</Code>. The autocompletion in the editor surfaces both your user
          variables and the built-in catalogue.
        </P>
        <H3>Built-in tokens</H3>
        <P>Always available in the body, no registration needed:</P>
        <UL>
          <Li><Code>{"{{uuid}}"}</Code> — random UUID v4.</Li>
          <Li><Code>{"{{timestamp}}"}</Code> — Unix epoch milliseconds.</Li>
          <Li><Code>{"{{date}}"}</Code> — ISO 8601 timestamp.</Li>
          <Li><Code>{"{{now}}"}</Code> — same as <Code>{"{{date}}"}</Code>.</Li>
          <Li><Code>{"{{random}}"}</Code> / <Code>{"{{int}}"}</Code> — pseudo-random integer.</Li>
        </UL>
        <H3>User variables</H3>
        <P>
          Defined on the <b>Variables</b> tab. Each row has an enabled toggle, a key, a value, and a
          description. Disabled rows don't substitute. The value itself can reference other tokens
          (chained), so <Code>{"{{order_id}}"}</Code> with value <Code>{"ORD-{{uuid}}"}</Code>
          expands per-send.
        </P>
        <Note>
          Tokens work fine inside JSON. AMQPush replaces them <i>after</i> validating the structural
          template — so <Code>{"\"id\": \"{{uuid}}\""}</Code> stays valid JSON during validation.
        </Note>

        <H3>Faker tokens (realistic test data)</H3>
        <P>
          The <Code>{"{{faker.<path>}}"}</Code> namespace wraps the
          {" "}<Code>@faker-js/faker</Code> library so you can fill bodies with realistic-looking
          dummy data. All tokens auto-complete from the editor like the built-ins.
        </P>
        <UL>
          <Li><b>People</b> — <Code>{"{{faker.firstName}}"}</Code>, <Code>{"{{faker.lastName}}"}</Code>, <Code>{"{{faker.fullName}}"}</Code>, <Code>{"{{faker.jobTitle}}"}</Code>, <Code>{"{{faker.gender}}"}</Code></Li>
          <Li><b>Internet / contact</b> — <Code>{"{{faker.email}}"}</Code>, <Code>{"{{faker.username}}"}</Code>, <Code>{"{{faker.url}}"}</Code>, <Code>{"{{faker.domain}}"}</Code>, <Code>{"{{faker.phone}}"}</Code>, <Code>{"{{faker.ip}}"}</Code>, <Code>{"{{faker.ipv6}}"}</Code>, <Code>{"{{faker.macAddress}}"}</Code>, <Code>{"{{faker.userAgent}}"}</Code>, <Code>{"{{faker.password}}"}</Code></Li>
          <Li><b>Address</b> — <Code>{"{{faker.streetAddress}}"}</Code>, <Code>{"{{faker.city}}"}</Code>, <Code>{"{{faker.state}}"}</Code>, <Code>{"{{faker.country}}"}</Code>, <Code>{"{{faker.countryCode}}"}</Code>, <Code>{"{{faker.zipCode}}"}</Code>, <Code>{"{{faker.latitude}}"}</Code>, <Code>{"{{faker.longitude}}"}</Code></Li>
          <Li><b>Finance</b> — <Code>{"{{faker.creditCardNumber}}"}</Code> (Luhn-valid), <Code>{"{{faker.creditCardCvv}}"}</Code>, <Code>{"{{faker.creditCardExpiry}}"}</Code> (YYYY-MM), <Code>{"{{faker.iban}}"}</Code>, <Code>{"{{faker.bic}}"}</Code>, <Code>{"{{faker.currency}}"}</Code>, <Code>{"{{faker.amount}}"}</Code></Li>
          <Li><b>Commerce</b> — <Code>{"{{faker.companyName}}"}</Code>, <Code>{"{{faker.productName}}"}</Code>, <Code>{"{{faker.productPrice}}"}</Code>, <Code>{"{{faker.department}}"}</Code></Li>
          <Li><b>Text</b> — <Code>{"{{faker.lorem}}"}</Code> (sentence), <Code>{"{{faker.lorem(N)}}"}</Code> (N words), <Code>{"{{faker.loremParagraph}}"}</Code>, <Code>{"{{faker.word}}"}</Code></Li>
        </UL>
        <Note>
          Faker values are <b>not stable</b> — each substitution produces a fresh value. If you
          need a repeatable pseudo-random for the same key across a request, set it once via a
          Pre-script (<Code>ctx.set("user_id", ctx.uuid())</Code>) and reuse the variable.
        </Note>
      </>
    ),
  },

  /* ── Pre-script ───────────────────────────────────────────────────────── */
  {
    id: "prescript",
    title: "Pre-script",
    icon: <Code2 className="w-3.5 h-3.5" />,
    searchText: "pre-script javascript sandbox dynamic variables ctx.set quickjs runtime per-send",
    content: (
      <>
        <H><Code2 className="w-4 h-4 text-blue-500" />Pre-script</H>
        <P>
          A small JavaScript snippet that runs <i>before each send</i>, in a sandboxed context.
          Use it to compute variable values dynamically — counters, derived IDs, randomized
          selections.
        </P>
        <H3>API</H3>
        <UL>
          <Li><Code>ctx.set(key, value)</Code> — sets / overrides a user variable for this send.</Li>
          <Li><Code>ctx.get(key)</Code> — reads the current value (built-in or user).</Li>
          <Li><Code>ctx.iter</Code> — 1-based index in the Batch loop (always <Code>1</Code> for single sends).</Li>
        </UL>
        <H3>Example</H3>
        <pre className="text-[12px] font-mono bg-t-card border border-t-line rounded-md p-2.5 overflow-x-auto mb-3">{`// Increment a counter, derive a routing key
const n = (ctx.get("seq") | 0) + 1;
ctx.set("seq", n);
ctx.set("routing", "us-east." + (n % 4));`}</pre>
        <Warn>
          The script runs in a JS sandbox — no <Code>fetch</Code>, no DOM, no Node APIs. Treat it as
          pure computation only.
        </Warn>
      </>
    ),
  },

  /* ── Batch + Schedule ─────────────────────────────────────────────────── */
  {
    id: "batch",
    title: "Batch & Schedule",
    icon: <Repeat2 className="w-3.5 h-3.5" />,
    searchText: "batch repeat delay schedule delayed first send loop count throughput cancel abort",
    content: (
      <>
        <H><Repeat2 className="w-4 h-4 text-blue-500" />Batch &amp; Schedule</H>
        <H3>Batch</H3>
        <P>
          Sends the same message <b>N times</b> with a configurable delay between sends. Variables
          and the Pre-script re-evaluate per iteration, so each iteration can carry a fresh UUID or
          counter.
        </P>
        <Row label="Repeat">Number of sends. <Code>1</Code> = single send (toggle off).</Row>
        <Row label="Delay">Milliseconds between sends. <Code>0</Code> = as fast as possible.</Row>
        <H3>Schedule</H3>
        <P>
          Delays the <i>first</i> send by N seconds. Combine with Batch to schedule a burst.
          The countdown is shown in the Send button; clicking <b>Cancel</b> aborts the wait via an
          <Code>AbortController</Code> — nothing is sent.
        </P>
        <Note>
          Schedule runs entirely client-side. If you need broker-side scheduled delivery, set the
          <Code>_AMQ_SCHEDULED_DELIVERY_TIME</Code> application property in the Properties tab
          (Artemis-specific).
        </Note>
      </>
    ),
  },

  /* ── CSV bulk send ────────────────────────────────────────────────────── */
  {
    id: "csv",
    title: "CSV bulk send",
    icon: <FileSpreadsheet className="w-3.5 h-3.5" />,
    searchText: "csv bulk import spreadsheet excel rows columns headers tokens substitution per-row papaparse load drop preview dry run progress cancel",
    content: (
      <>
        <H><FileSpreadsheet className="w-4 h-4 text-blue-500" />CSV bulk send</H>
        <P>
          Open the <b>CSV</b> tab in the Send view. Drop a CSV file (or click to browse); the
          first row is treated as the header. Each subsequent row turns into one outgoing message,
          with column values substituted into <Code>{"{{column_name}}"}</Code> tokens in Body and
          Properties.
        </P>
        <H3>Workflow</H3>
        <UL>
          <Li><b>Load</b> — drop a <Code>.csv</Code> file or click the dropzone. Header row populates the column-token chips.</Li>
          <Li><b>Compose your Body</b> on the regular Body tab using <Code>{"{{column_name}}"}</Code> placeholders. Click any chip in the CSV tab to copy its token to clipboard.</Li>
          <Li><b>Preview</b> the first 5 rows in the table; click a row to drive the <i>Dry-run preview</i> below — that pane shows exactly how the Body resolves for that row, so you can confirm before sending.</Li>
          <Li><b>Send N messages</b> kicks off the loop. Live progress bar, ok / fail counters, and a <b>Cancel</b> button that aborts cleanly at the next iteration boundary.</Li>
        </UL>
        <H3>Token resolution per row</H3>
        <P>
          For each row AMQPush stacks variables in this order — first match wins:
        </P>
        <UL>
          <Li>Pre-script <Code>ctx.set(...)</Code> values (script runs once per row; column values are accessible via <Code>ctx.get("col_name")</Code>)</Li>
          <Li>CSV column values for the current row</Li>
          <Li>User-defined Variables tab entries</Li>
          <Li>Built-in tokens (<Code>{"{{uuid}}"}</Code>, <Code>{"{{faker.email}}"}</Code>, etc.)</Li>
        </UL>
        <Row label="Per-row delay">Milliseconds between rows. <Code>0</Code> = as fast as possible (rate-limited only by broker / network).</Row>
        <Note>
          Schema validation is intentionally skipped in CSV mode for throughput. Validate your
          template against a single representative row in the regular Send view first; once it
          passes, switch to CSV mode for the bulk run.
        </Note>
        <Warn>
          Sending thousands of messages is destructive on production queues. Always test against
          a dev profile first; the dry-run preview is your friend.
        </Warn>
      </>
    ),
  },

  /* ── Reply ────────────────────────────────────────────────────────────── */
  {
    id: "reply",
    title: "Request-Reply",
    icon: <CornerDownLeft className="w-3.5 h-3.5" />,
    searchText: "request reply correlation id reply-to dynamic source temporary queue rpc round trip",
    content: (
      <>
        <H><CornerDownLeft className="w-4 h-4 text-blue-500" />Request-Reply</H>
        <P>
          Toggle <b>Reply</b> in the Send tabs to wait for a response after publishing. AMQPush
          sets <Code>reply-to</Code> on the outgoing message and opens a temporary receiver to
          listen for the matching <Code>correlation-id</Code>.
        </P>
        <Row label="Reply-to">Address the receiver attaches to. Leave blank for a dynamic source (broker-assigned temp queue).</Row>
        <Row label="Timeout">Milliseconds to wait before flagging the reply as timed-out.</Row>
        <P>
          When a reply arrives, it's shown inline below the send result and gets a <b>Resend with
          context</b> action that pre-fills the Send form with the reply's <Code>correlation-id</Code>.
        </P>
      </>
    ),
  },

  /* ── Templates ────────────────────────────────────────────────────────── */
  {
    id: "templates",
    title: "Templates",
    icon: <BookMarked className="w-3.5 h-3.5" />,
    searchText: "templates save load rename delete preset reuse json file",
    content: (
      <>
        <H><BookMarked className="w-4 h-4 text-blue-500" />Templates</H>
        <P>
          Save the entire Send setup — destination, body + subtype, properties, variables,
          pre-script, batch / schedule / reply settings, and the validation schema — under a name.
          Loading a template restores everything in one click.
        </P>
        <UL>
          <Li><b>Save current</b> — type a name and confirm. Existing names are overwritten.</Li>
          <Li><b>Load</b> — click a template row.</Li>
          <Li><b>Rename / Delete</b> — pencil and trash icons on hover.</Li>
        </UL>
        <Note>
          Templates are stored at <Code>~/.amqpush/templates.json</Code>. You can hand-edit or
          version-control that file; the new <Code>body_schema_json</Code> /
          <Code>body_schema_xsd</Code> fields are optional.
        </Note>
      </>
    ),
  },

  /* ── Schema validation ────────────────────────────────────────────────── */
  {
    id: "schema",
    title: "Body validation",
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    searchText: "schema validation json schema ajv xsd xml validation xmllint draft 2020 upload paste error file",
    content: (
      <>
        <H><ShieldCheck className="w-4 h-4 text-blue-500" />Body validation (JSON Schema / XSD)</H>
        <P>
          The <b>schema pill</b> in the Body sub-toolbar opens a modal where you can paste or
          upload a schema. The active schema is automatically picked based on the Raw subtype:
          JSON Schema for JSON, XSD for XML.
        </P>
        <H3>Status indicator</H3>
        <UL>
          <Li><b>Schema…</b> (grey) — no schema configured.</Li>
          <Li><b>schema</b> (blue) — schema set, body empty or not yet validated.</Li>
          <Li><b>schema ✓</b> (green) — body matches.</Li>
          <Li><b>schema ✗ (N)</b> (red) — N validation errors. Click to inspect.</Li>
          <Li><b>schema…</b> with spinner — XSD validation in progress (xmllint-wasm runs async).</Li>
        </UL>
        <H3>JSON Schema</H3>
        <P>
          Validated synchronously with <Code>ajv</Code>. Supports Draft-07 and 2020-12. Errors
          show with their <Code>instancePath</Code>, e.g. <Code>/order/lines/0/qty</Code>.
        </P>
        <H3>XSD</H3>
        <P>
          Validated asynchronously via <Code>xmllint-wasm</Code> (libxml2 compiled to WebAssembly,
          ~500&nbsp;KB). The WASM blob is lazy-loaded only when both an XSD and a non-empty body
          are present, so it doesn't slow startup. Errors include <Code>line N</Code> from the
          parser.
        </P>
        <Note>
          Both schemas are saved per-language in the same template, so switching subtypes doesn't
          lose the other one.
        </Note>
      </>
    ),
  },

  /* ── Receive ─────────────────────────────────────────────────────────── */
  {
    id: "receive",
    title: "Receive",
    icon: <Inbox className="w-3.5 h-3.5" />,
    searchText: "receive subscriber subscribe live messages filter consume credit reconnect drainer notifications dla selector jms broker filter expression where priority",
    content: (
      <>
        <H><Inbox className="w-4 h-4 text-blue-500" />Receive (subscriber)</H>
        <P>
          Subscribes to a queue and shows messages as they arrive — live, with auto-reconnect on
          network blips. Each row expands to show the full AMQP frame: standard properties,
          application properties, body, body kind, size, delivery count.
        </P>
        <H3>Controls</H3>
        <UL>
          <Li><b>Subscribe</b> opens the receiver. The queue field accepts comma-separated names to subscribe to multiple at once.</Li>
          <Li><b>Stop</b> detaches and stops accumulating messages.</Li>
          <Li><b>Filter</b> restricts the visible list to rows matching a substring (case-insensitive across body + properties).</Li>
          <Li><b>Reply</b> on a message pre-fills Send with the original's <Code>correlation-id</Code>.</Li>
        </UL>
        <H3>Broker-side selectors (filter on the wire)</H3>
        <P>
          Click the <Filter className="w-3 h-3 inline-block align-middle" /> <b>Selector</b>{" "}
          button next to the queue picker to expand the filter input. Enter a JMS-style
          expression like{" "}
          <Code>{"priority > 5 AND application_property:type = 'order'"}</Code>{" "}
          and the broker will only deliver matching messages — non-matches stay on the queue
          for other consumers.
        </P>
        <P>
          AMQPush packages the expression as an AMQP 1.0 source filter under the descriptor
          {" "}<Code>apache.org:selector-filter:string</Code>, which is the de-facto standard
          accepted by Artemis, ActiveMQ Classic, Qpid Broker-J, and most JMS-compatible
          brokers. Active subscriptions with a selector get a small{" "}
          <Filter className="w-3 h-3 inline-block align-middle text-blue-500" /> badge on
          their chip, and the tooltip shows the selector text.
        </P>
        <Note>
          Selectors only see what the broker exposes — typically standard AMQP properties and
          application properties. They cannot match on body content. Empty selector = no filter
          (broker delivers everything, same as before).
        </Note>
        <Note>
          On Artemis with <Code>send-to-dla-on-no-route</Code> enabled, AMQPush silently drains the
          internal <Code>activemq.notifications</Code> address so unrouted notifications don't pile
          up in the DLQ.
        </Note>
      </>
    ),
  },

  /* ── Browser ─────────────────────────────────────────────────────────── */
  {
    id: "browser",
    title: "Browser",
    icon: <ListTree className="w-3.5 h-3.5" />,
    searchText: "browser queue browser peek messages purge delete management rpc artemis remove all messages refresh dlq dead letter requeue redeliver original destination",
    content: (
      <>
        <H><ListTree className="w-4 h-4 text-blue-500" />Queue browser</H>
        <P>
          Lists every queue on the broker with live counters (size, consumers, messages added /
          delivered). Auto-refreshes every 2.5 seconds. Click a queue to <b>peek</b> at the first
          messages without consuming them.
        </P>
        <H3>Peek</H3>
        <P>
          Reads a snapshot of pending messages — safe, non-destructive. Each entry shows the same
          metadata view as Receive. Use this to debug stuck or dead-letter queues.
        </P>
        <H3>Purge</H3>
        <P>
          The red <b>Purge</b> button on the peek pane removes <i>all</i> messages from the queue
          via the broker's management RPC (<Code>removeAllMessages</Code> on Artemis). A confirm
          dialog shows the message count before executing.
        </P>
        <Warn>
          Purge is destructive and cannot be undone. The message count is the broker-reported size
          at the moment of confirmation — concurrent producers may add more after.
        </Warn>

        <H3>DLQ inspection &amp; requeue</H3>
        <P>
          Browser auto-detects <b>dead-letter queues</b> by name — anything matching{" "}
          <Code>DLQ</Code>, <Code>*.DLQ</Code>, <Code>*_dlq</Code>, <Code>ActiveMQ.DLQ</Code>,
          <Code>ExpiryQueue</Code>, or simply containing "dlq" / "dead" (case-insensitive).
          When you peek into a DLQ a banner appears under the header explaining how requeue
          works on your broker, plus a green <b>Requeue all</b> button next to Purge.
        </P>
        <P>
          AMQPush reads the original destination from the message's application properties in
          this priority order:
        </P>
        <UL>
          <Li><Code>_AMQ_ORIG_ADDRESS</Code> — Artemis (most common)</Li>
          <Li><Code>_AMQ_ORIG_QUEUE</Code> — Artemis fallback (queue-level)</Li>
          <Li><Code>originalDestination</Code> — ActiveMQ Classic</Li>
          <Li><Code>JMSXOriginalDestination</Code></Li>
        </UL>
        <P>
          For each requeued message AMQPush strips DLQ-internal markers (<Code>_AMQ_ORIG_*</Code>,
          <Code>_AMQ_DLA_HISTORY</Code>, <Code>originalDestination</Code>, etc.) before
          republishing, so the broker doesn't immediately re-DLQ the copy if delivery fails again.
          The body and remaining application properties go through unchanged.
        </P>
        <P>
          You can also requeue messages individually: expanding any DLQ message reveals a{" "}
          <b>{"Requeue → <origin>"}</b> chip at the top of its details pane.
        </P>
        <Note>
          Requeue does <i>not</i> delete the original from the DLQ — peek-and-republish leaves
          the source untouched. After a successful Requeue all, follow up with the Purge button
          to clean up.
        </Note>
      </>
    ),
  },

  /* ── History ─────────────────────────────────────────────────────────── */
  {
    id: "history",
    title: "History",
    icon: <HistoryIcon className="w-3.5 h-3.5" />,
    searchText: "history sent log archive resend export json csv 200 entries persistent",
    content: (
      <>
        <H><HistoryIcon className="w-4 h-4 text-blue-500" />History</H>
        <P>
          The last <b>200 sends</b> (per profile) are persisted to <Code>~/.amqpush/history.json</Code>
          with full payload — text bodies always, file bodies up to 2&nbsp;MB (base64). Resend works
          even after a restart.
        </P>
        <H3>Layout</H3>
        <UL>
          <Li>Left pane: timestamped list, filterable.</Li>
          <Li>Right pane: full message — body (raw or pretty), application properties, auto-set properties.</Li>
          <Li><b>Resend</b> opens Send pre-filled with the original payload + properties.</Li>
          <Li><b>Export</b> dumps the visible filtered list as JSON or CSV.</Li>
        </UL>
        <Note>
          Files larger than 2&nbsp;MB are recorded by name only — body content isn't kept, so resend
          is unavailable. The threshold keeps <Code>history.json</Code> from ballooning.
        </Note>
      </>
    ),
  },

  /* ── Stats ──────────────────────────────────────────────────────────── */
  {
    id: "stats",
    title: "Stats",
    icon: <BarChart3 className="w-3.5 h-3.5" />,
    searchText: "stats statistics throughput sparkline cards reliability per-queue rate sent received error",
    content: (
      <>
        <H><BarChart3 className="w-4 h-4 text-blue-500" />Stats</H>
        <P>
          Six top-level cards — sent / received / errors / avg payload / throughput / reliability —
          with rolling sparklines, plus a per-queue breakdown. Stats are session-only (cleared on
          quit), kept in memory so they don't bloat <Code>localStorage</Code>.
        </P>
        <UL>
          <Li><b>Throughput</b> — moving average over the last 30 seconds (msgs/sec).</Li>
          <Li><b>Reliability</b> — <Code>sent / (sent + errors)</Code> as a percentage.</Li>
          <Li><b>Per-queue</b> — sortable table; click a header to flip direction.</Li>
        </UL>
      </>
    ),
  },

  /* ── Logs / Console ──────────────────────────────────────────────────── */
  {
    id: "logs",
    title: "Logs",
    icon: <Terminal className="w-3.5 h-3.5" />,
    searchText: "logs console activity events table sort filter date export json csv pause follow auto-scroll snapshot freeze",
    content: (
      <>
        <H><Terminal className="w-4 h-4 text-blue-500" />Logs</H>
        <P>
          Sortable table of every event — connect / send / receive / error — with date and time
          columns, level filter, search, and date presets (Today / 1h / 24h / 7d / All). Persists
          last 500 entries across restarts.
        </P>
        <H3>Pause vs Follow</H3>
        <UL>
          <Li><b>Pause</b> freezes the visible table — new events still arrive in the buffer but the table doesn't update until you Resume. Use when you want a stable snapshot to read or copy.</Li>
          <Li><b>Follow</b> keeps the view scrolled to the newest row. Turn off when you scroll up to read older entries — it stays parked there.</Li>
        </UL>
        <H3>Export</H3>
        <P>
          Exports respect the current filter. Pick JSON for round-tripping back into another tool,
          CSV for spreadsheet analysis, or <Code>.log</Code> for plain-text grep.
        </P>
      </>
    ),
  },

  /* ── Shortcuts ───────────────────────────────────────────────────────── */
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    icon: <Keyboard className="w-3.5 h-3.5" />,
    searchText: "keyboard shortcuts hotkeys cmd k command palette enter send escape close",
    content: (
      <>
        <H><Keyboard className="w-4 h-4 text-blue-500" />Keyboard shortcuts</H>
        <H3>Global</H3>
        <Row label={<><Kbd>⌘</Kbd><Kbd>K</Kbd></>}>Open command palette.</Row>
        <Row label={<><Kbd>⌘</Kbd><Kbd>1</Kbd>…<Kbd>7</Kbd></>}>Switch view (Connection / Send / Receive / Browser / History / Stats / Logs).</Row>
        <Row label={<><Kbd>⌘</Kbd><Kbd>L</Kbd></>}>Open Logs.</Row>
        <Row label={<><Kbd>⌘</Kbd><Kbd>Enter</Kbd></>}>Send the current message (Send view).</Row>
        <Row label={<><Kbd>Esc</Kbd></>}>Close any open modal / palette.</Row>
        <H3>Command palette</H3>
        <Row label={<><Kbd>↑</Kbd><Kbd>↓</Kbd></>}>Navigate. Disabled rows are skipped.</Row>
        <Row label={<><Kbd>Enter</Kbd></>}>Run the highlighted action.</Row>
        <H3>Editor (CodeMirror)</H3>
        <Row label={<><Kbd>⌘</Kbd><Kbd>/</Kbd></>}>Toggle line comment.</Row>
        <Row label={<><Kbd>⌘</Kbd><Kbd>F</Kbd></>}>Find / replace.</Row>
        <Row label={<>Type <Code>{"{{"}</Code></>}>Open variable autocomplete.</Row>
      </>
    ),
  },

  /* ── Tips ────────────────────────────────────────────────────────────── */
  {
    id: "tips",
    title: "Tips & Tricks",
    icon: <Sparkles className="w-3.5 h-3.5" />,
    searchText: "tips tricks pro power user advanced workflows performance debug",
    content: (
      <>
        <H><Sparkles className="w-4 h-4 text-blue-500" />Tips &amp; Tricks</H>
        <UL>
          <Li><b>Pre-fill from history</b>: when something fails in production, find the same payload in History → Resend → tweak → try again.</Li>
          <Li><b>Diagnose stuck queues</b>: Browser → click queue → Peek. Counters show prefetch / consumer status; peek shows what's actually waiting. Purge if needed.</Li>
          <Li><b>Test request-reply locally</b>: open two AMQPush windows, one Subscribed to <Code>requests</Code>, the other Sending with Reply on. The reply lands in the original Send view.</Li>
          <Li><b>Stress-test with Batch</b>: Repeat = 10000, Delay = 0. Watch Stats → Throughput. Set Pre-script <Code>ctx.set("id", "batch-" + ctx.iter)</Code> to make every message unique.</Li>
          <Li><b>Validate before send</b>: paste a JSON Schema / XSD into the Body schema modal. Send is gated on the body validating — no more "oops, missing field" sends.</Li>
          <Li><b>Profile-per-environment</b>: dev / staging / prod as separate profiles. The header dropdown switches the broker globally; nothing else changes.</Li>
        </UL>
      </>
    ),
  },

  /* ── Storage / files ─────────────────────────────────────────────────── */
  {
    id: "files",
    title: "Files & Storage",
    icon: <Database className="w-3.5 h-3.5" />,
    searchText: "files storage paths config home directory amqpush profiles templates queues history localstorage",
    content: (
      <>
        <H><Database className="w-4 h-4 text-blue-500" />Files &amp; Storage</H>
        <H3>~/.amqpush/</H3>
        <Row label="profiles.json">Saved broker profiles.</Row>
        <Row label="templates.json">Saved Send templates.</Row>
        <Row label="history.json">Last 200 sends per profile.</Row>
        <Row label="queues.json">Legacy queue bookmarks (UI removed; file ignored).</Row>
        <H3>localStorage (WebView)</H3>
        <Row label="amqpush.lastProfile">Auto-connect target on startup.</Row>
        <Row label="amqpush.logs">Last 500 log entries.</Row>
        <Row label="amqpush.sidebarCollapsed">Sidebar state.</Row>
        <Row label="amqpush-theme">Light / Dark / System.</Row>
        <Row label="amqpush.dismissedUpdateVersion">"Skip this version" preference.</Row>
        <Note>
          Backing up <Code>~/.amqpush/</Code> to a private repo or a dotfiles store gives you all
          your profiles and templates on a fresh machine.
        </Note>
      </>
    ),
  },
];

/* ────────────────────────────────────────────────────────────────────────── */
/*  Modal                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export default function HelpModal({
  initialSection,
  onClose,
}: {
  initialSection?: string;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState(initialSection ?? SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Reset scroll when section changes
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [activeId]);

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(s =>
      s.title.toLowerCase().includes(q) || s.searchText.toLowerCase().includes(q)
    );
  }, [query]);

  // If the active section gets filtered out, jump to the first match.
  useEffect(() => {
    if (!filteredSections.some(s => s.id === activeId) && filteredSections.length > 0) {
      setActiveId(filteredSections[0].id);
    }
  }, [filteredSections, activeId]);

  const active = SECTIONS.find(s => s.id === activeId) ?? SECTIONS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-t-bg border border-t-line rounded-lg shadow-2xl w-[920px] max-w-[95vw] h-[78vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-t-line bg-t-panel">
          <BookOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <div className="text-[13px] text-t-ink font-medium">Help</div>
          <span className="text-[11px] text-t-ink5">— in-app guide</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1 rounded text-t-ink4 hover:text-t-ink hover:bg-t-hover"
            aria-label="Close help"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex-1 min-h-0 flex">
          {/* Sidebar */}
          <div className="shrink-0 w-[220px] border-r border-t-line bg-t-panel/40 flex flex-col">
            <div className="shrink-0 px-2.5 py-2 border-b border-t-line">
              <div className="flex items-center gap-2 bg-t-field border border-t-line2 rounded-md px-2 py-1.5">
                <Search className="w-3 h-3 text-t-ink5 shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search help…"
                  className="flex-1 bg-transparent text-[12px] text-t-ink outline-none placeholder:text-t-ink5 min-w-0"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {filteredSections.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-t-ink5">No matches</div>
              ) : filteredSections.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                    s.id === active.id
                      ? "bg-blue-500/15 text-blue-500"
                      : "text-t-ink2 hover:bg-t-hover/50 hover:text-t-ink"
                  }`}
                >
                  <span className="shrink-0">{s.icon}</span>
                  <span className="truncate">{s.title}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
            {active.content}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-3 py-1.5 border-t border-t-line bg-t-panel flex items-center gap-3 text-[10px] text-t-ink5">
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
          <span className="ml-auto">{filteredSections.length} of {SECTIONS.length} sections</span>
        </div>
      </div>
    </div>
  );
}
