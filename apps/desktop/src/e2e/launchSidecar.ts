/**
 * Node helper that launches the REAL sidecar binary (plus the mock provider)
 * for the frontend E2E test, and returns the connection details the mocked
 * Tauri `invoke` binding resolves to.
 *
 * This shells out to `scripts/e2e-sidecar-launcher.py`, which starts the real
 * binary on a loopback listener socket, drives the readiness gate to open, and
 * prints a single JSON line on stdout: `{ sidecar_url, token, database }`.
 * Nothing about the frontend `fetch` is mocked here.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "../../../../");

export interface SidecarConnection {
  readonly baseUrl: string;
  readonly bearerToken: string;
  readonly database: string;
}

export interface SidecarHandle {
  readonly connection: SidecarConnection;
  /** Terminates the sidecar and mock provider. Idempotent. */
  readonly stop: () => Promise<void>;
}

export function sidecarPaths(): {
  readonly projectRoot: string;
  readonly python: string;
  readonly launcher: string;
  readonly sidecar: string;
} {
  const python = join(PROJECT_ROOT, "apps/sidecar/.venv/bin/python");
  const launcher = join(PROJECT_ROOT, "scripts/e2e-sidecar-launcher.py");
  const sidecar = join(
    PROJECT_ROOT,
    "apps/desktop/src-tauri/binaries/digital-human-sidecar-universal-apple-darwin",
  );
  return { projectRoot: PROJECT_ROOT, python, launcher, sidecar };
}

/** True when the real sidecar binary and the venv python are available. */
export function sidecarAvailable(): boolean {
  const { python, launcher, sidecar } = sidecarPaths();
  return (
    existsSync(python) &&
    existsSync(launcher) &&
    (existsSync(sidecar) ||
      existsSync(
        join(
          PROJECT_ROOT,
          "apps/desktop/src-tauri/binaries/digital-human-sidecar-aarch64-apple-darwin",
        ),
      ) ||
      existsSync(
        join(
          PROJECT_ROOT,
          "apps/desktop/src-tauri/binaries/digital-human-sidecar-x86_64-apple-darwin",
        ),
      ))
  );
}

/**
 * Launches the real sidecar and mock provider, blocking until the sidecar is
 * healthy and the readiness gate is open. Resolves with the connection details.
 */
export async function launchSidecar(): Promise<SidecarHandle> {
  const { python, launcher } = sidecarPaths();
  const child = spawn(python, [launcher], {
    cwd: PROJECT_ROOT,
    // A slightly longer mock stream so the frontend stop test has a reliable
    // window to stop an active generation instead of racing it to completion.
    env: { ...process.env, VOXSTUDIO_E2E_STREAM_DELAY: "0.4" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const connection = await new Promise<SidecarConnection>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(
        new Error(
          `Sidecar launch timed out (90s). stderr:\n${stderr.slice(-3000)}`,
        ),
      );
    }, 90_000);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const lines = stdout.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed) as {
            sidecar_url?: string;
            token?: string;
            database?: string;
          };
          if (parsed.sidecar_url && parsed.token) {
            clearTimeout(timer);
            resolvePromise({
              baseUrl: parsed.sidecar_url,
              bearerToken: parsed.token,
              database: parsed.database ?? "",
            });
            return;
          }
        } catch {
          // Not the connection JSON yet.
        }
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectPromise(
        new Error(
          `Sidecar launcher exited early (code ${code}). stderr:\n${stderr.slice(-3000)}`,
        ),
      );
    });
  });

  let stopped = false;
  const stop = () =>
    new Promise<void>((resolvePromise) => {
      if (stopped) {
        resolvePromise();
        return;
      }
      stopped = true;
      child.once("exit", () => resolvePromise());
      child.kill("SIGTERM");
      // Safety net if the launcher ignores the signal.
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      }, 5000);
    });

  return { connection, stop };
}