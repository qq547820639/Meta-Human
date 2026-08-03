use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

#[cfg(target_os = "macos")]
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CapturePermission {
    NotDetermined,
    Denied,
    Restricted,
    Authorized,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePermissionSnapshot {
    pub camera: CapturePermission,
    pub microphone: CapturePermission,
}

pub struct ActiveRecording {
    stream: cpal::Stream,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    channels: usize,
    path: PathBuf,
}

impl ActiveRecording {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

pub struct ActiveRecordingHandle {
    stop_tx: mpsc::Sender<()>,
    result_rx: mpsc::Receiver<Result<String, String>>,
}

pub trait CapturePermissionProvider: Send + Sync {
    fn camera_permission(&self) -> CapturePermission;
    fn microphone_permission(&self) -> CapturePermission;
}

pub struct MockCapturePermissionProvider {
    camera: CapturePermission,
    microphone: CapturePermission,
}

impl MockCapturePermissionProvider {
    pub fn new(camera: CapturePermission, microphone: CapturePermission) -> Self {
        Self { camera, microphone }
    }
}

impl CapturePermissionProvider for MockCapturePermissionProvider {
    fn camera_permission(&self) -> CapturePermission {
        self.camera
    }

    fn microphone_permission(&self) -> CapturePermission {
        self.microphone
    }
}

#[derive(Default)]
pub struct UnavailableCapturePermissionProvider;

impl CapturePermissionProvider for UnavailableCapturePermissionProvider {
    fn camera_permission(&self) -> CapturePermission {
        CapturePermission::NotDetermined
    }

    fn microphone_permission(&self) -> CapturePermission {
        CapturePermission::NotDetermined
    }
}

pub fn capture_permission_snapshot(
    provider: &dyn CapturePermissionProvider,
) -> CapturePermissionSnapshot {
    CapturePermissionSnapshot {
        camera: provider.camera_permission(),
        microphone: provider.microphone_permission(),
    }
}

pub fn capture_portrait_to_file(path: &Path) -> Result<(), String> {
    use nokhwa::pixel_format::RgbFormat;
    use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
    use nokhwa::Camera;

    let index = CameraIndex::Index(0);
    let requested =
        RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
    let mut camera = Camera::new(index, requested).map_err(|error| error.to_string())?;
    camera.open_stream().map_err(|error| error.to_string())?;
    let frame = camera.frame().map_err(|error| error.to_string())?;
    let decoded = frame
        .decode_image::<RgbFormat>()
        .map_err(|error| error.to_string())?;
    let dynamic = image::DynamicImage::ImageRgb8(decoded);
    let mut jpeg = Vec::new();
    dynamic
        .write_to(&mut Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
        .map_err(|error| error.to_string())?;
    std::fs::write(path, jpeg).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn capture_recording_to_file(path: &Path, duration_secs: f32) -> Result<(), String> {
    let recording = start_recording(path)?;
    std::thread::sleep(Duration::from_secs_f32(duration_secs));
    finish_recording(recording)
}

pub fn start_recording(path: &Path) -> Result<ActiveRecording, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no input device".to_string())?;
    let supported = device
        .default_input_config()
        .map_err(|error| error.to_string())?;
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.config();
    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let error_fn = |error| eprintln!("audio capture error: {error}");

    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => {
            let sink = samples.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _| {
                        sink.lock().unwrap().extend_from_slice(data);
                    },
                    error_fn,
                    None,
                )
                .map_err(|error| error.to_string())?
        }
        cpal::SampleFormat::I16 => {
            let sink = samples.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        sink.lock()
                            .unwrap()
                            .extend(data.iter().map(|sample| f32::from(*sample) / 32_768.0));
                    },
                    error_fn,
                    None,
                )
                .map_err(|error| error.to_string())?
        }
        cpal::SampleFormat::U16 => {
            let sink = samples.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        sink.lock().unwrap().extend(
                            data.iter()
                                .map(|sample| (f32::from(*sample) - 32_768.0) / 32_768.0),
                        );
                    },
                    error_fn,
                    None,
                )
                .map_err(|error| error.to_string())?
        }
        _ => return Err("unsupported audio sample format".to_string()),
    };

    stream.play().map_err(|error| error.to_string())?;
    Ok(ActiveRecording {
        stream,
        samples,
        sample_rate,
        channels,
        path: path.to_path_buf(),
    })
}

pub fn finish_recording(recording: ActiveRecording) -> Result<(), String> {
    drop(recording.stream);
    let captured = recording.samples.lock().unwrap().clone();
    write_wav(
        &recording.path,
        recording.sample_rate,
        recording.channels,
        &captured,
    )
}

pub fn start_recording_session(path: PathBuf) -> Result<ActiveRecordingHandle, String> {
    let (stop_tx, stop_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = result_tx.send(run_recording_session(path, stop_rx));
    });
    Ok(ActiveRecordingHandle { stop_tx, result_rx })
}

pub fn finish_recording_session(handle: ActiveRecordingHandle) -> Result<String, String> {
    let _ = handle.stop_tx.send(());
    handle
        .result_rx
        .recv()
        .map_err(|_| "recording thread stopped unexpectedly".to_string())?
}

fn run_recording_session(path: PathBuf, stop_rx: mpsc::Receiver<()>) -> Result<String, String> {
    let recording = start_recording(&path)?;
    let _ = stop_rx.recv();
    finish_recording(recording)?;
    Ok(path.to_string_lossy().into_owned())
}

fn write_wav(
    path: &Path,
    sample_rate: u32,
    channels: usize,
    samples: &[f32],
) -> Result<(), String> {
    let mut data = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16;
        data.extend_from_slice(&value.to_le_bytes());
    }
    let data_len = data.len() as u32;
    let channel_count = channels as u16;
    let byte_rate = sample_rate * u32::from(channel_count) * 2;

    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&channel_count.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&(channel_count * 2).to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(&data);

    std::fs::write(path, wav).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub mod avfoundation {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;

    use super::{CapturePermission, CapturePermissionProvider};

    pub struct AvFoundationCapturePermissionProvider;

    impl CapturePermissionProvider for AvFoundationCapturePermissionProvider {
        fn camera_permission(&self) -> CapturePermission {
            permission_for("vide")
        }

        fn microphone_permission(&self) -> CapturePermission {
            permission_for("soun")
        }
    }

    fn permission_for(media_type: &str) -> CapturePermission {
        let Some(class) = AnyClass::get(c"AVCaptureDevice") else {
            return CapturePermission::NotDetermined;
        };
        let media = NSString::from_str(media_type);
        let status: isize = unsafe { msg_send![class, authorizationStatusForMediaType: &*media] };
        match status {
            3 => CapturePermission::Authorized,
            2 => CapturePermission::Denied,
            1 => CapturePermission::Restricted,
            _ => CapturePermission::NotDetermined,
        }
    }
}
