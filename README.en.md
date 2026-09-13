# ZCode Universal Model Gateway (ZUMG)

[中文](README.md) | **English**

![License](https://img.shields.io/badge/license-MIT-green)
![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![Stars](https://img.shields.io/github/stars/Loopers180/zcode-universal-model-gateway?style=social)
![Last Commit](https://img.shields.io/github/last-commit/Loopers180/zcode-universal-model-gateway/main)

A locally-run **OpenAI Responses-compatible** gateway. ZCode only needs to point at
one local address (`http://127.0.0.1:8787/v1`); the gateway forwards requests to the
upstream providers you define in configuration — OpenAI Responses, OpenAI Chat
Completions, Anthropic Messages, or any OpenAI-compatible proxy — and exposes every
reasoning level as its own virtual model ID (`model@max`, `model@xhigh`, etc.).

The goal is that ZCode never needs to know an upstream Base URL, API key, real model
name, or vendor-specific reasoning parameters. All of that is configured through the
built-in Web UI or `config.yaml` — no Python changes required.

```
ZCode  ──POST /v1/responses (model = deepseek-flash@max)──▶  ZUMG  ──▶  Provider A / B / C
```

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running](#running)
- [Packaging as a Single-File Executable (Windows, no Python Required)](#packaging-as-a-single-file-executable-windows-no-python-required)
- [Quick Start](#quick-start)
- [ZCode Configuration](#zcode-configuration)
- [Configuration Reference](#configuration-reference)
- [Reasoning Levels & Virtual Models](#reasoning-levels--virtual-models)
- [Reasoning Precedence](#reasoning-precedence)
- [Request Overrides & Field Removal](#request-overrides--field-removal)
- [API Keys](#api-keys)
- [Web Admin UI](#web-admin-ui)
- [Level Comparison](#level-comparison)
- [HTTP API](#http-api)
- [Supported Provider Protocols](#supported-provider-protocols)
- [Security](#security)
- [Platform Notes (Windows / macOS / Linux)](#platform-notes-windows--macos--linux)
- [Running the Tests](#running-the-tests)
- [Project Structure](#project-structure)
- [Known Limitations](#known-limitations)
- [License](#license)

## Features

- One local endpoint for multiple providers and models.
- Virtual model IDs per reasoning level, working around ZCode's incomplete reasoning
  detection: picking `deepseek-flash@max` executes at the `max` level.
- Reasoning mappings are **configuration data, not code**: each level deep-merges an
  arbitrary YAML/JSON object into the upstream request body. Level names and vendor
  parameter fields are never hard-coded.
- Streaming: Responses→Responses passes raw SSE bytes through; Chat/Anthropic are
  converted correctly.
- Tool calling fully preserved (`tools`, `tool_choice`, `parallel_tool_calls`,
  function calls, tool results) — validated for coding-agent scenarios.
- Hot config reload: edit `config.yaml` (or save from the UI) without restarting.
  A broken config never takes the gateway down; the last known-good config keeps
  serving.
- Configs are validated before being written, using atomic replacement.
- Built-in HTML admin UI: no CDN, no build step, switchable between Chinese and
  English (the switch also drives backend error messages).
- Test Console **Level Comparison**: send one question to all (or selected)
  reasoning levels of a model at once and compare reasoning token counts,
  reasoning length, time-to-first-reasoning and latency side by side, to verify
  that `model@level` really changes upstream behaviour (see
  [Level Comparison](#level-comparison)).

## Requirements

- Python 3.11+ (development and testing use 3.12). A conda environment works too;
  a virtualenv is optional.
- No Node.js, npm, database, Redis, or Docker needed.

## Installation

Install the dependencies into your existing Python (system Python, conda env, or
virtualenv). With conda there is no need for a separate venv:

```bash
conda activate base          # or any Python 3.11+ environment
pip install -r requirements.txt
```

<details>
<summary>If you prefer an isolated virtual environment (optional)</summary>

```bash
# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
```powershell
# Windows (PowerShell)
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
</details>

## Running

```bash
python -m gateway
```

Launcher scripts are also provided. They locate a Python 3.11+ interpreter, install
dependencies on first run, then start the gateway. No machine-specific paths are
hard-coded, so the same script works on any machine:

| Platform             | Command        | Double-click launch        |
|----------------------|----------------|----------------------------|
| Windows (cmd)        | `start.bat`    | ✅ double-click `start.bat` |
| Windows (PowerShell) | `.\start.ps1`  | —                          |
| macOS / Linux        | `./start.sh`   | —                          |

Then open <http://127.0.0.1:8787/>. On first start, if `config.yaml` does not exist
it is generated automatically from `config.example.yaml`.

The gateway listens on `127.0.0.1:8787` by default. Override with environment
variables (the launch scripts honor them too):

```
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=8787
```

## Packaging as a Single-File Executable (Windows, no Python Required)

If the target computer should not need Python at all, the gateway can be packaged
into a standalone exe.

**Build** (once, on a development machine):

```powershell
.\build_exe.bat
```

The script installs PyInstaller if missing and invokes `zumg.spec`; the output is
`dist\ZUMG.exe` (about 18 MB, single file).

**Usage**: copy `ZUMG.exe` to any Windows machine and **double-click it**. Next to
the exe it will:

- generate `config.yaml` automatically on first run
- write keys saved in the Web UI to `secrets.local.json` in the same directory
- serve the admin UI at <http://127.0.0.1:8787/>

In other words the whole program is **portable**: one exe plus the two config files
it generates. It runs from a USB stick or any folder — no registry writes, no
dependencies installed.

### Moving to Another Computer: One-File Full Backup

Instead of manually copying `config.yaml` and `secrets.local.json`, use the Web UI's
**Config → Full Backup** and click **"Export full backup"**. You get a
`zumg-backup-<date>.json` containing:

- all providers, models, reasoning levels and mappings
- all saved API keys

On the new computer, open the gateway → Config → **"Import full backup"** → pick the
file and confirm. That's the whole restore.
(Only keys saved through the UI are included in the backup; keys provided via
environment variables cannot be exported.)

> ⚠️ The backup file contains **keys in plain text**. Store it carefully; never
> upload it to cloud drives, GitHub, or chat apps. To export the configuration
> without keys, use "Export (no keys)".

Notes:

- An exe only runs on the **same operating system it was built on** (a
  Windows-built exe runs on Windows only; macOS/Linux need to be packaged on their
  own platforms).
- On first launch, Windows Defender SmartScreen may block the unsigned executable
  (normal for unsigned binaries); choose "Run anyway".
- Different port: set `GATEWAY_PORT=8899` before starting, or place a `.env` file
  next to the exe.

## Quick Start

```bash
# 1. Set a provider key (DeepSeek shown as an example)
export DEEPSEEK_API_KEY="sk-..."      # PowerShell: $env:DEEPSEEK_API_KEY="sk-..."

# 2. Start the gateway
python -m gateway

# 3. Point ZCode at it, then request a virtual model
curl http://127.0.0.1:8787/v1/models
curl -X POST http://127.0.0.1:8787/v1/responses \
  -H 'content-type: application/json' \
  -d '{"model":"deepseek-flash@max","input":"say hi"}'
```

## ZCode Configuration

Create a custom **OpenAI Responses-compatible** provider in ZCode:

| Setting  | Value                                                        |
|----------|--------------------------------------------------------------|
| Base URL | `http://127.0.0.1:8787/v1`                                   |
| API Key  | `local` (any non-empty placeholder)                          |
| Model    | any ID returned by `GET /v1/models`, e.g. `deepseek-flash@max` |

The gateway ignores the `local` placeholder. The real provider key comes from the
environment variable named in the config — see [API Keys](#api-keys).

## Configuration Reference

`config.yaml` is the single source of truth. Start from `config.example.yaml`, which
contains examples for all three protocols.

```yaml
settings:
  reasoning_precedence: alias   # alias | client

providers:
  deepseek:
    display_name: DeepSeek
    protocol: openai_responses   # openai_responses | openai_chat | anthropic_messages
    base_url: https://api.deepseek.com/v1
    api_key_env: DEEPSEEK_API_KEY
    timeout: 600                 # optional, seconds
    headers:                     # optional, static headers
      X-Client: zumg
    headers_from_env:            # optional, header name -> env var name
      X-Custom-Token: CUSTOM_TOKEN
    paths:                       # optional, sensible defaults are generated
      responses: /responses
      chat_completions: /chat/completions
      models: /models

models:
  deepseek-flash:
    display_name: DeepSeek Flash
    provider: deepseek
    upstream_model: deepseek-chat
    enabled: true
    reasoning:
      supported: [off, low, high, max]
      default: high
      mapping:
        off:  { reasoning: { effort: none } }
        low:  { reasoning: { effort: low } }
        high: { reasoning: { effort: high } }
        max:  { reasoning: { effort: max } }
```

### Provider Fields

| Field            | Description                                                            |
|------------------|------------------------------------------------------------------------|
| `display_name`   | Name shown in the UI.                                                  |
| `protocol`       | One of `openai_responses`, `openai_chat`, `anthropic_messages`.        |
| `base_url`       | Upstream root URL, e.g. `https://api.openai.com/v1`.                   |
| `api_key_env`    | Environment variable holding this provider's key.                      |
| `enabled`        | Set to false to keep the config but stop forwarding to it.             |
| `timeout`        | Per-request upstream timeout in seconds; default 600.                  |
| `headers`        | Static headers sent with every upstream request.                       |
| `headers_from_env` | Mapping of header name → environment variable name.                  |
| `paths`          | Optional path overrides; protocol-aware defaults are generated.        |

### Model Fields

| Field               | Description                                                              |
|---------------------|--------------------------------------------------------------------------|
| `provider`          | Must reference a defined provider.                                       |
| `upstream_model`    | The real model ID sent upstream.                                         |
| `enabled`           | Disabled models are hidden from `/v1/models` and rejected on request.    |
| `reasoning`         | Levels, default level, and mapping (see below).                          |
| `request_overrides` | Deep-merged into every request (takes precedence over the client body).  |
| `remove_fields`     | Dot-separated paths removed from the final upstream body.                |

## Reasoning Levels & Virtual Models

**Level names are arbitrary strings.** The gateway does not hard-code
`low`/`high`/`max` — you can use `minimal`, `xhigh`, `ultra`, and so on.

For a model with levels `off, low, high, max`, `GET /v1/models` returns:

```
deepseek-flash
deepseek-flash@off
deepseek-flash@low
deepseek-flash@high
deepseek-flash@max
```

The bare ID (no suffix) uses the model's `default` level (`high` here), so
`deepseek-flash` behaves the same as `deepseek-flash@high`.

Each level's `mapping` is an arbitrary object **deep-merged** into the upstream
request body. The gateway does not interpret its contents. Examples:

```yaml
mapping:
  max: { reasoning: { effort: high } }        # OpenAI style
  high: { reasoning_effort: high }            # flat field
  low:  { thinking: { type: enabled, budget_tokens: 4000 } }   # Anthropic style
  minimal: { thinkingConfig: { thinkingBudget: 1024 } }         # Gemini style
```

Vendors name their "thinking strength" parameters differently; put the right field
in the mapping:

| Provider / Protocol          | Reasoning parameter                                              |
|------------------------------|------------------------------------------------------------------|
| DeepSeek / OpenAI Responses  | `reasoning: { effort: none \| low \| high \| max }`              |
| Qwen3.8-Flash (DashScope compatible-mode) | `reasoning_effort: low \| medium \| xhigh` (default `xhigh`); `enable_thinking: false` disables thinking |
| Anthropic                    | `thinking: { type: enabled, budget_tokens: 8000 }`               |

In the Web UI's model editor these ship as dropdown presets (`reasoning.effort`,
`reasoning_effort`, `thinking.budget_tokens`, `thinking.type`, `enable_thinking`) —
pick the field, fill in the value, no hand-written JSON needed.

Qwen3.8-Flash example (`off` disables thinking; the rest use the official
`reasoning_effort` levels):

```yaml
models:
  qwen-flash:
    provider: qwen
    upstream_model: qwen3.8-flash
    reasoning:
      supported: [off, low, medium, xhigh]
      default: xhigh
      mapping:
        off:    { enable_thinking: false }
        low:    { reasoning_effort: low }
        medium: { reasoning_effort: medium }
        xhigh:  { reasoning_effort: xhigh }
```

> Note: per the official docs, `high` and `max` are automatically mapped to
> `xhigh`; thinking is on by default; when thinking is on, `temperature` defaults
> to 0.6 (smaller values are adjusted automatically).

Use `POST /api/admin/preview` (or the Test Console in the UI) to inspect the final
upstream request body before sending.

## Reasoning Precedence

```
model@level suffix  >  model default  >  client-sent reasoning
```

With the default `settings.reasoning_precedence: alias`, requesting `foo@max` while
sending `{"reasoning": {"effort": "low"}}` still executes at `max`. That is the
whole point of this project: let the model alias force-override the reasoning
settings ZCode itself sends. Setting `reasoning_precedence: client` reverses this
(the client request body wins).

### Fully Ignoring Client Reasoning Settings

A deep merge can only override **same-named fields**. When the client and your level
mapping use **different field names** (e.g. ZCode sends `reasoning.effort` for the
Responses protocol, while Qwen needs `reasoning_effort`), both fields end up in the
upstream body and the client's field may still influence the result.

Enable **`ignore_client_reasoning: true`** on a model to fix this: the gateway
strips these client-sent fields before applying the level mapping:

```
reasoning           # OpenAI Responses: reasoning.effort / reasoning.summary
reasoning_effort    # OpenAI Chat Completions flat field
reasoningEffort     # camelCase variant of the same field (some model catalogs use it)
reasoning_summary   # reasoning summary toggle
thinking            # Anthropic: thinking.type / budget_tokens
thinkingConfig      # Gemini style
thinking_budget
enable_thinking     # Qwen / Tongyi thinking toggle
output_config       # Anthropic's block that carries effort
```

This covers every reasoning path injected by ZCode's built-in model catalog
(`thinking`, `output_config.effort`, `enable_thinking`, `thinking.type`,
`reasoningEffort`), plus the other common OpenAI / Anthropic / Qwen spellings. The
final body is then decided solely by the chosen `model@level`, independent of any
client toggle:

```yaml
models:
  qwen-flash:
    provider: qwen
    upstream_model: qwen3.8-flash
    ignore_client_reasoning: true   # ZCode's thinking toggles no longer have any effect
    reasoning:
      supported: [off, low, medium, xhigh]
      default: xhigh
      mapping:
        off:    { enable_thinking: false }
        low:    { reasoning_effort: low }
        medium: { reasoning_effort: medium }
        xhigh:  { reasoning_effort: xhigh }
```

In the Web UI this is the "Ignore client reasoning" checkbox in the model editor. It
only applies when the level mapping is applied with `alias` precedence; enabling it
is equivalent to force-removing the fields listed above.

## Request Overrides & Field Removal

```yaml
models:
  my-model:
    provider: custom
    upstream_model: model-123
    request_overrides:
      temperature: 1
      extra_body:
        foo: bar
    remove_fields:
      - temperature
      - top_p
      - reasoning.summary
```

The final upstream body is merged in this order: client body → `request_overrides`
→ reasoning mapping (under `alias` precedence) → forced `model` → field removal.

## API Keys

Keys are **never** stored in `config.yaml`. Three ways to provide them, highest
priority first:

1. **Local key file (recommended — enter once)** — enter the key in the Web UI's
   provider editor and click "Save locally". The key is written to
   `secrets.local.json` next to the config and reloaded automatically after a
   restart, so you never set the env var again. The file is git-ignored and gets
   `0600` permissions on macOS/Linux.
2. **Session-only temporary key** — also entered in the UI, via "This session
   only". Kept in process memory only; gone on restart.
3. **Environment variable** — each provider names one via `api_key_env`:

```bash
export OPENAI_API_KEY="sk-..."        # macOS / Linux
```
```powershell
$env:OPENAI_API_KEY="sk-..."          # Windows PowerShell
```

If a key is missing, the gateway still starts; calling that provider returns a
clear error:

```json
{ "error": { "type": "provider_auth_error",
             "message": "environment variable OPENAI_API_KEY is not set." } }
```

## Web Admin UI

Open <http://127.0.0.1:8787/> (or `/ui`). The UI ships in Chinese and English —
use the language button in the top-right corner to switch (the choice is
remembered, and backend error messages follow it too). The page names below are
the English renderings of the on-screen labels. Pages:

- **Dashboard** — runtime status, counts, the ZCode Base URL (with copy button),
  recent requests/errors.
- **Providers** — add / edit / delete / duplicate / test / enable-disable; key
  status (`saved locally` / `environment` / `temporary key` / `missing`); enter a
  key to "Save locally" (survives restarts) or keep it for "This session only",
  or "Clear key".
- **Models** — add / edit / delete / duplicate / test; dynamically add/remove
  reasoning-level rows, each with a JSON mapping editor; live preview of virtual
  model IDs.
- **Test Console** — two modes:
  - **Single Test**: pick a virtual model, send streaming or non-streaming; view a
    redacted request preview and the streamed output; interrupt in-flight requests.
  - **Level Comparison**: see [Level Comparison](#level-comparison).
- **Config** — form mode (via the provider/model pages) and raw YAML mode with
  validate / save / reload / download / upload / reset-to-example, plus
  **Full Backup** (export/import a single JSON file including saved keys — see
  [Packaging as a Single-File Executable](#packaging-as-a-single-file-executable-windows-no-python-required)).
- **Logs** — the last 100 requests (time, model, level, provider, upstream model,
  protocol, status, latency, error type). Prompts and tool outputs are never logged.
- **About**.

The UI follows the system light/dark theme and is responsive on mobile.

## Level Comparison

Once levels are configured, you may want to know whether `model@level` actually
takes effect. **Level Comparison** in the Test Console does exactly that: enter a
question, tick the levels to compare (all by default), and click "Start Comparison".
The gateway sends the same request once per level (at most 4 concurrently; one
failing level never cancels the others) and lays the results out side by side:

- The parameters that level actually injected into the upstream request body
  (`mapping` and `request_overrides`);
- Reasoning token count, reasoning character count, time to the first reasoning
  chunk, total latency, and input/output tokens;
- The reasoning text and the answer (each truncated to 20000 characters).

A summary bar at the top ranks the levels by length and states whether the level
mappings had an observable effect. Evidence is ordered by strength:

1. **Reasoning tokens** (most reliable, from the upstream `usage`);
2. **Reasoning character count** (when the upstream reports no tokens, the
   reasoning text length stands in);
3. When neither is available, only latency remains and no conclusion can be drawn.

Two known limits: some proxies return neither reasoning content nor
`reasoning_tokens` (the summary labels both when only some levels report tokens);
and the Anthropic protocol currently reports `reasoning_tokens` as 0. So when
comparing a provider for the first time, first check whether it returns a reasoning
summary — for the Responses protocol you can add `reasoning.summary=auto` to the
model's `request_overrides` to ask the upstream for the reasoning process.

Note: **every level is a real call and may incur cost**.

## HTTP API

For ZCode:

| Method | Path                   | Description                                              |
|--------|------------------------|----------------------------------------------------------|
| `GET`  | `/v1/models`           | All enabled logical models and virtual model IDs.        |
| `GET`  | `/v1/models/{id}`      | A single model.                                          |
| `POST` | `/v1/responses`        | Primary entry point; supports `stream: true`.            |
| `POST` | `/v1/chat/completions` | Convenience entry; returns a Responses-shaped body.      |
| `GET`  | `/healthz`             | `{"status":"ok","config":"valid"}`; a missing key never fails it. |

Admin API (`/api/admin/*`): `status`, `meta`, `logs`, `metrics`, `providers`
(GET/POST/PUT/DELETE + duplicate/test/temporary-key), `models`
(GET/POST/PUT/DELETE + duplicate/test/virtual), `preview`, `compare`, `config`
(get/validate/save/reload/download/upload/reset-example), and `config/bundle`
(full-backup export/import).

`POST /api/admin/compare` backs Level Comparison: request body
`{"model":"deepseek-flash","levels":["low","max"],"body":{"input":"…"},"stream":false}`,
streamed back as NDJSON — first `{"type":"started",…}`, then one
`{"type":"result",…}` line per level as it finishes (with `reasoning_tokens`,
`reasoning_chars`, `first_reasoning_ms`, `elapsed_ms`, `mapping`, …), and finally
`{"type":"done","count":N}`. Omitting `levels` means all levels; `model` also
accepts the `model@level` form (the comparison always spans the model's levels).

Error types: `unknown_model`, `unknown_reasoning_level`, `provider_disabled`,
`model_disabled`, `provider_auth_error`, `upstream_timeout`, `upstream_error`,
`config_error`, `adapter_error`, `unsupported_feature`.

Upstream HTTP statuses (400/401/403/404/409/429/5xx) are preserved along with the
upstream body and Content-Type.

## Supported Provider Protocols

| Protocol              | Purpose                          | Status                                                       |
|-----------------------|----------------------------------|--------------------------------------------------------------|
| `openai_responses`    | OpenAI Responses-compatible upstream | Fully supported; streaming passes raw SSE bytes through. |
| `openai_chat`         | OpenAI Chat Completions upstream | Request/response conversion, streaming, tool calling.        |
| `anthropic_messages`  | Anthropic Messages upstream      | system/messages, tools, thinking, streaming.                 |

Responses→Responses favors stability. Responses-specific advanced features that
cannot be losslessly converted for Chat/Anthropic (`previous_response_id`, `store`,
`include`) return `unsupported_feature` rather than silently changing semantics.

## Security

- Binds to `127.0.0.1` by default (never `0.0.0.0` by default).
- API keys come only from environment variables, the local key file, or in-memory
  temporary keys. They are never written into configs, logs, or responses.
- Raw YAML config is validated before being written, via atomic replacement
  (temp file + `fsync` + atomic rename).
- Optional admin authentication: set `GATEWAY_ADMIN_TOKEN` and every
  `/api/admin/*` request must carry it (`x-admin-token` header or
  `Authorization: Bearer …`). The UI keeps the token in `sessionStorage` only.
- No wildcard CORS; the UI and API are same-origin.
- Logs contain no prompts, inputs, tool outputs, headers, or keys.

> **Note:** the admin API and the `/v1/*` proxy endpoints have no authentication by
> default — this is intended for local use. If you expose the gateway beyond
> `127.0.0.1` (LAN, container, tunnel), set `GATEWAY_ADMIN_TOKEN` and put the
> gateway behind an authenticating reverse proxy. The full-backup file contains
> keys in plain text; keep it safe.

## Platform Notes (Windows / macOS / Linux)

The gateway is pure Python (FastAPI + httpx) and runs identically on all three
platforms. A few platform-specific details:

- **Launchers.** `start.sh` (macOS/Linux), `start.bat` (cmd) and `start.ps1`
  (PowerShell) all locate a Python 3.11+ via `PATH` (plus common conda install
  locations on Windows as a fallback), install dependencies on first run, and
  start the gateway. No machine-specific paths are hard-coded.
- **Executable bit.** `start.sh` is committed with mode `755`, and
  `.gitattributes` forces LF line endings for it, so it stays executable after
  cloning on Linux/macOS. If the bit is ever lost, run `chmod +x start.sh` once
  or just `bash start.sh`.
- **Key file permissions.** On macOS/Linux, `secrets.local.json` is created with
  `0600` permissions. (On Windows, POSIX permissions do not apply; rely on your
  user-profile ACLs.)
- **Line endings.** `.gitattributes` keeps `*.sh`/`*.py`/`*.yaml` at LF and
  Windows scripts (`*.bat`, `*.cmd`, `*.ps1`) at CRLF, so a single clone works
  across all three platforms.
- **Running as a service.** For a persistent setup, run `python -m gateway`
  under a service manager, e.g. a systemd unit (`ExecStart=/usr/bin/env
  GATEWAY_CONFIG=/etc/zumg/config.yaml python -m gateway`) on Linux, or a
  launchd plist on macOS. Set `GATEWAY_ADMIN_TOKEN` whenever the port is not
  loopback-only.
- **Startup banner.** The banner is printed by Python (not the shell scripts) so
  Unicode output is correct regardless of console code page; launcher messages
  are kept ASCII-only for the same reason.
- **Windows executable.** On Windows the gateway can additionally be packaged
  into a portable single-file exe with `build_exe.bat` — see
  [Packaging as a Single-File Executable](#packaging-as-a-single-file-executable-windows-no-python-required).

## Running the Tests

```bash
pip install -r requirements-dev.txt
pytest -q
```

All tests mock upstreams with `httpx.MockTransport`; no real or paid API is called.

## Project Structure

```
gateway/
  __main__.py        # python -m gateway entry point
  app.py             # FastAPI app, /v1 endpoints, static UI
  config.py          # schema, validation, atomic writes, hot reload
  models.py          # model resolution, virtual model IDs
  router.py          # planning, upstream HTTP, streaming, error mapping
  merge.py           # deep merge and safe nested field removal
  secrets.py         # local key file + in-memory temporary keys + env vars
  metrics.py         # in-memory metrics and bounded request log
  compare.py         # level comparison: one prompt across levels, with reasoning metrics
  errors.py          # unified error types
  paths.py           # path resolution in source/frozen (exe) modes
  adapters/          # openai_responses, openai_chat, anthropic_messages
  admin/api.py       # admin API
  static/            # index.html, style.css, app.js
tests/               # pytest suite (all upstreams mocked)
config.example.yaml  requirements*.txt  README.md / README.en.md
run_gateway.py  zumg.spec  build_exe.bat   # exe packaging (entry / spec / one-click script)
start.bat  start.ps1  start.sh           # portable launchers (no hard-coded paths)
.gitignore  .gitattributes  .env.example
```

`config.yaml` is git-ignored (it holds your local provider config) and is
generated from `config.example.yaml` on first run. `secrets.local.json` (written
by "Save locally" in the UI) is git-ignored as well.

## Known Limitations

- The Anthropic adapter's Responses↔Messages conversion is a new implementation;
  Responses-specific constructs it cannot handle raise `unsupported_feature`
  rather than guessing at semantics.
- `reasoning_precedence: client` is supported, but the default `alias` mode is the
  one exercised by the test suite.
- Metrics and logs are in-memory only and reset on restart (by design).
- "Test connection" performs one lightweight `GET /models` probe; it never issues
  a billable inference request.
- Hot reload is based on file mtime, so changes take effect on the next request
  after the file changes.
- Level Comparison depends on what the upstream returns: an upstream that reports
  neither `reasoning_tokens` nor reasoning content cannot be judged this way; the
  Anthropic protocol currently reports `reasoning_tokens` as 0.
- Launcher scripts print ASCII-only messages (avoiding Windows batch code-page
  issues); the startup banner is printed by Python.

## License

Released under the [MIT License](LICENSE). Copyright © 2026 Linxuan Fang.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Loopers180/zcode-universal-model-gateway&type=Date)](https://star-history.com/#Loopers180/zcode-universal-model-gateway&Date)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Loopers180/zcode-universal-model-gateway&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Loopers180/zcode-universal-model-gateway&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Loopers180/zcode-universal-model-gateway&type=Date" />
</picture>
