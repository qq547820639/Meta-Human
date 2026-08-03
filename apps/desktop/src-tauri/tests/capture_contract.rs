use voxstudio_desktop_lib::capture::{
    capture_permission_snapshot, capture_portrait_to_file, capture_recording_to_file,
    CapturePermission, CapturePermissionSnapshot, MockCapturePermissionProvider,
    UnavailableCapturePermissionProvider,
};

#[test]
fn snapshot_maps_both_permissions_from_provider() {
    let provider = MockCapturePermissionProvider::new(
        CapturePermission::Authorized,
        CapturePermission::Denied,
    );

    assert_eq!(
        capture_permission_snapshot(&provider),
        CapturePermissionSnapshot {
            camera: CapturePermission::Authorized,
            microphone: CapturePermission::Denied,
        }
    );
}

#[test]
fn serialized_snapshot_uses_camel_case_permission_names() {
    let provider = MockCapturePermissionProvider::new(
        CapturePermission::NotDetermined,
        CapturePermission::Restricted,
    );

    let json = serde_json::to_string(&capture_permission_snapshot(&provider)).unwrap();

    assert_eq!(
        json,
        r#"{"camera":"notDetermined","microphone":"restricted"}"#
    );
}

#[test]
fn unavailable_provider_reports_not_determined() {
    let snapshot = capture_permission_snapshot(&UnavailableCapturePermissionProvider);

    assert_eq!(snapshot.camera, CapturePermission::NotDetermined);
    assert_eq!(snapshot.microphone, CapturePermission::NotDetermined);
}

#[cfg(target_os = "macos")]
#[test]
fn avfoundation_provider_returns_a_real_permission_state() {
    let provider =
        voxstudio_desktop_lib::capture::avfoundation::AvFoundationCapturePermissionProvider;
    let snapshot = capture_permission_snapshot(&provider);

    assert!(matches!(
        snapshot.camera,
        CapturePermission::NotDetermined
            | CapturePermission::Denied
            | CapturePermission::Restricted
            | CapturePermission::Authorized
    ));
    assert!(matches!(
        snapshot.microphone,
        CapturePermission::NotDetermined
            | CapturePermission::Denied
            | CapturePermission::Restricted
            | CapturePermission::Authorized
    ));
}

#[test]
#[ignore = "requires camera hardware"]
fn captures_portrait_to_jpeg_file() {
    let path = std::env::temp_dir().join("voxstudio-capture-test.jpg");
    let _ = std::fs::remove_file(&path);

    capture_portrait_to_file(&path).unwrap();

    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(&bytes[..3], &[0xFF, 0xD8, 0xFF]);
    let _ = std::fs::remove_file(&path);
}

#[test]
#[ignore = "requires microphone hardware"]
fn captures_recording_to_wav_file() {
    let path = std::env::temp_dir().join("voxstudio-capture-test.wav");
    let _ = std::fs::remove_file(&path);

    capture_recording_to_file(&path, 1.0).unwrap();

    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(&bytes[..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WAVE");
    let _ = std::fs::remove_file(&path);
}
