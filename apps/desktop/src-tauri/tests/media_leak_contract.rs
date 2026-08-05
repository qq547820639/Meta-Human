use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use voxstudio_desktop_lib::stale_temp_media_candidates;

/// Creates a unique temp sub-directory so the leak test never touches the
/// real system temp dir and never races with other tests.
fn temp_scaffold() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("voxstudio-leak-test-{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, b"bytes").unwrap();
    path
}

#[test]
fn stale_media_candidates_ignore_unrelated_temp_files() {
    let dir = temp_scaffold();
    let unrelated = write(&dir, "unrelated.txt");
    let other = write(&dir, "voxstudio-config.json");

    let candidates = stale_temp_media_candidates(&dir);

    assert!(candidates.is_empty());
    fs::remove_file(&unrelated).unwrap();
    fs::remove_file(&other).unwrap();
    fs::remove_dir(&dir).unwrap_or_default();
}

#[test]
fn stale_media_candidates_match_only_captured_portraits_and_recordings() {
    let dir = temp_scaffold();
    let portrait = write(&dir, "voxstudio-portrait-123.jpg");
    let recording = write(&dir, "voxstudio-recording-123.wav");
    // A portrait temp file that has already been cleaned should not reappear.
    fs::remove_file(&portrait).unwrap();

    let mut candidates = stale_temp_media_candidates(&dir);
    candidates.sort();

    assert_eq!(candidates, vec![recording.clone()]);
    assert!(candidates
        .iter()
        .any(|path| path.ends_with("voxstudio-recording-123.wav")));
    assert!(!candidates
        .iter()
        .any(|path| path.ends_with("voxstudio-portrait-123.jpg")));
    fs::remove_file(&recording).unwrap();
    fs::remove_dir(&dir).unwrap_or_default();
}

#[test]
fn missing_directory_yields_no_candidates() {
    let missing = std::env::temp_dir().join("voxstudio-leak-test-does-not-exist");
    assert!(stale_temp_media_candidates(&missing).is_empty());
}
