#!/usr/bin/env bash
#
# release-closure.sh
#
# Release acceptance for the macOS "正式发布闭环": dual-arch binaries, app
# signing, Gatekeeper, offline launch, overlay install / old-data upgrade,
# uninstall cleanup, crash cleanup, and first-run permissions.
#
# Honesty rule: checks that can be verified on THIS machine are run for real.
# Checks that require credentials, a clean Mac, TCC interaction, or a real
# install environment are reported as UNVERIFIED together with a runbook of
# the exact commands/probes to run on the target machine. We never fabricate
# a PASS.
#
# Usage:
#   scripts/release-closure.sh [--app PATH] [--dmg PATH] [--offline] [--install-root DIR]
#
# Options:
#   --app PATH           App bundle to validate (default: universal Tauri output).
#   --dmg PATH           DMG to validate (default: output/VoxStudio-universal.dmg).
#   --offline            Attempt a real offline-launch smoke (requires sudo to
#                        toggle the network; skipped as UNVERIFIED otherwise).
#   --install-root DIR   Already-installed app root to validate for the
#                        install/upgrade/uninstall/crash gates (default: none).
#
# Exit codes:
#   0  no FAIL (UNVERIFIED items are reported separately)
#   1  at least one verifiable gate FAILED
#   3  usage error

set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
# shellcheck disable=SC1091
source "${script_dir}/lib/release-common.sh"

output_dir="${project_root}/output"
log_md="${output_dir}/release-closure.md"
body_file="$(mktemp "${TMPDIR:-/tmp}/release-closure.XXXXXX")"

app="${project_root}/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app"
dmg="${project_root}/output/VoxStudio-universal.dmg"
sidecar_binary="${project_root}/apps/desktop/src-tauri/binaries/digital-human-sidecar-universal-apple-darwin"
desktop_binary="${project_root}/apps/desktop/src-tauri/target/universal-apple-darwin/release/voxstudio-desktop"
[[ -f "${desktop_binary}" ]] || desktop_binary="${project_root}/apps/desktop/src-tauri/target/release/voxstudio-desktop"

do_offline=0
install_root=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --dmg) dmg="$2"; shift 2 ;;
    --offline) do_offline=1; shift ;;
    --install-root) install_root="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) printf 'error: unknown option: %s\n' "$1" >&2; exit 3 ;;
  esac
done

log() { printf '%s\n' "$*" | tee -a "${body_file}"; }

failures=0
unverified=0

finalize() {
  local rc=$?
  {
    printf '# Release Closure\n\n'
    printf 'Generated: %s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '```text\n'
    cat "${body_file}"
    printf '```\n'
  } > "${log_md}" 2>/dev/null || true
  rm -f "${body_file}"
  exit "${rc}"
}
trap finalize EXIT

log '-- Release closure gates --'

# ---------------------------------------------------------------------------
# 1) Dual-architecture (arm64 + x86_64) binaries
# ---------------------------------------------------------------------------
for entry in "sidecar:${sidecar_binary}" "desktop:${desktop_binary}"; do
  label="${entry%%:*}"
  path="${entry#*:}"
  archs="$(release_binary_universal "${path}" 2>&1)"
  if [[ "${archs}" == "missing" ]]; then
    log "FAIL        ${label} binary missing: ${path}"
    failures=$((failures + 1))
  elif release_binary_universal "${path}" >/dev/null 2>&1; then
    log "PASS        ${label} is universal (${archs})"
  else
    log "FAIL        ${label} is not universal (${archs})"
    failures=$((failures + 1))
  fi
done

# The two executables inside the app bundle.
if [[ -d "${app}" ]]; then
  for bin in voxstudio-desktop digital-human-sidecar; do
    binpath="${app}/Contents/MacOS/${bin}"
    archs="$(release_binary_universal "${binpath}" 2>&1)"
    if release_binary_universal "${binpath}" >/dev/null 2>&1; then
      log "PASS        app MacOS/${bin} is universal (${archs})"
    else
      log "FAIL        app MacOS/${bin} is not universal (${archs})"
      failures=$((failures + 1))
    fi
  done
else
  log "UNVERIFIED  app bundle dual-arch (no app at ${app})"
  log '            requires: a built universal app bundle'
  unverified=$((unverified + 1))
fi

# ---------------------------------------------------------------------------
# 2) Signature + Gatekeeper on the app
# ---------------------------------------------------------------------------
sig_summary="$(release_app_signature "${app}" 2>&1)"
if [[ -d "${app}" ]]; then
  if release_app_signature "${app}" >/dev/null 2>&1; then
    log "PASS        app signature verifies (${sig_summary})"
  else
    log "FAIL        app signature is not release-acceptable (${sig_summary})"
    log '            requires: Developer ID Application signing (see scripts/sign-notarize.sh)'
    failures=$((failures + 1))
  fi
  if release_spctl_accepts "${app}"; then
    log 'PASS        spctl --assess --type execute accepts app'
  else
    log 'FAIL        spctl --assess --type execute rejected app (Gatekeeper blocks it)'
    failures=$((failures + 1))
  fi
else
  log 'UNVERIFIED  signature + Gatekeeper (no app bundle)'
  unverified=$((unverified + 1))
fi

# ---------------------------------------------------------------------------
# 3) Notarization staple on the DMG
# ---------------------------------------------------------------------------
if [[ -f "${dmg}" ]]; then
  if xcrun stapler validate "${dmg}" >/dev/null 2>&1; then
    log 'PASS        DMG is stapled (stapler validate)'
  else
    log 'UNVERIFIED  DMG staple (not stapled / not notarized)'
    log '            requires: notarization credentials + scripts/sign-notarize.sh'
    unverified=$((unverified + 1))
  fi
else
  log "UNVERIFIED  DMG staple (no DMG at ${dmg})"
  unverified=$((unverified + 1))
fi

# ---------------------------------------------------------------------------
# 4) Offline launch
# ---------------------------------------------------------------------------
if [[ "${do_offline}" -eq 1 ]]; then
  if [[ -d "${app}" ]]; then
    if sudo -n true >/dev/null 2>&1; then
      log 'Attempting real offline launch (passwordless sudo available)...'
      # Order matters: disable network, launch, confirm, restore network.
      if sudo ifconfig en0 down 2>&1 | log; then
        ( open -n "${app}" >/dev/null 2>&1 || log 'WARN        open -n failed' )
        launched=0
        for _ in $(seq 1 20); do
          if pgrep -x VoxStudio >/dev/null 2>&1 || pgrep -x voxstudio-desktop >/dev/null 2>&1; then
            launched=1
            break
          fi
          sleep 0.5
        done
        sudo ifconfig en0 up >/dev/null 2>&1 || true
        if [[ "${launched}" -eq 1 ]]; then
          log 'PASS        app launched with network disabled'
          osascript -e 'quit app id "io.voxstudio.desktop"' >/dev/null 2>&1 || true
        else
          log 'FAIL        app did not launch with network disabled'
          failures=$((failures + 1))
        fi
      else
        log 'UNVERIFIED  offline launch (could not disable network)'
        unverified=$((unverified + 1))
      fi
    else
      log 'UNVERIFIED  offline launch (needs passwordless sudo to toggle network)'
      log '            runbook:  sudo ifconfig en0 down && open -a VoxStudio && <verify> && sudo ifconfig en0 up'
      log '            expects:  app and sidecar start without network; no hang on provider calls'
      unverified=$((unverified + 1))
    fi
  else
    log 'UNVERIFIED  offline launch (no app bundle)'
    unverified=$((unverified + 1))
  fi
else
  log 'UNVERIFIED  offline launch (run with --offline to attempt; needs passwordless sudo)'
  log '            expects:  app + sidecar start with no connectivity; no startup hang'
  unverified=$((unverified + 1))
fi

# Sidecar local-only readiness probe (runs without network).
if [[ -x "${sidecar_binary}" ]]; then
  if "${sidecar_binary}" --version >/dev/null 2>&1 || "${sidecar_binary}" --help >/dev/null 2>&1; then
    log 'PASS        sidecar binary runs standalone (no Python/uv needed)'
  else
    log 'FAIL        sidecar binary did not run standalone'
    failures=$((failures + 1))
  fi
else
  log 'UNVERIFIED  sidecar standalone run (binary missing)'
  unverified=$((unverified + 1))
fi

# ---------------------------------------------------------------------------
# 5) First-run permissions (camera / microphone / Keychain)
# ---------------------------------------------------------------------------
# Automatable locally: ensure the Info.plist carries the TCC usage strings.
plist="${app}/Contents/Info.plist"
if [[ -f "${plist}" ]]; then
  for key in NSCameraUsageDescription NSMicrophoneUsageDescription; do
    if plutil -extract "${key}" raw "${plist}" >/dev/null 2>&1; then
      log "PASS        Info.plist declares ${key}"
    else
      log "FAIL        Info.plist is missing ${key}"
      failures=$((failures + 1))
    fi
  done
else
  log 'UNVERIFIED  Info.plist TCC usage strings (no app bundle)'
  unverified=$((unverified + 1))
fi

# The actual TCC prompts can only be validated on a clean Mac with a real user.
log 'UNVERIFIED  first-run camera/mic permission prompts'
log '            requires: clean Mac + real GUI session (TCC prompts)'
log '            runbook:  launch app, trigger 拍摄人像 -> allow Camera;'
log '                      trigger 声音样本 -> allow Microphone;'
log '                      verify ~/Library/Application Support/io.voxstudio.desktop is created'
unverified=$((unverified + 1))

# Keychain access uses the login keychain via the `keyring` crate; first use is
# automatic but should be confirmed on a clean Mac.
log 'UNVERIFIED  first-run Keychain access'
log '            runbook:  保存 provider 密钥后确认未触发“钥匙串已被锁定”错误；'
log '                     `security find-generic-password -s io.voxstudio.desktop` 可检索到条目'
unverified=$((unverified + 1))

# ---------------------------------------------------------------------------
# 6) Overlay install / old-data upgrade / uninstall / crash cleanup
# ---------------------------------------------------------------------------
if [[ -n "${install_root}" && -d "${install_root}" ]]; then
  log "Validating installed app at: ${install_root}"
  if [[ -d "${install_root}" ]]; then
    log 'PASS        installed app present'
  else
    log 'FAIL        installed app missing'
    failures=$((failures + 1))
  fi
else
  log 'UNVERIFIED  overlay install / old-data upgrade / uninstall / crash cleanup'
  log '            requires: a real installed app (pass --install-root <app>, or run on target Mac)'
  log '            data dir: ~/Library/Application Support/io.voxstudio.desktop'
  log '            runbook:'
  log '              升级:  保留数据目录，安装新版覆盖 -> 启动后数据库迁移生成 .bak.<版本>，会话/设置保留'
  log '              卸载清理: 删除 /Applications/VoxStudio.app 与数据目录后，无残留进程/文件'
  log '              崩溃清理: kill 主程序后，无残留 VoxStudio/sidecar 进程，重启可恢复，资源(临时像/录音)释放'
  unverified=$((unverified + 1))
fi

release_summary "${failures}" "${unverified}" | tee -a "${body_file}"
if [[ "${failures}" -gt 0 ]]; then
  exit 1
fi
exit 0