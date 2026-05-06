use chrono::Local;
use fe2o3_amqp::connection::ConnectionHandle;
use fe2o3_amqp::session::SessionHandle;
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

pub async fn start(
    host: &str,
    port: u16,
    address: String,
    username: &str,
    password: &str,
    use_tls: bool,
    app: AppHandle,
) -> Result<SubscriberHandle, String> {
    let scheme = if use_tls { "amqps" } else { "amqp" };
    let url = if !username.is_empty() {
        format!("{scheme}://{username}:{password}@{host}:{port}")
    } else {
        format!("{scheme}://{host}:{port}")
    };

    let mut connection = Connection::open("amqpush-sub", &*url)
        .await
        .map_err(|e| format!("Subscriber connection failed: {e}"))?;

    let mut session = Session::begin(&mut connection)
        .await
        .map_err(|e| format!("Subscriber session failed: {e}"))?;

    let receiver = Receiver::attach(&mut session, "amqpush-recv", &address)
        .await
        .map_err(|e| format!("Subscriber link failed: {e}"))?;

    let task = tokio::spawn(run_loop(receiver, connection, session, app));

    Ok(SubscriberHandle {
        abort: task.abort_handle(),
    })
}

async fn run_loop(
    mut receiver: Receiver,
    mut connection: ConnectionHandle<()>,
    mut session: SessionHandle<()>,
    app: AppHandle,
) {
    const MAX_BODY_LEN: usize = 4096;

    loop {
        match receiver.recv::<String>().await {
            Ok(delivery) => {
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
            Err(e) => {
                app.emit("subscriber_error", e.to_string()).ok();
                break;
            }
        }
    }

    // best-effort cleanup (may not run if task is aborted)
    let _ = receiver.detach().await;
    let _ = session.end().await;
    let _ = connection.close().await;
    app.emit("subscriber_stopped", ()).ok();
}
