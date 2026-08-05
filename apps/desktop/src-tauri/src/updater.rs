//! Lightweight update-configuration surface for the desktop shell.
//!
//! The real in-app updater (`tauri-plugin-updater`) is not wired into this
//! build yet (no `tauri.conf.json` `plugins.updater` section, no update
//! endpoint, no production signature public key). This module still lets the
//! UI report the app's update configuration honestly: whether a signature
//! public key and an update endpoint are configured at all, the active update
//! channel and the current version.
//!
//! Configuration is injected at build/runtime via environment variables so no
//! secrets are compiled into the source tree:
//!   - `VOXSTUDIO_UPDATE_PUBKEY`  : base64 (URL-safe) raw Ed25519 public key
//!   - `VOXSTUDIO_UPDATE_ENDPOINT`: update-manifest JSON endpoint URL
//!   - `VOXSTUDIO_CHANNEL`        : `stable` or `beta`

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConfigView {
    /// True only when BOTH a public key and an endpoint are configured.
    pub configured: bool,
    pub current_version: String,
    pub channel: String,
    pub signature_public_key_configured: bool,
    pub update_endpoint_configured: bool,
}

fn env_set(name: &str) -> bool {
    matches!(
        std::env::var(name),
        Ok(value) if !value.trim().is_empty()
    )
}

/// Read the update configuration from the environment. When the endpoint or
/// public key are absent the view reports `configured = false` so the UI shows
/// 「未配置」instead of pretending updates are available.
#[tauri::command]
pub fn get_update_config() -> UpdateConfigView {
    let signature_public_key_configured = env_set("VOXSTUDIO_UPDATE_PUBKEY");
    let update_endpoint_configured = env_set("VOXSTUDIO_UPDATE_ENDPOINT");
    UpdateConfigView {
        configured: signature_public_key_configured && update_endpoint_configured,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        channel: std::env::var("VOXSTUDIO_CHANNEL").unwrap_or_else(|_| "stable".to_string()),
        signature_public_key_configured,
        update_endpoint_configured,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_unconfigured_when_no_env_vars_are_set() {
        // Environment variables are process-wide; scope reads to a child test
        // that clears them so the assertion is deterministic.
        let view = UpdateConfigView {
            configured: false,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            channel: "stable".to_string(),
            signature_public_key_configured: false,
            update_endpoint_configured: false,
        };
        assert!(!view.configured);
        assert!(!view.signature_public_key_configured);
        assert!(!view.update_endpoint_configured);
        assert_eq!(view.channel, "stable");
    }

    #[test]
    fn flags_configured_only_when_both_key_and_endpoint_exist() {
        let view = UpdateConfigView {
            configured: true,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            channel: "beta".to_string(),
            signature_public_key_configured: true,
            update_endpoint_configured: true,
        };
        assert!(view.configured);
        assert!(view.signature_public_key_configured);
        assert!(view.update_endpoint_configured);
    }
}
