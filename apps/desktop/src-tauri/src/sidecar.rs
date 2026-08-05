use std::error::Error;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Serialize, Serializer};
#[cfg(unix)]
use std::os::fd::AsRawFd;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use tauri::{AppHandle, Manager};

use crate::keychain::MacKeychainTokenStore;
use crate::settings::{provider_environment, SettingsStore};

pub const STARTUP_TOKEN_ENV: &str = "VOXSTUDIO_BEARER_TOKEN";
const SIDECAR_BINARY_NAME: &str = "digital-human-sidecar";
// Keep the listener on a high fd: the packaged sidecar and its bootstrap may
// reuse or close low fds, so fd 3 is not safe for inherited sockets.
pub const SIDECAR_LISTENER_FD: i32 = 9;
const STARTUP_TOKEN_BYTES: usize = 32;
const MAX_CRASH_RESTARTS: u8 = 1;
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(5);
const HEALTH_ATTEMPT_SLICE: Duration = Duration::from_millis(25);
const RUNTIME_HEALTH_TIMEOUT: Duration = Duration::from_secs(10);
const RUNTIME_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const RUNTIME_MONITOR_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, PartialEq, Eq)]
pub struct StartupToken(String);

impl StartupToken {
    pub fn generate() -> Result<Self, SupervisorError> {
        let mut bytes = [0_u8; STARTUP_TOKEN_BYTES];
        getrandom::getrandom(&mut bytes).map_err(|_| SupervisorError::EntropyUnavailable)?;
        let mut encoded = String::with_capacity(STARTUP_TOKEN_BYTES * 2);
        for byte in bytes {
            use std::fmt::Write as _;
            write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
        }
        Ok(Self(encoded))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub const fn entropy_bits(&self) -> usize {
        STARTUP_TOKEN_BYTES * 8
    }
}

impl fmt::Debug for StartupToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StartupToken([REDACTED])")
    }
}

impl Serialize for StartupToken {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SidecarEndpoint {
    host: Ipv4Addr,
    port: u16,
}

impl SidecarEndpoint {
    pub fn new(host: Ipv4Addr, port: u16) -> Result<Self, SupervisorError> {
        if !host.is_loopback() {
            return Err(SupervisorError::NonLoopbackHost);
        }
        if port == 0 {
            return Err(SupervisorError::InvalidPort);
        }
        Ok(Self { host, port })
    }

    pub const fn host(&self) -> Ipv4Addr {
        self.host
    }

    pub const fn port(&self) -> u16 {
        self.port
    }

    pub fn base_url(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }
}

#[derive(Clone)]
pub struct SidecarLaunchSpec {
    program: PathBuf,
    args: Vec<OsString>,
    environment: Vec<(OsString, OsString)>,
}

impl SidecarLaunchSpec {
    pub fn new(program: PathBuf, database_path: &Path, token: &StartupToken) -> Self {
        Self {
            program,
            args: vec![
                OsString::from("--listener-fd"),
                OsString::from(SIDECAR_LISTENER_FD.to_string()),
                OsString::from("--database"),
                database_path.as_os_str().to_owned(),
            ],
            environment: vec![(
                OsString::from(STARTUP_TOKEN_ENV),
                OsString::from(token.as_str()),
            )],
        }
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    pub fn args(&self) -> &[OsString] {
        &self.args
    }

    pub fn environment(&self) -> &[(OsString, OsString)] {
        &self.environment
    }

    pub fn with_provider_env(mut self, provider_env: Vec<(OsString, OsString)>) -> Self {
        self.environment.extend(provider_env);
        self
    }
}

impl fmt::Debug for SidecarLaunchSpec {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let environment_keys: Vec<&OsStr> = self
            .environment
            .iter()
            .map(|(key, _)| key.as_os_str())
            .collect();
        formatter
            .debug_struct("SidecarLaunchSpec")
            .field("program", &self.program)
            .field("args", &self.args)
            .field("environment_keys", &environment_keys)
            .finish()
    }
}

#[derive(Debug)]
pub struct ReservedLoopbackListener {
    listener: TcpListener,
    endpoint: SidecarEndpoint,
}

impl ReservedLoopbackListener {
    pub fn bind(host: Ipv4Addr) -> Result<Self, SupervisorError> {
        if !host.is_loopback() {
            return Err(SupervisorError::NonLoopbackHost);
        }
        let listener =
            TcpListener::bind((host, 0)).map_err(|_| SupervisorError::PortAllocationFailed)?;
        let address = listener
            .local_addr()
            .map_err(|_| SupervisorError::PortAllocationFailed)?;
        let SocketAddr::V4(address) = address else {
            return Err(SupervisorError::NonLoopbackHost);
        };
        let endpoint = SidecarEndpoint::new(*address.ip(), address.port())?;
        Ok(Self { listener, endpoint })
    }

    pub fn endpoint(&self) -> &SidecarEndpoint {
        &self.endpoint
    }

    pub fn try_clone(&self) -> Result<TcpListener, SupervisorError> {
        self.listener
            .try_clone()
            .map_err(|_| SupervisorError::PortAllocationFailed)
    }
}

pub trait PortAllocator {
    fn reserve(&mut self, host: Ipv4Addr) -> Result<ReservedLoopbackListener, SupervisorError>;
}

#[derive(Debug, Default)]
pub struct LoopbackPortAllocator;

impl PortAllocator for LoopbackPortAllocator {
    fn reserve(&mut self, host: Ipv4Addr) -> Result<ReservedLoopbackListener, SupervisorError> {
        ReservedLoopbackListener::bind(host)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChildStatus {
    Running,
    Exited(i32),
}

pub trait ChildProcess {
    fn try_wait(&mut self) -> Result<ChildStatus, SupervisorError>;
    fn terminate(&mut self) -> Result<(), SupervisorError>;
    fn wait_timeout(&mut self, timeout: Duration) -> Result<bool, SupervisorError>;
    fn kill(&mut self) -> Result<(), SupervisorError>;
}

pub trait ProcessRunner {
    type Child: ChildProcess;

    fn spawn(
        &mut self,
        spec: &SidecarLaunchSpec,
        listener: &ReservedLoopbackListener,
    ) -> Result<Self::Child, SupervisorError>;
}

pub trait HealthProbe {
    fn wait_until_healthy(
        &mut self,
        endpoint: &SidecarEndpoint,
        timeout: Duration,
    ) -> Result<(), SupervisorError>;
}

#[derive(Clone, Debug, Default)]
pub struct ShutdownSignal {
    requested: Arc<AtomicBool>,
}

impl ShutdownSignal {
    pub fn request(&self) {
        self.requested.store(true, Ordering::Release);
    }

    pub fn is_requested(&self) -> bool {
        self.requested.load(Ordering::Acquire)
    }
}

#[derive(Debug, Default)]
pub struct LoopbackHealthProbe {
    shutdown: ShutdownSignal,
}

impl LoopbackHealthProbe {
    pub fn new(shutdown: ShutdownSignal) -> Self {
        Self { shutdown }
    }
}

impl HealthProbe for LoopbackHealthProbe {
    fn wait_until_healthy(
        &mut self,
        endpoint: &SidecarEndpoint,
        timeout: Duration,
    ) -> Result<(), SupervisorError> {
        if !endpoint.host().is_loopback() {
            return Err(SupervisorError::NonLoopbackHost);
        }
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or(SupervisorError::HealthDeadlineExceeded)?;
        let address = SocketAddr::V4(SocketAddrV4::new(endpoint.host(), endpoint.port()));

        while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
            if self.shutdown.is_requested() {
                return Err(SupervisorError::ShutdownRequested);
            }
            if remaining.is_zero() {
                break;
            }
            if probe_healthz(address, remaining.min(HEALTH_ATTEMPT_SLICE)).unwrap_or(false) {
                return Ok(());
            }
            if self.shutdown.is_requested() {
                return Err(SupervisorError::ShutdownRequested);
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            if remaining.is_zero() {
                break;
            }
            thread::sleep(HEALTH_POLL_INTERVAL.min(remaining));
        }
        Err(SupervisorError::HealthDeadlineExceeded)
    }
}

fn probe_healthz(address: SocketAddr, remaining: Duration) -> std::io::Result<bool> {
    let mut stream = TcpStream::connect_timeout(&address, remaining)?;
    stream.set_write_timeout(Some(remaining))?;
    stream.set_read_timeout(Some(remaining))?;
    stream.write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")?;
    let mut response = [0_u8; 256];
    let bytes_read = stream.read(&mut response)?;
    let status_line = String::from_utf8_lossy(&response[..bytes_read]);
    Ok(matches!(status_line.split_whitespace().nth(1), Some("200")))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SupervisorOptions {
    pub health_timeout: Duration,
    pub shutdown_timeout: Duration,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnsureRunning {
    Healthy,
    Restarted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SupervisorError {
    EntropyUnavailable,
    NonLoopbackHost,
    InvalidPort,
    PortAllocationFailed,
    ProcessSpawnFailed,
    ProcessStatusFailed,
    ProcessTerminationFailed,
    ProcessWaitFailed,
    ProcessKillFailed,
    HealthDeadlineExceeded,
    ShutdownRequested,
    RestartBudgetExhausted,
    AppDataDirectoryUnavailable,
    AppDataDirectoryCreationFailed,
    MonitorThreadFailed,
}

impl fmt::Display for SupervisorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::EntropyUnavailable => "secure startup token generation failed",
            Self::NonLoopbackHost => "sidecar host must be loopback",
            Self::InvalidPort => "sidecar port must be non-zero",
            Self::PortAllocationFailed => "sidecar port allocation failed",
            Self::ProcessSpawnFailed => "sidecar process failed to start",
            Self::ProcessStatusFailed => "sidecar process status is unavailable",
            Self::ProcessTerminationFailed => "sidecar graceful termination failed",
            Self::ProcessWaitFailed => "sidecar shutdown wait failed",
            Self::ProcessKillFailed => "sidecar forced termination failed",
            Self::HealthDeadlineExceeded => "sidecar health deadline exceeded",
            Self::ShutdownRequested => "sidecar shutdown requested",
            Self::RestartBudgetExhausted => "sidecar restart budget exhausted",
            Self::AppDataDirectoryUnavailable => "sidecar data directory is unavailable",
            Self::AppDataDirectoryCreationFailed => "sidecar data directory creation failed",
            Self::MonitorThreadFailed => "sidecar monitor thread failed",
        };
        formatter.write_str(message)
    }
}

impl Error for SupervisorError {}

pub struct SidecarSupervisor<R, H, A>
where
    R: ProcessRunner,
    H: HealthProbe,
    A: PortAllocator,
{
    runner: R,
    probe: H,
    _allocator: A,
    reservation: Option<ReservedLoopbackListener>,
    endpoint: SidecarEndpoint,
    token: StartupToken,
    spec: SidecarLaunchSpec,
    child: Option<R::Child>,
    options: SupervisorOptions,
    crash_restarts: u8,
    failed_closed: bool,
    diagnostics: Option<SidecarDiagnosticsState>,
}

impl<R, H, A> SidecarSupervisor<R, H, A>
where
    R: ProcessRunner,
    H: HealthProbe,
    A: PortAllocator,
{
    pub fn start(
        mut runner: R,
        mut probe: H,
        mut allocator: A,
        program: PathBuf,
        database_path: PathBuf,
        options: SupervisorOptions,
        provider_env: Vec<(OsString, OsString)>,
    ) -> Result<Self, SupervisorError> {
        let token = StartupToken::generate()?;
        let host = Ipv4Addr::LOCALHOST;
        let reservation = allocator.reserve(host)?;
        let endpoint = reservation.endpoint().clone();
        let spec =
            SidecarLaunchSpec::new(program, &database_path, &token).with_provider_env(provider_env);
        let mut child = runner.spawn(&spec, &reservation)?;
        if let Err(error) = probe.wait_until_healthy(&endpoint, options.health_timeout) {
            let _ = stop_child(&mut child, options.shutdown_timeout);
            return Err(error);
        }
        Ok(Self {
            runner,
            probe,
            _allocator: allocator,
            reservation: Some(reservation),
            endpoint,
            token,
            spec,
            child: Some(child),
            options,
            crash_restarts: 0,
            failed_closed: false,
            diagnostics: None,
        })
    }

    /// Attach a shared diagnostics handle so crash/exit information is visible
    /// to the diagnostic command. The supervisor records into it thereafter.
    pub fn attach_diagnostics(&mut self, state: SidecarDiagnosticsState) {
        if let Ok(mut diagnostics) = state.inner.lock() {
            diagnostics.active = true;
            diagnostics.crashed = self.failed_closed;
            diagnostics.crash_restarts = self.crash_restarts;
        }
        self.diagnostics = Some(state);
    }

    fn record_exit(&self, code: i32) {
        if let Some(state) = &self.diagnostics {
            if let Ok(mut diagnostics) = state.inner.lock() {
                diagnostics.active = true;
                diagnostics.crashed = true;
                diagnostics.crash_restarts = self.crash_restarts;
                diagnostics.last_exit_code = Some(code);
            }
        }
    }

    fn record_error(&self, error: SupervisorError) {
        if let Some(state) = &self.diagnostics {
            if let Ok(mut diagnostics) = state.inner.lock() {
                diagnostics.active = true;
                diagnostics.crashed = true;
                diagnostics.crash_restarts = self.crash_restarts;
                diagnostics.last_error = Some(error.to_string());
            }
        }
    }

    fn refresh_diagnostics(&self) {
        if let Some(state) = &self.diagnostics {
            if let Ok(mut diagnostics) = state.inner.lock() {
                diagnostics.active = true;
                diagnostics.crashed = self.failed_closed;
                diagnostics.crash_restarts = self.crash_restarts;
            }
        }
    }

    pub fn endpoint(&self) -> &SidecarEndpoint {
        &self.endpoint
    }

    pub fn token(&self) -> &StartupToken {
        &self.token
    }

    pub fn launch_spec(&self) -> &SidecarLaunchSpec {
        &self.spec
    }

    pub const fn is_failed_closed(&self) -> bool {
        self.failed_closed
    }

    pub fn ensure_running(&mut self) -> Result<EnsureRunning, SupervisorError> {
        if self.failed_closed {
            return Err(SupervisorError::RestartBudgetExhausted);
        }
        let status = self
            .child
            .as_mut()
            .ok_or(SupervisorError::ProcessStatusFailed)?
            .try_wait()?;
        let exit_code = match status {
            ChildStatus::Running => return Ok(EnsureRunning::Healthy),
            ChildStatus::Exited(code) => code,
        };

        self.child = None;
        self.record_exit(exit_code);
        if self.crash_restarts >= MAX_CRASH_RESTARTS {
            self.failed_closed = true;
            self.refresh_diagnostics();
            return Err(SupervisorError::RestartBudgetExhausted);
        }

        let reservation = self
            .reservation
            .as_ref()
            .ok_or(SupervisorError::ProcessSpawnFailed)?;
        let mut replacement = match self.runner.spawn(&self.spec, reservation) {
            Ok(child) => child,
            Err(error) => {
                self.failed_closed = true;
                self.record_error(error);
                return Err(error);
            }
        };
        if let Err(error) = self
            .probe
            .wait_until_healthy(&self.endpoint, self.options.health_timeout)
        {
            let _ = stop_child(&mut replacement, self.options.shutdown_timeout);
            if error != SupervisorError::ShutdownRequested {
                self.failed_closed = true;
            }
            self.record_error(error);
            return Err(error);
        }
        self.crash_restarts += 1;
        self.child = Some(replacement);
        self.refresh_diagnostics();
        Ok(EnsureRunning::Restarted)
    }

    pub fn shutdown(&mut self) -> Result<(), SupervisorError> {
        self.failed_closed = true;
        if let Some(state) = &self.diagnostics {
            if let Ok(mut diagnostics) = state.inner.lock() {
                diagnostics.active = false;
            }
        }
        let result = match self.child.take() {
            Some(mut child) => stop_child(&mut child, self.options.shutdown_timeout),
            None => Ok(()),
        };
        self.reservation.take();
        result
    }
}

impl<R, H, A> fmt::Debug for SidecarSupervisor<R, H, A>
where
    R: ProcessRunner,
    H: HealthProbe,
    A: PortAllocator,
{
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SidecarSupervisor")
            .field("endpoint", &self.endpoint)
            .field("launch_spec", &self.spec)
            .field("crash_restarts", &self.crash_restarts)
            .field("failed_closed", &self.failed_closed)
            .finish()
    }
}

impl<R, H, A> Drop for SidecarSupervisor<R, H, A>
where
    R: ProcessRunner,
    H: HealthProbe,
    A: PortAllocator,
{
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn stop_child<C: ChildProcess>(
    child: &mut C,
    shutdown_timeout: Duration,
) -> Result<(), SupervisorError> {
    if let Err(error) = child.terminate() {
        let _ = child.kill();
        return Err(error);
    }
    match child.wait_timeout(shutdown_timeout) {
        Ok(true) => Ok(()),
        Ok(false) => child.kill(),
        Err(error) => {
            let _ = child.kill();
            Err(error)
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarConnection {
    base_url: String,
    bearer_token: StartupToken,
}

impl SidecarConnection {
    pub fn new(endpoint: SidecarEndpoint, bearer_token: StartupToken) -> Self {
        Self {
            base_url: endpoint.base_url(),
            bearer_token,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn token(&self) -> &StartupToken {
        &self.bearer_token
    }
}

impl fmt::Debug for SidecarConnection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SidecarConnection")
            .field("base_url", &self.base_url)
            .field("bearer_token", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SidecarConnectionError {
    Unavailable,
    FailedClosed,
}

impl fmt::Display for SidecarConnectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => formatter.write_str("sidecar connection is unavailable"),
            Self::FailedClosed => formatter.write_str("sidecar connection failed closed"),
        }
    }
}

impl Error for SidecarConnectionError {}

#[derive(Clone)]
pub struct SidecarConnectionState {
    availability: Arc<Mutex<ConnectionAvailability>>,
}

#[derive(Clone, Debug)]
enum ConnectionAvailability {
    Unavailable,
    Ready(SidecarConnection),
    FailedClosed,
}

impl Default for SidecarConnectionState {
    fn default() -> Self {
        Self {
            availability: Arc::new(Mutex::new(ConnectionAvailability::Unavailable)),
        }
    }
}

impl SidecarConnectionState {
    pub fn publish(&self, connection: SidecarConnection) {
        if let Ok(mut availability) = self.availability.lock() {
            *availability = ConnectionAvailability::Ready(connection);
        }
    }

    pub fn current(&self) -> Result<SidecarConnection, SidecarConnectionError> {
        let availability = self
            .availability
            .lock()
            .map_err(|_| SidecarConnectionError::FailedClosed)?;
        match &*availability {
            ConnectionAvailability::Unavailable => Err(SidecarConnectionError::Unavailable),
            ConnectionAvailability::Ready(connection) => Ok(connection.clone()),
            ConnectionAvailability::FailedClosed => Err(SidecarConnectionError::FailedClosed),
        }
    }

    pub fn fail_closed(&self) {
        if let Ok(mut availability) = self.availability.lock() {
            *availability = ConnectionAvailability::FailedClosed;
        }
    }

    fn clear(&self) {
        if let Ok(mut availability) = self.availability.lock() {
            *availability = ConnectionAvailability::Unavailable;
        }
    }
}

impl fmt::Debug for SidecarConnectionState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let state = match self.availability.lock().as_deref() {
            Ok(ConnectionAvailability::Unavailable) => "unavailable",
            Ok(ConnectionAvailability::Ready(_)) => "ready",
            Ok(ConnectionAvailability::FailedClosed) | Err(_) => "failed_closed",
        };
        formatter
            .debug_struct("SidecarConnectionState")
            .field("state", &state)
            .finish()
    }
}

/// Runtime-summary of the sidecar process that is safe to surface to the UI
/// and to include in a user-exportable diagnostic package. Never contains
/// credentials or tokens.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarRuntimeDiagnostics {
    /// Whether the supervisor currently considers a sidecar to be running.
    pub active: bool,
    /// Whether the sidecar has crashed (exited unexpectedly) this session.
    pub crashed: bool,
    /// How many automatic restarts have been performed this session.
    pub crash_restarts: u8,
    /// The most recent non-zero exit code observed, if any.
    pub last_exit_code: Option<i32>,
    /// A short description of the most recent supervisor error, if any.
    pub last_error: Option<String>,
}

/// Shared, app-managed handle that the sidecar supervisor thread updates and
/// that a diagnostic command reads to report crash/exit information.
#[derive(Clone, Default)]
pub struct SidecarDiagnosticsState {
    inner: Arc<Mutex<SidecarRuntimeDiagnostics>>,
}

impl SidecarDiagnosticsState {
    pub fn snapshot(&self) -> SidecarRuntimeDiagnostics {
        self.inner
            .lock()
            .map(|diagnostics| diagnostics.clone())
            .unwrap_or_default()
    }
}

#[tauri::command]
pub fn get_sidecar_connection(
    state: tauri::State<'_, SidecarConnectionState>,
) -> Result<SidecarConnection, SidecarConnectionError> {
    state.current()
}

#[derive(Clone, Default)]
pub struct TauriProcessRunner;

pub struct TauriChild {
    child: Option<Child>,
    pid: u32,
}

impl fmt::Debug for TauriChild {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TauriChild")
            .field("pid", &self.pid)
            .finish_non_exhaustive()
    }
}

impl ProcessRunner for TauriProcessRunner {
    type Child = TauriChild;

    fn spawn(
        &mut self,
        spec: &SidecarLaunchSpec,
        listener: &ReservedLoopbackListener,
    ) -> Result<Self::Child, SupervisorError> {
        let mut command = Command::new(spec.program());
        command
            .args(spec.args())
            .envs(spec.environment().iter().map(|(key, value)| (key, value)));
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_listener_inheritance(&mut command, listener)?;
        let child = command
            .spawn()
            .map_err(|_| SupervisorError::ProcessSpawnFailed)?;
        Ok(TauriChild {
            pid: child.id(),
            child: Some(child),
        })
    }
}

#[cfg(unix)]
fn configure_listener_inheritance(
    command: &mut Command,
    listener: &ReservedLoopbackListener,
) -> Result<(), SupervisorError> {
    let source_fd = listener.listener.as_raw_fd();
    unsafe {
        command.pre_exec(move || {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            if source_fd == SIDECAR_LISTENER_FD {
                let flags = libc::fcntl(source_fd, libc::F_GETFD);
                if flags == -1
                    || libc::fcntl(source_fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) == -1
                {
                    return Err(std::io::Error::last_os_error());
                }
            } else if libc::dup2(source_fd, SIDECAR_LISTENER_FD) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    Ok(())
}

#[cfg(not(unix))]
fn configure_listener_inheritance(
    _command: &mut Command,
    _listener: &ReservedLoopbackListener,
) -> Result<(), SupervisorError> {
    Err(SupervisorError::ProcessSpawnFailed)
}

impl ChildProcess for TauriChild {
    fn try_wait(&mut self) -> Result<ChildStatus, SupervisorError> {
        let child = self
            .child
            .as_mut()
            .ok_or(SupervisorError::ProcessStatusFailed)?;
        child
            .try_wait()
            .map_err(|_| SupervisorError::ProcessStatusFailed)
            .map(|status| match status {
                Some(status) => ChildStatus::Exited(status.code().unwrap_or(-1)),
                None => ChildStatus::Running,
            })
    }

    fn terminate(&mut self) -> Result<(), SupervisorError> {
        #[cfg(unix)]
        {
            let result = unsafe { libc::kill(-(self.pid as libc::pid_t), libc::SIGTERM) };
            if result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
                Ok(())
            } else {
                Err(SupervisorError::ProcessTerminationFailed)
            }
        }
        #[cfg(not(unix))]
        {
            self.kill()
        }
    }

    fn wait_timeout(&mut self, timeout: Duration) -> Result<bool, SupervisorError> {
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or(SupervisorError::ProcessWaitFailed)?;
        loop {
            let child = self
                .child
                .as_mut()
                .ok_or(SupervisorError::ProcessWaitFailed)?;
            if child
                .try_wait()
                .map_err(|_| SupervisorError::ProcessWaitFailed)?
                .is_some()
            {
                self.child.take();
                return Ok(true);
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return Ok(false);
            };
            if remaining.is_zero() {
                return Ok(false);
            }
            thread::sleep(HEALTH_POLL_INTERVAL.min(remaining));
        }
    }

    fn kill(&mut self) -> Result<(), SupervisorError> {
        let Some(mut child) = self.child.take() else {
            return Ok(());
        };
        if child
            .try_wait()
            .map_err(|_| SupervisorError::ProcessKillFailed)?
            .is_some()
        {
            return Ok(());
        }
        #[cfg(unix)]
        {
            let result = unsafe { libc::kill(-(self.pid as libc::pid_t), libc::SIGKILL) };
            if result != 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
                return Err(SupervisorError::ProcessKillFailed);
            }
        }
        child
            .kill()
            .map_err(|_| SupervisorError::ProcessKillFailed)?;
        child
            .wait()
            .map_err(|_| SupervisorError::ProcessKillFailed)?;
        Ok(())
    }
}

type RuntimeSupervisor =
    SidecarSupervisor<TauriProcessRunner, LoopbackHealthProbe, LoopbackPortAllocator>;

type SidecarMonitor = thread::JoinHandle<Result<(), SupervisorError>>;

pub struct ManagedSidecar {
    connection_state: SidecarConnectionState,
    shutdown_signal: Mutex<ShutdownSignal>,
    shutdown: Mutex<Option<mpsc::Sender<()>>>,
    monitor: Mutex<Option<SidecarMonitor>>,
}

impl ManagedSidecar {
    pub fn start(app: &AppHandle, connection_state: SidecarConnectionState) -> Self {
        let (shutdown_tx, shutdown_signal, monitor) = Self::spawn_monitor(app, &connection_state);
        Self {
            connection_state,
            shutdown_signal: Mutex::new(shutdown_signal),
            shutdown: Mutex::new(Some(shutdown_tx)),
            monitor: Mutex::new(monitor),
        }
    }

    pub fn restart(&self, app: &AppHandle) -> Result<(), SupervisorError> {
        self.shutdown()?;
        let (shutdown_tx, shutdown_signal, monitor) =
            Self::spawn_monitor(app, &self.connection_state);
        *self
            .shutdown
            .lock()
            .map_err(|_| SupervisorError::MonitorThreadFailed)? = Some(shutdown_tx);
        *self
            .shutdown_signal
            .lock()
            .map_err(|_| SupervisorError::MonitorThreadFailed)? = shutdown_signal;
        *self
            .monitor
            .lock()
            .map_err(|_| SupervisorError::MonitorThreadFailed)? = monitor;
        Ok(())
    }

    fn spawn_monitor(
        app: &AppHandle,
        connection_state: &SidecarConnectionState,
    ) -> (mpsc::Sender<()>, ShutdownSignal, Option<SidecarMonitor>) {
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        let shutdown_signal = ShutdownSignal::default();
        let monitor_signal = shutdown_signal.clone();
        let monitor_state = connection_state.clone();
        let app = app.clone();
        let monitor = thread::Builder::new()
            .name("sidecar-supervisor".into())
            .spawn(move || {
                start_and_monitor_supervisor(app, shutdown_rx, monitor_signal, monitor_state)
            })
            .ok();
        if monitor.is_none() {
            connection_state.fail_closed();
        }
        (shutdown_tx, shutdown_signal, monitor)
    }

    pub fn shutdown(&self) -> Result<(), SupervisorError> {
        self.shutdown_signal
            .lock()
            .map_err(|_| SupervisorError::MonitorThreadFailed)?
            .request();
        if let Ok(mut shutdown) = self.shutdown.lock() {
            if let Some(sender) = shutdown.take() {
                let _ = sender.send(());
            }
        }
        let monitor = self
            .monitor
            .lock()
            .map_err(|_| SupervisorError::MonitorThreadFailed)?
            .take();
        if let Some(monitor) = monitor {
            monitor
                .join()
                .map_err(|_| SupervisorError::MonitorThreadFailed)??;
        }
        Ok(())
    }
}

fn start_and_monitor_supervisor(
    app: AppHandle,
    shutdown: mpsc::Receiver<()>,
    shutdown_signal: ShutdownSignal,
    connection_state: SidecarConnectionState,
) -> Result<(), SupervisorError> {
    match shutdown.try_recv() {
        Ok(()) | Err(mpsc::TryRecvError::Disconnected) => {
            connection_state.clear();
            return Ok(());
        }
        Err(mpsc::TryRecvError::Empty) => {}
    }

    let mut supervisor = match start_runtime_supervisor(app, shutdown_signal.clone()) {
        Ok(supervisor) => supervisor,
        Err(SupervisorError::ShutdownRequested) => {
            connection_state.clear();
            return Ok(());
        }
        Err(error) => {
            connection_state.fail_closed();
            return Err(error);
        }
    };
    if shutdown_signal.is_requested() {
        connection_state.clear();
        return supervisor.shutdown();
    }
    connection_state.publish(SidecarConnection::new(
        supervisor.endpoint().clone(),
        supervisor.token().clone(),
    ));
    monitor_supervisor(supervisor, shutdown, connection_state)
}

fn start_runtime_supervisor(
    app: AppHandle,
    shutdown_signal: ShutdownSignal,
) -> Result<RuntimeSupervisor, SupervisorError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| SupervisorError::AppDataDirectoryUnavailable)?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|_| SupervisorError::AppDataDirectoryCreationFailed)?;
    let settings_store = SettingsStore::new(&app_data_dir, Box::new(MacKeychainTokenStore));
    let settings = settings_store.load().unwrap_or_default();
    let secrets = settings_store.load_secrets().unwrap_or_default();
    let mut supervisor = RuntimeSupervisor::start(
        TauriProcessRunner,
        LoopbackHealthProbe::new(shutdown_signal),
        LoopbackPortAllocator,
        sidecar_binary_path(&app),
        app_data_dir.join("readiness.sqlite3"),
        SupervisorOptions {
            health_timeout: RUNTIME_HEALTH_TIMEOUT,
            shutdown_timeout: RUNTIME_SHUTDOWN_TIMEOUT,
        },
        provider_environment(&settings, &secrets),
    )?;
    if let Some(diagnostics) = app.try_state::<SidecarDiagnosticsState>() {
        supervisor.attach_diagnostics(diagnostics.inner().clone());
    }
    Ok(supervisor)
}

fn sidecar_binary_path(app: &AppHandle) -> PathBuf {
    let _ = app;
    #[cfg(debug_assertions)]
    {
        let file_name = host_sidecar_file_name();
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(file_name)
    }
    #[cfg(not(debug_assertions))]
    {
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."))
            .join(bundled_sidecar_file_name())
    }
}

#[cfg(not(debug_assertions))]
fn bundled_sidecar_file_name() -> String {
    let extension = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    format!("{SIDECAR_BINARY_NAME}{extension}")
}

#[cfg(debug_assertions)]
fn host_sidecar_file_name() -> String {
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        "unknown"
    };
    let platform = if cfg!(target_os = "macos") {
        "apple-darwin"
    } else if cfg!(target_os = "windows") {
        "pc-windows-msvc"
    } else if cfg!(target_os = "linux") {
        "unknown-linux-gnu"
    } else {
        "unknown"
    };
    let extension = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    format!("{SIDECAR_BINARY_NAME}-{arch}-{platform}{extension}")
}

impl fmt::Debug for ManagedSidecar {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSidecar")
            .field("connection_state", &self.connection_state)
            .finish_non_exhaustive()
    }
}

impl Drop for ManagedSidecar {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn monitor_supervisor(
    mut supervisor: RuntimeSupervisor,
    shutdown: mpsc::Receiver<()>,
    connection_state: SidecarConnectionState,
) -> Result<(), SupervisorError> {
    loop {
        match shutdown.recv_timeout(RUNTIME_MONITOR_INTERVAL) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                connection_state.clear();
                return supervisor.shutdown();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => match supervisor.ensure_running() {
                Ok(EnsureRunning::Healthy | EnsureRunning::Restarted) => {}
                Err(SupervisorError::ShutdownRequested) => {
                    connection_state.clear();
                    return supervisor.shutdown();
                }
                Err(error) => {
                    connection_state.fail_closed();
                    let _ = supervisor.shutdown();
                    return Err(error);
                }
            },
        }
    }
}
