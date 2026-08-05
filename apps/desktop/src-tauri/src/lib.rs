pub mod capture;
pub mod keychain;
pub mod media;
pub mod readiness;
pub mod recording;
pub mod settings;
pub mod sidecar;
pub mod updater;
pub use readiness::{derive_readiness_snapshot, get_readiness_snapshot};

use crate::keychain::MacKeychainTokenStore;
use crate::settings::{AppSecrets, AppSettings, AppSettingsView, SettingsStore};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use sidecar::{
    get_sidecar_connection, ManagedSidecar, SidecarConnectionError, SidecarConnectionState,
    SidecarDiagnosticsState, SidecarRuntimeDiagnostics,
};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

const FEISHU_CALLBACK_PORT: u16 = 43_125;

#[derive(Default)]
struct RecordingSessionState(Mutex<Option<capture::ActiveRecordingHandle>>);

#[tauri::command]
fn validate_portrait_file(path: String) -> Result<media::PortraitInfo, String> {
    let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
    media::validate_portrait_bytes(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn validate_recording_file(path: String) -> Result<recording::RecordingInfo, String> {
    let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
    recording::validate_wav_bytes(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn capture_permission_status() -> capture::CapturePermissionSnapshot {
    #[cfg(target_os = "macos")]
    {
        capture::capture_permission_snapshot(
            &capture::avfoundation::AvFoundationCapturePermissionProvider,
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        capture::capture_permission_snapshot(&capture::UnavailableCapturePermissionProvider)
    }
}

#[tauri::command]
fn capture_portrait() -> Result<String, String> {
    let path = std::env::temp_dir().join(format!("voxstudio-portrait-{}.jpg", std::process::id()));
    capture::capture_portrait_to_file(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn capture_recording(duration_secs: Option<f32>) -> Result<String, String> {
    let duration_secs = duration_secs.unwrap_or(2.0).clamp(1.0, 30.0);
    let path = std::env::temp_dir().join(format!("voxstudio-recording-{}.wav", std::process::id()));
    tauri::async_runtime::spawn_blocking(move || {
        capture::capture_recording_to_file(&path, duration_secs)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn start_recording(state: tauri::State<'_, RecordingSessionState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "recording state unavailable".to_string())?;
    if guard.is_some() {
        return Err("recording is already active".to_string());
    }
    let path = std::env::temp_dir().join(format!("voxstudio-recording-{}.wav", std::process::id()));
    *guard = Some(capture::start_recording_session(path)?);
    Ok(())
}

#[tauri::command]
fn stop_recording(state: tauri::State<'_, RecordingSessionState>) -> Result<String, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "recording state unavailable".to_string())?;
    let handle = guard
        .take()
        .ok_or_else(|| "no active recording".to_string())?;
    capture::finish_recording_session(handle)
}

#[tauri::command]
fn delete_media_file(path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(path);
    let temp_dir = std::env::temp_dir();
    if !path.starts_with(&temp_dir) {
        return Err("only temporary media files can be deleted".to_string());
    }
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_captured_temp_media() -> Result<u32, String> {
    let candidates = stale_temp_media_candidates(&std::env::temp_dir());
    let mut deleted = 0_u32;
    for path in candidates {
        std::fs::remove_file(&path).map_err(|error| error.to_string())?;
        deleted += 1;
    }
    Ok(deleted)
}

/// Identifies leftover voxstudio temp media files (portraits/recordings) in a
/// directory. Extracted so cleanup can be verified without a live sidecar and
/// so a media resource leak test can assert that captured files are reclaimed.
pub fn stale_temp_media_candidates(temp_dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::new();
    let Ok(entries) = std::fs::read_dir(temp_dir) else {
        return candidates;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("voxstudio-portrait-") || name.starts_with("voxstudio-recording-") {
            candidates.push(entry.path());
        }
    }
    candidates
}

fn imported_media_path(prefix: &str, extension: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!(
        "{prefix}-{}-{nanos}.{extension}",
        std::process::id()
    ))
}

#[tauri::command]
fn pick_portrait_file() -> Result<String, String> {
    let selected = rfd::FileDialog::new()
        .add_filter("照片", &["jpg", "jpeg", "png", "heic"])
        .pick_file()
        .ok_or_else(|| "选择已取消".to_string())?;
    let extension = selected
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jpg")
        .to_ascii_lowercase();
    let extension = if extension == "jpeg" {
        String::from("jpg")
    } else {
        extension
    };
    let destination = imported_media_path("voxstudio-portrait", &extension);
    std::fs::copy(&selected, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn pick_recording_file() -> Result<String, String> {
    let selected = rfd::FileDialog::new()
        .add_filter("录音", &["wav"])
        .pick_file()
        .ok_or_else(|| "选择已取消".to_string())?;
    let destination = imported_media_path("voxstudio-recording", "wav");
    std::fs::copy(&selected, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

/// Opens the native "save" dialog and writes `content` to the chosen file.
/// Returns the saved path on success, `None` when the user cancels, and an
/// error when writing fails.
#[tauri::command]
fn save_text_file(default_name: String, content: String) -> Result<String, String> {
    let file = rfd::FileDialog::new()
        .add_filter("导出", &["md", "json", "txt"])
        .set_file_name(&default_name)
        .save_file()
        .ok_or_else(|| "选择已取消".to_string())?;
    std::fs::write(&file, content).map_err(|error| error.to_string())?;
    Ok(file.to_string_lossy().into_owned())
}

#[tauri::command]
fn load_app_settings(app: tauri::AppHandle) -> Result<AppSettingsView, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let store = SettingsStore::new(&data_dir, Box::new(MacKeychainTokenStore));
    let settings = store.load().map_err(|error| error.to_string())?;
    let secrets = store.load_secrets().map_err(|error| error.to_string())?;
    Ok(AppSettingsView {
        settings,
        remote_api_key_set: secrets.remote_api_key.is_some(),
        feishu_app_secret_set: secrets.feishu_app_secret.is_some(),
        feishu_access_token_set: secrets.feishu_access_token.is_some(),
        feishu_refresh_token_set: secrets.feishu_refresh_token.is_some(),
    })
}

#[tauri::command]
fn save_app_settings(
    app: tauri::AppHandle,
    settings: AppSettings,
    remote_api_key: Option<String>,
    feishu_app_secret: Option<String>,
    feishu_access_token: Option<String>,
    feishu_refresh_token: Option<String>,
) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let store = SettingsStore::new(&data_dir, Box::new(MacKeychainTokenStore));
    let mut secrets = store.load_secrets().map_err(|error| error.to_string())?;
    apply_secret(&mut secrets.remote_api_key, remote_api_key);
    apply_secret(&mut secrets.feishu_app_secret, feishu_app_secret);
    apply_secret(&mut secrets.feishu_access_token, feishu_access_token);
    apply_secret(&mut secrets.feishu_refresh_token, feishu_refresh_token);
    store
        .save(&settings, &secrets)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn reset_all_settings(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let store = SettingsStore::new(&data_dir, Box::new(MacKeychainTokenStore));
    store
        .save(&AppSettings::default(), &AppSecrets::default())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn restart_sidecar(
    app: tauri::AppHandle,
    sidecar: tauri::State<'_, ManagedSidecar>,
) -> Result<(), String> {
    sidecar.restart(&app).map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppDiagnostics {
    name: String,
    version: String,
    channel: String,
    commit: String,
    data_dir: Option<String>,
    connection: String,
    sidecar: SidecarRuntimeDiagnostics,
}

/// App + sidecar diagnostic summary safe to show in the UI and to bundle into a
/// user-exported diagnostic package. Deliberately excludes any secrets/tokens.
#[tauri::command]
fn get_app_diagnostics(
    app: tauri::AppHandle,
    connection: tauri::State<'_, SidecarConnectionState>,
    diagnostics: tauri::State<'_, SidecarDiagnosticsState>,
) -> Result<AppDiagnostics, String> {
    let connection = match connection.current() {
        Ok(connection) => format!("ready (baseUrl={})", connection.base_url()),
        Err(SidecarConnectionError::Unavailable) => "unavailable".to_string(),
        Err(SidecarConnectionError::FailedClosed) => "failed_closed".to_string(),
    };
    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|path| path.to_string_lossy().into_owned());
    Ok(AppDiagnostics {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        channel: std::env::var("VOXSTUDIO_CHANNEL").unwrap_or_else(|_| "stable".to_string()),
        commit: std::env::var("VOXSTUDIO_COMMIT").unwrap_or_else(|_| "unknown".to_string()),
        data_dir,
        connection,
        sidecar: diagnostics.snapshot(),
    })
}

#[tauri::command]
fn check_local_provider(url: String) -> Result<bool, String> {
    let host_port = url
        .strip_prefix("http://")
        .ok_or_else(|| "only http URLs are supported".to_string())?
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    if host_port.is_empty() {
        return Ok(false);
    }
    let address = host_port
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| "cannot resolve host".to_string())?;
    Ok(TcpStream::connect_timeout(&address, Duration::from_secs(2)).is_ok())
}

#[tauri::command]
fn check_remote_provider(url: String) -> Result<bool, String> {
    let is_https = url.starts_with("https://");
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or_else(|| "only http(s) URLs are supported".to_string())?;
    let host_port = without_scheme.split('/').next().unwrap_or("").to_string();
    if host_port.is_empty() {
        return Ok(false);
    }
    let (host, port) = match host_port.rsplit_once(':') {
        Some((host, port)) if port.parse::<u16>().is_ok() => {
            (host.to_string(), port.parse::<u16>().unwrap())
        }
        _ => (host_port, if is_https { 443 } else { 80 }),
    };
    let address = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| "cannot resolve host".to_string())?;
    Ok(TcpStream::connect_timeout(&address, Duration::from_secs(2)).is_ok())
}

pub fn feishu_authorization_url(app_id: &str, redirect_uri: &str) -> Result<String, String> {
    if app_id.trim().is_empty() || redirect_uri.trim().is_empty() {
        return Err("Feishu app id and redirect uri are required".to_string());
    }
    let encoded = utf8_percent_encode(redirect_uri, NON_ALPHANUMERIC);
    Ok(format!(
        "https://open.feishu.cn/open-apis/authen/v1/authorize?app_id={app_id}&redirect_uri={encoded}&state=voxstudio"
    ))
}

#[tauri::command]
fn open_feishu_authorization(app_id: String, redirect_uri: String) -> Result<String, String> {
    let url = feishu_authorization_url(&app_id, &redirect_uri)?;
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(url)
}

#[tauri::command]
fn open_system_permissions() -> Result<(), String> {
    // Opens the macOS Privacy & Security settings pane so users can grant
    // microphone/camera permissions the wizard asked about.
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy")
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn parse_feishu_code_from_request(request: &str) -> Result<String, String> {
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("");
    let query = path.split('?').nth(1).unwrap_or("");
    let code = query
        .split('&')
        .find_map(|part| part.strip_prefix("code="))
        .ok_or_else(|| "Feishu callback did not include a code".to_string())?;
    Ok(percent_encoding::percent_decode_str(code)
        .decode_utf8_lossy()
        .into_owned())
}

#[tauri::command]
fn start_feishu_oauth(app_id: String) -> Result<String, String> {
    let redirect_uri = format!("http://127.0.0.1:{FEISHU_CALLBACK_PORT}/oauth/feishu");
    let url = feishu_authorization_url(&app_id, &redirect_uri)?;
    let listener = TcpListener::bind(("127.0.0.1", FEISHU_CALLBACK_PORT))
        .map_err(|error| error.to_string())?;

    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|error| error.to_string())?;
    wait_for_feishu_callback(listener)
}

fn wait_for_feishu_callback(listener: TcpListener) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0_u8; 8192];
                let read = stream
                    .read(&mut buffer)
                    .map_err(|error| error.to_string())?;
                let code =
                    parse_feishu_code_from_request(&String::from_utf8_lossy(&buffer[..read]))?;
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
                );
                return Ok(code);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("Feishu authorization timed out".to_string());
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn apply_secret(target: &mut Option<String>, value: Option<String>) {
    match value {
        Some(value) if value.is_empty() => *target = None,
        Some(value) => *target = Some(value),
        None => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let connection_state = SidecarConnectionState::default();
            app.manage(RecordingSessionState::default());
            app.manage(connection_state.clone());
            app.manage(SidecarDiagnosticsState::default());
            app.manage(ManagedSidecar::start(app.handle(), connection_state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            readiness::get_readiness_snapshot,
            readiness::derive_readiness_snapshot,
            get_sidecar_connection,
            get_app_diagnostics,
            updater::get_update_config,
            validate_portrait_file,
            validate_recording_file,
            capture_permission_status,
            capture_portrait,
            capture_recording,
            start_recording,
            stop_recording,
            delete_media_file,
            delete_captured_temp_media,
            pick_portrait_file,
            pick_recording_file,
            save_text_file,
            load_app_settings,
            save_app_settings,
            reset_all_settings,
            restart_sidecar,
            check_local_provider,
            check_remote_provider,
            open_feishu_authorization,
            open_system_permissions,
            start_feishu_oauth
        ])
        .build(tauri::generate_context!())
        .expect("error while building VoxStudio");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            let managed = app_handle.state::<ManagedSidecar>();
            let _ = managed.shutdown();
        }
    });
}
