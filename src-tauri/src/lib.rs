use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use fe2o3_amqp::{Connection, Receiver, Session};

mod amqp;
mod broker;
mod history_store;
mod profiles;
mod queues;
mod subscriber;
mod templates;

use amqp::{AmqpClient, HistoryEntry, SendResult};
use broker::{BrokerQueue, ManagementChannel, PeekedMessage};
use profiles::Profile;
use queues::SavedQueue;
use subscriber::SubscriberHandle;
use templates::Template;

pub struct AppState {
    client: Arc<Mutex<AmqpClient>>,
    sub: Arc<Mutex<Option<SubscriberHandle>>>,
    history: Arc<Mutex<Vec<HistoryEntry>>>,
    /// Persistent management channel — opened lazily on first list_broker_queues
    /// call, reused across polls. Closed on disconnect.
    mgmt: Arc<Mutex<Option<ManagementChannel>>>,
}

// ── connection ────────────────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn connect(
    state: tauri::State<'_, AppState>,
    host: String,
    port: u16,
    address: String,
    username: String,
    password: String,
    use_tls: bool,
    container_id: Option<String>,
    heartbeat_secs: Option<u32>,
    connect_timeout_secs: Option<u32>,
    sasl_anonymous: Option<bool>,
) -> Result<(), String> {
    let mut client = state.client.lock().await;
    client
        .connect(
            &host,
            port,
            &address,
            &username,
            &password,
            use_tls,
            container_id.as_deref().unwrap_or(""),
            heartbeat_secs.unwrap_or(0),
            connect_timeout_secs.unwrap_or(10),
            sasl_anonymous.unwrap_or(false),
        )
        .await
}

#[tauri::command]
async fn disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    // Stop subscriber if running
    {
        let mut sub = state.sub.lock().await;
        if let Some(h) = sub.take() {
            h.stop();
        }
    }
    // Close management channel cleanly
    {
        let mut mgmt = state.mgmt.lock().await;
        if let Some(chan) = mgmt.take() {
            chan.close().await;
        }
    }
    let mut client = state.client.lock().await;
    client.disconnect().await
}

#[tauri::command]
async fn connection_info(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    let client = state.client.lock().await;
    Ok(client.connection_info())
}

// ── messaging ─────────────────────────────────────────────────────────────────

#[tauri::command]
async fn send_message(
    state: tauri::State<'_, AppState>,
    address: String,
    text: Option<String>,
    file_name: Option<String>,
    file_data_b64: Option<String>,
    custom_props: HashMap<String, String>,
    reply_to: Option<String>,
    profile: Option<String>,
) -> Result<SendResult, String> {
    let reply_to_for_history = reply_to.clone();
    let result = {
        let mut client = state.client.lock().await;
        client
            .send_message(&address, text.clone(), file_name.clone(), file_data_b64.clone(), custom_props.clone(), reply_to)
            .await?
    };

    // Record history
    let mut history = state.history.lock().await;
    let body_preview = text
        .as_deref()
        .map(|t| t.chars().take(120).collect::<String>())
        .unwrap_or_else(|| format!("(file: {})", file_name.as_deref().unwrap_or("?")));

    // Store file content only for small files (≤ ~2 MB base64) so we can resend
    // without re-picking. Larger files are skipped to avoid bloating history.
    const MAX_BASE64_KEEP: usize = 2 * 1024 * 1024 + 4096;
    let kept_file_data = file_data_b64
        .as_ref()
        .filter(|b| b.len() <= MAX_BASE64_KEEP)
        .cloned();

    // Capture everything that goes on the wire alongside user-set custom_props.
    // Mirrors the construction in amqp::send_message.
    let mut auto_properties: HashMap<String, String> = HashMap::new();
    auto_properties.insert("message-id".into(), result.message_id.clone());
    auto_properties.insert("creation-time".into(), result.timestamp.clone());
    auto_properties.insert("priority".into(), "4".into());
    auto_properties.insert("durable".into(), "false".into());
    if let Some(ref rt) = reply_to_for_history {
        auto_properties.insert("reply-to".into(), rt.clone());
    }
    auto_properties.insert("_AMQ_ROUTING_TYPE".into(), "1".into());
    auto_properties.insert("is_file".into(), file_name.is_some().to_string());
    if let Some(ref name) = file_name {
        auto_properties.insert("file_name".into(), name.clone());
    }

    history.push(HistoryEntry {
        id: result.message_id.clone(),
        timestamp: result.timestamp.clone(),
        address: address.clone(),
        profile: profile.filter(|s| !s.is_empty()),
        body_preview,
        body_full: text,
        is_file: file_name.is_some(),
        file_name,
        file_data_b64: kept_file_data,
        properties: custom_props,
        auto_properties,
    });
    // Keep last 200 entries
    if history.len() > 200 {
        let drain_to = history.len() - 200;
        history.drain(0..drain_to);
    }

    // Persist to disk so history survives app restarts
    history_store::save(&history);

    Ok(result)
}

// ── subscriber ────────────────────────────────────────────────────────────────

#[tauri::command]
async fn start_subscriber(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    address: String,
) -> Result<(), String> {
    let (host, port, username, password, use_tls) = {
        let client = state.client.lock().await;
        if !client.is_connected() {
            return Err("Not connected to broker".into());
        }
        (
            client.host.clone(),
            client.port,
            client.username.clone(),
            client.password.clone(),
            client.use_tls,
        )
    };

    let handle =
        subscriber::start(&host, port, address, &username, &password, use_tls, app).await?;

    let mut sub = state.sub.lock().await;
    if let Some(old) = sub.replace(handle) {
        old.stop();
    }
    Ok(())
}

#[tauri::command]
async fn stop_subscriber(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut sub = state.sub.lock().await;
    if let Some(h) = sub.take() {
        h.stop();
    }
    Ok(())
}

// ── history ───────────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_history(state: tauri::State<'_, AppState>) -> Result<Vec<HistoryEntry>, String> {
    let history = state.history.lock().await;
    Ok(history.iter().rev().cloned().collect())
}

#[tauri::command]
async fn clear_history(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut history = state.history.lock().await;
    history.clear();
    history_store::save(&history);
    Ok(())
}

// ── profiles ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_profiles() -> Vec<Profile> {
    profiles::load_all()
}

#[tauri::command]
fn save_profile(profile: Profile) -> Result<(), String> {
    profiles::save(profile)
}

#[tauri::command]
fn delete_profile(name: String) -> Result<(), String> {
    profiles::delete(&name)
}

// ── saved queues ──────────────────────────────────────────────────────────────

#[tauri::command]
fn get_saved_queues() -> Vec<SavedQueue> {
    queues::load_all()
}

#[tauri::command]
fn save_queue(queue: SavedQueue) -> Result<(), String> {
    queues::save(queue)
}

#[tauri::command]
fn delete_queue(name: String) -> Result<(), String> {
    queues::delete(&name)
}

// ── templates ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_templates() -> Vec<Template> {
    templates::load_all()
}

#[tauri::command]
fn save_template(template: Template) -> Result<(), String> {
    templates::save(template);
    Ok(())
}

#[tauri::command]
fn delete_template(name: String) -> Result<(), String> {
    templates::delete(&name);
    Ok(())
}

/// Try to attach a sender link to `address`. On brokers with auto-create-queues
/// (ActiveMQ Classic/Artemis default config) this creates the queue if absent.
/// Returns Ok(()) if the address is reachable, Err if the broker refuses it.
#[tauri::command]
async fn verify_queue(
    state: tauri::State<'_, AppState>,
    address: String,
) -> Result<(), String> {
    let mut client = state.client.lock().await;
    client.verify_queue(&address).await
}

// ── broker management (Artemis / ActiveMQ Classic with AMQP) ────────────────

#[tauri::command]
async fn list_broker_queues(state: tauri::State<'_, AppState>) -> Result<Vec<BrokerQueue>, String> {
    let (host, port, username, password, use_tls) = {
        let client = state.client.lock().await;
        if !client.is_connected() {
            return Err("Not connected".into());
        }
        (
            client.host.clone(),
            client.port,
            client.username.clone(),
            client.password.clone(),
            client.use_tls,
        )
    };

    let mut mgmt_guard = state.mgmt.lock().await;

    // Lazily open the management channel on first use
    if mgmt_guard.is_none() {
        let chan = ManagementChannel::open(&host, port, &username, &password, use_tls).await?;
        *mgmt_guard = Some(chan);
    }

    // Try the call. On failure, drop the channel — next call will reopen.
    let chan = mgmt_guard.as_mut().expect("just opened");
    match broker::list_queues_via(chan).await {
        Ok(list) => Ok(list),
        Err(e) => {
            // Channel may be in a bad state — close it so next call re-opens fresh
            if let Some(c) = mgmt_guard.take() {
                c.close().await;
            }
            Err(e)
        }
    }
}

#[tauri::command]
async fn peek_messages(
    state: tauri::State<'_, AppState>,
    queue: String,
    max: u32,
    timeout_ms: u64,
) -> Result<Vec<PeekedMessage>, String> {
    let (host, port, username, password, use_tls) = {
        let client = state.client.lock().await;
        if !client.is_connected() {
            return Err("Not connected".into());
        }
        (
            client.host.clone(),
            client.port,
            client.username.clone(),
            client.password.clone(),
            client.use_tls,
        )
    };
    broker::peek_messages(&host, port, &username, &password, use_tls, &queue, max, timeout_ms)
        .await
}

// ── request-reply ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn await_reply(
    state: tauri::State<'_, AppState>,
    address: String,
    timeout_ms: u64,
) -> Result<Option<String>, String> {
    let (host, port, username, password, use_tls) = {
        let client = state.client.lock().await;
        if !client.is_connected() {
            return Err("Not connected".into());
        }
        (client.host.clone(), client.port, client.username.clone(), client.password.clone(), client.use_tls)
    };

    let scheme = if use_tls { "amqps" } else { "amqp" };
    let url = if !username.is_empty() {
        format!("{scheme}://{username}:{password}@{host}:{port}")
    } else {
        format!("{scheme}://{host}:{port}")
    };

    let mut connection = Connection::open("amqpush-reply", &*url)
        .await
        .map_err(|e| format!("Reply conn failed: {e}"))?;
    let mut session = Session::begin(&mut connection)
        .await
        .map_err(|e| format!("Reply session failed: {e}"))?;
    let mut receiver = Receiver::attach(&mut session, "amqpush-reply-recv", &address)
        .await
        .map_err(|e| format!("Reply link failed: {e}"))?;

    let result = tokio::time::timeout(
        tokio::time::Duration::from_millis(timeout_ms),
        receiver.recv::<String>(),
    )
    .await;

    let _ = receiver.detach().await;
    let _ = session.end().await;
    let _ = connection.close().await;

    match result {
        Ok(Ok(delivery)) => Ok(Some(delivery.body().clone())),
        Ok(Err(e)) => Err(format!("Receive error: {e}")),
        Err(_) => Ok(None), // timeout
    }
}

// ── export ────────────────────────────────────────────────────────────────────

fn csv_escape(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\"").replace('\n', " ").replace('\r', ""))
}

#[tauri::command]
async fn export_history(
    state: tauri::State<'_, AppState>,
    format: String,
) -> Result<String, String> {
    let history = state.history.lock().await;

    let filename = format!(
        "amqpush-history-{}.{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        format
    );
    let dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_default();
    let path = dir.join(&filename);

    let content = if format == "csv" {
        let mut out = String::from("id,timestamp,address,body\n");
        for e in history.iter() {
            let body = e.body_full.as_deref().unwrap_or(&e.body_preview);
            out.push_str(&format!(
                "{},{},{},{}\n",
                csv_escape(&e.id),
                csv_escape(&e.timestamp),
                csv_escape(&e.address),
                csv_escape(body)
            ));
        }
        out
    } else {
        serde_json::to_string_pretty(&*history).map_err(|e| e.to_string())?
    };

    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

// ── entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        client: Arc::new(Mutex::new(AmqpClient::new())),
        sub: Arc::new(Mutex::new(None)),
        history: Arc::new(Mutex::new(history_store::load())),
        mgmt: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            connection_info,
            send_message,
            start_subscriber,
            stop_subscriber,
            get_history,
            clear_history,
            get_profiles,
            save_profile,
            delete_profile,
            get_saved_queues,
            save_queue,
            delete_queue,
            verify_queue,
            get_templates,
            save_template,
            delete_template,
            export_history,
            await_reply,
            list_broker_queues,
            peek_messages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
