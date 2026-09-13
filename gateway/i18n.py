"""Message catalog and request-scoped locale.

Chinese is the default language; English or Japanese is selected per request
via the ``Accept-Language`` header (the Web UI sends the language the user
picked). The startup banner and other pre-request output follow
``GATEWAY_LANG`` (``zh``, ``en`` or ``ja``), defaulting to Chinese.

Messages use ``str.format`` placeholders, e.g. ``tr("model.unknown", model="x")``
against ``"未知模型 {model!r}"``. Keeping messages in one catalog means both
languages stay in sync and a missing key fails loudly in tests rather than
silently returning the wrong language.
"""

from __future__ import annotations

import contextvars
import os

DEFAULT_LOCALE = "zh"
SUPPORTED_LOCALES = ("zh", "en", "ja")

_locale: contextvars.ContextVar[str] = contextvars.ContextVar(
    "zumg_locale", default=DEFAULT_LOCALE
)

_CATALOG: dict[str, dict[str, str]] = {
    "zh": {
        # -- startup ----------------------------------------------------
        "startup.generated_config": "已从 {example} 生成 {target}",
        "banner.admin_ui": "  管理界面  : {url}",
        "banner.zcode_url": "  ZCode 地址: {url}",
        "banner.stop": "  按 Ctrl+C 停止服务。",
        # -- config -----------------------------------------------------
        "config.unsupported_protocol": "不支持的协议 {protocol!r}；支持的协议：{supported}",
        "config.base_url_empty": "base_url 不能为空",
        "config.base_url_scheme": "base_url 必须以 http:// 或 https:// 开头",
        "config.provider_no_path": "服务商未配置 {kind!r} 对应的路径",
        "config.level_name_empty": "思考档位名称不能为空",
        "config.level_name_at": "思考档位名称 {level!r} 不能包含 '@'",
        "config.mapping_not_object": "思考档位 {level!r} 的 mapping 必须是对象",
        "config.default_level_unknown": "默认思考档位 {default!r} 不在支持的档位 {supported} 中",
        "config.mapping_unknown_levels": "reasoning mapping 中含有未在 supported 中列出的档位：{levels}",
        "config.invalid_identifier": "标识符 {key!r} 无效：不能为空，且不能包含 '@'",
        "config.model_unknown_provider": "模型 {model!r} 引用了不存在的服务商 {provider!r}",
        "config.root_not_mapping": "配置文件的根节点必须是映射/对象",
        "config.invalid": "配置无效：{error}",
        "config.yaml_parse_error": "YAML 解析错误：{error}",
        "config.file_not_found": "找不到配置文件：{path}",
        "config.file_unreadable": "无法读取配置文件 {path}：{error}",
        # -- model resolution -------------------------------------------
        "model.none_in_request": "请求中没有提供 model 参数",
        "model.unknown": "未知模型 {model!r}",
        "model.disabled": "模型 {model!r} 已被禁用",
        "model.unknown_provider": "模型 {model!r} 引用了不存在的服务商 {provider!r}",
        "model.no_reasoning": "模型 {model!r} 不支持思考档位",
        "model.level_unsupported": (
            "模型 {model!r} 不支持思考档位 {level!r}；支持的档位：{supported}"
        ),
        "provider.disabled": "服务商 {provider!r} 已被禁用",
        # -- upstream / router ------------------------------------------
        "upstream.timeout": "上游服务商 {provider!r} 请求超时",
        "upstream.request_failed": "上游请求失败：{error}",
        "upstream.invalid_json": "上游返回的响应体不是合法 JSON",
        "upstream.http_error": "上游返回 HTTP {status}",
        # -- app / request body -----------------------------------------
        "app.started": "ZUMG {version} 已启动；配置={config} 服务商={providers} 模型={models}",
        "app.internal_error": "发生了未预期的内部错误",
        "app.bad_json": "请求体必须是合法 JSON：{error}",
        "app.body_not_object": "请求体必须是一个 JSON 对象",
        # -- adapters (shared) ------------------------------------------
        "adapter.unsupported_param": "参数 {field!r} 无法在不改变语义的前提下转换到该服务商协议",
        "adapter.input_not_string_or_array": "'input' 必须是字符串或输入项数组",
        "adapter.item_not_object": "输入项必须是对象",
        "adapter.tool_not_object": "每个 tool 必须是对象",
        "adapter.tool_choice_no_name": "tool_choice 的 function 缺少 name",
        "adapter.invalid_tool_choice": "无效的 tool_choice",
        "adapter.unknown_tool_choice": "未知的 tool_choice {choice!r}",
        "adapter.no_input_messages": "请求中没有任何输入消息",
        "adapter.upstream_not_json_object": "上游返回的响应不是 JSON 对象",
        "adapter.stream_error": "上游流式响应出错",
        "adapter.stream_translate_failed": "流式转换失败：{error}",
        # -- adapters (chat) --------------------------------------------
        "chat.image_no_url": (
            "input_image 缺少 URL（例如仅提供 file_id）时，无法转换到 Chat Completions"
        ),
        "chat.block_type": "内容块类型 {type!r} 无法转换到 Chat Completions",
        "chat.item_type": "输入项类型 {type!r} 无法转换到 Chat Completions",
        "chat.tool_type": "tool 类型 {type!r} 无法转换到 Chat Completions",
        "chat.tool_choice_type": "tool_choice 类型 {type!r} 无法转换到 Chat Completions",
        "chat.text_format_type": "text.format 类型 {type!r} 无法转换到 Chat Completions",
        # -- adapters (anthropic) ---------------------------------------
        "anthropic.image_no_url": "缺少 URL 的图片内容无法转换到 Anthropic Messages",
        "anthropic.data_url_malformed": "图片内容中的 data URL 格式不正确",
        "anthropic.block_type": "内容块类型 {type!r} 无法转换到 Anthropic Messages",
        "anthropic.item_type": "输入项类型 {type!r} / 角色 {role!r} 无法转换到 Anthropic Messages",
        "anthropic.tool_args_not_json": "工具调用参数不是合法 JSON，无法转换到 Anthropic Messages",
        "anthropic.tool_type": "tool 类型 {type!r} 无法转换到 Anthropic Messages",
        "anthropic.tool_choice_type": "tool_choice 类型 {type!r} 无法转换到 Anthropic Messages",
        # -- auth -------------------------------------------------------
        "auth.env_missing": "环境变量 {env} 未配置。",
        "auth.no_key": "服务商 {provider!r} 尚未配置 API Key。",
        # -- admin API --------------------------------------------------
        "admin.token_required": "需要有效的管理 Token，或 Token 不正确",
        "admin.cross_site_denied": "跨站请求被拒绝",
        "provider.id_empty": "服务商 ID 不能为空",
        "provider.id_at": "服务商 ID 不能包含 '@'",
        "provider.exists": "该服务商已存在",
        "provider.not_found": "找不到该服务商",
        "provider.in_use": (
            "该服务商仍被以下模型引用：{models}。请先删除这些模型，或选择连同它们一起删除。"
        ),
        "provider.target_exists": "目标服务商 ID 已存在",
        "provider.invalid_config": "服务商配置无效：{error}",
        "provider.unknown": "未知的服务商 {provider!r}",
        "model.id_empty": "模型 ID 不能为空",
        "model.id_at": "模型 ID 不能包含 '@'",
        "model.exists": "该模型已存在",
        "model.not_found": "找不到该模型",
        "model.target_exists": "目标模型 ID 已存在",
        "model.provider_not_found": "找不到该模型所属的服务商",
        "model.invalid_config": "模型配置无效：{error}",
        "request.model_required": "必须提供 model",
        "request.yaml_required": "必须提供 'yaml' 字段",
        "config.example_not_found": "找不到 config.example.yaml",
        "bundle.bad_format": "不是有效的完整备份文件（缺少 format 标记）",
        "bundle.no_config": "备份文件缺少 config 内容",
        "bundle.bad_keys": "备份文件的 keys 字段格式不正确",
        "bundle.foreign_keys": "备份文件包含配置中不存在的服务商 Key：{providers}",
        # -- comparison -------------------------------------------------
        "compare.no_levels": "模型 {model!r} 没有配置思考档位，无法对比",
        "compare.no_levels_selected": "没有选择任何思考档位",
        "compare.upstream_failed": "上游返回 response.failed",
        # -- misc -------------------------------------------------------
        "common.none": "（无）",
    },
    "en": {
        # -- startup ----------------------------------------------------
        "startup.generated_config": "Generated {target} from {example}",
        "banner.admin_ui": "  Admin UI  : {url}",
        "banner.zcode_url": "  ZCode URL : {url}",
        "banner.stop": "  Press Ctrl+C to stop.",
        # -- config -----------------------------------------------------
        "config.unsupported_protocol": "unsupported protocol {protocol!r}; supported protocols: {supported}",
        "config.base_url_empty": "base_url must not be empty",
        "config.base_url_scheme": "base_url must start with http:// or https://",
        "config.provider_no_path": "provider has no path configured for {kind!r}",
        "config.level_name_empty": "reasoning level names must not be empty",
        "config.level_name_at": "reasoning level name {level!r} must not contain '@'",
        "config.mapping_not_object": "mapping for reasoning level {level!r} must be an object",
        "config.default_level_unknown": (
            "default reasoning level {default!r} is not in the supported levels {supported}"
        ),
        "config.mapping_unknown_levels": (
            "reasoning mapping contains levels not listed in supported: {levels}"
        ),
        "config.invalid_identifier": (
            "invalid identifier {key!r}: must not be empty and must not contain '@'"
        ),
        "config.model_unknown_provider": "model {model!r} references unknown provider {provider!r}",
        "config.root_not_mapping": "the config file root must be a mapping/object",
        "config.invalid": "invalid config: {error}",
        "config.yaml_parse_error": "YAML parse error: {error}",
        "config.file_not_found": "config file not found: {path}",
        "config.file_unreadable": "cannot read config file {path}: {error}",
        # -- model resolution -------------------------------------------
        "model.none_in_request": "no model parameter in request",
        "model.unknown": "unknown model {model!r}",
        "model.disabled": "model {model!r} is disabled",
        "model.unknown_provider": "model {model!r} references unknown provider {provider!r}",
        "model.no_reasoning": "model {model!r} does not support reasoning levels",
        "model.level_unsupported": (
            "model {model!r} does not support reasoning level {level!r}; "
            "supported levels: {supported}"
        ),
        "provider.disabled": "provider {provider!r} is disabled",
        # -- upstream / router ------------------------------------------
        "upstream.timeout": "upstream provider {provider!r} timed out",
        "upstream.request_failed": "upstream request failed: {error}",
        "upstream.invalid_json": "upstream response body is not valid JSON",
        "upstream.http_error": "upstream returned HTTP {status}",
        # -- app / request body -----------------------------------------
        "app.started": "ZUMG {version} started; config={config} providers={providers} models={models}",
        "app.internal_error": "An unexpected internal error occurred",
        "app.bad_json": "request body must be valid JSON: {error}",
        "app.body_not_object": "request body must be a JSON object",
        # -- adapters (shared) ------------------------------------------
        "adapter.unsupported_param": (
            "parameter {field!r} cannot be converted to this provider protocol "
            "without changing semantics"
        ),
        "adapter.input_not_string_or_array": "'input' must be a string or an array of input items",
        "adapter.item_not_object": "each input item must be an object",
        "adapter.tool_not_object": "each tool must be an object",
        "adapter.tool_choice_no_name": "tool_choice function is missing 'name'",
        "adapter.invalid_tool_choice": "invalid tool_choice",
        "adapter.unknown_tool_choice": "unknown tool_choice {choice!r}",
        "adapter.no_input_messages": "request contains no input messages",
        "adapter.upstream_not_json_object": "upstream response is not a JSON object",
        "adapter.stream_error": "upstream streaming response failed",
        "adapter.stream_translate_failed": "stream translation failed: {error}",
        # -- adapters (chat) --------------------------------------------
        "chat.image_no_url": (
            "input_image without a URL (e.g. only a file_id given) cannot be "
            "converted to Chat Completions"
        ),
        "chat.block_type": "content block type {type!r} cannot be converted to Chat Completions",
        "chat.item_type": "input item type {type!r} cannot be converted to Chat Completions",
        "chat.tool_type": "tool type {type!r} cannot be converted to Chat Completions",
        "chat.tool_choice_type": (
            "tool_choice type {type!r} cannot be converted to Chat Completions"
        ),
        "chat.text_format_type": (
            "text.format type {type!r} cannot be converted to Chat Completions"
        ),
        # -- adapters (anthropic) ---------------------------------------
        "anthropic.image_no_url": (
            "image content without a URL cannot be converted to Anthropic Messages"
        ),
        "anthropic.data_url_malformed": "malformed data URL in image content",
        "anthropic.block_type": (
            "content block type {type!r} cannot be converted to Anthropic Messages"
        ),
        "anthropic.item_type": (
            "input item type {type!r} / role {role!r} cannot be converted to Anthropic Messages"
        ),
        "anthropic.tool_args_not_json": (
            "tool call arguments are not valid JSON and cannot be converted to Anthropic Messages"
        ),
        "anthropic.tool_type": "tool type {type!r} cannot be converted to Anthropic Messages",
        "anthropic.tool_choice_type": (
            "tool_choice type {type!r} cannot be converted to Anthropic Messages"
        ),
        # -- auth -------------------------------------------------------
        "auth.env_missing": "environment variable {env} is not set.",
        "auth.no_key": "provider {provider!r} has no API key configured.",
        # -- admin API --------------------------------------------------
        "admin.token_required": "a valid admin token is required, or the token is incorrect",
        "admin.cross_site_denied": "cross-site request denied",
        "provider.id_empty": "provider ID must not be empty",
        "provider.id_at": "provider ID must not contain '@'",
        "provider.exists": "provider already exists",
        "provider.not_found": "provider not found",
        "provider.in_use": (
            "provider is still referenced by these models: {models}. "
            "Delete the models first, or choose to delete them together with the provider."
        ),
        "provider.target_exists": "target provider ID already exists",
        "provider.invalid_config": "invalid provider config: {error}",
        "provider.unknown": "unknown provider {provider!r}",
        "model.id_empty": "model ID must not be empty",
        "model.id_at": "model ID must not contain '@'",
        "model.exists": "model already exists",
        "model.not_found": "model not found",
        "model.target_exists": "target model ID already exists",
        "model.provider_not_found": "provider for this model not found",
        "model.invalid_config": "invalid model config: {error}",
        "request.model_required": "model is required",
        "request.yaml_required": "the 'yaml' field is required",
        "config.example_not_found": "config.example.yaml not found",
        "bundle.bad_format": "Not a valid full backup file (missing format marker)",
        "bundle.no_config": "Backup file is missing config content",
        "bundle.bad_keys": "Backup file has an invalid 'keys' field",
        "bundle.foreign_keys": (
            "Backup file contains keys for providers not in the configuration: {providers}"
        ),
        # -- comparison -------------------------------------------------
        "compare.no_levels": "model {model!r} has no reasoning levels configured, nothing to compare",
        "compare.no_levels_selected": "no reasoning levels selected",
        "compare.upstream_failed": "upstream returned response.failed",
        # -- misc -------------------------------------------------------
        "common.none": "(none)",
    },
    "ja": {
        # -- startup ----------------------------------------------------
        "startup.generated_config": "{example} から {target} を生成しました",
        "banner.admin_ui": "  管理UI  : {url}",
        "banner.zcode_url": "  ZCode URL : {url}",
        "banner.stop": "  Ctrl+C で停止します。",
        # -- config -----------------------------------------------------
        "config.unsupported_protocol": (
            "サポートされていないプロトコル {protocol!r}（サポート対象: {supported}）"
        ),
        "config.base_url_empty": "base_url は空にできません",
        "config.base_url_scheme": "base_url は http:// または https:// で始まる必要があります",
        "config.provider_no_path": "プロバイダーに {kind!r} 用のパスが設定されていません",
        "config.level_name_empty": "思考レベル名は空にできません",
        "config.level_name_at": "思考レベル名 {level!r} に '@' は含められません",
        "config.mapping_not_object": (
            "思考レベル {level!r} の mapping はオブジェクトである必要があります"
        ),
        "config.default_level_unknown": (
            "デフォルトの思考レベル {default!r} はサポート対象のレベル {supported} に含まれていません"
        ),
        "config.mapping_unknown_levels": (
            "reasoning mapping に supported に列挙されていないレベルが含まれています: {levels}"
        ),
        "config.invalid_identifier": (
            "識別子 {key!r} が無効です: 空にできず、'@' も含められません"
        ),
        "config.model_unknown_provider": (
            "モデル {model!r} が存在しないプロバイダー {provider!r} を参照しています"
        ),
        "config.root_not_mapping": "設定ファイルのルートはマッピング/オブジェクトである必要があります",
        "config.invalid": "設定が無効です: {error}",
        "config.yaml_parse_error": "YAML 解析エラー: {error}",
        "config.file_not_found": "設定ファイルが見つかりません: {path}",
        "config.file_unreadable": "設定ファイル {path} を読み込めません: {error}",
        # -- model resolution -------------------------------------------
        "model.none_in_request": "リクエストに model パラメータがありません",
        "model.unknown": "不明なモデル {model!r}",
        "model.disabled": "モデル {model!r} は無効化されています",
        "model.unknown_provider": (
            "モデル {model!r} が存在しないプロバイダー {provider!r} を参照しています"
        ),
        "model.no_reasoning": "モデル {model!r} は思考レベルに対応していません",
        "model.level_unsupported": (
            "モデル {model!r} は思考レベル {level!r} に対応していません; "
            "サポート対象: {supported}"
        ),
        "provider.disabled": "プロバイダー {provider!r} は無効化されています",
        # -- upstream / router ------------------------------------------
        "upstream.timeout": "上流プロバイダー {provider!r} がタイムアウトしました",
        "upstream.request_failed": "上流リクエストが失敗しました: {error}",
        "upstream.invalid_json": "上流のレスポンスボディが有効な JSON ではありません",
        "upstream.http_error": "上流が HTTP {status} を返しました",
        # -- app / request body -----------------------------------------
        "app.started": (
            "ZUMG {version} を起動しました; 設定={config} プロバイダー={providers} モデル={models}"
        ),
        "app.internal_error": "予期しない内部エラーが発生しました",
        "app.bad_json": "リクエストボディは有効な JSON である必要があります: {error}",
        "app.body_not_object": "リクエストボディは JSON オブジェクトである必要があります",
        # -- adapters (shared) ------------------------------------------
        "adapter.unsupported_param": (
            "パラメータ {field!r} は、意味を変えずにこのプロバイダーのプロトコルへ変換できません"
        ),
        "adapter.input_not_string_or_array": "'input' は文字列または入力項目の配列である必要があります",
        "adapter.item_not_object": "各入力項目はオブジェクトである必要があります",
        "adapter.tool_not_object": "各 tool はオブジェクトである必要があります",
        "adapter.tool_choice_no_name": "tool_choice の function に 'name' がありません",
        "adapter.invalid_tool_choice": "無効な tool_choice です",
        "adapter.unknown_tool_choice": "不明な tool_choice {choice!r}",
        "adapter.no_input_messages": "リクエストに入力メッセージがありません",
        "adapter.upstream_not_json_object": "上流のレスポンスが JSON オブジェクトではありません",
        "adapter.stream_error": "上流のストリーミングレスポンスでエラーが発生しました",
        "adapter.stream_translate_failed": "ストリーム変換に失敗しました: {error}",
        # -- adapters (chat) --------------------------------------------
        "chat.image_no_url": (
            "URL のない input_image（file_id のみ指定の場合など）は "
            "Chat Completions へ変換できません"
        ),
        "chat.block_type": (
            "コンテンツブロックタイプ {type!r} は Chat Completions へ変換できません"
        ),
        "chat.item_type": "入力項目タイプ {type!r} は Chat Completions へ変換できません",
        "chat.tool_type": "tool タイプ {type!r} は Chat Completions へ変換できません",
        "chat.tool_choice_type": (
            "tool_choice タイプ {type!r} は Chat Completions へ変換できません"
        ),
        "chat.text_format_type": (
            "text.format タイプ {type!r} は Chat Completions へ変換できません"
        ),
        # -- adapters (anthropic) ---------------------------------------
        "anthropic.image_no_url": (
            "URL のない画像コンテンツは Anthropic Messages へ変換できません"
        ),
        "anthropic.data_url_malformed": "画像コンテンツ内の data URL の形式が不正です",
        "anthropic.block_type": (
            "コンテンツブロックタイプ {type!r} は Anthropic Messages へ変換できません"
        ),
        "anthropic.item_type": (
            "入力項目タイプ {type!r} / ロール {role!r} は Anthropic Messages へ変換できません"
        ),
        "anthropic.tool_args_not_json": (
            "ツール呼び出しの引数が有効な JSON ではないため、Anthropic Messages へ変換できません"
        ),
        "anthropic.tool_type": "tool タイプ {type!r} は Anthropic Messages へ変換できません",
        "anthropic.tool_choice_type": (
            "tool_choice タイプ {type!r} は Anthropic Messages へ変換できません"
        ),
        # -- auth -------------------------------------------------------
        "auth.env_missing": "環境変数 {env} が設定されていません。",
        "auth.no_key": "プロバイダー {provider!r} に API Key が設定されていません。",
        # -- admin API --------------------------------------------------
        "admin.token_required": "有効な管理トークンが必要です、またはトークンが正しくありません",
        "admin.cross_site_denied": "クロスサイトリクエストは拒否されました",
        "provider.id_empty": "プロバイダー ID は空にできません",
        "provider.id_at": "プロバイダー ID に '@' は含められません",
        "provider.exists": "このプロバイダーは既に存在します",
        "provider.not_found": "プロバイダーが見つかりません",
        "provider.in_use": (
            "このプロバイダーは次のモデルから参照されています: {models}。"
            "先にこれらのモデルを削除するか、まとめて削除してください。"
        ),
        "provider.target_exists": "対象のプロバイダー ID は既に存在します",
        "provider.invalid_config": "プロバイダー設定が無効です: {error}",
        "provider.unknown": "不明なプロバイダー {provider!r}",
        "model.id_empty": "モデル ID は空にできません",
        "model.id_at": "モデル ID に '@' は含められません",
        "model.exists": "このモデルは既に存在します",
        "model.not_found": "モデルが見つかりません",
        "model.target_exists": "対象のモデル ID は既に存在します",
        "model.provider_not_found": "このモデルのプロバイダーが見つかりません",
        "model.invalid_config": "モデル設定が無効です: {error}",
        "request.model_required": "model は必須です",
        "request.yaml_required": "'yaml' フィールドは必須です",
        "config.example_not_found": "config.example.yaml が見つかりません",
        "bundle.bad_format": "有効な完全バックアップファイルではありません（format マーカーがありません）",
        "bundle.no_config": "バックアップファイルに config 内容がありません",
        "bundle.bad_keys": "バックアップファイルの 'keys' フィールドの形式が不正です",
        "bundle.foreign_keys": (
            "バックアップファイルに、設定に存在しないプロバイダーの Key が含まれています: {providers}"
        ),
        # -- comparison -------------------------------------------------
        "compare.no_levels": (
            "モデル {model!r} には思考レベルが設定されていないため、比較できません"
        ),
        "compare.no_levels_selected": "思考レベルが選択されていません",
        "compare.upstream_failed": "上流が response.failed を返しました",
        # -- misc -------------------------------------------------------
        "common.none": "（なし）",
    },
}


def normalize_locale(value: str | None) -> str | None:
    """Map a language tag onto a supported locale, or ``None`` if unknown."""
    if not value:
        return None
    tag = value.strip().lower().replace("_", "-")
    if not tag:
        return None
    primary = tag.split("-", 1)[0]
    if primary in SUPPORTED_LOCALES:
        return primary
    return None


def resolve_locale(accept_language: str | None) -> str:
    """Pick a locale for one request from an ``Accept-Language`` header.

    Only the first (highest-priority) entry is considered. A Chinese tag keeps
    Chinese; any other named language falls back to English, which is the more
    widely useful default for non-Chinese speakers. No header (or an empty one)
    keeps the configured default so local/ZCode traffic stays Chinese.
    """
    if accept_language:
        first = accept_language.split(",")[0].strip().split(";")[0].strip()
        locale = normalize_locale(first)
        if locale:
            return locale
        if first:
            return "en"
    return default_locale()


def default_locale() -> str:
    """The locale used outside a request (startup banner, logs)."""
    return normalize_locale(os.environ.get("GATEWAY_LANG")) or DEFAULT_LOCALE


def set_locale(locale: str) -> contextvars.Token:
    """Set the locale for the current context; returns a reset token."""
    return _locale.set(normalize_locale(locale) or DEFAULT_LOCALE)


def reset_locale(token: contextvars.Token) -> None:
    _locale.reset(token)


def get_locale() -> str:
    return _locale.get()


def tr(key: str, /, **params: object) -> str:
    """Render a catalog message in the current locale.

    ``key`` is positional-only so message placeholders may use any name
    (``{key}`` included) without colliding with the function's own argument.
    """
    template = _CATALOG.get(get_locale(), _CATALOG[DEFAULT_LOCALE]).get(key)
    if template is None:
        # Fall back so a missing key cannot break a request, but make the gap
        # obvious in the output (and in tests) instead of hiding it.
        template = _CATALOG[DEFAULT_LOCALE].get(key)
    if template is None:  # pragma: no cover - guarded by tests
        return key
    return template.format(**params)
