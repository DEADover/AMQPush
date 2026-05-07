use chrono::Local;
use fe2o3_amqp::{Connection, Receiver, Session};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct ReceivedMessage {
    pub id: String,
    pub body: String,
    pub timestamp: String,
    pub is_truncated: bool,
}

pub struct SubscriberHandle {
    abort: tokio::task::AbortHandle,
}

impl SubscriberHandle {
    pub fn stop(&self) {
        self.abort.abort();
    }
}

struct SubParams {
    host: String,
    port: u16,
    address: String,
    username: String,
    password: String,
    use_tls: bool,
}

async fn open_connection(p: &SubParams) -> Result<(Receiver, fe2o3_amqp::connection::ConnectionHandle<()>, fe2o3_amqp::session::SessionHandle<()>), String> {
    let scheme = if p.use_tls { "amqps" } else { "amqp" };
    let url = if !p.username.is_empty() {
        format!("{scheme}://{}:{}@{}:{}", p.username, p.password, p.host, p.port)
    } else {
        format!("{scheme}://{}:{}", p.host, p.port)
    };

    let mut connection = Connection::open("amqpush-sub", &*url)
        .await
        .map_err(|e| format!("Subscriber connection failed: {e}"))?;

    let mut session = Session::begin(&mut connection)
        .await
        .map_err(|e| format!("Subscriber session failed: {e}"))?;

    let receiver = Receiver::attach(&mut session, "amqpush-recv", &p.address)
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
    app: AppHandle,
) -> Result<SubscriberHandle, String> {
    let params = SubParams {
        host: host.to_string(),
        port,
        address,
        username: username.to_string(),
        password: password.to_string(),
        use_tls,
    };

    // Initial connection attempt (fail fast, surface error to UI)
    let (receiver, connection, session) = open_connection(&params).await?;

    let task = tokio::spawn(run_loop(receiver, connection, session, params, app));

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
) {
    const MAX_BODY_LEN: usize = 4096;
    const MAX_BACKOFF_MS: u64 = 30_000;
    let mut backoff_ms: u64 = 1_000;

    loop {
        match receiver.recv::<String>().await {
            Ok(delivery) => {
                backoff_ms = 1_000; // reset on successful receive

                let raw = delivery.body().clone();
                let is_truncated = raw.len() > MAX_BODY_LEN;
                let body = if is_truncated {
                    format!("{}…", &raw[..MAX_BODY_LEN])
                } else {
                    raw
                };

                let _ = receiver.accept(&delivery).await;
                app.emit(
                    "message_received",
                    ReceivedMessage {
                        id: Uuid::new_v4().to_string(),
                        body,
                        timestamp: Local::now().format("%H:%M:%S").to_string(),
                        is_truncated,
                    },
                )
                .ok();
            }
            Err(_) => {
                // Best-effort cleanup of old connection
                let _ = receiver.detach().await;
                let _ = session.end().await;
                let _ = connection.close().await;

                // Notify UI: reconnecting
                app.emit("subscriber_reconnecting", backoff_ms).ok();
                tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);

                // Try to reconnect
                match open_connection(&params).await {
                    Ok((r, c, s)) => {
                        receiver = r;
                        connection = c;
                        session = s;
                        app.emit("subscriber_reconnected", ()).ok();
                    }
                    Err(e) => {
                        app.emit("subscriber_error", e).ok();
                        app.emit("subscriber_stopped", ()).ok();
                        return;
                    }
                }
            }
        }
    }
}
