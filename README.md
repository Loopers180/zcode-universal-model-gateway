# ZCode Universal Model Gateway（ZUMG）

**中文** | [English](README.en.md)

![License](https://img.shields.io/badge/license-MIT-green)
![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![Stars](https://img.shields.io/github/stars/Loopers180/zcode-universal-model-gateway?style=social)
![Last Commit](https://img.shields.io/github/last-commit/Loopers180/zcode-universal-model-gateway/main)

一个本地运行的 **OpenAI Responses 兼容** 网关。ZCode 只需连接一个本地地址
（`http://127.0.0.1:8787/v1`），网关负责把请求转发到你在配置里指定的上游服务商
——OpenAI Responses、OpenAI Chat Completions、Anthropic Messages，或任何
OpenAI 兼容的中转服务——并把每一个思考档位暴露成独立的虚拟模型 ID
（`model@max`、`model@xhigh` 等）。

目标是让 ZCode 完全不需要知道上游的 Base URL、API Key、真实模型名和各家特有的
reasoning 参数。这些全部通过内置的 Web 界面或 `config.yaml` 配置，无需修改 Python 代码。

```
ZCode  ──POST /v1/responses (model = deepseek-flash@max)──▶  ZUMG  ──▶  服务商 A / B / C
```

---

## 目录

- [功能特性](#功能特性)
- [环境要求](#环境要求)
- [安装](#安装)
- [启动](#启动)
- [快速上手](#快速上手)
- [ZCode 配置](#zcode-配置)
- [配置说明](#配置说明)
- [思考档位与虚拟模型](#思考档位与虚拟模型)
- [思考档位优先级](#思考档位优先级)
- [请求覆盖与删除字段](#请求覆盖与删除字段)
- [API Key](#api-key)
- [Web 管理界面](#web-管理界面)
- [档位对比](#档位对比)
- [HTTP 接口](#http-接口)
- [支持的服务商协议](#支持的服务商协议)
- [安全](#安全)
- [运行测试](#运行测试)
- [项目结构](#项目结构)
- [已知限制](#已知限制)

## 功能特性

- 单一本地端点对接多个服务商与模型。
- 按思考档位暴露虚拟模型 ID，绕开 ZCode 对 reasoning 能力识别不完整的问题：
  选 `deepseek-flash@max` 就会以 `max` 档执行。
- 思考映射是**配置数据，不是代码**：每个档位把任意 YAML/JSON 对象 deep merge 进
  上游请求体。档位名和厂商参数字段都没有写死。
- 流式输出：Responses→Responses 为原始 SSE 字节透传，Chat/Anthropic 会正确转换。
- Tool calling 完整保留（tools、tool_choice、parallel_tool_calls、function call、
  tool result），面向编程 Agent 场景验证过。
- 配置热更新：编辑 `config.yaml`（或在界面里保存）后无需重启。写坏配置不会让网关
  崩溃，上一版有效配置会继续服务。
- 配置写入前先校验，并采用原子替换写入。
- 内置 HTML 管理界面，不依赖 CDN，无构建步骤，支持中英文切换。
- 测试台「档位对比」：同一个问题一次性发给某个模型的全部（或选定的）思考档位，
  并排比较各档位的思考 token 数、思考字数、首字延迟与耗时，用来验证
  `模型@档位` 是否真的改变了上游行为（见下方[档位对比](#档位对比)）。

## 环境要求

- Python 3.11+（开发与测试基于 3.12）。使用 conda 环境也可以，虚拟环境是可选项。
- 不需要 Node.js、npm、数据库、Redis 或 Docker。

## 安装

把依赖装进你现有的 Python 即可（系统 Python、conda 环境或虚拟环境）。用 conda 时
无需再建虚拟环境：

```bash
conda activate base          # 或任何 Python 3.11+ 的环境
pip install -r requirements.txt
```

<details>
<summary>如果更想用独立的虚拟环境（可选）</summary>

```powershell
# Windows (PowerShell)
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
```bash
# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
</details>

## 启动

```powershell
python -m gateway
```

也可以使用启动脚本：它们会自动寻找 Python 3.11+、在缺依赖时安装，然后启动网关。
脚本里没有写死任何机器专属路径，换机器同样可用：

| 平台 | 命令 | 双击启动 |
|------|------|----------|
| Windows (cmd) | `start.bat` | ✅ 直接双击 `start.bat` |
| Windows (PowerShell) | `.\start.ps1` | — |
| macOS / Linux | `./start.sh` | — |

然后打开 <http://127.0.0.1:8787/>。首次启动时如果 `config.yaml` 不存在，会自动从
`config.example.yaml` 生成一份。

默认监听 `127.0.0.1:8787`。可用环境变量覆盖（启动脚本也遵循这些变量）：

```
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=8787
```

## 打包成单文件 exe（Windows，免装 Python）

如果目标电脑不想装 Python，可以打包成一个独立 exe 带过去。

**构建**（在开发机上执行一次）：

```powershell
.\build_exe.bat
```

脚本会装好 PyInstaller（如缺）并调用 `zumg.spec`，产物为 `dist\ZUMG.exe`（约 18 MB，单文件）。

**使用**：把 `ZUMG.exe` 拷到任意 Windows 电脑，**双击即可**。它会在自己旁边：

- 首次运行自动生成 `config.yaml`
- 在 Web 界面保存的 Key 写入同目录的 `secrets.local.json`
- 打开 <http://127.0.0.1:8787/> 管理界面

也就是说整个程序是**便携的**：一个 exe + 它自动生成的两个配置文件，放在 U 盘或任意文件夹都能跑，不写注册表、不装依赖。

### 换电脑：一个文件带走全部配置

不想手动拷贝 `config.yaml` 和 `secrets.local.json`，可以在 Web 界面
**配置 → 完整备份** 里点 **「导出完整备份」**，得到一个 `zumg-backup-日期.json`。
它包含：

- 全部服务商、模型、思考档位与映射
- 全部已保存的 API Key

在新电脑上打开网关 → 配置 → **「导入完整备份」** → 选择该文件，确认后即完成恢复。
（在界面里保存的 Key 才会进入备份；用环境变量提供的 Key 无法导出。）

> ⚠️ 该文件包含**明文 Key**，请妥善保管，不要上传到网盘、GitHub 或聊天工具。
> 只想导出配置、不带 Key 时，用「导出（不含 Key）」。

注意事项：

- exe 只能在与构建时**相同的操作系统**上运行（Windows 构建的只能在 Windows 用；macOS/Linux 需在各自系统上重新打包）。
- 首次启动可能会被 Windows Defender SmartScreen 拦截（未签名的可执行文件的常见行为），选择"仍要运行"即可。
- 换端口：启动前设环境变量 `GATEWAY_PORT=8899`，或在同一目录放 `.env` 文件。

## 快速上手

```bash
# 1. 设置服务商 Key（以 DeepSeek 为例）
export DEEPSEEK_API_KEY="sk-..."      # PowerShell 用：$env:DEEPSEEK_API_KEY="sk-..."

# 2. 启动网关
python -m gateway

# 3. 让 ZCode 指向它，然后请求一个虚拟模型
curl http://127.0.0.1:8787/v1/models
curl -X POST http://127.0.0.1:8787/v1/responses \
  -H 'content-type: application/json' \
  -d '{"model":"deepseek-flash@max","input":"say hi"}'
```

## ZCode 配置

在 ZCode 中创建一个自定义的 **OpenAI Responses 兼容** 服务商：

| 配置项 | 值 |
|--------|-----|
| Base URL | `http://127.0.0.1:8787/v1` |
| API Key | `local`（任意非空占位符即可） |
| Model | `GET /v1/models` 返回的任意 ID，例如 `deepseek-flash@max` |

网关会忽略 `local` 这个占位符。真实的服务商 Key 来自配置中指定的环境变量，
见 [API Key](#api-key)。

## 配置说明

`config.yaml` 是唯一的配置来源。可以从 `config.example.yaml` 开始，里面已包含三种协议示例。

```yaml
settings:
  reasoning_precedence: alias   # alias | client

providers:
  deepseek:
    display_name: DeepSeek
    protocol: openai_responses   # openai_responses | openai_chat | anthropic_messages
    base_url: https://api.deepseek.com/v1
    api_key_env: DEEPSEEK_API_KEY
    timeout: 600                 # 可选，单位秒
    headers:                     # 可选，固定请求头
      X-Client: zumg
    headers_from_env:            # 可选，请求头 -> 环境变量名
      X-Custom-Token: CUSTOM_TOKEN
    paths:                       # 可选，默认会自动生成
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

### 服务商字段

| 字段 | 说明 |
|------|------|
| `display_name` | 界面上显示的名称。 |
| `protocol` | 取值之一：`openai_responses`、`openai_chat`、`anthropic_messages`。 |
| `base_url` | 上游根地址，例如 `https://api.openai.com/v1`。 |
| `api_key_env` | 存放该服务商 Key 的环境变量名。 |
| `enabled` | 设为 false 可保留配置但停止向它转发。 |
| `timeout` | 单次上游请求超时时间（秒），默认 600。 |
| `headers` | 每次上游请求都会带上的固定请求头。 |
| `headers_from_env` | 请求头名 → 环境变量名 的映射。 |
| `paths` | 可选的路径覆盖；会按协议生成合理默认值。 |

### 模型字段

| 字段 | 说明 |
|------|------|
| `provider` | 必须引用一个已定义的服务商。 |
| `upstream_model` | 发送给上游的真实模型 ID。 |
| `enabled` | 禁用的模型不会出现在 `/v1/models`，请求也会被拒绝。 |
| `reasoning` | 档位、默认档位与映射（见下文）。 |
| `request_overrides` | deep merge 进每一次请求（优先级高于客户端请求体）。 |
| `remove_fields` | 从最终上游请求体中删除的点号路径。 |

## 思考档位与虚拟模型

**档位名称可以是任意字符串。** 网关不写死 `low`/`high`/`max`，你可以用
`minimal`、`xhigh`、`ultra` 等等。

对于档位为 `off, low, high, max` 的模型，`GET /v1/models` 会返回：

```
deepseek-flash
deepseek-flash@off
deepseek-flash@low
deepseek-flash@high
deepseek-flash@max
```

不带档位后缀的 ID 使用模型的 `default` 档（此处为 `high`），因此 `deepseek-flash`
和 `deepseek-flash@high` 行为一致。

每个档位的 `mapping` 是一个任意对象，会被 **deep merge** 进上游请求体。网关不解释它
的内容。例如：

```yaml
mapping:
  max: { reasoning: { effort: high } }        # OpenAI 风格
  high: { reasoning_effort: high }            # 扁平字段
  low:  { thinking: { type: enabled, budget_tokens: 4000 } }   # Anthropic 风格
  minimal: { thinkingConfig: { thinkingBudget: 1024 } }         # Gemini 风格
```

各厂商“思考强度”的参数名不同，映射里写对应字段即可：

| 服务商 / 协议 | 思考参数 |
|---------------|----------|
| DeepSeek / OpenAI Responses | `reasoning: { effort: none \| low \| high \| max }` |
| Qwen3.8-Flash（百炼 compatible-mode） | `reasoning_effort: low \| medium \| xhigh`（默认 `xhigh`）；`enable_thinking: false` 关闭思考 |
| Anthropic | `thinking: { type: enabled, budget_tokens: 8000 }` |

在 Web 界面的模型编辑框里，这些都已做成下拉预设（`reasoning.effort`、
`reasoning_effort`、`thinking.budget_tokens`、`thinking.type`、`enable_thinking`），
选字段、填值即可，不用手写 JSON。

Qwen3.8-Flash 示例（`off` 关闭思考，其余按官方 `reasoning_effort` 分档）：

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

> 注：官方文档说明 `high`、`max` 会被自动映射到 `xhigh`；思考默认开启；开启思考时
> `temperature` 默认 0.6（更小的值会被自动调整）。

发送前可用 `POST /api/admin/preview`（或界面里的测试台）查看最终的上游请求体。

## 思考档位优先级

```
模型名@档位后缀  >  模型 default  >  客户端请求自带的 reasoning
```

默认 `settings.reasoning_precedence: alias` 下，请求 `foo@max` 同时又带了
`{"reasoning": {"effort": "low"}}`，最终会按 `max` 执行。这正是本项目的核心目的：
让模型别名强制覆盖 ZCode 自身发出的 reasoning 设置。设为 `reasoning_precedence: client`
则反转（以客户端请求体为准）。

### 彻底忽略客户端的思考设置

deep merge 只能覆盖**同名字段**。当客户端和你的档位映射用了**不同字段名**时（例如
ZCode 对 responses 协议发 `reasoning.effort`，而 Qwen 需要 `reasoning_effort`），
两个字段会同时出现在上游请求体里，客户端那个仍可能影响结果。

给某个模型勾选（或配置）**`ignore_client_reasoning: true`** 即可解决：网关会在套用档位
映射之前，先删掉客户端发来的这些字段：

```
reasoning           # OpenAI Responses：reasoning.effort / reasoning.summary
reasoning_effort    # OpenAI Chat Completions 扁平字段
reasoningEffort     # 同一字段的驼峰写法（部分厂商目录用它）
reasoning_summary   # 思考摘要开关
thinking            # Anthropic：thinking.type / budget_tokens
thinkingConfig      # Gemini 风格
thinking_budget
enable_thinking     # Qwen / 通义思考开关
output_config       # Anthropic 用于承载 effort 的块
```

这覆盖了 ZCode 内置模型目录里会注入的全部思考路径（`thinking`、
`output_config.effort`、`enable_thinking`、`thinking.type`、`reasoningEffort`），
以及 OpenAI / Anthropic / Qwen 常用的其它写法。这样最终请求体只由你所选的
`model@档位` 决定，与客户端开关完全无关：

```yaml
models:
  qwen-flash:
    provider: qwen
    upstream_model: qwen3.8-flash
    ignore_client_reasoning: true   # ZCode 的思考开关不再有任何影响
    reasoning:
      supported: [off, low, medium, xhigh]
      default: xhigh
      mapping:
        off:    { enable_thinking: false }
        low:    { reasoning_effort: low }
        medium: { reasoning_effort: medium }
        xhigh:  { reasoning_effort: xhigh }
```

Web 界面里对应模型编辑框中的「忽略客户端思考设置」复选框。该选项只在按 `alias`
优先级套用档位映射时生效，勾选它等价于对上面 6 个字段做兜底删除。

## 请求覆盖与删除字段

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

最终上游请求体的合并顺序为：客户端请求体 → `request_overrides` → 思考映射
（`alias` 优先级下）→ 强制写入 `model` → 删除字段。

## API Key

Key **绝不** 保存在 `config.yaml` 中。有三种提供方式，按优先级从高到低：

1. **本地密钥文件（推荐，输一次即可）** — 在 Web 界面的服务商编辑框里填入 Key，
   点「保存到本地」。Key 会写入网关目录下的 `secrets.local.json`，重启后自动加载，
   不用每次设置环境变量。该文件已在 `.gitignore` 中忽略，不会提交到 Git；
   在 macOS/Linux 上还会自动设为 `0600` 权限。
2. **本次会话临时 Key** — 同样在界面里填入，点「仅本次会话」。只存在进程内存中，
   重启即失效。
3. **环境变量** — 每个服务商通过 `api_key_env` 指定一个环境变量名：

```powershell
$env:OPENAI_API_KEY="sk-..."          # Windows PowerShell
```
```bash
export OPENAI_API_KEY="sk-..."        # macOS / Linux
```

如果某个 Key 未设置，网关仍能正常启动；只有调用该服务商时会返回清晰错误：

```json
{ "error": { "type": "provider_auth_error",
             "message": "环境变量 OPENAI_API_KEY 未配置。" } }
```

你也可以在 Web 界面里设置一个 **临时 Key**。它只保存在网关进程内存中：不写入配置、
不记日志、不返回浏览器、不写入 localStorage，重启后自动失效。详见上一节。

## Web 管理界面

打开 <http://127.0.0.1:8787/>（或 `/ui`）。界面支持**中英文切换**：右上角按钮切换，
选择会被记住，后端的错误提示也会跟着切换（通过 `Accept-Language` 传递）。默认中文。

包含以下页面：

- **总览** — 运行状态、各项数量、ZCode Base URL（带复制按钮）、最近请求/错误。
- **服务商** — 添加 / 编辑 / 删除 / 复制 / 测试 / 启停；Key 状态
  （`本地已保存` / `环境变量` / `临时 Key` / `缺失`）；在编辑框里填入 Key 后可
  「保存到本地」（重启后仍有效）或「仅本次会话」，也可「清除 Key」。
- **模型** — 添加 / 编辑 / 删除 / 复制 / 测试；可动态增删的思考档位行，每行一个
  JSON 映射编辑器；实时预览虚拟模型 ID。
- **测试台** — 两个模式：
  - **单次测试**：选择一个虚拟模型，以流式或非流式发送；查看经遮蔽处理的请求预览与
    流式输出；可中断正在进行的请求。
  - **档位对比**：见下方[档位对比](#档位对比)。
- **配置** — 表单模式（通过服务商/模型页面）与原始 YAML 模式，支持校验 / 保存 /
  重新加载 / 下载 / 上传 / 重置为示例。
- **日志** — 最近 100 条请求（时间、模型、档位、服务商、上游模型、协议、状态、耗时、
  错误类型）。不记录 Prompt 或工具输出。
- **关于**。

界面会跟随系统亮色/暗色主题，并适配移动端。

## 档位对比

配置好档位之后，你可能想知道`模型@档位`是不是真的生效了。测试台里的
**档位对比**就是干这个的：填入一个问题，勾选要比较的档位（默认全选），点「开始对比」，
网关会为每个档位各发送一次相同的请求（并发上限 4，互不影响，某个档位失败不会中断
其他档位），并把结果并排展示：

- 该档位真正注入到上游请求体的参数（`mapping` 与 `request_overrides`）；
- 思考 token 数、思考字符数、首个思考片段的到达时间、总耗时、输入/输出 token；
- 思考内容与回答原文（各截断到 20000 字符）。

顶部汇总条按长度排序展示各档位差异，并给出一句结论：档位是否产生了可观察的不同效果。
判读依据按可信度排序：

1. **思考 token 数**（最可靠，来自上游 `usage`）；
2. **思考字符数**（上游没有上报 token 时，用思考文本长度代替）；
3. 两者都没有时只能看耗时，无法下结论。

两个已知限制：有些中转不返回思考内容，也不上报 `reasoning_tokens`（部分档位未上报
token 时汇总条会同时标注两者）；Anthropic 协议目前把 `reasoning_tokens` 记为 0。
所以第一次用某个服务商做对比时，建议先确认它是否返回思考摘要——Responses 协议可在
模型配置的 `request_overrides` 里加 `reasoning.summary=auto` 要求上游返回思考过程。

注意：**每个档位都是一次真实调用，可能产生费用**。

## HTTP 接口

面向 ZCode：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET`  | `/v1/models` | 全部已启用的逻辑模型与虚拟模型 ID。 |
| `GET`  | `/v1/models/{id}` | 单个模型。 |
| `POST` | `/v1/responses` | 主入口；支持 `stream: true`。 |
| `POST` | `/v1/chat/completions` | 便捷入口；返回 Responses 结构。 |
| `GET`  | `/healthz` | `{"status":"ok","config":"valid"}`；缺 Key 不会让它失败。 |

管理接口（`/api/admin/*`）：`status`、`meta`、`logs`、`metrics`、`providers`
（GET/POST/PUT/DELETE + duplicate/test/temporary-key）、`models`
（GET/POST/PUT/DELETE + duplicate/test/virtual）、`preview`、`compare`、`config`
（get/validate/save/reload/download/upload/reset-example）。

`POST /api/admin/compare` 是档位对比的后端：请求体
`{"model":"deepseek-flash","levels":["low","max"],"body":{"input":"…"},"stream":false}`，
以 NDJSON 流式返回——先 `{"type":"started",…}`，每个档位完成时输出一行
`{"type":"result",…}`（含 `reasoning_tokens`、`reasoning_chars`、`first_reasoning_ms`、
`elapsed_ms`、`mapping` 等），最后 `{"type":"done","count":N}`。`levels` 省略表示全部
档位，`model` 也接受 `模型@档位` 形式（对比始终跨该模型的所有档位）。

错误类型：`unknown_model`、`unknown_reasoning_level`、`provider_disabled`、
`model_disabled`、`provider_auth_error`、`upstream_timeout`、`upstream_error`、
`config_error`、`adapter_error`、`unsupported_feature`。

上游返回的 HTTP 状态码（400/401/403/404/409/429/5xx）会连同上游响应体和
Content-Type 一并保留。

## 支持的服务商协议

| 协议 | 用途 | 状态 |
|------|------|------|
| `openai_responses` | OpenAI Responses 兼容上游 | 完整支持；流式为原始 SSE 字节透传。 |
| `openai_chat` | OpenAI Chat Completions 上游 | 支持请求/响应转换、流式、工具调用。 |
| `anthropic_messages` | Anthropic Messages 上游 | 支持 system/messages、工具、thinking、流式。 |

Responses→Responses 以稳定性优先。对 Chat/Anthropic 无法无损转换的 Responses 高级
特性（`previous_response_id`、`store`、`include`）会返回 `unsupported_feature`，
而不是悄悄改变语义。

## 安全

- 默认只监听 `127.0.0.1`（绝不默认 `0.0.0.0`）。
- API Key 只来自环境变量（或内存中的临时 Key）。不会写入配置、不会记入日志、
  也不会返回给客户端。
- 原始 YAML 配置写入前先校验，并采用原子替换（临时文件 + `fsync` + 原子替换）。
- 可选管理鉴权：设置 `GATEWAY_ADMIN_TOKEN` 后，所有 `/api/admin/*` 请求都必须携带它
  （`x-admin-token` 请求头或 `Authorization: Bearer …`）。界面仅把 Token 存在
  `sessionStorage` 中。
- 不使用通配 CORS；界面与 API 同源。
- 日志不包含 Prompt、输入、工具输出、请求头或 Key。

## 运行测试

```bash
pip install -r requirements-dev.txt
pytest -q
```

测试全部使用 `httpx.MockTransport` 模拟上游，不会调用任何真实或付费 API。

## 项目结构

```
gateway/
  __main__.py        # python -m gateway 入口
  app.py             # FastAPI 应用、/v1 端点、静态界面
  config.py          # Schema、校验、原子写入、热更新
  models.py          # 模型解析、虚拟模型 ID
  router.py          # 规划、上游 HTTP、流式、错误映射
  merge.py           # deep merge 与安全的嵌套字段删除
  secrets.py         # 本地密钥文件 + 内存临时 Key + 环境变量
  metrics.py         # 内存 metrics 与有界请求日志
  compare.py         # 档位对比：同一问题跑多个档位并采集思考 token/字数/耗时
  errors.py          # 统一错误类型
  paths.py           # 源码/冻结(exe)两种模式下的路径解析
  adapters/          # openai_responses、openai_chat、anthropic_messages
  admin/api.py       # 管理 API
  static/            # index.html、style.css、app.js
tests/               # pytest 测试（全部 Mock 上游）
config.example.yaml  requirements*.txt  README.md
run_gateway.py  zumg.spec  build_exe.bat   # exe 打包（入口 / 配置 / 一键脚本）
start.bat  start.ps1  start.sh           # 可移植启动脚本（不写死路径）
.gitignore  .gitattributes  .env.example
```

`config.yaml` 已被 git 忽略（它保存你的本地服务商配置），首次运行时从
`config.example.yaml` 自动生成。`secrets.local.json`（界面里「保存到本地」写入的
Key）同样被 git 忽略。

### 用于共享 / 上传 GitHub 的说明

- 启动脚本通过 `PATH`（以及常见 conda 安装位置作为兜底）定位 Python，不与任何一台
  机器绑定。请把 Key 放在环境变量或本地 `.env` 中，绝不要写进脚本或配置。
- `.gitattributes` 强制 `start.sh` 使用 LF、Windows 脚本使用 CRLF，因此在
  Linux/macOS 上克隆后 `start.sh` 依然可执行。如果可执行位丢失，用
  `bash start.sh` 或先执行一次 `chmod +x start.sh`。
- 代码注释、docstring 与标识符保留英文以便复用；界面与错误提示支持中英切换（默认中文，
  右上角按钮切换），本文档为中文，英文文档见 `README.en.md`。

## 已知限制

- Anthropic 适配器的 Responses↔Messages 转换属于新实现；无法处理的 Responses 专有
  构造会抛出 `unsupported_feature`，而不是猜测语义。
- 支持 `reasoning_precedence: client`，但经过充分测试的是默认的 `alias` 模式。
- metrics 与日志仅存于内存，重启即清空（属设计预期）。
- `测试连接` 只执行一次轻量的 `GET /models` 探测，不会触发计费的推理请求。
- 配置热更新基于文件 mtime，因此文件改动后会在下一次请求时才生效。
- 档位对比的判读依赖上游返回的数据：不上报 `reasoning_tokens` 且不返回思考内容的上游
  无法据此确认档位是否生效；Anthropic 协议目前把 `reasoning_tokens` 记为 0。
- 启动脚本的提示信息保持 ASCII（避免 Windows 批处理的代码页问题），中文启动横幅由
  Python 打印。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=Loopers180/zcode-universal-model-gateway&type=Date)](https://star-history.com/#Loopers180/zcode-universal-model-gateway&Date)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Loopers180/zcode-universal-model-gateway&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Loopers180/zcode-universal-model-gateway&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Loopers180/zcode-universal-model-gateway&type=Date" />
</picture>

## 许可证

本项目基于 [MIT License](LICENSE) 开源。Copyright © 2026 Linxuan Fang.
