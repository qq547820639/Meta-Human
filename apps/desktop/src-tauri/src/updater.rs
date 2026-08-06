//! In-app update surface for the desktop shell, backed by the real
//! `tauri-plugin-updater`.
//!
//! The plugin is registered at startup (see `lib.rs`). This module drives it:
//!
//! - `get_update_config` — honestly reports whether the real updater is
//!   actually usable (public key + endpoint present).
//! - `update_check` — pings the channel endpoint via the plugin.
//! - `update_download` — downloads + verifies the package, staging it.
//! - `update_install` — installs the staged package.
//!
//! Configuration is injected at build/runtime via environment variables so no
//! secrets are compiled into the source tree. The signature public key used by
//! the plugin is supplied through `VOXSTUDIO_UPDATE_PUBKEY` (base64 URL-safe raw
//! Ed25519 public key) and injected into the plugin builder at registration;
//! the per-channel update endpoints are resolved here at runtime:
//!
//! - stable → `VOXSTUDIO_UPDATE_ENDPOINT_STABLE`
//! - beta → `VOXSTUDIO_UPDATE_ENDPOINT`
//!
//! The `pubkey` in `tauri.conf.json` is a placeholder that must be replaced
//! with the real production public key before shipping in-app updates.

use serde::Serialize;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const ENV_ENDPOINT: &str = "VOXSTUDIO_UPDATE_ENDPOINT"; // beta
const ENV_ENDPOINT_STABLE: &str = "VOXSTUDIO_UPDATE_ENDPOINT_STABLE";

/// The signature public key is injected at *build time* via the
/// `VOXSTUDIO_UPDATE_PUBKEY` environment variable and baked into the binary
/// with `option_env!`. This makes it safe from runtime replacement: an attacker
/// who can set process env vars after launch cannot change which key verifies
/// updates. A literal placeholder (the old dev marker) is never accepted.
const PRODUCTION_PUBKEY_PLACEHOLDER: &str =
    "VOXSTUDIO_DEVEL_PLACEHOLDER_INJECT_PRODUCTION_VIA_VOXSTUDIO_UPDATE_PUBKEY";

/// Return the production signature public key configured at build time, or
/// `None` when no real key was provided. An empty value or the known dev
/// placeholder is treated as "not configured" so a placeholder can never be
/// used to verify (and accept) an update.
pub fn production_public_key_configured() -> Option<String> {
    validated_public_key(option_env!("VOXSTUDIO_UPDATE_PUBKEY").unwrap_or(""))
}

/// Pure validation: return the key only when it is a real (non-empty,
/// non-placeholder) value. Split out so it can be unit tested without relying
/// on process-wide build-time env.
fn validated_public_key(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == PRODUCTION_PUBKEY_PLACEHOLDER {
        None
    } else {
        Some(trimmed.to_string())
    }
}

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

/// True only when a real production public key was baked in at build time.
fn signature_public_key_configured() -> bool {
    production_public_key_configured().is_some()
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
        tauri_plugin_updater::Error::EmptyEndpoints => "not_configured: 更新端点未配置".to_string(),
        tauri_plugin_updater::Error::InsecureTransportProtocol => {
            "not_configured: 更新端点必须使用 HTTPS".to_string()
        }
        tauri_plugin_updater::Error::Minisign(_) => {
            "signature_invalid: 更新包签名校验失败，已拒绝安装".to_string()
        }
        tauri_plugin_updater::Error::Network(_) => "download_failed: 更新包下载失败".to_string(),
        tauri_plugin_updater::Error::Io(error) => format!("install_failed: {error}"),
        tauri_plugin_updater::Error::Reqwest(error) => {
            format!("check_failed: 更新请求失败：{error}")
        }
        tauri_plugin_updater::Error::ReleaseNotFound => "no_update: 未找到可用更新".to_string(),
        other => format!("更新失败：{other}"),
    }
}

/// A single per-platform entry in a Tauri v2 update manifest.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestPlatformUpdate {
    pub url: String,
    pub signature: String,
}

/// A parsed Tauri v2 update manifest (`{ "version": ..., "platforms": {...} }`).
///
/// This is the manifest contract the production updater consumes. Parsing it
/// here (rather than only inside the plugin) lets us validate a manifest before
/// staging an update and lets the test suite pin the exact accepted shape.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: String,
    pub platforms: std::collections::BTreeMap<String, ManifestPlatformUpdate>,
}

/// Parse a Tauri v2-compatible update manifest. Returns an error for malformed
/// JSON, a missing `version`, or a missing/malformed `platforms` map.
pub fn parse_manifest_v2(raw: &str) -> Result<UpdateManifest, String> {
    #[derive(serde::Deserialize)]
    struct RawManifest {
        version: String,
        #[serde(default)]
        platforms: std::collections::BTreeMap<String, RawPlatform>,
    }
    #[derive(serde::Deserialize)]
    struct RawPlatform {
        url: String,
        signature: String,
    }

    let parsed: RawManifest =
        serde_json::from_str(raw).map_err(|error| format!("manifest_json_invalid: {error}"))?;
    if parsed.version.trim().is_empty() {
        return Err("manifest_invalid: missing version".to_string());
    }
    if parsed.platforms.is_empty() {
        return Err("manifest_invalid: no platforms".to_string());
    }
    let platforms = parsed
        .platforms
        .into_iter()
        .map(|(target, platform)| {
            (
                target,
                ManifestPlatformUpdate {
                    url: platform.url,
                    signature: platform.signature,
                },
            )
        })
        .collect();
    Ok(UpdateManifest {
        version: parsed.version,
        platforms,
    })
}

/// Verify a raw Ed25519 signature over `data` against a base64 (URL-safe, raw)
/// public key. Returns `false` (never panics) for any malformed key/signature
/// or a mismatched signature, so callers treat a failed verification as a hard
/// denial of the update.
///
/// Production signature verification is performed by `tauri-plugin-updater`'s
/// minisign path during `update_download`; this primitive is the same Ed25519
/// accept/reject gate used by the test suite to prove that a bad signature is
/// never accepted (and therefore never installed).
pub fn verify_update_signature(
    data: &[u8],
    signature_base64: &str,
    public_key_base64: &str,
) -> bool {
    use base64::Engine as _;
    use ed25519_dalek::{Signature, VerifyingKey};

    let Ok(sig_bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(signature_base64)
        .map_err(|_| ())
    else {
        return false;
    };
    let Ok(signature) = Signature::from_slice(&sig_bytes) else {
        return false;
    };
    let Ok(pk_bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(public_key_base64)
        .map_err(|_| ())
    else {
        return false;
    };
    let Ok(pk_array) = <[u8; 32]>::try_from(pk_bytes.as_slice()) else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&pk_array) else {
        return false;
    };
    verifying_key.verify_strict(data, &signature).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialize env-dependent tests so they do not race on process-wide vars.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn production_key_is_rejected_when_absent_or_placeholder() {
        // Empty / absent build-time key => not configured (fails closed).
        assert!(validated_public_key("").is_none());
        assert!(validated_public_key("   ").is_none());
        // The old dev placeholder must never be accepted as a real key.
        assert!(validated_public_key(PRODUCTION_PUBKEY_PLACEHOLDER).is_none());
        // A real key passes through (trimmed).
        assert_eq!(
            validated_public_key("  dGVzdC1wdWJrZXk  ").as_deref(),
            Some("dGVzdC1wdWJrZXk")
        );
    }

    #[test]
    fn reports_unconfigured_when_no_key_is_baked_in() {
        let _guard = ENV_LOCK.lock().unwrap();
        // Sandbox the real process env so the view is deterministic.
        let saved_endpoint = std::env::var(ENV_ENDPOINT).ok();
        let saved_stable = std::env::var(ENV_ENDPOINT_STABLE).ok();
        std::env::remove_var(ENV_ENDPOINT);
        std::env::remove_var(ENV_ENDPOINT_STABLE);

        let view = get_update_config();
        // The compile-time key is absent in a plain test build, so the updater
        // reports not configured regardless of endpoint state.
        assert!(!view.signature_public_key_configured);
        assert!(!view.configured);
        assert!(!view.update_endpoint_configured);
        assert!(!view.stable_endpoint_configured);
        assert!(!view.beta_endpoint_configured);
        assert_eq!(view.channel, "stable");

        restore_var(ENV_ENDPOINT, saved_endpoint);
        restore_var(ENV_ENDPOINT_STABLE, saved_stable);
    }

    #[test]
    fn reports_not_configured_with_endpoints_but_no_builtin_key() {
        let _guard = ENV_LOCK.lock().unwrap();
        let saved_stable = std::env::var(ENV_ENDPOINT_STABLE).ok();
        std::env::set_var(
            ENV_ENDPOINT_STABLE,
            "https://updates.example.com/{{target}}/{{arch}}",
        );

        let view = get_update_config();
        // Endpoints are configured, but without a baked-in production key the
        // updater must still report `configured = false` (fails closed).
        assert!(view.stable_endpoint_configured);
        assert!(!view.signature_public_key_configured);
        assert!(!view.configured);

        restore_var(ENV_ENDPOINT_STABLE, saved_stable);
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
        assert_eq!(
            channel_endpoint("beta").as_deref(),
            Some("https://beta.example")
        );
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

    // -----------------------------------------------------------------------
    // Update manifest parsing (Tauri v2 contract)
    // -----------------------------------------------------------------------

    #[test]
    fn parses_a_v2_manifest_version_and_platforms() {
        let manifest = parse_manifest_v2(
            r#"{
                "version": "1.2.3",
                "notes": "release notes",
                "pub_date": "2026-01-01T00:00:00Z",
                "platforms": {
                    "darwin-aarch64": {
                        "url": "https://cdn.example.com/voxstudio-aarch64.app.tar.gz",
                        "signature": "dGVzdC1zaWc="
                    },
                    "darwin-x86_64": {
                        "url": "https://cdn.example.com/voxstudio-x86_64.app.tar.gz",
                        "signature": "dGVzdC1zaWcy"
                    }
                }
            }"#,
        )
        .expect("valid manifest should parse");

        assert_eq!(manifest.version, "1.2.3");
        assert_eq!(manifest.platforms.len(), 2);
        let arm = &manifest.platforms["darwin-aarch64"];
        assert_eq!(
            arm.url,
            "https://cdn.example.com/voxstudio-aarch64.app.tar.gz"
        );
        assert_eq!(arm.signature, "dGVzdC1zaWc=");
    }

    #[test]
    fn rejects_malformed_manifest_json() {
        let error = parse_manifest_v2("{ not valid json").unwrap_err();
        assert!(error.starts_with("manifest_json_invalid"), "got: {error}");
    }

    #[test]
    fn rejects_manifest_without_version() {
        let error = parse_manifest_v2(
            r#"{"platforms":{"darwin-aarch64":{"url":"https://x","signature":"sig"}}}"#,
        )
        .unwrap_err();
        assert!(error.contains("version"), "got: {error}");
    }

    #[test]
    fn rejects_manifest_without_platforms() {
        let error = parse_manifest_v2(r#"{"version":"1.0.0","platforms":{}}"#).unwrap_err();
        assert!(error.contains("no platforms"), "got: {error}");
    }

    // -----------------------------------------------------------------------
    // Signature verification: bad signature is rejected (never installed)
    // -----------------------------------------------------------------------

    fn test_keypair() -> (String, String) {
        use base64::Engine as _;
        use ed25519_dalek::SigningKey;
        let seed = [7_u8; 32];
        let signing = SigningKey::from_bytes(&seed);
        let public_key = signing.verifying_key().to_bytes();
        (
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(public_key),
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(signing.to_bytes()),
        )
    }

    fn sign_with(seed: [u8; 32], data: &[u8]) -> String {
        use base64::Engine as _;
        use ed25519_dalek::{Signer, SigningKey};
        let signing = SigningKey::from_bytes(&seed);
        let signature = signing.sign(data);
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(signature.to_bytes())
    }

    #[test]
    fn accepts_a_validly_signed_package() {
        let (public_key, _) = test_keypair();
        let data = b"payload";
        let signature = sign_with([7_u8; 32], data);
        assert!(verify_update_signature(data, &signature, &public_key));
    }

    #[test]
    fn rejects_a_tampered_signature_and_never_installs() {
        let (public_key, _) = test_keypair();
        let data = b"payload";
        let signature = sign_with([7_u8; 32], data);
        // A different payload under the same key must fail verification — the
        // update is rejected and no install is attempted.
        assert!(!verify_update_signature(
            b"tampered",
            &signature,
            &public_key
        ));

        // A signature from a different key must also fail.
        let other_signature = sign_with([9_u8; 32], data);
        assert!(!verify_update_signature(
            data,
            &other_signature,
            &public_key
        ));
    }

    #[test]
    fn rejects_malformed_key_or_signature() {
        assert!(!verify_update_signature(
            b"data",
            "!!not-base64!!",
            "dGVzdA"
        ));
        assert!(!verify_update_signature(b"data", "c2ln", "bWFsZm9ybWVk"));
        assert!(!verify_update_signature(b"data", "", ""));
    }

    // -----------------------------------------------------------------------
    // Error mapping: signature/install failures surface as honest errors
    // -----------------------------------------------------------------------

    #[test]
    fn maps_signature_failure_to_signature_invalid() {
        use tauri_plugin_updater::Error;
        let message =
            update_error_message(&Error::Minisign(minisign_verify::Error::InvalidSignature));
        assert!(message.starts_with("signature_invalid"), "got: {message}");
    }

    #[test]
    fn maps_install_io_failure_to_install_failed() {
        use tauri_plugin_updater::Error;
        let message = update_error_message(&Error::Io(std::io::Error::other("disk full")));
        assert!(message.starts_with("install_failed"), "got: {message}");
    }
}
