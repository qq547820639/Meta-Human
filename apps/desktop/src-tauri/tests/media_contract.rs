use voxstudio_desktop_lib::media::{
    validate_portrait_bytes, MediaError, PortraitFormat, PortraitInfo,
};

fn png_bytes() -> Vec<u8> {
    vec![
        0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    ]
}

#[test]
fn png_bytes_are_accepted() {
    let bytes = png_bytes();

    assert_eq!(
        validate_portrait_bytes(&bytes).unwrap(),
        PortraitInfo {
            format: PortraitFormat::Png,
            bytes: bytes.len(),
        }
    );
}

#[test]
fn jpeg_and_heic_bytes_are_accepted() {
    let jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00];
    assert_eq!(
        validate_portrait_bytes(&jpeg).unwrap().format,
        PortraitFormat::Jpeg
    );

    let heic = vec![
        0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p', b'h', b'e', b'i', b'c',
    ];
    assert_eq!(
        validate_portrait_bytes(&heic).unwrap().format,
        PortraitFormat::Heic
    );
}

#[test]
fn empty_unsupported_and_oversized_files_are_rejected() {
    assert_eq!(validate_portrait_bytes(&[]), Err(MediaError::Empty));
    assert_eq!(
        validate_portrait_bytes(b"not an image"),
        Err(MediaError::UnsupportedFormat)
    );

    let oversized = {
        let mut bytes = png_bytes();
        bytes.resize(20 * 1024 * 1024 + 1, 0);
        bytes
    };
    assert_eq!(
        validate_portrait_bytes(&oversized),
        Err(MediaError::TooLarge)
    );
}
