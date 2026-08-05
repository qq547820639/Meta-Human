use std::collections::{HashSet, VecDeque};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use voxstudio_desktop_lib::sidecar::{
    ChildProcess, ChildStatus, EnsureRunning, HealthProbe, LoopbackHealthProbe, ManagedSidecar,
    PortAllocator, ProcessRunner, ReservedLoopbackListener, ShutdownSignal, SidecarConnection,
    SidecarConnectionError, SidecarConnectionState, SidecarEndpoint, SidecarLaunchSpec,
    SidecarSupervisor, StartupToken, SupervisorError, SupervisorOptions, SIDECAR_LISTENER_FD,
    STARTUP_TOKEN_ENV,
};

#[derive(Clone, Default)]
struct RunnerTrace {
    specs: Arc<Mutex<Vec<SidecarLaunchSpec>>>,
    listener_endpoints: Arc<Mutex<Vec<SidecarEndpoint>>>,
    events: Arc<Mutex<Vec<String>>>,
}

struct FakeChild {
    statuses: VecDeque<ChildStatus>,
    wait_exits: bool,
    events: Arc<Mutex<Vec<String>>>,
}

impl FakeChild {
    fn new(statuses: impl IntoIterator<Item = ChildStatus>, wait_exits: bool) -> Self {
        Self {
            statuses: statuses.into_iter().collect(),
            wait_exits,
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn with_events(
        statuses: impl IntoIterator<Item = ChildStatus>,
        wait_exits: bool,
        events: Arc<Mutex<Vec<String>>>,
    ) -> Self {
        Self {
            statuses: statuses.into_iter().collect(),
            wait_exits,
            events,
        }
    }
}

impl ChildProcess for FakeChild {
    fn try_wait(&mut self) -> Result<ChildStatus, SupervisorError> {
        Ok(self.statuses.pop_front().unwrap_or(ChildStatus::Running))
    }

    fn terminate(&mut self) -> Result<(), SupervisorError> {
        self.events.lock().unwrap().push("terminate".into());
        Ok(())
    }

    fn wait_timeout(&mut self, timeout: Duration) -> Result<bool, SupervisorError> {
        self.events
            .lock()
            .unwrap()
            .push(format!("wait:{}", timeout.as_millis()));
        Ok(self.wait_exits)
    }

    fn kill(&mut self) -> Result<(), SupervisorError> {
        self.events.lock().unwrap().push("kill".into());
        Ok(())
    }
}

struct FakeRunner {
    trace: RunnerTrace,
    children: VecDeque<FakeChild>,
}

impl FakeRunner {
    fn new(children: impl IntoIterator<Item = FakeChild>) -> (Self, RunnerTrace) {
        let trace = RunnerTrace::default();
        (
            Self {
                trace: trace.clone(),
                children: children.into_iter().collect(),
            },
            trace,
        )
    }
}

impl ProcessRunner for FakeRunner {
    type Child = FakeChild;

    fn spawn(
        &mut self,
        spec: &SidecarLaunchSpec,
        listener: &ReservedLoopbackListener,
    ) -> Result<Self::Child, SupervisorError> {
        self.trace.specs.lock().unwrap().push(spec.clone());
        self.trace
            .listener_endpoints
            .lock()
            .unwrap()
            .push(listener.endpoint().clone());
        self.trace.events.lock().unwrap().push("spawn".into());
        self.children
            .pop_front()
            .ok_or(SupervisorError::ProcessSpawnFailed)
    }
}

#[derive(Clone, Default)]
struct ProbeTrace(Arc<Mutex<Vec<(SidecarEndpoint, Duration)>>>);

struct FakeProbe {
    trace: ProbeTrace,
    outcomes: VecDeque<Result<(), SupervisorError>>,
}

impl FakeProbe {
    fn healthy(count: usize) -> (Self, ProbeTrace) {
        let trace = ProbeTrace::default();
        (
            Self {
                trace: trace.clone(),
                outcomes: (0..count).map(|_| Ok(())).collect(),
            },
            trace,
        )
    }
}

impl HealthProbe for FakeProbe {
    fn wait_until_healthy(
        &mut self,
        endpoint: &SidecarEndpoint,
        timeout: Duration,
    ) -> Result<(), SupervisorError> {
        self.trace
            .0
            .lock()
            .unwrap()
            .push((endpoint.clone(), timeout));
        self.outcomes
            .pop_front()
            .unwrap_or(Err(SupervisorError::HealthDeadlineExceeded))
    }
}

#[derive(Clone, Default)]
struct AllocatorTrace(Arc<Mutex<Vec<Ipv4Addr>>>);

struct FakeAllocator {
    trace: AllocatorTrace,
}

impl FakeAllocator {
    fn new() -> (Self, AllocatorTrace) {
        let trace = AllocatorTrace::default();
        (
            Self {
                trace: trace.clone(),
            },
            trace,
        )
    }
}

impl PortAllocator for FakeAllocator {
    fn reserve(&mut self, host: Ipv4Addr) -> Result<ReservedLoopbackListener, SupervisorError> {
        self.trace.0.lock().unwrap().push(host);
        ReservedLoopbackListener::bind(host)
    }
}

fn options() -> SupervisorOptions {
    SupervisorOptions {
        health_timeout: Duration::from_millis(40),
        shutdown_timeout: Duration::from_millis(25),
    }
}

fn start_supervisor(
    children: impl IntoIterator<Item = FakeChild>,
    probe_count: usize,
) -> (
    SidecarSupervisor<FakeRunner, FakeProbe, FakeAllocator>,
    RunnerTrace,
    ProbeTrace,
    AllocatorTrace,
) {
    let (runner, runner_trace) = FakeRunner::new(children);
    let (probe, probe_trace) = FakeProbe::healthy(probe_count);
    let (allocator, allocator_trace) = FakeAllocator::new();
    let supervisor = SidecarSupervisor::start(
        runner,
        probe,
        allocator,
        PathBuf::from("/bundle/digital-human-sidecar"),
        PathBuf::from("/data/readiness.sqlite3"),
        options(),
        Vec::new(),
    )
    .unwrap();
    (supervisor, runner_trace, probe_trace, allocator_trace)
}

#[test]
fn startup_tokens_have_256_bits_of_unique_url_safe_randomness() {
    let mut tokens = HashSet::new();

    for _ in 0..32 {
        let token = StartupToken::generate().unwrap();
        assert_eq!(token.entropy_bits(), 256);
        assert!(token.as_str().len() >= 43);
        assert!(token
            .as_str()
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'));
        assert!(!format!("{token:?}").contains(token.as_str()));
        assert!(tokens.insert(token.as_str().to_owned()));
    }
}

#[test]
fn start_allocates_loopback_and_passes_token_only_in_environment() {
    let child = FakeChild::new([ChildStatus::Running], true);
    let (supervisor, runner, probe, allocator) = start_supervisor([child], 1);
    let spec = runner.specs.lock().unwrap()[0].clone();
    let token = supervisor.token().as_str();

    assert_eq!(
        allocator.0.lock().unwrap().as_slice(),
        &[Ipv4Addr::LOCALHOST]
    );
    assert_eq!(supervisor.endpoint().host(), Ipv4Addr::LOCALHOST);
    assert_ne!(supervisor.endpoint().port(), 0);
    assert_eq!(
        supervisor.endpoint().base_url(),
        format!("http://127.0.0.1:{}", supervisor.endpoint().port())
    );
    assert_eq!(spec.program(), Path::new("/bundle/digital-human-sidecar"));
    assert_eq!(
        spec.args(),
        &[
            OsString::from("--listener-fd"),
            OsString::from(SIDECAR_LISTENER_FD.to_string()),
            OsString::from("--database"),
            OsString::from("/data/readiness.sqlite3"),
        ]
    );
    assert!(!spec.args().contains(&OsString::from("--port")));
    assert!(spec.args().iter().all(|arg| arg != token));
    assert_eq!(spec.environment().len(), 1);
    assert_eq!(spec.environment()[0].0, OsString::from(STARTUP_TOKEN_ENV));
    assert_eq!(spec.environment()[0].1, OsString::from(token));
    assert!(!format!("{spec:?}").contains(token));
    assert!(!format!("{supervisor:?}").contains(token));
    assert_eq!(
        probe.0.lock().unwrap().as_slice(),
        &[(supervisor.endpoint().clone(), options().health_timeout)]
    );
    assert_eq!(
        runner.listener_endpoints.lock().unwrap().as_slice(),
        &[supervisor.endpoint().clone()]
    );
}

fn assert_competing_bind_is_blocked(endpoint: &SidecarEndpoint) {
    let error = TcpListener::bind((endpoint.host(), endpoint.port())).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::AddrInUse);
}

#[test]
fn listener_reservation_blocks_competing_bind_through_restart_and_releases_on_shutdown() {
    let first = FakeChild::new([ChildStatus::Exited(10)], true);
    let second = FakeChild::new([ChildStatus::Running], true);
    let (mut supervisor, runner, _, _) = start_supervisor([first, second], 2);
    let endpoint = supervisor.endpoint().clone();

    assert_competing_bind_is_blocked(&endpoint);
    assert_eq!(
        supervisor.ensure_running().unwrap(),
        EnsureRunning::Restarted
    );
    assert_competing_bind_is_blocked(&endpoint);
    assert_eq!(runner.listener_endpoints.lock().unwrap().len(), 2);

    supervisor.shutdown().unwrap();

    TcpListener::bind((endpoint.host(), endpoint.port())).unwrap();
}

#[test]
fn listener_reservation_releases_when_supervisor_is_dropped() {
    let child = FakeChild::new([ChildStatus::Running], true);
    let (supervisor, _, _, _) = start_supervisor([child], 1);
    let endpoint = supervisor.endpoint().clone();

    assert_competing_bind_is_blocked(&endpoint);
    drop(supervisor);

    TcpListener::bind((endpoint.host(), endpoint.port())).unwrap();
}

#[test]
fn endpoint_rejects_non_loopback_hosts_and_zero_ports() {
    assert!(matches!(
        SidecarEndpoint::new(Ipv4Addr::UNSPECIFIED, 4312),
        Err(SupervisorError::NonLoopbackHost)
    ));
    assert!(matches!(
        SidecarEndpoint::new(Ipv4Addr::LOCALHOST, 0),
        Err(SupervisorError::InvalidPort)
    ));
}

#[test]
fn first_crash_restarts_once_and_second_crash_fails_closed() {
    let first = FakeChild::new([ChildStatus::Exited(10)], true);
    let second = FakeChild::new([ChildStatus::Exited(11)], true);
    let (mut supervisor, runner, probe, _) = start_supervisor([first, second], 2);

    assert_eq!(
        supervisor.ensure_running().unwrap(),
        EnsureRunning::Restarted
    );
    assert!(matches!(
        supervisor.ensure_running(),
        Err(SupervisorError::RestartBudgetExhausted)
    ));
    assert!(supervisor.is_failed_closed());
    assert_eq!(runner.specs.lock().unwrap().len(), 2);
    assert_eq!(probe.0.lock().unwrap().len(), 2);
}

#[test]
fn shutdown_terminates_then_waits_without_kill_when_child_exits() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let child = FakeChild::with_events([ChildStatus::Running], true, events.clone());
    let (mut supervisor, _, _, _) = start_supervisor([child], 1);

    supervisor.shutdown().unwrap();

    assert_eq!(events.lock().unwrap().as_slice(), &["terminate", "wait:25"]);
}

#[test]
fn shutdown_kills_only_after_bounded_graceful_wait_expires() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let child = FakeChild::with_events([ChildStatus::Running], false, events.clone());
    let (mut supervisor, _, _, _) = start_supervisor([child], 1);

    supervisor.shutdown().unwrap();

    assert_eq!(
        events.lock().unwrap().as_slice(),
        &["terminate", "wait:25", "kill"]
    );
}

#[test]
fn drop_is_best_effort_and_never_panics() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let child = FakeChild::with_events([ChildStatus::Running], false, events.clone());
    let (supervisor, _, _, _) = start_supervisor([child], 1);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(supervisor)));

    assert!(result.is_ok());
    assert_eq!(
        events.lock().unwrap().as_slice(),
        &["terminate", "wait:25", "kill"]
    );
}

fn local_http_server(
    status: u16,
    response_delay: Duration,
) -> (
    SidecarEndpoint,
    Arc<Mutex<String>>,
    std::thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let endpoint =
        SidecarEndpoint::new(Ipv4Addr::LOCALHOST, listener.local_addr().unwrap().port()).unwrap();
    let captured = Arc::new(Mutex::new(String::new()));
    let captured_request = captured.clone();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(100)))
            .unwrap();
        let mut request = [0_u8; 1024];
        let read = stream.read(&mut request).unwrap_or(0);
        *captured_request.lock().unwrap() = String::from_utf8_lossy(&request[..read]).into_owned();
        std::thread::sleep(response_delay);
        let reason = if status == 200 { "OK" } else { "Unavailable" };
        let response =
            format!("HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let _ = stream.write_all(response.as_bytes());
    });
    (endpoint, captured, server)
}

struct StallingRunner {
    accepted: mpsc::Sender<()>,
    release: Arc<AtomicBool>,
    server: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
    events: Arc<Mutex<Vec<String>>>,
}

struct TricklingRunner {
    accepted: mpsc::Sender<()>,
    server: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
    events: Arc<Mutex<Vec<String>>>,
}

impl ProcessRunner for TricklingRunner {
    type Child = FakeChild;

    fn spawn(
        &mut self,
        _spec: &SidecarLaunchSpec,
        listener: &ReservedLoopbackListener,
    ) -> Result<Self::Child, SupervisorError> {
        let listener = listener.try_clone()?;
        let accepted = self.accepted.clone();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            accepted.send(()).unwrap();
            let deadline = Instant::now() + Duration::from_millis(400);
            while Instant::now() < deadline {
                if stream.write_all(b"x").is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        *self.server.lock().unwrap() = Some(server);
        Ok(FakeChild::with_events(
            [ChildStatus::Running],
            true,
            self.events.clone(),
        ))
    }
}

impl ProcessRunner for StallingRunner {
    type Child = FakeChild;

    fn spawn(
        &mut self,
        _spec: &SidecarLaunchSpec,
        listener: &ReservedLoopbackListener,
    ) -> Result<Self::Child, SupervisorError> {
        let listener = listener.try_clone()?;
        let accepted = self.accepted.clone();
        let release = self.release.clone();
        let server = std::thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            accepted.send(()).unwrap();
            while !release.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(1));
            }
        });
        *self.server.lock().unwrap() = Some(server);
        Ok(FakeChild::with_events(
            [ChildStatus::Running],
            true,
            self.events.clone(),
        ))
    }
}

#[test]
fn stalled_initial_health_wait_honors_shutdown_and_stops_child_promptly() {
    let shutdown = ShutdownSignal::default();
    let (accepted_tx, accepted_rx) = mpsc::channel();
    let release = Arc::new(AtomicBool::new(false));
    let server = Arc::new(Mutex::new(None));
    let events = Arc::new(Mutex::new(Vec::new()));
    let runner = StallingRunner {
        accepted: accepted_tx,
        release: release.clone(),
        server: server.clone(),
        events: events.clone(),
    };
    let (allocator, _) = FakeAllocator::new();
    let start_shutdown = shutdown.clone();
    let startup = std::thread::spawn(move || {
        SidecarSupervisor::start(
            runner,
            LoopbackHealthProbe::new(start_shutdown),
            allocator,
            PathBuf::from("/bundle/digital-human-sidecar"),
            PathBuf::from("/data/readiness.sqlite3"),
            SupervisorOptions {
                health_timeout: Duration::from_secs(5),
                shutdown_timeout: Duration::from_millis(25),
            },
            Vec::new(),
        )
    });
    accepted_rx.recv_timeout(Duration::from_secs(1)).unwrap();

    let cancelled_at = Instant::now();
    shutdown.request();
    let result = startup.join().unwrap();
    let elapsed = cancelled_at.elapsed();
    release.store(true, Ordering::Release);
    server.lock().unwrap().take().unwrap().join().unwrap();

    assert!(matches!(result, Err(SupervisorError::ShutdownRequested)));
    assert!(elapsed < Duration::from_millis(250), "elapsed: {elapsed:?}");
    assert_eq!(events.lock().unwrap().as_slice(), &["terminate", "wait:25"]);
}

#[test]
fn trickling_health_response_cannot_hide_shutdown_cancellation() {
    let shutdown = ShutdownSignal::default();
    let (accepted_tx, accepted_rx) = mpsc::channel();
    let server = Arc::new(Mutex::new(None));
    let events = Arc::new(Mutex::new(Vec::new()));
    let runner = TricklingRunner {
        accepted: accepted_tx,
        server: server.clone(),
        events: events.clone(),
    };
    let (allocator, _) = FakeAllocator::new();
    let start_shutdown = shutdown.clone();
    let startup = std::thread::spawn(move || {
        SidecarSupervisor::start(
            runner,
            LoopbackHealthProbe::new(start_shutdown),
            allocator,
            PathBuf::from("/bundle/digital-human-sidecar"),
            PathBuf::from("/data/readiness.sqlite3"),
            SupervisorOptions {
                health_timeout: Duration::from_secs(5),
                shutdown_timeout: Duration::from_millis(25),
            },
            Vec::new(),
        )
    });
    accepted_rx.recv_timeout(Duration::from_secs(1)).unwrap();

    let cancelled_at = Instant::now();
    shutdown.request();
    let result = startup.join().unwrap();
    let elapsed = cancelled_at.elapsed();
    server.lock().unwrap().take().unwrap().join().unwrap();

    assert!(matches!(result, Err(SupervisorError::ShutdownRequested)));
    assert!(elapsed < Duration::from_millis(250), "elapsed: {elapsed:?}");
    assert_eq!(events.lock().unwrap().as_slice(), &["terminate", "wait:25"]);
}

#[test]
fn loopback_health_probe_accepts_only_public_healthz_200() {
    let (endpoint, request, server) = local_http_server(200, Duration::ZERO);
    let token = StartupToken::generate().unwrap();
    let mut probe = LoopbackHealthProbe::default();

    probe
        .wait_until_healthy(&endpoint, Duration::from_millis(100))
        .unwrap();
    server.join().unwrap();

    let request = request.lock().unwrap();
    assert!(request.starts_with("GET /healthz HTTP/1.1\r\n"));
    assert!(!request.to_ascii_lowercase().contains("authorization"));
    assert!(!request.to_ascii_lowercase().contains("cookie"));
    assert!(!request.contains('?'));
    assert!(!request.contains(token.as_str()));
}

#[test]
fn loopback_health_probe_rejects_non_200_and_obeys_timeout() {
    let (unavailable, _, unavailable_server) = local_http_server(503, Duration::ZERO);
    let mut probe = LoopbackHealthProbe::default();

    let unavailable_result = probe.wait_until_healthy(&unavailable, Duration::from_millis(25));
    unavailable_server.join().unwrap();

    let (slow, _, slow_server) = local_http_server(200, Duration::from_millis(80));
    let started = std::time::Instant::now();
    let timeout_result = probe.wait_until_healthy(&slow, Duration::from_millis(20));
    let elapsed = started.elapsed();
    slow_server.join().unwrap();

    assert_eq!(
        unavailable_result,
        Err(SupervisorError::HealthDeadlineExceeded)
    );
    assert_eq!(timeout_result, Err(SupervisorError::HealthDeadlineExceeded));
    assert!(elapsed < Duration::from_millis(150));
}

#[test]
fn connection_serialization_is_minimal_and_debug_is_redacted() {
    let endpoint = SidecarEndpoint::new(Ipv4Addr::LOCALHOST, 43_210).unwrap();
    let token = StartupToken::generate().unwrap();
    let connection = SidecarConnection::new(endpoint, token.clone());
    let serialized = serde_json::to_value(&connection).unwrap();

    assert_eq!(
        serialized,
        serde_json::json!({
            "baseUrl": "http://127.0.0.1:43210",
            "bearerToken": token.as_str(),
        })
    );
    assert!(!format!("{connection:?}").contains(token.as_str()));
}

#[test]
fn connection_state_returns_safe_unavailable_and_failed_closed_errors() {
    let state = SidecarConnectionState::default();

    assert_eq!(state.current(), Err(SidecarConnectionError::Unavailable));

    let endpoint = SidecarEndpoint::new(Ipv4Addr::LOCALHOST, 43_211).unwrap();
    let token = StartupToken::generate().unwrap();
    state.publish(SidecarConnection::new(endpoint, token.clone()));
    assert_eq!(state.current().unwrap().token().as_str(), token.as_str());

    state.fail_closed();
    let error = state.current().unwrap_err();
    assert_eq!(error, SidecarConnectionError::FailedClosed);
    assert!(!format!("{state:?}").contains(token.as_str()));
    assert!(!format!("{error:?}").contains(token.as_str()));
}

fn csp_directive<'a>(csp: &'a str, name: &str) -> Vec<&'a str> {
    csp.split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with(name))
        .unwrap()
        .split_whitespace()
        .collect()
}

#[test]
fn tauri_config_bundles_only_the_sidecar_and_uses_narrow_csp_permissions() {
    let config_text = include_str!("../tauri.conf.json");
    let capability_text = include_str!("../capabilities/default.json");
    let manifest_text = include_str!("../Cargo.toml");
    let info_plist_text = include_str!("../Info.plist");
    let config: serde_json::Value = serde_json::from_str(config_text).unwrap();
    let capability: serde_json::Value = serde_json::from_str(capability_text).unwrap();

    assert_eq!(
        config["bundle"]["externalBin"],
        serde_json::json!(["binaries/digital-human-sidecar"])
    );
    assert_eq!(
        config["bundle"]["macOS"]["infoPlist"],
        serde_json::json!("Info.plist")
    );
    assert_eq!(
        config["app"]["security"]["assetProtocol"]["enable"],
        serde_json::json!(true)
    );
    assert_eq!(
        config["app"]["security"]["assetProtocol"]["scope"],
        serde_json::json!(["$TEMP/voxstudio-portrait-*", "$TEMP/voxstudio-recording-*"])
    );
    assert!(info_plist_text.contains("NSCameraUsageDescription"));
    assert!(info_plist_text.contains("NSMicrophoneUsageDescription"));
    let csp = config["app"]["security"]["csp"].as_str().unwrap();
    let connect = csp_directive(csp, "connect-src");
    assert_eq!(
        connect,
        vec![
            "connect-src",
            "'self'",
            "ipc:",
            "http://ipc.localhost",
            "http://127.0.0.1:*",
        ]
    );
    assert!(csp.contains("default-src 'self'"));
    assert!(csp.contains("media-src 'self' data: asset: http://asset.localhost"));
    assert!(!csp.contains("default-src *"));
    assert!(!csp.contains("unsafe-inline"));
    assert!(!csp.contains("unsafe-eval"));
    assert!(!csp.contains("https://"));

    let dev_csp = config["app"]["security"]["devCsp"].as_str().unwrap();
    assert!(dev_csp.contains("ws://127.0.0.1:*"));
    assert!(dev_csp.contains("style-src 'self' 'unsafe-inline'"));
    assert!(!dev_csp.contains("unsafe-eval"));
    assert!(!dev_csp.contains("https://"));

    assert_eq!(
        capability["permissions"],
        serde_json::json!(["core:default", "updater:default"])
    );
    assert!(!capability_text.contains("shell:"));
    assert!(!config_text.contains(STARTUP_TOKEN_ENV));
    assert!(!config_text.contains("bearerToken"));
    assert!(!manifest_text.contains("tauri-plugin-shell"));
}

#[test]
fn runtime_wrapper_is_exported_and_exit_events_trigger_shutdown() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<ManagedSidecar>();

    let _start: fn(&tauri::AppHandle, SidecarConnectionState) -> ManagedSidecar =
        ManagedSidecar::start;

    let lib = include_str!("../src/lib.rs");
    assert!(!lib.contains("tauri_plugin_shell"));
    assert!(lib.contains("RunEvent::ExitRequested"));
    assert!(lib.contains("RunEvent::Exit"));
    assert!(lib.contains("managed.shutdown()"));
    assert!(lib.contains("get_sidecar_connection"));
    assert!(lib.contains("restart_sidecar"));
    assert!(lib.contains("sidecar.restart(&app)"));
    assert!(lib.contains("app.manage(ManagedSidecar::start(app.handle(), connection_state));"));
    assert!(!lib.contains("ManagedSidecar::start(app.handle(), connection_state)?"));
}
