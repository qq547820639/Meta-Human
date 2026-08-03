use voxstudio_desktop_lib::recording::{validate_wav_bytes, RecordingError, RecordingInfo};

fn wav_bytes(data_size: u32, sample_rate: u32, byte_rate: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&byte_rate.to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    bytes.resize(bytes.len() + data_size as usize, 0);
    bytes
}

#[test]
fn valid_wav_reports_duration_and_sample_rate() {
    let bytes = wav_bytes(32_000, 16_000, 32_000);

    assert_eq!(
        validate_wav_bytes(&bytes).unwrap(),
        RecordingInfo {
            duration_millis: 1_000,
            sample_rate: 16_000,
            bytes: bytes.len(),
        }
    );
}

#[test]
fn invalid_wav_is_rejected() {
    assert_eq!(
        validate_wav_bytes(b"not a wav"),
        Err(RecordingError::InvalidWav)
    );
}

#[test]
fn too_short_wav_is_rejected() {
    let bytes = wav_bytes(1_000, 16_000, 32_000);

    assert_eq!(validate_wav_bytes(&bytes), Err(RecordingError::TooShort));
}

#[test]
fn oversized_recording_is_rejected() {
    let mut bytes = wav_bytes(1_000, 16_000, 32_000);
    bytes.resize(25 * 1024 * 1024 + 1, 0);

    assert_eq!(validate_wav_bytes(&bytes), Err(RecordingError::TooLarge));
}
