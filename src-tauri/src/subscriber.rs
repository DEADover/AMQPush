use chrono::Local;
use fe2o3_amqp::{Receiver, Session};
use fe2o3_amqp_types::messaging::Body;
use fe2o3_amqp_types::primitives::Value;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::broker::{extract_peeked, PeekedMessage};

/// Live message pushed to the UI by the subscriber. Mirrors `PeekedMessage`
/// from broker.rs so Receive view can render the same rich detail panel as
/// Browser/peek (standard AMQP properties + application properties + body).
#[derive(Debug, Clone, Serialize)]
pub struct ReceivedMessage {
    pub id: String,
    pub timestamp: String,
    /// Truncated body text for the compact list view (`meta.body_text` for full).
    pub body: String,
    pub is_truncated: bool,
    /// Full AMQP metadata extracted from the delivery.
    pub meta: PeekedMessage,
    /// Queue (source address) this message arrived on. Used by the UI to tag
    /// messages in mixed multi-queue feeds.
    pub queue: String,
}

/// Per-queue lifecycle event payload. Used for `subscriber_reconnecting`,
/// `subscriber_reconnected`, `subscriber_error`, `subscriber_stopped`.
#[derive(Debug, Clone, Serialize)]
pub struct SubEvent {
    pub queue: String,
    /// Free-form payload — backoff_ms for reconnecting, error string for error,
    /// empty for reconnected/stopped.
    pub message: Option<String>,
}

pub struct SubscriberHandle {
    abort: tokio::task::AbortHandle,
}

impl SubscriberHandle {
    pub fn stop(&self) {
        self.abort.abort();
    }
}

#[derive(Clone)]
struct SubParams {
    host: String,
    port: u16,
    address: String,
    username: String,
    password: String,
    use_tls: bool,
    tls_skip_verify: bool,
}

async fn open_connection(p: &SubParams) -> Result<(Receiver, fe2o3_amqp::connection::ConnectionHandle<()>, fe2o3_amqp::session::SessionHandle<()>), String> {
    let mut connection = crate::amqp::open_connection(
        &p.host, p.port, &p.username, &p.password,
        p.use_tls, p.tls_skip_verify,
        "amqpush-sub", false, 0,
    )
    .await
    .map_err(|e| format!("Subscriber connection failed: {e}"))?;

    let mut session = Session::begin(&mut connection)
        .await
        .map_err(|e| format!("Subscriber session failed: {e}"))?;

    // Use a UUID-based link name so multiple receivers in the same session
    // don't collide on link names (some brokers reject duplicate names).
    let link_name = format!("amqpush-recv-{}", Uuid::new_v4());
    let receiver = Receiver::attach(&mut session, link_name, &p.address)
        .await
        .map_err(|e| format!("Subscriber link failed: {e}"))?;

    Ok((receiver, connection, session))
}

pub async fn start(
    host: &str,
    port: u16,
    address: String,
    username: &str,
    password: &str,
    use_tls: bool,
    tls_skip_verify: bool,
    app: AppHandle,
) -> Result<SubscriberHandle, String> {
    let params = SubParams {
        host: host.to_string(),
        port,
        address: address.clone(),
        username: username.to_string(),
        password: password.to_string(),
        use_tls,
        tls_skip_verify,
    };

    // Initial connection attempt (fail fast, surface error to UI)
    let (receiver, connection, session) = open_connection(&params).await?;

    let task = tokio::spawn(run_loop(receiver, connection, session, params, app, address));

    Ok(SubscriberHandle {
        abort: task.abort_handle(),
    })
}

async fn run_loop(
    mut receiver: Receiver,
    mut connection: fe2o3_amqp::connection::ConnectionHandle<()>,
    mut session: fe2o3_amqp::session::SessionHandle<()>,
    params: SubParams,
    app: AppHandle,
    queue: String,
) {
    const MAX_BODY_LEN: usize = 4096;
    const MAX_BACKOFF_MS: u64 = 30_000;
    let mut backoff_ms: u64 = 1_000;

    loop {
        match receiver.recv::<Body<Value>>().await {
            Ok(delivery) => {
                backoff_ms = 1_000; // reset on successful receive

                let meta = extract_peeked(&delivery);

                let body_text = meta.body_text.clone().unwrap_or_default();
                let is_truncated = body_text.len() > MAX_BODY_LEN;
                let body = if is_truncated {
                    let mut end = MAX_BODY_LEN;
                    while end > 0 && !body_text.is_char_boundary(end) {
                        end -= 1;
                    }
                    format!("{}…", &body_text[..end])
                } else {
                    body_text
                };

                let _ = receiver.accept(&delivery).await;
                app.emit(
                    "message_received",
                    ReceivedMessage {
                        id: Uuid::new_v4().to_string(),
                        timestamp: Local::now().format("%H:%M:%S").to_string(),
                        body,
                        is_truncated,
                        meta,
                        queue: queue.clone(),
                    },
                )
                .ok();
            }
            Err(_) => {
                // Best-effort cleanup of old connection
                let _ = receiver.detach().await;
                let _ = session.end().await;
                let _ = connection.close().await;

                // Notify UI: reconnecting (per-queue event)
                app.emit("subscriber_reconnecting", SubEvent {
                    queue: queue.clone(),
                    message: Some(backoff_ms.to_string()),
                }).ok();
                tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);

                // Try to reconnect
                match open_connection(&params).await {
                    Ok((r, c, s)) => {
                        receiver = r;
                        connection = c;
                        session = s;
                        app.emit("subscriber_reconnected", SubEvent {
                            queue: queue.clone(),
                            message: None,
                        }).ok();
                    }
                    Err(e) => {
                        app.emit("subscriber_error", SubEvent {
                            queue: queue.clone(),
                            message: Some(e),
                        }).ok();
                        app.emit("subscriber_stopped", SubEvent {
                            queue: queue.clone(),
                            message: None,
                        }).ok();
                        return;
                    }
                }
            }
        }
    }
}
