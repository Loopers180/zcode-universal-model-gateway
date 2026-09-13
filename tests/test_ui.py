"""Web UI smoke tests (no browser automation required)."""

from __future__ import annotations


async def test_index_serves_html(build_app, client_factory):
    harness = build_app()
    client = client_factory(harness.app)
    response = await client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    html = response.text
    for label in ("服务商", "模型", "测试台", "配置", "单次测试", "档位对比"):
        assert label in html


async def test_compare_ui_present_in_assets(build_app, client_factory):
    """The comparison view is wired: tab, level list and API call."""
    harness = build_app()
    client = client_factory(harness.app)
    html = (await client.get("/")).text
    for element_id in ("console-tab-compare", "compare-model", "compare-levels", "compare-send"):
        assert 'id="' + element_id + '"' in html
    js = (await client.get("/static/app.js")).text
    assert "/api/admin/compare" in js
    assert "switchConsoleTab" in js


async def test_language_toggle_is_wired(build_app, client_factory):
    """The UI ships a zh/en/ja switch and loads its translation tables."""
    harness = build_app()
    client = client_factory(harness.app)
    html = (await client.get("/")).text
    assert 'id="lang-switch"' in html
    for lang in ("zh", "en", "ja"):
        assert f'data-lang="{lang}"' in html
    assert "/static/i18n.js" in html

    js = (await client.get("/static/app.js")).text
    assert "ZUMG_I18N" in js
    assert "accept-language" in js

    table = (await client.get("/static/i18n.js")).text
    assert "zhToEn" in table
    assert "enToZh" in table
    assert "zhToJa" in table
    assert "jaToZh" in table


async def test_i18n_table_covers_ui_strings(build_app, client_factory):
    """Every Chinese string in the UI must have an English rendering."""
    import json
    import re

    harness = build_app()
    client = client_factory(harness.app)
    table_text = (await client.get("/static/i18n.js")).text
    match = re.search(r"const ZH_TO_EN = (\{.*?\n\});", table_text, re.S)
    assert match, "generated table not found"
    table = json.loads(match.group(1))

    js = (await client.get("/static/app.js")).text
    html = (await client.get("/")).text

    literal_re = re.compile(r"""'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)\"""", re.VERBOSE)
    cjk_re = re.compile(r"[\u4e00-\u9fff]")

    missing = set()
    for source, skip in ((js, {"中文", "切换到中文"}), (html, set())):
        for m in literal_re.finditer(source):
            text = m.group(1) if m.group(1) is not None else m.group(2)
            if cjk_re.search(text) and text not in table and text not in skip:
                missing.add(text)
    assert not missing, f"UI strings without a translation: {sorted(missing)}"


async def test_i18n_ja_table_covers_all_en_keys(build_app, client_factory):
    """The Japanese table must translate every key the English table has."""
    import json
    import re

    harness = build_app()
    client = client_factory(harness.app)
    table_text = (await client.get("/static/i18n.js")).text
    en_match = re.search(r"const ZH_TO_EN = (\{.*?\n\});", table_text, re.S)
    ja_match = re.search(r"const ZH_TO_JA = (\{.*?\n\});", table_text, re.S)
    assert en_match and ja_match, "generated tables not found"
    en_table = json.loads(en_match.group(1))
    ja_table = json.loads(ja_match.group(1))

    assert set(ja_table) == set(en_table), (
        f"ja table keys differ: {set(ja_table) ^ set(en_table)}"
    )
    # No value may be a lazy copy of the English value. (Kanji shared with the
    # Chinese source is fine — words like 保存/停止 are genuine Japanese.)
    copied_en = [k for k, v in ja_table.items() if v == en_table[k]]
    assert not copied_en, f"ja values identical to English: {sorted(copied_en)}"


async def test_ui_alias_serves_html(build_app, client_factory):
    harness = build_app()
    client = client_factory(harness.app)
    assert (await client.get("/ui")).status_code == 200


async def test_static_assets_served(build_app, client_factory):
    harness = build_app()
    client = client_factory(harness.app)
    css = await client.get("/static/style.css")
    assert css.status_code == 200
    assert "text/css" in css.headers["content-type"]
    js = await client.get("/static/app.js")
    assert js.status_code == 200
    assert "javascript" in js.headers["content-type"]


async def test_static_path_traversal_blocked(build_app, client_factory):
    harness = build_app()
    client = client_factory(harness.app)
    response = await client.get("/static/..%2f..%2fapp.py")
    assert response.status_code == 404


async def test_no_cdn_or_external_dependency_in_html(build_app, client_factory):
    harness = build_app()
    client = client_factory(harness.app)
    html = (await client.get("/")).text
    assert "http://" not in html.replace("http://127.0.0.1", "")
    assert "https://" not in html
    assert "cdn" not in html.lower()


async def test_static_assets_are_revalidated(build_app, client_factory):
    """UI updates must take effect without a hard refresh (no stale cache)."""
    harness = build_app()
    client = client_factory(harness.app)
    for path in ("/", "/static/app.js", "/static/style.css"):
        response = await client.get(path)
        assert response.status_code == 200, path
        assert "no-cache" in response.headers.get("cache-control", ""), path


async def test_modal_does_not_close_on_backdrop_click(build_app, client_factory):
    """The dialog must only close on an explicit action, not a stray click.

    Spelled out in source: the backdrop click handler must not call close().
    """
    harness = build_app()
    client = client_factory(harness.app)
    js = (await client.get("/static/app.js")).text
    assert "modal-backdrop" in js
    # No handler may close the dialog from a backdrop/e.target comparison.
    assert "event.target === backdrop" not in js
