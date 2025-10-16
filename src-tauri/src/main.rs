#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use walkdir::WalkDir;

const LIBRARY_FILE: &str = "library.json";
const DOWNLOAD_BUFFER: usize = 1024 * 128;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InstallStatus {
    NotInstalled,
    Downloading,
    Installed,
    Archived,
}

impl Default for InstallStatus {
    fn default() -> Self {
        Self::NotInstalled
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameEntry {
    pub id: String,
    pub title: String,
    pub version: Option<String>,
    pub archive_path: Option<String>,
    pub install_path: Option<String>,
    pub executable_path: Option<String>,
    pub repacker: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub status: InstallStatus,
    pub notes: Option<String>,
    pub checksum: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    pub added_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GamePayload {
    title: String,
    version: Option<String>,
    archive_path: Option<String>,
    install_path: Option<String>,
    executable_path: Option<String>,
    repacker: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    status: InstallStatus,
    notes: Option<String>,
    checksum: Option<String>,
    color: Option<String>,
    size_override: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadQueuedPayload {
    id: String,
    file_name: String,
    destination: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressEvent {
    id: String,
    file_name: String,
    processed: u64,
    total: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadCompleteEvent {
    id: String,
    file_name: String,
    destination: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadErrorEvent {
    id: String,
    file_name: String,
    message: String,
}

#[tauri::command]
fn load_library(app: AppHandle) -> Result<Vec<GameEntry>, String> {
    read_library(&app)
        .map_err(|error| format!("Failed to load library: {error}"))
        .map(|mut collection| {
            collection.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            collection
        })
}

#[tauri::command]
fn add_game(app: AppHandle, payload: GamePayload) -> Result<GameEntry, String> {
    let mut library = read_library(&app).map_err(|error| error.to_string())?;
    let mut entry = game_from_payload(payload, None);
    entry.id = Uuid::new_v4().to_string();
    entry.added_at = Utc::now();
    entry.updated_at = entry.added_at;

    library.push(entry.clone());
    write_library(&app, &library).map_err(|error| error.to_string())?;

    Ok(entry)
}

#[tauri::command]
fn update_game(app: AppHandle, id: String, payload: GamePayload) -> Result<GameEntry, String> {
    let mut library = read_library(&app).map_err(|error| error.to_string())?;
    let mut entry = library
        .iter()
        .find(|game| game.id == id)
        .cloned()
        .ok_or_else(|| format!("Game {id} not found"))?;

    entry = game_from_payload(payload, Some(entry));
    entry.id = id.clone();
    entry.updated_at = Utc::now();

    if let Some(existing) = library.iter_mut().find(|game| game.id == id) {
        *existing = entry.clone();
    }

    write_library(&app, &library).map_err(|error| error.to_string())?;

    Ok(entry)
}

#[tauri::command]
fn remove_game(app: AppHandle, id: String) -> Result<(), String> {
    let mut library = read_library(&app).map_err(|error| error.to_string())?;
    let initial_len = library.len();
    library.retain(|game| game.id != id);

    if library.len() == initial_len {
        return Err(format!("Game {id} not found"));
    }

    write_library(&app, &library).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let resolved = PathBuf::from(&path);
    if !resolved.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let path_string = resolved.to_string_lossy().to_string();

    tauri::api::shell::open(&app.shell_scope(), path_string, None)
        .map_err(|error| format!("Failed to open path: {error}"))
}

#[tauri::command]
fn scan_path_size(path: String) -> Result<u64, String> {
    let target = PathBuf::from(path.clone());
    if !target.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    compute_path_size(&target).map_err(|error| error.to_string())
}

#[tauri::command]
fn queue_download(
    app: AppHandle,
    url: String,
    destination: String,
    file_name: Option<String>,
) -> Result<DownloadQueuedPayload, String> {
    if url.trim().is_empty() {
        return Err("URL cannot be empty".into());
    }
    if destination.trim().is_empty() {
        return Err("Destination cannot be empty".into());
    }

    let id = Uuid::new_v4().to_string();
    let resolved_destination = PathBuf::from(destination);
    let inferred_name = file_name
        .filter(|name| !name.trim().is_empty())
        .or_else(|| infer_file_name(&url))
        .unwrap_or_else(|| format!("download-{id}"));

    let mut target_path = resolved_destination.clone();
    if target_path.is_dir() || !target_path.as_path().extension().is_some() {
        target_path = target_path.join(&inferred_name);
    }

    if let Some(parent) = target_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return Err(format!("Failed to create destination folder: {error}"));
        }
    }

    let app_handle = app.clone();
    let url_clone = url.clone();
    let file_name_clone = inferred_name.clone();
    let destination_clone = target_path.clone();

    thread::spawn(move || {
        if let Err(error) = download_file(app_handle.clone(), &id, &url_clone, &destination_clone, &file_name_clone) {
            let _ = app_handle.emit_all(
                "download-error",
                DownloadErrorEvent {
                    id: id.clone(),
                    file_name: file_name_clone.clone(),
                    message: error.to_string(),
                },
            );
        } else {
            let _ = app_handle.emit_all(
                "download-complete",
                DownloadCompleteEvent {
                    id: id.clone(),
                    file_name: file_name_clone.clone(),
                    destination: destination_clone.to_string_lossy().to_string(),
                },
            );
        }
    });

    Ok(DownloadQueuedPayload {
        id,
        file_name: inferred_name,
        destination: target_path.to_string_lossy().to_string(),
    })
}

fn download_file(
    app: AppHandle,
    id: &str,
    url: &str,
    target: &Path,
    file_name: &str,
) -> Result<()> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .context("Failed to create HTTP client")?;

    let mut response = client.get(url).send().context("Failed to start download")?;

    if !response.status().is_success() {
        return Err(anyhow!("Download failed with status {}", response.status()));
    }

    let total = response.content_length();
    let mut file = File::create(target).context("Failed to create destination file")?;
    let mut downloaded: u64 = 0;
    let mut buffer = vec![0u8; DOWNLOAD_BUFFER];

    loop {
        let bytes_read = response.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        file.write_all(&buffer[..bytes_read])?;
        downloaded += bytes_read as u64;

        let _ = app.emit_all(
            "download-progress",
            DownloadProgressEvent {
                id: id.to_string(),
                file_name: file_name.to_string(),
                processed: downloaded,
                total,
            },
        );
    }

    file.flush()?;

    Ok(())
}

fn infer_file_name(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let last = parsed.path_segments()?.last()?;
    if last.is_empty() {
        None
    } else {
        Some(last.to_string())
    }
}

fn game_from_payload(payload: GamePayload, existing: Option<GameEntry>) -> GameEntry {
    let GamePayload {
        title,
        version,
        archive_path,
        install_path,
        executable_path,
        repacker,
        tags,
        status,
        notes,
        checksum,
        color,
        size_override,
    } = payload;

    let now = Utc::now();

    let mut entry = existing.unwrap_or_else(|| GameEntry {
        id: Uuid::new_v4().to_string(),
        title: String::new(),
        version: None,
        archive_path: None,
        install_path: None,
        executable_path: None,
        repacker: None,
        tags: Vec::new(),
        status: InstallStatus::default(),
        notes: None,
        checksum: None,
        color: None,
        size_bytes: None,
        added_at: now,
        updated_at: now,
    });

    let title = title.trim();
    entry.title = if title.is_empty() {
        "Untitled".to_string()
    } else {
        title.to_string()
    };

    let archive_path = archive_path.and_then(non_empty);
    let install_path = install_path.and_then(non_empty);
    let executable_path = executable_path.and_then(non_empty);

    entry.version = version.and_then(non_empty);
    entry.archive_path = archive_path.clone();
    entry.install_path = install_path.clone();
    entry.executable_path = executable_path;
    entry.repacker = repacker.and_then(non_empty);
    entry.tags = normalize_tags(tags);
    entry.status = status;
    entry.notes = notes.and_then(non_empty);
    entry.checksum = checksum.and_then(non_empty);
    entry.color = color.and_then(non_empty);

    if let Some(size) = size_override
        .or_else(|| {
            archive_path
                .as_ref()
                .or(install_path.as_ref())
                .and_then(|path| compute_path_size(Path::new(path)).ok())
        })
    {
        entry.size_bytes = Some(size);
    }

    entry
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn read_library(app: &AppHandle) -> Result<Vec<GameEntry>> {
    let path = resolve_library_path(app)?;

    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    let games: Vec<GameEntry> = serde_json::from_str(&content)?;
    Ok(games)
}

fn write_library(app: &AppHandle, games: &[GameEntry]) -> Result<()> {
    let path = resolve_library_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = serde_json::to_string_pretty(games)?;
    fs::write(path, payload)?;
    Ok(())
}

fn resolve_library_path(app: &AppHandle) -> Result<PathBuf> {
    let resolver = app.path_resolver();
    let base = resolver
        .app_config_dir()
        .or_else(|| resolver.app_data_dir())
        .context("Unable to resolve application data folder")?;
    fs::create_dir_all(&base)?;
    Ok(base.join(LIBRARY_FILE))
}

fn compute_path_size(path: &Path) -> Result<u64> {
    if path.is_file() {
        let metadata = fs::metadata(path)?;
        return Ok(metadata.len());
    }

    if path.is_dir() {
        let mut total: u64 = 0;
        for entry in WalkDir::new(path).follow_links(true) {
            let entry = entry?;
            if entry.file_type().is_file() {
                total += entry.metadata()?.len();
            }
        }
        return Ok(total);
    }

    Err(anyhow!("Unsupported path type"))
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut parsed: Vec<String> = Vec::new();

    for tag in tags {
        for value in tag.split(',') {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                parsed.push(trimmed.to_string());
            }
        }
    }

    parsed.sort();
    parsed.dedup();
    parsed
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_library,
            add_game,
            update_game,
            remove_game,
            open_path,
            scan_path_size,
            queue_download
        ])
        .setup(|app| {
            // ensure data directory exists on start
            let _ = resolve_library_path(&app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
