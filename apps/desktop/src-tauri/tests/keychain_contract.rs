use voxstudio_desktop_lib::keychain::{
    KeychainError, MacKeychainTokenStore, MemoryTokenStore, TokenStore,
};

fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn memory_store_saves_loads_and_overwrites() {
    let store = MemoryTokenStore::default();

    store.save("voxstudio", "feishu", "token-one").unwrap();
    assert_eq!(store.load("voxstudio", "feishu").unwrap(), "token-one");

    store.save("voxstudio", "feishu", "token-two").unwrap();

    assert_eq!(store.load("voxstudio", "feishu").unwrap(), "token-two");
}

#[test]
fn memory_store_delete_removes_and_reports_not_found() {
    let store = MemoryTokenStore::default();
    store.save("voxstudio", "feishu", "token-one").unwrap();

    store.delete("voxstudio", "feishu").unwrap();

    assert_eq!(
        store.load("voxstudio", "feishu"),
        Err(KeychainError::NotFound)
    );
    assert_eq!(
        store.delete("voxstudio", "feishu"),
        Err(KeychainError::NotFound)
    );
}

#[test]
fn debug_output_never_contains_stored_secrets() {
    let store = MemoryTokenStore::default();
    store
        .save("voxstudio", "feishu", "super-secret-token")
        .unwrap();

    let debug = format!("{store:?}");

    assert!(!debug.contains("super-secret-token"));
    assert!(debug.contains("REDACTED"));
}

#[test]
fn mac_keychain_store_is_send_sync_and_redacted() {
    assert_send_sync::<MacKeychainTokenStore>();
    assert_send_sync::<MemoryTokenStore>();

    let debug = format!("{:?}", MacKeychainTokenStore);

    assert_eq!(debug, "MacKeychainTokenStore");
}
