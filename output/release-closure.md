# Release Closure

Generated: 2026-08-05T03:46:17Z

```text
-- Release closure gates --
PASS        sidecar is universal (x86_64 arm64)
PASS        desktop is universal (x86_64 arm64)
PASS        app MacOS/voxstudio-desktop is universal (x86_64 arm64)
PASS        app MacOS/digital-human-sidecar is universal (x86_64 arm64)
FAIL        app signature is not release-acceptable (Signature=adhoc TeamIdentifier=not set)
            requires: Developer ID Application signing (see scripts/sign-notarize.sh)
FAIL        spctl --assess --type execute rejected app (Gatekeeper blocks it)
UNVERIFIED  DMG staple (not stapled / not notarized)
            requires: notarization credentials + scripts/sign-notarize.sh
UNVERIFIED  offline launch (run with --offline to attempt; needs passwordless sudo)
            expects:  app + sidecar start with no connectivity; no startup hang
PASS        sidecar binary runs standalone (no Python/uv needed)
PASS        Info.plist declares NSCameraUsageDescription
PASS        Info.plist declares NSMicrophoneUsageDescription
UNVERIFIED  first-run camera/mic permission prompts
            requires: clean Mac + real GUI session (TCC prompts)
            runbook:  launch app, trigger 拍摄人像 -> allow Camera;
                      trigger 声音样本 -> allow Microphone;
                      verify ~/Library/Application Support/io.voxstudio.desktop is created
UNVERIFIED  first-run Keychain access
            runbook:  保存 provider 密钥后确认未触发“钥匙串已被锁定”错误；
                     `security find-generic-password -s io.voxstudio.desktop` 可检索到条目
UNVERIFIED  overlay install / old-data upgrade / uninstall / crash cleanup
            requires: a real installed app (pass --install-root <app>, or run on target Mac)
            data dir: ~/Library/Application Support/io.voxstudio.desktop
            runbook:
              升级:  保留数据目录，安装新版覆盖 -> 启动后数据库迁移生成 .bak.<版本>，会话/设置保留
              卸载清理: 删除 /Applications/VoxStudio.app 与数据目录后，无残留进程/文件
              崩溃清理: kill 主程序后，无残留 VoxStudio/sidecar 进程，重启可恢复，资源(临时像/录音)释放
Release closure FAILED with 2 FAIL and 5 UNVERIFIED item(s).
```
