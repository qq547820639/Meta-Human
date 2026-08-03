use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use keyring::Entry;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeychainError {
    StoreUnavailable,
    NotFound,
    OperationFailed,
}

impl fmt::Display for KeychainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::StoreUnavailable => "keychain store is unavailable",
            Self::NotFound => "keychain entry was not found",
            Self::OperationFailed => "keychain operation failed",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for KeychainError {}

pub trait TokenStore: Send + Sync {
    fn save(&self, service: &str, account: &str, secret: &str) -> Result<(), KeychainError>;
    fn load(&self, service: &str, account: &str) -> Result<String, KeychainError>;
    fn delete(&self, service: &str, account: &str) -> Result<(), KeychainError>;
}

#[derive(Default)]
pub struct MemoryTokenStore {
    entries: Mutex<HashMap<(String, String), String>>,
}

impl TokenStore for MemoryTokenStore {
    fn save(&self, service: &str, account: &str, secret: &str) -> Result<(), KeychainError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| KeychainError::OperationFailed)?;
        entries.insert((service.to_owned(), account.to_owned()), secret.to_owned());
        Ok(())
    }

    fn load(&self, service: &str, account: &str) -> Result<String, KeychainError> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| KeychainError::OperationFailed)?;
        entries
            .get(&(service.to_owned(), account.to_owned()))
            .cloned()
            .ok_or(KeychainError::NotFound)
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), KeychainError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| KeychainError::OperationFailed)?;
        entries
            .remove(&(service.to_owned(), account.to_owned()))
            .map(|_| ())
            .ok_or(KeychainError::NotFound)
    }
}

impl fmt::Debug for MemoryTokenStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MemoryTokenStore")
            .field("entries", &"[REDACTED]")
            .finish()
    }
}

#[derive(Default)]
pub struct MacKeychainTokenStore;

impl TokenStore for MacKeychainTokenStore {
    fn save(&self, service: &str, account: &str, secret: &str) -> Result<(), KeychainError> {
        let entry = Entry::new(service, account).map_err(|_| KeychainError::StoreUnavailable)?;
        entry
            .set_password(secret)
            .map_err(|_| KeychainError::OperationFailed)
    }

    fn load(&self, service: &str, account: &str) -> Result<String, KeychainError> {
        let entry = Entry::new(service, account).map_err(|_| KeychainError::StoreUnavailable)?;
        entry.get_password().map_err(|error| match error {
            keyring::Error::NoEntry => KeychainError::NotFound,
            _ => KeychainError::StoreUnavailable,
        })
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), KeychainError> {
        let entry = Entry::new(service, account).map_err(|_| KeychainError::StoreUnavailable)?;
        entry.delete_credential().map_err(|error| match error {
            keyring::Error::NoEntry => KeychainError::NotFound,
            _ => KeychainError::OperationFailed,
        })
    }
}

impl fmt::Debug for MacKeychainTokenStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("MacKeychainTokenStore")
    }
}
