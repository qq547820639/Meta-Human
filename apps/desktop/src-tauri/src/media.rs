use std::fmt;

use serde::Serialize;

pub const MAX_PORTRAIT_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PortraitFormat {
    Jpeg,
    Png,
    Heic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortraitInfo {
    pub format: PortraitFormat,
    pub bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaError {
    Empty,
    TooLarge,
    UnsupportedFormat,
}

impl fmt::Display for MediaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Empty => "portrait file is empty",
            Self::TooLarge => "portrait file exceeds the size limit",
            Self::UnsupportedFormat => "portrait format is not supported",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for MediaError {}

pub fn validate_portrait_bytes(bytes: &[u8]) -> Result<PortraitInfo, MediaError> {
    if bytes.is_empty() {
        return Err(MediaError::Empty);
    }
    if bytes.len() > MAX_PORTRAIT_BYTES {
        return Err(MediaError::TooLarge);
    }

    let format = if is_jpeg(bytes) {
        PortraitFormat::Jpeg
    } else if is_png(bytes) {
        PortraitFormat::Png
    } else if is_heic(bytes) {
        PortraitFormat::Heic
    } else {
        return Err(MediaError::UnsupportedFormat);
    };

    Ok(PortraitInfo {
        format,
        bytes: bytes.len(),
    })
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && bytes[..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
}

fn is_heic(bytes: &[u8]) -> bool {
    bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"heic" | b"heix" | b"mif1")
}
