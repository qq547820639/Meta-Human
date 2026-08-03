use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::keychain::{KeychainError, TokenStore};

pub const SETTINGS_SERVICE: &str = "io.voxstudio.desktop";
const REMOTE_API_KEY_ACCOUNT: &str = "remote-api-key";
const FEISHU_APP_SECRET_ACCOUNT: &str = "feishu-app-secret";
const FEISHU_ACCESS_TOKEN_ACCOUNT: &str = "feishu-access-token";
const FEISHU_REFRESH_TOKEN_ACCOUNT: &str = "feishu-refresh-token";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub local_base_url: Option<String>,
    pub local_chat_model: Option<String>,
    pub local_embedding_model: Option<String>,
    pub local_stt_model: Option<String>,
    pub local_timeout_seconds: Option<f64>,
    pub remote_base_url: Option<String>,
    pub remote_tts_voice: Option<String>,
    pub remote_voice_enroll_path: Option<String>,
    pub remote_avatar_enroll_path: Option<String>,
    pub remote_avatar_stream_path: Option<String>,
    pub remote_avatar_stream_stop_path: Option<String>,
    pub remote_tts_path: Option<String>,
    pub feishu_app_id: Option<String>,
    pub feishu_space_id: Option<String>,
    pub feishu_base_url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct AppSecrets {
    pub remote_api_key: Option<String>,
    pub feishu_app_secret: Option<String>,
    pub feishu_access_token: Option<String>,
    pub feishu_refresh_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsView {
    #[serde(flatten)]
    pub settings: AppSettings,
    pub remote_api_key_set: bool,
    pub feishu_app_secret_set: bool,
    pub feishu_access_token_set: bool,
    pub feishu_refresh_token_set: bool,
}

#[derive(Debug)]
pub enum SettingsError {
    Io(String),
    Json(String),
    Keychain(String),
}

impl fmt::Display for SettingsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Io(error) => format!("settings io error: {error}"),
            Self::Json(error) => format!("settings json error: {error}"),
            Self::Keychain(error) => format!("settings keychain error: {error}"),
        };
        formatter.write_str(&message)
    }
}

impl std::error::Error for SettingsError {}

pub struct SettingsStore {
    path: PathBuf,
    token_store: Box<dyn TokenStore>,
}

impl SettingsStore {
    pub fn new(data_dir: &Path, token_store: Box<dyn TokenStore>) -> Self {
        Self {
            path: data_dir.join("settings.json"),
            token_store,
        }
    }

    pub fn load(&self) -> Result<AppSettings, SettingsError> {
        if !self.path.is_file() {
            return Ok(AppSettings::default());
        }
        let text =
            fs::read_to_string(&self.path).map_err(|error| SettingsError::Io(error.to_string()))?;
        serde_json::from_str(&text).map_err(|error| SettingsError::Json(error.to_string()))
    }

    pub fn save(&self, settings: &AppSettings, secrets: &AppSecrets) -> Result<(), SettingsError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| SettingsError::Io(error.to_string()))?;
        }
        let json = serde_json::to_string_pretty(settings)
            .map_err(|error| SettingsError::Json(error.to_string()))?;
        fs::write(&self.path, json).map_err(|error| SettingsError::Io(error.to_string()))?;
        self.save_secret(REMOTE_API_KEY_ACCOUNT, secrets.remote_api_key.as_deref())?;
        self.save_secret(
            FEISHU_APP_SECRET_ACCOUNT,
            secrets.feishu_app_secret.as_deref(),
        )?;
        self.save_secret(
            FEISHU_ACCESS_TOKEN_ACCOUNT,
            secrets.feishu_access_token.as_deref(),
        )?;
        self.save_secret(
            FEISHU_REFRESH_TOKEN_ACCOUNT,
            secrets.feishu_refresh_token.as_deref(),
        )?;
        Ok(())
    }

    pub fn load_secrets(&self) -> Result<AppSecrets, SettingsError> {
        Ok(AppSecrets {
            remote_api_key: self.load_secret(REMOTE_API_KEY_ACCOUNT)?,
            feishu_app_secret: self.load_secret(FEISHU_APP_SECRET_ACCOUNT)?,
            feishu_access_token: self.load_secret(FEISHU_ACCESS_TOKEN_ACCOUNT)?,
            feishu_refresh_token: self.load_secret(FEISHU_REFRESH_TOKEN_ACCOUNT)?,
        })
    }

    fn save_secret(&self, account: &str, value: Option<&str>) -> Result<(), SettingsError> {
        match value {
            Some(value) => self
                .token_store
                .save(SETTINGS_SERVICE, account, value)
                .map_err(|error| SettingsError::Keychain(error.to_string())),
            None => {
                let _ = self.token_store.delete(SETTINGS_SERVICE, account);
                Ok(())
            }
        }
    }

    fn load_secret(&self, account: &str) -> Result<Option<String>, SettingsError> {
        match self.token_store.load(SETTINGS_SERVICE, account) {
            Ok(value) => Ok(Some(value)),
            Err(KeychainError::NotFound) => Ok(None),
            Err(error) => Err(SettingsError::Keychain(error.to_string())),
        }
    }
}

pub fn provider_environment(
    settings: &AppSettings,
    secrets: &AppSecrets,
) -> Vec<(OsString, OsString)> {
    let mut values = Vec::new();
    push(
        &mut values,
        "VOXSTUDIO_LOCAL_BASE_URL",
        settings.local_base_url.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_LOCAL_CHAT_MODEL",
        settings.local_chat_model.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_LOCAL_EMBEDDING_MODEL",
        settings.local_embedding_model.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_LOCAL_STT_MODEL",
        settings.local_stt_model.as_deref(),
    );
    if let Some(timeout) = settings.local_timeout_seconds {
        values.push((
            OsString::from("VOXSTUDIO_LOCAL_TIMEOUT_SECONDS"),
            OsString::from(timeout.to_string()),
        ));
    }
    push(
        &mut values,
        "VOXSTUDIO_REMOTE_BASE_URL",
        settings.remote_base_url.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_REMOTE_API_KEY",
        secrets.remote_api_key.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_REMOTE_TTS_VOICE",
        settings.remote_tts_voice.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_REMOTE_VOICE_ENROLL_PATH",
        settings.remote_voice_enroll_path.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_REMOTE_AVATAR_ENROLL_PATH",
        settings.remote_avatar_enroll_path.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_REMOTE_AVATAR_STREAM_PATH",
        settings.remote_avatar_stream_path.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_REMOTE_AVATAR_STREAM_STOP_PATH",
        settings.remote_avatar_stream_stop_path.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_REMOTE_TTS_PATH",
        settings.remote_tts_path.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_FEISHU_APP_ID",
        settings.feishu_app_id.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_FEISHU_APP_SECRET",
        secrets.feishu_app_secret.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_FEISHU_ACCESS_TOKEN",
        secrets.feishu_access_token.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_FEISHU_REFRESH_TOKEN",
        secrets.feishu_refresh_token.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_FEISHU_SPACE_ID",
        settings.feishu_space_id.as_deref(),
    );
    push(
        &mut values,
        "VOXSTUDIO_FEISHU_BASE_URL",
        settings.feishu_base_url.as_deref(),
    );
    values
}

fn push(values: &mut Vec<(OsString, OsString)>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        values.push((OsString::from(key), OsString::from(value)));
    }
}
