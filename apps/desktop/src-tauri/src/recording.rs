use std::fmt;

use serde::Serialize;

pub const MAX_RECORDING_BYTES: usize = 25 * 1024 * 1024;
pub const MIN_RECORDING_DURATION_MILLIS: u64 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub duration_millis: u64,
    pub sample_rate: u32,
    pub bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingError {
    Empty,
    TooLarge,
    InvalidWav,
    TooShort,
}

impl fmt::Display for RecordingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Empty => "recording is empty",
            Self::TooLarge => "recording exceeds the size limit",
            Self::InvalidWav => "recording is not a valid WAV file",
            Self::TooShort => "recording is too short",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for RecordingError {}

pub fn validate_wav_bytes(bytes: &[u8]) -> Result<RecordingInfo, RecordingError> {
    if bytes.is_empty() {
        return Err(RecordingError::Empty);
    }
    if bytes.len() > MAX_RECORDING_BYTES {
        return Err(RecordingError::TooLarge);
    }
    if bytes.len() < 44 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(RecordingError::InvalidWav);
    }

    let Some(sample_rate) = u32_at(bytes, 24) else {
        return Err(RecordingError::InvalidWav);
    };
    let Some(byte_rate) = u32_at(bytes, 28) else {
        return Err(RecordingError::InvalidWav);
    };
    let Some(data_size) = u32_at(bytes, 40) else {
        return Err(RecordingError::InvalidWav);
    };
    if sample_rate == 0 || byte_rate == 0 {
        return Err(RecordingError::InvalidWav);
    }

    let duration_millis = u64::from(data_size) * 1_000 / u64::from(byte_rate);
    if duration_millis < MIN_RECORDING_DURATION_MILLIS {
        return Err(RecordingError::TooShort);
    }

    Ok(RecordingInfo {
        duration_millis,
        sample_rate,
        bytes: bytes.len(),
    })
}

fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes(slice.try_into().ok()?))
}
