//! In-app update surface for the desktop shell, backed by the real
//! `tauri-plugin-updater`.
//!
//! The plugin is registered at startup (see `lib.rs`). This module drives it:
//!   - `get_update_config`        : honestly reports whether the real updater is
//!                                  actually usable (public key + endpoint present).
//!   - `update_check`             : pings the channel endpoint via the plugin.
//!   - `update_download`          : downloads + verifies the package, staging it.
//!   - `update_install`           : installs the staged package.
//!
//! Configuration is injected at build/runtime via environment variables so no
//! secrets are compiled into the source tree. The signature public key used by
//! the plugin is supplied through `VOXSTUDIO_UPDATE_PUBKEY` (base64 URL-safe raw
//! Ed25519 public key) and injected into the plugin builder at registration;
//! the per-channel update endpoints are resolved here at runtime:
//!   - stable → `VOXSTUDIO_UPDATE_ENDPOINT_STABLE`
//!   - beta   → `VOXSTUDIO_UPDATE_ENDPOINT`
//! The `pubkey` in `tauri.conf.json` is a placeholder that must be replaced with
//! the real production public key before shipping in-app updates.

use serde::Serialize;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const ENV_ENDPOINT: &str = "VOXSTUDIO_UPDATE_ENDPOINT"; // beta
const ENV_ENDPOINT_STABLE: &str = "VOXSTUDIO_UPDATE_ENDPOINT_STABLE";
const ENV_PUBKEY: &str = "VOXSTUDIO_UPDATE_PUBKEY";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConfigView {
    /// True only when the signature public key AND at least one channel endpoint
    /// are configured — i.e. the real updater could actually run.
    pub configured: bool,
    pub current_version: String,
    pub channel: String,
    pub signature_public_key_configured: bool,
    pub update_endpoint_configured: bool,
    pub stable_endpoint_configured: bool,
    pub beta_endpoint_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckView {
    pub available: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressView {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

/// A fully downloaded + signature-verified update, staged until install.
pub struct StagedUpdate {
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}

#[derive(Default)]
pub struct UpdateState(pub Mutex<Option<StagedUpdate>>);

fn env_set(name: &str) -> bool {
    matches!(
        std::env::var(name),
        Ok(value) if !value.trim().is_empty()
    )
}

/// The update endpoint URL for a channel, read from the environment.
pub fn channel_endpoint(channel: &str) -> Option<String> {
    let variable = if channel == "beta" {
        ENV_ENDPOINT
    } else {
        ENV_ENDPOINT_STABLE
    };
    std::env::var(variable)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn signature_public_key_configured() -> bool {
    env_set(ENV_PUBKEY)
}

/// Build a plugin `Updater` pinned to the given channel's endpoint.
fn build_updater(
    app: &tauri::AppHandle,
    channel: &str,
) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoint =
        channel_endpoint(channel).ok_or_else(|| "not_configured: 更新端点未配置".to_string())?;
    let url = Url::parse(&endpoint).map_err(|error| format!("无效更新端点：{error}"))?;
    let updater_builder = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|error| error.to_string())?;
    updater_builder
        .build()
        .map_err(|error| update_error_message(&error))
}

/// Read the update configuration from the environment. When the endpoint or
/// public key are absent the view reports `configured = false` so the UI shows
/// 「未配置」instead of pretending updates are available.
#[tauri::command]
pub fn get_update_config() -> UpdateConfigView {
    let stable_endpoint_configured = channel_endpoint("stable").is_some();
    let beta_endpoint_configured = channel_endpoint("beta").is_some();
    let update_endpoint_configured = stable_endpoint_configured || beta_endpoint_configured;
    let signature_public_key_configured = signature_public_key_configured();
    UpdateConfigView {
        configured: signature_public_key_configured && update_endpoint_configured,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        channel: std::env::var("VOXSTUDIO_CHANNEL").unwrap_or_else(|_| "stable".to_string()),
        signature_public_key_configured,
        update_endpoint_configured,
        stable_endpoint_configured,
        beta_endpoint_configured,
    }
}

/// Check the configured channel endpoint for a newer version.
#[tauri::command]
pub async fn update_check(
    app: tauri::AppHandle,
    channel: String,
) -> Result<UpdateCheckView, String> {
    let updater = build_updater(&app, &channel)?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheckView {
            available: true,
            version: Some(update.version.to_string()),
        }),
        Ok(None) => Ok(UpdateCheckView {
            available: false,
            version: None,
        }),
        Err(error) => Err(update_error_message(&error)),
    }
}

/// Download and cryptographically verify the available update package for the
/// channel, streaming progress to `on_progress`, and stage it for install.
#[tauri::command]
pub async fn update_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
    channel: String,
    on_progress: Channel<UpdateProgressView>,
) -> Result<(), String> {
    let updater = build_updater(&app, &channel)?;
    let update = updater
        .check()
        .await
        .map_err(|error| update_error_message(&error))?
        .ok_or_else(|| "no_update: 当前已是最新版本".to_string())?;

    let mut downloaded_bytes: u64 = 0;
    let bytes = update
        .download(
            |chunk_length: usize, content_length: Option<u64>| {
                downloaded_bytes += chunk_length as u64;
                let _ = on_progress.send(UpdateProgressView {
                    downloaded_bytes,
                    total_bytes: content_length,
                });
            },
            || {},
        )
        .await
        .map_err(|error| update_error_message(&error))?;

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "update state unavailable".to_string())?;
    *guard = Some(StagedUpdate { update, bytes });
    Ok(())
}

/// Install the staged update package and restart the app.
#[tauri::command]
pub async fn update_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    let staged = {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "update state unavailable".to_string())?;
        guard
            .take()
            .ok_or_else(|| "no_update: 尚未下载更新包".to_string())?
    };
    staged
        .update
        .install(&staged.bytes)
        .map_err(|error| update_error_message(&error))?;
    // The installer restarts the app on success (macOS handles this in
    // `install_inner`); nothing further is needed here.
    let _ = app;
    Ok(())
}

fn update_error_message(error: &tauri_plugin_updater::Error) -> String {
    match error {
        tauri_plugin_updater::Error::EmptyEndpoints => {
            "not_configured: 更新端点未配置".to_string()
        }
        tauri_plugin_updater::Error::InsecureTransportProtocol => {
            "not_configured: 更新端点必须使用 HTTPS".to_string()
        }
        tauri_plugin_updater::Error::Minisign(_) => {
            "signature_invalid: 更新包签名校验失败，已拒绝安装".to_string()
        }
        tauri_plugin_updater::Error::Network(_) => {
            "download_failed: 更新包下载失败".to_string()
        }
        tauri_plugin_updater::Error::Io(error) => format!("install_failed: {error}"),
        tauri_plugin_updater::Error::Reqwest(error) => {
            format!("check_failed: 更新请求失败：{error}")
        }
        tauri_plugin_updater::Error::ReleaseNotFound => {
            "no_update: 未找到可用更新".to_string()
        }
        other => format!("更新失败：{other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialize env-dependent tests so they do not race on process-wide vars.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn reports_unconfigured_when_no_env_vars_are_set() {
        let _guard = ENV_LOCK.lock().unwrap();
        // Sandbox the real process env so the assertion is deterministic.
        let saved_endpoint = std::env::var(ENV_ENDPOINT).ok();
        let saved_stable = std::env::var(ENV_ENDPOINT_STABLE).ok();
        let saved_pubkey = std::env::var(ENV_PUBKEY).ok();
        std::env::remove_var(ENV_ENDPOINT);
        std::env::remove_var(ENV_ENDPOINT_STABLE);
        std::env::remove_var(ENV_PUBKEY);

        let view = get_update_config();
        assert!(!view.configured);
        assert!(!view.signature_public_key_configured);
        assert!(!view.update_endpoint_configured);
        assert!(!view.stable_endpoint_configured);
        assert!(!view.beta_endpoint_configured);
        assert_eq!(view.channel, "stable");

        restore_var(ENV_ENDPOINT, saved_endpoint);
        restore_var(ENV_ENDPOINT_STABLE, saved_stable);
        restore_var(ENV_PUBKEY, saved_pubkey);
    }

    #[test]
    fn reports_configured_when_both_key_and_an_endpoint_exist() {
        let _guard = ENV_LOCK.lock().unwrap();
        let saved_stable = std::env::var(ENV_ENDPOINT_STABLE).ok();
        let saved_pubkey = std::env::var(ENV_PUBKEY).ok();
        std::env::set_var(
            ENV_ENDPOINT_STABLE,
            "https://updates.example.com/{{target}}/{{arch}}",
        );
        std::env::set_var(ENV_PUBKEY, "dGVzdC1wdWJrZXk");

        let view = get_update_config();
        assert!(view.configured);
        assert!(view.signature_public_key_configured);
        assert!(view.stable_endpoint_configured);
        assert!(!view.beta_endpoint_configured);

        restore_var(ENV_ENDPOINT_STABLE, saved_stable);
        restore_var(ENV_PUBKEY, saved_pubkey);
    }

    #[test]
    fn channel_endpoint_reads_beta_and_stable_variables() {
        let _guard = ENV_LOCK.lock().unwrap();
        let saved_stable = std::env::var(ENV_ENDPOINT_STABLE).ok();
        let saved_beta = std::env::var(ENV_ENDPOINT).ok();
        std::env::set_var(ENV_ENDPOINT_STABLE, "https://stable.example");
        std::env::set_var(ENV_ENDPOINT, "https://beta.example");

        assert_eq!(
            channel_endpoint("stable").as_deref(),
            Some("https://stable.example")
        );
        assert_eq!(channel_endpoint("beta").as_deref(), Some("https://beta.example"));
        // Unknown channels fall back to the stable endpoint.
        assert_eq!(
            channel_endpoint("release").as_deref(),
            Some("https://stable.example")
        );

        restore_var(ENV_ENDPOINT_STABLE, saved_stable);
        restore_var(ENV_ENDPOINT, saved_beta);
    }

    fn restore_var(name: &str, value: Option<String>) {
        match value {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }
}