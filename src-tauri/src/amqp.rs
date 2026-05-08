use base64::Engine;
use chrono::Local;
use fe2o3_amqp::connection::ConnectionHandle;
use fe2o3_amqp::session::SessionHandle;
use fe2o3_amqp::{Connection, Sender, Session};
use fe2o3_amqp_types::messaging::{ApplicationProperties, Header, Message, Priority, Properties};
use fe2o3_amqp_types::primitives::Timestamp;
use fe2o3_amqp_types::primitives::{OrderedMap, SimpleValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ── result / history ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SendResult {
    pub message_id: String,
    pub timestamp: String,
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub timestamp: String,
    pub address: String,
    /// Active profile name at send time (for display in history list / preview).
    /// Optional for backward compat with entries from before this field existed.
    #[serde(default)]
    pub profile: Option<String>,
    pub body_preview: String,
    pub body_full: Option<String>,
    pub is_file: bool,
    pub file_name: Option<String>,
    /// Base64-encoded file content — kept only for files up to ~2 MB to allow
    /// re-sending the attachment from History without re-picking it.
    #[serde(default)]
    pub file_data_b64: Option<String>,
    /// User-supplied custom application properties (from the Properties tab in Send view).
    pub properties: HashMap<String, String>,
    /// Auto-set fields included with the message — standard AMQP properties
    /// (message-id, creation-time, priority, durable, reply-to) plus application
    /// properties added by AMQPush itself (`_AMQ_ROUTING_TYPE`, `is_file`, `file_name`).
    /// Optional for backward compat with entries from before this field existed.
    #[serde(default)]
    pub auto_properties: HashMap<String, String>,
}

// ── client ───────────────────────────────────────────────────────────────────

pub struct AmqpClient {
    connection: Option<ConnectionHandle<()>>,
    session: Option<SessionHandle<()>>,
    senders: HashMap<String, Sender>,
    pub default_address: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub use_tls: bool,
    pub tls_skip_verify: bool,
    /// Stored so `reopen()` can re-establish the connection with the same
    /// settings if the session dies (e.g. after broker idle timeout).
    container_id: String,
    sasl_anonymous: bool,
    heartbeat_secs: u32,
}

/// Heuristic detection of "session/connection got reset" errors from
/// fe2o3-amqp. When a publisher hits one of these we transparently reopen
/// the connection and retry once, instead of forcing the user to reconnect.
fn is_retryable_disconnect_err(s: &str) -> bool {
    let s = s.to_ascii_lowercase();
    s.contains("illegal session state")
        || s.contains("session might have stopped")
        || s.contains("session has ended")
        || s.contains("connection has stopped")
        || s.contains("connection might have stopped")
        || s.contains("connection ended")
        || s.contains("link has detached")
        || s.contains("link is detached")
        || s.contains("idle timeout")
        || s.contains("connection closed")
        || s.contains("not connected")
}

/// Open a connection to the broker with all the knobs: TLS (with optional
/// certificate-check bypass for self-signed brokers), heartbeat, SASL Plain
/// or Anonymous, custom container ID. Used by every module that needs to
/// open its own AMQP session — keeps the auth/TLS code in one place.
#[allow(clippy::too_many_arguments)]
pub async fn open_connection(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    use_tls: bool,
    tls_skip_verify: bool,
    container_id: &str,
    sasl_anonymous: bool,
    heartbeat_secs: u32,
) -> Result<ConnectionHandle<()>, String> {
    use fe2o3_amqp::sasl_profile::SaslProfile;

    let mut builder = Connection::builder().container_id(container_id);
    if heartbeat_secs > 0 {
        builder = builder.idle_time_out(heartbeat_secs * 1000);
    }

    // Configure SASL Plain only when creds present and ANONYMOUS not forced.
    // Otherwise fe2o3-amqp will negotiate ANONYMOUS automatically.
    if !username.is_empty() && !sasl_anonymous {
        builder = builder.sasl_profile(SaslProfile::Plain {
            username: username.into(),
            password: password.into(),
        });
    }

    if use_tls {
        // Manual TLS path — lets us configure cert verification on/off.
        let mut tls_builder = native_tls::TlsConnector::builder();
        if tls_skip_verify {
            tls_builder
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true);
        }
        let tls = tls_builder
            .build()
            .map_err(|e| format!("TLS connector init: {e}"))?;
        let async_tls = tokio_native_tls::TlsConnector::from(tls);

        let tcp = tokio::net::TcpStream::connect(format!("{host}:{port}"))
            .await
            .map_err(|e| format!("TCP connect: {e}"))?;
        let tls_stream = async_tls
            .connect(host, tcp)
            .await
            .map_err(|e| format!("TLS handshake: {e}"))?;

        builder
            .hostname(host)
            .open_with_stream(tls_stream)
            .await
            .map_err(|e| format!("AMQP open: {e}"))
    } else {
        // Plain TCP path. Use a credential-free URL — auth comes from the
        // explicit SaslProfile set above. Embedding `user:pass@` in the URL
        // would force percent-encoding of any special chars in the password
        // (`@`, `:`, `/`, `#`, `?`, etc.); the explicit profile takes raw
        // bytes and handles them correctly.
        let url = format!("amqp://{host}:{port}");
        builder
            .open(&*url)
            .await
            .map_err(|e| format!("AMQP open: {e}"))
    }
}

impl AmqpClient {
    pub fn new() -> Self {
        Self {
            connection: None,
            session: None,
            senders: HashMap::new(),
            default_address: "test_queue".into(),
            host: String::new(),
            port: 61616,
            username: String::new(),
            password: String::new(),
            use_tls: false,
            tls_skip_verify: false,
            container_id: String::new(),
            sasl_anonymous: false,
            heartbeat_secs: 0,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &mut self,
        host: &str,
        port: u16,
        address: &str,
        username: &str,
        password: &str,
        use_tls: bool,
        container_id: &str,
        heartbeat_secs: u32,
        connect_timeout_secs: u32,
        sasl_anonymous: bool,
        tls_skip_verify: bool,
    ) -> Result<(), String> {
        self.disconnect().await.ok();

        let cid_owned;
        let cid: &str = if container_id.is_empty() {
            cid_owned = format!("amqpush-{}", uuid::Uuid::new_v4());
            &cid_owned
        } else {
            container_id
        };

        // Apply optional connect timeout
        let connect_fut = open_connection(
            host, port, username, password,
            use_tls, tls_skip_verify,
            cid, sasl_anonymous, heartbeat_secs,
        );
        let mut connection = if connect_timeout_secs > 0 {
            tokio::time::timeout(
                std::time::Duration::from_secs(connect_timeout_secs as u64),
                connect_fut,
            )
            .await
            .map_err(|_| format!("Connection timeout after {connect_timeout_secs}s"))?
            .map_err(|e| format!("Connection failed: {e}"))?
        } else {
            connect_fut
                .await
                .map_err(|e| format!("Connection failed: {e}"))?
        };

        let mut session = Session::begin(&mut connection)
            .await
            .map_err(|e| format!("Session failed: {e}"))?;

        // Pre-attach sender for the default address — only if user gave one.
        if !address.is_empty() {
            let sender = Sender::attach(&mut session, "amqpush-default", address)
                .await
                .map_err(|e| format!("Link to '{address}' failed: {e}"))?;
            self.senders.insert(address.to_string(), sender);
        }

        self.connection = Some(connection);
        self.session = Some(session);
        self.default_address = address.to_string();
        self.host = host.to_string();
        self.port = port;
        self.username = username.to_string();
        self.password = password.to_string();
        self.use_tls = use_tls;
        self.tls_skip_verify = tls_skip_verify;
        self.container_id = cid.to_string();
        self.sasl_anonymous = sasl_anonymous;
        self.heartbeat_secs = heartbeat_secs;

        Ok(())
    }

    /// Re-establish connection + session using the same settings as the last
    /// successful `connect()`. Drops any cached senders since they belong to
    /// the dead session. Used after a transparent retry on session-dead errors.
    async fn reopen(&mut self) -> Result<(), String> {
        // Best-effort cleanup of dead handles
        for (_, s) in self.senders.drain() {
            let _ = s.close().await;
        }
        if let Some(mut s) = self.session.take() { let _ = s.end().await; }
        if let Some(mut c) = self.connection.take() { let _ = c.close().await; }

        if self.host.is_empty() {
            return Err("Cannot reopen — never connected".into());
        }

        // Use a fresh container_id so the broker doesn't think we're the
        // ghost of the previous (possibly half-dead) connection.
        let new_cid = format!("amqpush-{}", uuid::Uuid::new_v4());

        let mut connection = open_connection(
            &self.host, self.port, &self.username, &self.password,
            self.use_tls, self.tls_skip_verify,
            &new_cid, self.sasl_anonymous, self.heartbeat_secs,
        )
        .await
        .map_err(|e| format!("Reopen connection: {e}"))?;

        let session = Session::begin(&mut connection)
            .await
            .map_err(|e| format!("Reopen session: {e}"))?;

        self.connection = Some(connection);
        self.session = Some(session);
        self.container_id = new_cid;
        Ok(())
    }

    async fn get_or_create_sender(&mut self, address: &str) -> Result<&mut Sender, String> {
        if !self.senders.contains_key(address) {
            let session = self.session.as_mut().ok_or("Not connected")?;
            let name = format!("amqpush-{address}");
            let sender = Sender::attach(session, &name, address)
                .await
                .map_err(|e| format!("Link to '{address}' failed: {e}"))?;
            self.senders.insert(address.to_string(), sender);
        }
        self.senders.get_mut(address).ok_or_else(|| "Sender not found".into())
    }

    pub async fn send_message(
        &mut self,
        address: &str,
        text: Option<String>,
        file_name: Option<String>,
        file_data_b64: Option<String>,
        custom_props: HashMap<String, String>,
        reply_to: Option<String>,
    ) -> Result<SendResult, String> {
        if self.host.is_empty() {
            return Err("Not connected".into());
        }

        let msg_id = Uuid::new_v4().to_string();
        let now = Local::now();
        let ts = now.format("%Y-%m-%d %H:%M:%S").to_string();
        let creation_ms = now.timestamp_millis();

        // Try once. If we hit a session/connection-dead error, transparently
        // reopen the connection and retry once. This handles cases where the
        // broker dropped the connection (idle timeout, restart, network blip).
        match self.try_send_once(
            address, &text, &file_name, file_data_b64.as_deref(),
            &custom_props, &reply_to, &msg_id, creation_ms,
        ).await {
            Ok(()) => {}
            Err(e) if is_retryable_disconnect_err(&e) => {
                eprintln!("amqp: send hit retryable error '{e}' — reopening session and retrying");
                self.reopen().await
                    .map_err(|re| format!("Send failed: {e}; reopen failed: {re}"))?;
                self.try_send_once(
                    address, &text, &file_name, file_data_b64.as_deref(),
                    &custom_props, &reply_to, &msg_id, creation_ms,
                ).await?;
            }
            Err(e) => return Err(e),
        }

        Ok(SendResult {
            message_id: msg_id,
            timestamp: ts,
            address: address.to_string(),
        })
    }

    /// Single send attempt. All inputs by reference so it can be called twice
    /// (once for original attempt, once after `reopen()` on retryable errors)
    /// without consuming the caller's owned values.
    #[allow(clippy::too_many_arguments)]
    async fn try_send_once(
        &mut self,
        address: &str,
        text: &Option<String>,
        file_name: &Option<String>,
        file_data_b64: Option<&str>,
        custom_props: &HashMap<String, String>,
        reply_to: &Option<String>,
        msg_id: &str,
        creation_ms: i64,
    ) -> Result<(), String> {
        let mut props: OrderedMap<String, SimpleValue> = OrderedMap::new();
        if let Some(name) = file_name {
            props.insert("file_name".into(), SimpleValue::String(name.clone()));
            props.insert("is_file".into(), SimpleValue::Bool(true));
        } else {
            props.insert("is_file".into(), SimpleValue::Bool(false));
        }
        // Tag the message as ANYCAST routing — Artemis uses _AMQ_ROUTING_TYPE
        // to distinguish queue-style (1) vs topic-style (2) delivery.
        props.insert("_AMQ_ROUTING_TYPE".into(), SimpleValue::Byte(1));
        for (k, v) in custom_props {
            props.insert(k.clone(), SimpleValue::String(v.clone()));
        }
        let app_props = ApplicationProperties(props);

        let msg_props = Some(Properties {
            message_id: Some(fe2o3_amqp_types::messaging::MessageId::String(msg_id.to_string().into())),
            creation_time: Some(Timestamp::from_milliseconds(creation_ms)),
            reply_to: reply_to.clone().map(|s| s.into()),
            ..Default::default()
        });

        let msg_header = Some(Header {
            durable: false,
            priority: Priority(4),
            ..Default::default()
        });

        let addr = address.to_string();
        self.get_or_create_sender(&addr).await?;
        let sender = self.senders.get_mut(&addr).unwrap();

        if let Some(body) = text {
            let mut builder = Message::builder().application_properties(app_props);
            if let Some(h) = msg_header { builder = builder.header(h); }
            if let Some(p) = msg_props  { builder = builder.properties(p); }
            let msg = builder.value(body.clone()).build();
            sender.send(msg).await.map_err(|e| format!("Send failed: {e}"))?;
        } else if let Some(b64) = file_data_b64 {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("Base64: {e}"))?;
            let mut builder = Message::builder().application_properties(app_props);
            if let Some(h) = msg_header { builder = builder.header(h); }
            if let Some(p) = msg_props  { builder = builder.properties(p); }
            let msg = builder.data(bytes).build();
            sender.send(msg).await.map_err(|e| format!("Send failed: {e}"))?;
        } else {
            return Err("No body provided".into());
        }

        Ok(())
    }

    pub async fn disconnect(&mut self) -> Result<(), String> {
        for (_, s) in self.senders.drain() {
            let _ = s.close().await;
        }
        if let Some(mut s) = self.session.take() {
            let _ = s.end().await;
        }
        if let Some(mut c) = self.connection.take() {
            let _ = c.close().await;
        }
        Ok(())
    }

    /// Attach a sender link to `address` to verify the queue exists (or trigger
    /// auto-creation on brokers that support it, e.g. ActiveMQ, Artemis with
    /// auto-create-queues=true). The sender is kept in the cache for future sends.
    pub async fn verify_queue(&mut self, address: &str) -> Result<(), String> {
        if self.session.is_none() {
            return Err("Not connected to broker".into());
        }
        self.get_or_create_sender(address).await?;
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.session.is_some()
    }

    pub fn connection_info(&self) -> Option<String> {
        if self.is_connected() {
            Some(format!("{}:{}", self.host, self.port))
        } else {
            None
        }
    }
}
