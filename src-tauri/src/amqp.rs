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
    ) -> Result<(), String> {
        self.disconnect().await.ok();

        let scheme = if use_tls { "amqps" } else { "amqp" };
        let creds_in_url = !username.is_empty() && !sasl_anonymous;
        let url = if creds_in_url {
            format!("{scheme}://{username}:{password}@{host}:{port}")
        } else {
            format!("{scheme}://{host}:{port}")
        };

        let cid_owned;
        let cid: &str = if container_id.is_empty() {
            cid_owned = format!("amqpush-{}", uuid::Uuid::new_v4());
            &cid_owned
        } else {
            container_id
        };

        // Build connection with optional idle-timeout (heartbeat).
        let mut builder = Connection::builder().container_id(cid);
        if heartbeat_secs > 0 {
            // idle_time_out is in milliseconds
            builder = builder.idle_time_out(heartbeat_secs * 1000);
        }

        // Apply optional connect timeout
        let connect_fut = builder.open(&*url);
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
        if self.session.is_none() {
            return Err("Not connected".into());
        }

        let msg_id = Uuid::new_v4().to_string();
        let now = Local::now();
        let ts = now.format("%Y-%m-%d %H:%M:%S").to_string();
        let creation_ms = now.timestamp_millis();

        let mut props: OrderedMap<String, SimpleValue> = OrderedMap::new();

        if let Some(ref name) = file_name {
            props.insert("file_name".into(), SimpleValue::String(name.clone()));
            props.insert("is_file".into(), SimpleValue::Bool(true));
        } else {
            props.insert("is_file".into(), SimpleValue::Bool(false));
        }

        // Tag the message as ANYCAST routing — Artemis uses _AMQ_ROUTING_TYPE
        // to distinguish queue-style (1) vs topic-style (2) delivery. Without
        // this header Artemis assumes the address default; setting it explicitly
        // makes our messages indistinguishable from FESB-originated ones.
        props.insert(
            "_AMQ_ROUTING_TYPE".into(),
            SimpleValue::Byte(1),
        );

        for (k, v) in &custom_props {
            props.insert(k.clone(), SimpleValue::String(v.clone()));
        }

        let app_props = ApplicationProperties(props);

        // AMQP standard Properties — set message_id, creation_time and reply_to
        // so the message presents JMS-style metadata when inspected by FESB or
        // any other AMQP-aware management UI.
        let msg_props = Some(Properties {
            message_id: Some(fe2o3_amqp_types::messaging::MessageId::String(msg_id.clone().into())),
            creation_time: Some(Timestamp::from_milliseconds(creation_ms)),
            reply_to: reply_to.map(|s| s.into()),
            ..Default::default()
        });

        // Standard JMS-style header: durable=false, priority=4 (Artemis default).
        let msg_header = Some(Header {
            durable: false,
            priority: Priority(4),
            ..Default::default()
        });

        // We need to get the sender separately to avoid borrow conflict
        let addr = address.to_string();
        self.get_or_create_sender(&addr).await?;
        let sender = self.senders.get_mut(&addr).unwrap();

        if let Some(body) = text {
            let mut builder = Message::builder().application_properties(app_props);
            if let Some(h) = msg_header.clone() { builder = builder.header(h); }
            if let Some(p) = msg_props.clone()  { builder = builder.properties(p); }
            let msg = builder.value(body).build();
            sender.send(msg).await.map_err(|e| format!("Send failed: {e}"))?;
        } else if let Some(b64) = file_data_b64 {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&b64)
                .map_err(|e| format!("Base64: {e}"))?;
            let mut builder = Message::builder().application_properties(app_props);
            if let Some(h) = msg_header.clone() { builder = builder.header(h); }
            if let Some(p) = msg_props.clone()  { builder = builder.properties(p); }
            let msg = builder.data(bytes).build();
            sender.send(msg).await.map_err(|e| format!("Send failed: {e}"))?;
        } else {
            return Err("No body provided".into());
        }

        Ok(SendResult {
            message_id: msg_id,
            timestamp: ts,
            address: address.to_string(),
        })
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
