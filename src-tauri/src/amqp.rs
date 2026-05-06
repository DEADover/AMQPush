use base64::Engine;
use chrono::Local;
use fe2o3_amqp::connection::ConnectionHandle;
use fe2o3_amqp::session::SessionHandle;
use fe2o3_amqp::{Connection, Sender, Session};
use fe2o3_amqp_types::messaging::{ApplicationProperties, Message};
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
    pub body_preview: String,
    pub body_full: Option<String>,
    pub is_file: bool,
    pub file_name: Option<String>,
    pub properties: HashMap<String, String>,
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

    pub async fn connect(
        &mut self,
        host: &str,
        port: u16,
        address: &str,
        username: &str,
        password: &str,
        use_tls: bool,
    ) -> Result<(), String> {
        self.disconnect().await.ok();

        let scheme = if use_tls { "amqps" } else { "amqp" };
        let url = if !username.is_empty() {
            format!("{scheme}://{username}:{password}@{host}:{port}")
        } else {
            format!("{scheme}://{host}:{port}")
        };

        let mut connection = Connection::open("amqpush", &*url)
            .await
            .map_err(|e| format!("Connection failed: {e}"))?;

        let mut session = Session::begin(&mut connection)
            .await
            .map_err(|e| format!("Session failed: {e}"))?;

        // Pre-attach sender for the default address
        let sender = Sender::attach(&mut session, "amqpush-default", address)
            .await
            .map_err(|e| format!("Link failed: {e}"))?;

        self.senders.insert(address.to_string(), sender);
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
    ) -> Result<SendResult, String> {
        if self.session.is_none() {
            return Err("Not connected".into());
        }

        let msg_id = Uuid::new_v4().to_string();
        let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let mut props: OrderedMap<String, SimpleValue> = OrderedMap::new();
        props.insert("message_id".into(), SimpleValue::String(msg_id.clone()));
        props.insert("timestamp".into(), SimpleValue::String(ts.clone()));

        if let Some(ref name) = file_name {
            props.insert("file_name".into(), SimpleValue::String(name.clone()));
            props.insert("is_file".into(), SimpleValue::Bool(true));
        } else {
            props.insert("is_file".into(), SimpleValue::Bool(false));
        }
        for (k, v) in &custom_props {
            props.insert(k.clone(), SimpleValue::String(v.clone()));
        }

        let app_props = ApplicationProperties(props);

        // We need to get the sender separately to avoid borrow conflict
        let addr = address.to_string();
        self.get_or_create_sender(&addr).await?;
        let sender = self.senders.get_mut(&addr).unwrap();

        if let Some(body) = text {
            let msg = Message::builder()
                .application_properties(app_props)
                .value(body)
                .build();
            sender.send(msg).await.map_err(|e| format!("Send failed: {e}"))?;
        } else if let Some(b64) = file_data_b64 {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&b64)
                .map_err(|e| format!("Base64: {e}"))?;
            let msg = Message::builder()
                .application_properties(app_props)
                .data(bytes)
                .build();
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
