# Provider Readiness

Generated: 2026-08-05T01:47:12Z

> **Corrective note (2026-08-05):** the `OK local ... responding` line below is a
> **false positive**. No local model service exists on 127.0.0.1:11434; the local
> proxy (ClashX on 127.0.0.1:7890) intercepts the probe and returns a 502 that curl
> treats as success (exit 0). Bypassing the proxy (`curl --noproxy '*'`) shows
> connection refused. All provider paths are therefore **未验证**. See
> `output/release-acceptance.md`.

```text
-- Provider smoke availability --
OK    local OpenAI-compatible service is responding
FAIL  VOXSTUDIO_REMOTE_BASE_URL is not set
FAIL  Feishu access token and space id are not both set
FAIL  Apple release credentials are not configured
At least one provider smoke path is available.
```
