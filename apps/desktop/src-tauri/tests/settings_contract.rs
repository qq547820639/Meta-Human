use voxstudio_desktop_lib::feishu_authorization_url;
use voxstudio_desktop_lib::keychain::MemoryTokenStore;
use voxstudio_desktop_lib::parse_feishu_code_from_request;
use voxstudio_desktop_lib::settings::{
    provider_environment, AppSecrets, AppSettings, SettingsStore,
};

#[test]
fn settings_round_trip_keeps_non_secret_fields() {
    let dir = std::env::temp_dir().join("voxstudio-settings-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let store = SettingsStore::new(&dir, Box::new(MemoryTokenStore::default()));
    let settings = AppSettings {
        local_base_url: Some("http://127.0.0.1:11434".into()),
        local_chat_model: Some("qwen".into()),
        feishu_space_id: Some("space-1".into()),
        ..AppSettings::default()
    };

    store
        .save(
            &settings,
            &AppSecrets {
                remote_api_key: Some("secret-key".into()),
                feishu_refresh_token: Some("refresh-token".into()),
                ..AppSecrets::default()
            },
        )
        .unwrap();

    assert_eq!(store.load().unwrap(), settings);
    let secrets = store.load_secrets().unwrap();
    assert_eq!(secrets.remote_api_key.as_deref(), Some("secret-key"));
    assert_eq!(
        secrets.feishu_refresh_token.as_deref(),
        Some("refresh-token")
    );
    let json = std::fs::read_to_string(dir.join("settings.json")).unwrap();
    assert!(!json.contains("secret-key"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn missing_settings_file_returns_defaults() {
    let dir = std::env::temp_dir().join("voxstudio-settings-missing");
    let _ = std::fs::remove_dir_all(&dir);
    let store = SettingsStore::new(&dir, Box::new(MemoryTokenStore::default()));

    assert_eq!(store.load().unwrap(), AppSettings::default());
    assert_eq!(store.load_secrets().unwrap(), AppSecrets::default());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn provider_environment_maps_settings_to_sidecar_variables() {
    let settings = AppSettings {
        local_base_url: Some("http://127.0.0.1:11434".into()),
        remote_base_url: Some("https://gpu.example.com".into()),
        remote_voice_enroll_path: Some("/v1/voice/enrollments".into()),
        remote_avatar_stream_stop_path: Some("/v1/avatar/streams/{session_id}".into()),
        feishu_space_id: Some("space-1".into()),
        ..AppSettings::default()
    };
    let secrets = AppSecrets {
        remote_api_key: Some("secret-key".into()),
        feishu_refresh_token: Some("refresh-token".into()),
        feishu_access_token: Some("access-token".into()),
        ..AppSecrets::default()
    };

    let env = provider_environment(&settings, &secrets);
    let map: std::collections::HashMap<String, String> = env
        .into_iter()
        .map(|(key, value)| {
            (
                key.to_string_lossy().into_owned(),
                value.to_string_lossy().into_owned(),
            )
        })
        .collect();

    assert_eq!(
        map.get("VOXSTUDIO_LOCAL_BASE_URL").map(String::as_str),
        Some("http://127.0.0.1:11434")
    );
    assert_eq!(
        map.get("VOXSTUDIO_REMOTE_API_KEY").map(String::as_str),
        Some("secret-key")
    );
    assert_eq!(
        map.get("VOXSTUDIO_FEISHU_ACCESS_TOKEN").map(String::as_str),
        Some("access-token")
    );
    assert_eq!(
        map.get("VOXSTUDIO_FEISHU_REFRESH_TOKEN")
            .map(String::as_str),
        Some("refresh-token")
    );
    assert_eq!(
        map.get("VOXSTUDIO_REMOTE_VOICE_ENROLL_PATH")
            .map(String::as_str),
        Some("/v1/voice/enrollments")
    );
    assert_eq!(
        map.get("VOXSTUDIO_REMOTE_AVATAR_STREAM_STOP_PATH")
            .map(String::as_str),
        Some("/v1/avatar/streams/{session_id}")
    );
}

#[test]
fn feishu_authorization_url_encodes_redirect_uri() {
    let url = feishu_authorization_url("cli_app", "http://127.0.0.1:1420/oauth/feishu").unwrap();

    assert!(url.contains("app_id=cli_app"));
    assert!(url.contains("redirect_uri=http"));
    assert!(url.contains("%3A"));
    assert!(url.contains("%2F"));
    assert!(url.contains("state=voxstudio"));
}

#[test]
fn feishu_callback_parses_percent_encoded_code() {
    let code = parse_feishu_code_from_request(
        "GET /oauth/feishu?code=abc%2Bdef&state=voxstudio HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
    )
    .unwrap();

    assert_eq!(code, "abc+def");
}
