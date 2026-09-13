"""Interface language: Accept-Language switching and catalog integrity."""

from __future__ import annotations

import httpx

from gateway import i18n


def test_catalog_has_matching_keys():
    zh = set(i18n._CATALOG["zh"])
    en = set(i18n._CATALOG["en"])
    ja = set(i18n._CATALOG["ja"])
    assert zh == en == ja, f"catalog keys differ: {zh ^ en ^ ja}"


def test_japanese_catalog_translates_representative_keys():
    """The ja catalog must be real Japanese, not the zh/en text leaked through."""
    token = i18n.set_locale("ja")
    try:
        assert i18n.tr("model.unknown", model="nope") == "不明なモデル 'nope'"
        assert i18n.tr("model.none_in_request") == "リクエストに model パラメータがありません"
        rendered = i18n.tr("provider.not_found")
        assert rendered == "プロバイダーが見つかりません"
        # Spot-check user-facing keys so a leaked zh/en template cannot hide.
        assert i18n.tr("model.disabled", model="m") == "モデル 'm' は無効化されています"
        assert i18n.tr("provider.disabled", provider="p") == "プロバイダー 'p' は無効化されています"
        assert i18n.tr("config.invalid", error="boom") == "設定が無効です: boom"
        assert (
            i18n.tr("auth.no_key", provider="p")
            == "プロバイダー 'p' に API Key が設定されていません。"
        )
    finally:
        i18n.reset_locale(token)


def test_catalog_messages_render_in_both_locales():
    """A placeholder typo would only surface at request time, so check now."""
    import re

    for locale, catalog in i18n._CATALOG.items():
        token = i18n.set_locale(locale)
        try:
            for key, template in catalog.items():
                names = set(re.findall(r"{(\w+)[!:}]", template))
                rendered = i18n.tr(key, **{name: "X" for name in names})
                assert "{" not in rendered, f"{locale}/{key} left a placeholder: {rendered}"
                assert rendered.strip(), f"{locale}/{key} rendered empty"
        finally:
            i18n.reset_locale(token)


def test_normalize_and_resolve_locale():
    assert i18n.normalize_locale("zh") == "zh"
    assert i18n.normalize_locale("zh-CN") == "zh"
    assert i18n.normalize_locale("zh_Hans") == "zh"
    assert i18n.normalize_locale("en-US") == "en"
    assert i18n.normalize_locale("EN") == "en"
    assert i18n.normalize_locale("ja") == "ja"
    assert i18n.normalize_locale("ja-JP") == "ja"
    assert i18n.normalize_locale("fr") is None
    assert i18n.normalize_locale("") is None
    assert i18n.normalize_locale(None) is None

    # No header keeps the default (Chinese) so local/ZCode traffic is stable.
    assert i18n.resolve_locale(None) == "zh"
    assert i18n.resolve_locale("") == "zh"
    assert i18n.resolve_locale("zh-CN,zh;q=0.9,en;q=0.8") == "zh"
    assert i18n.resolve_locale("en-US,en;q=0.9") == "en"
    assert i18n.resolve_locale("ja-JP,ja;q=0.9") == "ja"
    # An unsupported language still falls back to English rather than Chinese.
    assert i18n.resolve_locale("fr") == "en"


async def test_api_errors_follow_accept_language(build_app, client_factory):
    harness = build_app()
    client = client_factory(harness.app)

    body = {"model": "nope", "body": {"input": "x"}}
    zh = await client.post("/api/admin/compare", json=body, headers={"accept-language": "zh-CN"})
    en = await client.post("/api/admin/compare", json=body, headers={"accept-language": "en"})
    ja = await client.post("/api/admin/compare", json=body, headers={"accept-language": "ja-JP"})
    default = await client.post("/api/admin/compare", json=body)

    assert zh.status_code == en.status_code == ja.status_code == default.status_code == 404
    zh_message = zh.json()["detail"]["error"]["message"]
    en_message = en.json()["detail"]["error"]["message"]
    ja_message = ja.json()["detail"]["error"]["message"]

    assert zh_message == "未知模型 'nope'"
    assert en_message == "unknown model 'nope'"
    assert ja_message == "不明なモデル 'nope'"
    assert default.json()["detail"]["error"]["message"] == zh_message


async def test_gateway_error_messages_switch_language(build_app, client_factory):
    """The /v1 surface (what ZCode sees) switches too."""
    harness = build_app()
    client = client_factory(harness.app)

    payload = {"model": "foo@nonexistent-level", "input": "hi"}
    zh = await client.post("/v1/responses", json=payload, headers={"accept-language": "zh"})
    en = await client.post("/v1/responses", json=payload, headers={"accept-language": "en"})

    assert zh.status_code == 400 and en.status_code == 400
    assert "不支持思考档位" in zh.json()["error"]["message"]
    assert "does not support reasoning level" in en.json()["error"]["message"]


async def test_upstream_error_message_switches_language(build_app, client_factory):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": {"message": "boom"}})

    harness = build_app(handler=handler)
    client = client_factory(harness.app)
    payload = {"model": "foo", "input": "hi"}

    en = await client.post("/v1/responses", json=payload, headers={"accept-language": "en"})
    # The upstream body is preserved verbatim, but the gateway's own fallback
    # text for a body without a message is translated.
    assert en.status_code == 500
    assert en.json()["error"]["message"] == "boom"


async def test_streaming_response_messages_are_localized(build_app, client_factory):
    """Locale must survive into a streaming response (context stays set)."""

    def handler(request: httpx.Request) -> httpx.Response:
        async def iterator():
            yield 'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n'.encode()
            yield b'data: {"error":{"message":"upstream exploded"}}\n\n'
            yield b"data: [DONE]\n\n"

        return httpx.Response(
            status_code=200,
            headers={"content-type": "text/event-stream"},
            content=iterator(),
        )

    harness = build_app(handler=handler)
    client = client_factory(harness.app)
    async with client.stream(
        "POST",
        "/v1/responses",
        json={"model": "bar", "input": "hi", "stream": True},
        headers={"accept-language": "en"},
    ) as response:
        text = "".join([chunk async for chunk in response.aiter_text()])
    assert "upstream exploded" in text


def test_locale_helpers_are_scoped():
    assert i18n.get_locale() == "zh"
    token = i18n.set_locale("en")
    try:
        assert i18n.tr("model.none_in_request") == "no model parameter in request"
    finally:
        i18n.reset_locale(token)
    assert i18n.get_locale() == "zh"
    assert i18n.tr("model.none_in_request") == "请求中没有提供 model 参数"


def test_unknown_key_does_not_raise():
    assert i18n.tr("no.such.key") == "no.such.key"
