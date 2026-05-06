use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

mod amqp;
mod profiles;
mod queues;
mod subscriber;

use amqp::{AmqpClient, HistoryEntry, SendResult};
use profiles::Profile;
use queues::SavedQueue;
use subscriber::SubscriberHandle;

pub struct AppState {
    client: Arc<Mutex<AmqpClient>>,
    sub: Arc<Mutex<Option<SubscriberHandle>>>,
    history: Arc<Mutex<Vec<HistoryEntry>>>,
}

// ── connection ────────────────────────────────────────────────────────────────

#[tauri::command]
async fn connect(
    state: tauri::State<'_, AppState>,
    host: String,
    port: u16,
    address: String,
    username: String,
    password: String,
    use_tls: bool,
) -> Result<(), String> {
    let mut client = state.client.lock().await;
    client.connect(&host, port, &address, &username, &password, use_tls).await
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
) -> Result<SendResult, String> {
    let result = {
        let mut client = state.client.lock().await;
        client
            .send_message(&address, text.clone(), file_name.clone(), file_data_b64.clone(), custom_props.clone())
            .await?
    };

    // Record history
    let mut history = state.history.lock().await;
    let body_preview = text
        .as_deref()
        .map(|t| t.chars().take(120).collect::<String>())
        .unwrap_or_else(|| format!("(file: {})", file_name.as_deref().unwrap_or("?")));

    history.push(HistoryEntry {
        id: result.message_id.clone(),
        timestamp: result.timestamp.clone(),
        address: address.clone(),
        body_preview,
        body_full: text,
        is_file: file_name.is_some(),
        file_name,
        properties: custom_props,
    });
    // Keep last 200 entries
    if history.len() > 200 {
        let drain_to = history.len() - 200;
        history.drain(0..drain_to);
    }

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

// ── entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        client: Arc::new(Mutex::new(AmqpClient::new())),
        sub: Arc::new(Mutex::new(None)),
        history: Arc::new(Mutex::new(Vec::new())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
