/* ZCode Universal Model Gateway - admin UI
 * Plain JavaScript, no build step, no external dependencies.
 * All dynamic content is inserted through DOM nodes / textContent to avoid XSS.
 * NOTE: code identifiers and comments stay English for reuse; user-facing
 * strings are written in Chinese and translated at runtime by the i18n layer
 * below (see /static/i18n.js).
 */
'use strict';

(function () {
  // ------------------------------------------------------------------ i18n
  //
  // Chinese is the source language: every user-facing string in this file is
  // written in Chinese, and `t()` maps it to the active language at render
  // time. English comes from a lookup table generated from the English
  // edition; unknown strings (model names, provider ids, upstream output,
  // user input) pass through untouched.
  //
  // Switching re-renders the current view instead of patching the DOM, so
  // every dynamic label is translated without tracking each node.
  const LANG_KEY = 'zumg_lang';

  const i18n = {
    // First visit follows the browser language (zh/ja detected, anything
    // else falls back to English); an explicit pick via the switcher is
    // remembered and always wins over the detection.
    lang: (function () {
      const stored = localStorage.getItem(LANG_KEY);
      if (stored === 'zh' || stored === 'en' || stored === 'ja') return stored;
      const nav = (navigator.language || '').toLowerCase();
      if (nav.startsWith('zh')) return 'zh';
      if (nav.startsWith('ja')) return 'ja';
      return 'en';
    })(),
    // Longest-first, so a more specific key wins over a shorter one that
    // happens to share a prefix.
    prefixes: {},
  };

  function tableFor(lang) {
    if (!window.ZUMG_I18N) return {};
    if (lang === 'en') return window.ZUMG_I18N.zhToEn || {};
    if (lang === 'ja') return window.ZUMG_I18N.zhToJa || {};
    return {};
  }

  (function initPrefixes() {
    ['en', 'ja'].forEach((lang) => {
      i18n.prefixes[lang] = Object.keys(tableFor(lang))
        .sort((a, b) => b.length - a.length);
    });
  })();

  function t(text) {
    if (i18n.lang === 'zh' || typeof text !== 'string' || !text) return text;
    const table = tableFor(i18n.lang);
    if (Object.prototype.hasOwnProperty.call(table, text)) return table[text];
    // Messages are often built by concatenation ('复制失败：' + detail), so
    // fall back to translating the longest known prefix. Dynamic values are
    // rarely Chinese, which keeps accidental rewrites unlikely; a miss simply
    // leaves the text as-is.
    for (const key of i18n.prefixes[i18n.lang] || []) {
      if (text.length > key.length && text.startsWith(key)) {
        return table[key] + text.slice(key.length);
      }
    }
    return text;
  }

  function translateTo(text, lang) {
    if (lang === 'zh' || typeof text !== 'string' || !text) return text;
    const table = tableFor(lang);
    return Object.prototype.hasOwnProperty.call(table, text) ? table[text] : text;
  }

  function setLang(lang) {
    if (lang !== 'zh' && lang !== 'en' && lang !== 'ja') return;
    if (lang === i18n.lang) return;
    i18n.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* private mode */ }
    renderStaticText();
    updateLangToggle();
    // Re-render the active view so its dynamic strings pick up the language.
    const active = document.querySelector('#sidebar a.active');
    if (active) showView(active.dataset.view);
  }

  const HTML_LANG = { zh: 'zh-CN', en: 'en', ja: 'ja' };

  function updateLangToggle() {
    document.querySelectorAll('#lang-switch .lang-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.lang === i18n.lang);
    });
    document.documentElement.lang = HTML_LANG[i18n.lang] || 'zh-CN';
  }

  // -- static markup translation ------------------------------------------
  //
  // index.html is written in Chinese. Rather than tagging every node, the
  // original text of each translatable node is recorded once at startup and
  // re-rendered on every language switch, which keeps both directions exact.
  const staticTextNodes = [];   // {node, source}
  const staticAttrNodes = [];   // {node, attr, source}

  const CJK_RE = /[\u4e00-\u9fff]/;

  function collectStaticText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeValue && CJK_RE.test(node.nodeValue)) {
        staticTextNodes.push({ node: node, source: node.nodeValue });
      }
    }
    root.querySelectorAll('[placeholder], [title], [aria-label]').forEach((el) => {
      ['placeholder', 'title', 'aria-label'].forEach((attr) => {
        const value = el.getAttribute(attr);
        if (value && CJK_RE.test(value)) {
          staticAttrNodes.push({ node: el, attr: attr, source: value });
        }
      });
    });
  }

  function renderStaticText() {
    // Swap only the text around the original whitespace, so indentation in
    // the markup is preserved.
    staticTextNodes.forEach((entry) => {
      const original = entry.source;
      const lead = original.match(/^\s*/)[0];
      const trail = original.match(/\s*$/)[0];
      const core = original.slice(lead.length, original.length - trail.length);
      entry.node.nodeValue = lead + translateTo(core, i18n.lang) + trail;
    });
    staticAttrNodes.forEach((entry) => {
      entry.node.setAttribute(entry.attr, translateTo(entry.source, i18n.lang));
    });
  }

  // ---------------------------------------------------------------- state
  const state = {
    token: sessionStorage.getItem('zumg_token') || '',
    providers: [],
    models: [],
    status: null,
    meta: null,
    controller: null,
    streaming: false,
  };

  // ---------------------------------------------------------------- utils
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = t(value);
        else if (key === 'value') node.value = value;
        else if (key === 'checked') node.checked = true;
        else if (key === 'disabled') node.disabled = true;
        else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'dataset') {
          for (const dk of Object.keys(value)) node.dataset[dk] = value[dk];
        } else if (key === 'placeholder' || key === 'title' || key === 'aria-label') {
          node.setAttribute(key, t(value));
        } else node.setAttribute(key, value);
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(t(String(child))));
    }
    return node;
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function badge(text, kind) {
    return el('span', { class: 'badge ' + (kind || 'muted'), text: text });
  }

  function notify(message, kind) {
    const box = el('div', { class: 'toast ' + (kind || ''), text: message });
    $('#toast').append(box);
    setTimeout(() => box.remove(), 4200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify('已复制', 'ok');
    } catch (err) {
      notify('复制失败：' + err.message, 'err');
    }
  }

  function fmtTime(value) {
    if (!value) return '—';
    const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function extractError(data) {
    if (!data) return null;
    const detail = data.detail !== undefined ? data.detail : data;
    if (typeof detail === 'string') return detail;
    if (detail && detail.error && detail.error.message) return detail.error.message;
    if (detail && detail.message) return detail.message;
    try {
      return JSON.stringify(detail);
    } catch (e) {
      return String(detail);
    }
  }

  // ------------------------------------------------------------------ API
  function askToken() {
    const value = window.prompt(
      '该网关已启用管理 Token。请输入 GATEWAY_ADMIN_TOKEN：'
    );
    if (value) {
      state.token = value;
      sessionStorage.setItem('zumg_token', value);
    }
  }

  async function api(path, options) {
    options = options || {};
    const headers = { accept: 'application/json', 'accept-language': i18n.lang };
    if (state.token) headers['x-admin-token'] = state.token;
    let payload;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(options.body);
    }
    const response = await fetch(path, { method: options.method || 'GET', headers: headers, body: payload });
    if (response.status === 401) {
      askToken();
      throw new Error('需要有效的管理 Token。');
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { detail: text };
      }
    }
    if (!response.ok) throw new Error(extractError(data) || 'HTTP ' + response.status);
    return data;
  }

  // ------------------------------------------------------------- navigation
  const loaders = {
    dashboard: loadStatus,
    providers: loadProviders,
    models: loadModels,
    console: loadConsoleOptions,
    configuration: loadConfig,
    logs: loadLogs,
    about: loadAbout,
  };

  function showView(name) {
    document.querySelectorAll('#sidebar a').forEach((a) => {
      a.classList.toggle('active', a.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('active', v.id === 'view-' + name);
    });
    $('#sidebar').classList.remove('open');
    const loader = loaders[name];
    if (loader) loader().catch((err) => notify(err.message, 'err'));
  }

  function initNav() {
    document.querySelectorAll('#sidebar a').forEach((a) => {
      a.addEventListener('click', () => showView(a.dataset.view));
    });
    $('#nav-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  }

  // ------------------------------------------------------------- dashboard
  async function loadStatus() {
    const data = await api('/api/admin/status');
    state.status = data;
    renderDashboard(data);
  }

  function statCard(label, value, small) {
    return el('div', { class: 'card' }, [
      el('div', { class: 'label', text: label }),
      el('div', { class: 'value' + (small ? ' small' : ''), text: String(value) }),
    ]);
  }

  function renderDashboard(data) {
    const baseUrl = (state.meta && state.meta.default_base_url) || 'http://127.0.0.1:8787/v1';
    $('#zcode-base-url').value = baseUrl;
    const cards = $('#dash-cards');
    clear(cards);
    cards.append(
      statCard('网关状态', '正常', true),
      statCard('网关版本', data.version, true),
      statCard('监听地址', '127.0.0.1', true),
      statCard('配置状态', data.config_valid ? '有效' : '无效', true),
      statCard('服务商数量', data.providers),
      statCard('模型数量', data.models),
      statCard('虚拟模型数量', data.virtual_models),
      statCard('已配置 Key 的服务商', data.providers_with_keys)
    );

    const statusBadge = $('#config-status');
    statusBadge.textContent = t(data.config_valid ? '配置：正常' : '配置：无效');
    statusBadge.className = 'badge ' + (data.config_valid ? 'ok' : 'err');

    renderRecent($('#dash-recent'), data.recent_requests, false);
    renderRecent($('#dash-errors'), data.recent_errors, true);
  }

  function renderRecent(container, items, showError) {
    clear(container);
    if (!items || !items.length) {
      container.append(el('p', { class: 'muted', text: '暂无记录。' }));
      return;
    }
    const table = el('table', null, [
      el('thead', null, el('tr', null, [
        el('th', { text: '时间' }),
        el('th', { text: '模型' }),
        el('th', { text: '档位' }),
        el('th', { text: showError ? '错误' : '状态' }),
        el('th', { text: '耗时' }),
      ])),
      el('tbody', null, items.map((item) =>
        el('tr', null, [
          el('td', { text: fmtTime(item.time_iso || item.time) }),
          el('td', { class: 'mono', text: item.logical_model || '—' }),
          el('td', { text: item.reasoning_level || '—' }),
          el('td', null, showError
            ? el('span', { class: 'badge err', text: item.error_type || '错误' })
            : badge(String(item.status || '—'), item.ok ? 'ok' : 'err')),
          el('td', { text: item.latency_ms != null ? item.latency_ms + ' ms' : '—' }),
        ])
      )),
    ]);
    container.append(el('div', { class: 'table-wrap' }, table));
  }

  // ------------------------------------------------------------- providers
  async function loadProviders() {
    const data = await api('/api/admin/providers');
    state.providers = data.providers || [];
    renderProviders();
  }

  function keyBadge(provider) {
    const ks = provider.key_status || {};
    if (ks.source === 'local') return badge('本地已保存', 'ok');
    if (ks.source === 'temporary') return badge('临时 Key', 'warn');
    if (ks.source === 'environment') return badge('环境变量', 'ok');
    return badge('缺失', 'err');
  }

  function renderProviders() {
    const container = $('#providers-table');
    clear(container);
    if (!state.providers.length) {
      container.append(el('p', { class: 'muted', text: '尚未配置任何服务商。' }));
      return;
    }
    const rows = state.providers.map((p) =>
      el('tr', null, [
        el('td', null, [
          el('div', { text: p.display_name || p.id }),
          el('div', { class: 'mono muted', text: p.id }),
        ]),
        el('td', null, badge(p.protocol, 'accent')),
        el('td', { class: 'mono', text: p.base_url }),
        el('td', { class: 'mono', text: p.api_key_env || '—' }),
        el('td', null, keyBadge(p)),
        el('td', null, p.enabled ? badge('已启用', 'ok') : badge('已禁用', 'muted')),
        el('td', null, el('div', { class: 'row-actions' }, [
          actionBtn('编辑', () => openProviderForm(p)),
          actionBtn('测试', () => testProvider(p)),
          actionBtn('复制一份', () => duplicateProvider(p)),
          actionBtn(p.enabled ? '禁用' : '启用', () => toggleProvider(p, !p.enabled)),
          actionBtn('删除', () => deleteProvider(p), 'danger'),
        ])),
      ])
    );
    container.append(el('div', { class: 'table-wrap' }, el('table', null, [
      el('thead', null, el('tr', null, [
        el('th', { text: '服务商' }), el('th', { text: '协议' }),
        el('th', { text: 'Base URL' }), el('th', { text: 'Key 环境变量' }),
        el('th', { text: 'Key 状态' }), el('th', { text: '启用' }),
        el('th', { text: '操作' }),
      ])),
      el('tbody', null, rows),
    ])));
  }

  function actionBtn(label, onClick, kind) {
    return el('button', {
      class: 'btn sm' + (kind === 'danger' ? ' danger' : ''),
      type: 'button', text: label, onClick: onClick,
    });
  }

  function jsonTextarea(value) {
    return el('textarea', { spellcheck: 'false', text: value ? JSON.stringify(value, null, 2) : '' });
  }

  function parseJsonField(textarea, label, fallback) {
    const raw = textarea.value.trim();
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(label + ' 不是合法的 JSON：' + err.message);
    }
  }

  function openProviderForm(existing) {
    const isEdit = !!existing;
    const p = existing || { protocol: 'openai_responses', enabled: true, timeout: 600 };
    const idInput = el('input', { type: 'text', value: p.id || '', disabled: isEdit, placeholder: 'my_provider' });
    const nameInput = el('input', { type: 'text', value: p.display_name || '', placeholder: '我的服务商' });
    const protocolSelect = el('select', null, ['openai_responses', 'openai_chat', 'anthropic_messages'].map((proto) =>
      el('option', { value: proto, text: proto, selected: (p.protocol || 'openai_responses') === proto })
    ));
    const baseInput = el('input', { type: 'text', value: p.base_url || '', placeholder: 'https://api.example.com/v1' });
    const keyEnvInput = el('input', { type: 'text', value: p.api_key_env || '', placeholder: 'MY_PROVIDER_API_KEY' });
    const timeoutInput = el('input', { type: 'number', value: p.timeout || 600 });
    const headersInput = jsonTextarea(p.headers || {});
    const headersEnvInput = jsonTextarea(p.headers_from_env || {});
    const enabledInput = el('input', { type: 'checkbox', checked: p.enabled !== false });
    const tempKeyInput = el('input', { type: 'password', placeholder: 'sk-…（仅存内存）' });

    const body = el('div', null, [
      field('服务商 ID', idInput, '供模型引用的稳定标识，不能包含“@”。'),
      field('显示名称', nameInput, '在界面中显示的名称。'),
      field('协议', protocolSelect, '网关与该上游通信所用的协议。'),
      field('Base URL', baseInput, '例如：https://api.openai.com/v1'),
      field('API Key 环境变量名', keyEnvInput, '可选。填写后网关也会从这个环境变量读取 Key；若已在下方保存本地 Key，则本地 Key 优先。'),
      field('超时时间（秒）', timeoutInput, '单次上游请求的超时时间。'),
      el('div', { class: 'grid-2' }, [
        field('自定义请求头（JSON）', headersInput, '每次请求都会带上的固定请求头。'),
        field('来自环境变量的请求头（JSON）', headersEnvInput, '格式为 { "请求头名称": "环境变量名" }。'),
      ]),
      field('启用', el('label', { class: 'check' }, [enabledInput, '该服务商处于启用状态'])),
    ]);
    if (isEdit) {
      const keyStatusBadge = el('span', { class: 'badge muted' });
      const keyStatusRow = el('p', { class: 'sub' }, ['当前状态：', keyStatusBadge]);

      // Reflect the key state in the dialog without closing it.
      function renderKeyStatus(ks) {
        ks = ks || {};
        let statusText;
        if (ks.source === 'local') statusText = '已保存到本地密钥文件 · 重启后仍然有效';
        else if (ks.source === 'temporary') statusText = '本次会话临时 Key 生效中 · 重启后失效';
        else if (ks.source === 'environment') statusText = '来自环境变量 · 无需在此设置';
        else statusText = '尚未设置 Key';
        keyStatusBadge.textContent = statusText;
        keyStatusBadge.className = 'badge ' + (ks.available ? 'ok' : 'err');
      }
      renderKeyStatus(p.key_status);

      async function applyKey(persist) {
        const result = await api('/api/admin/providers/' + encodeURIComponent(p.id) + '/key',
          { method: 'PUT', body: { api_key: tempKeyInput.value, persist: persist } });
        tempKeyInput.value = '';
        renderKeyStatus(result.key_status);
        notify(persist ? 'Key 已保存到本地，重启后仍然有效' : '已设置临时 Key（重启后失效）', 'ok');
        loadProviders();
      }

      body.append(el('div', { class: 'panel', style: 'margin-bottom:0' }, [
        el('h2', { text: 'API Key' }),
        el('p', { class: 'sub', text: '在这里填入 Key 并选择保存方式，就不用每次设置环境变量了。Key 会写入网关目录下的 secrets.local.json（已在 .gitignore 中忽略，不会提交到 Git），不会写进 config.yaml，也不会记入日志或返回浏览器。' }),
        keyStatusRow,
        el('div', { class: 'inline' }, [tempKeyInput, el('button', {
          class: 'btn primary', type: 'button', text: '保存到本地', onClick: async () => {
            try { await applyKey(true); } catch (err) { notify(err.message, 'err'); }
          },
        }), el('button', {
          class: 'btn', type: 'button', text: '仅本次会话', onClick: async () => {
            try { await applyKey(false); } catch (err) { notify(err.message, 'err'); }
          },
        }), el('button', {
          class: 'btn danger', type: 'button', text: '清除 Key', onClick: async () => {
            if (!window.confirm('确定清除该服务商已保存的 Key 吗？')) return;
            try {
              const result = await api('/api/admin/providers/' + encodeURIComponent(p.id) + '/key', { method: 'DELETE' });
              renderKeyStatus(result.key_status);
              notify('已清除', 'ok');
              loadProviders();
            } catch (err) { notify(err.message, 'err'); }
          },
        })]),
      ]));
    }

    const modal = openModal({
      title: isEdit ? '编辑服务商' : '添加服务商',
      wide: true,
      body: body,
      footer: [
        el('button', { class: 'btn', type: 'button', text: '取消', onClick: () => modal.close() }),
        el('button', {
          class: 'btn primary', type: 'button', text: '保存', onClick: async () => {
            try {
              const payload = {
                display_name: nameInput.value.trim(),
                protocol: protocolSelect.value,
                base_url: baseInput.value.trim(),
                api_key_env: keyEnvInput.value.trim() || null,
                timeout: Number(timeoutInput.value) || 600,
                headers: parseJsonField(headersInput, '自定义请求头', {}),
                headers_from_env: parseJsonField(headersEnvInput, '来自环境变量的请求头', {}),
                enabled: enabledInput.checked,
              };
              if (!baseInput.value.trim()) throw new Error('Base URL 不能为空。');
              if (isEdit) {
                await api('/api/admin/providers/' + encodeURIComponent(p.id), { method: 'PUT', body: payload });
              } else {
                payload.id = idInput.value.trim();
                if (!payload.id) throw new Error('服务商 ID 不能为空。');
                await api('/api/admin/providers', { method: 'POST', body: payload });
              }
              modal.close();
              notify('已保存', 'ok');
              loadProviders();
            } catch (err) { notify(err.message, 'err'); }
          },
        }),
      ],
    });
  }

  function field(label, input, hint) {
    return el('div', { class: 'field' }, [
      el('label', { text: label }), input,
      hint ? el('div', { class: 'hint', text: hint }) : null,
    ]);
  }

  async function testProvider(provider) {
    notify('正在测试 ' + provider.id + '…');
    try {
      const result = await api('/api/admin/providers/' + encodeURIComponent(provider.id) + '/test', { method: 'POST' });
      if (result.ok) {
        notify(t('成功 — HTTP ') + result.status + t('，用时 ') + result.latency_ms + ' ms' +
          (result.model_count != null ? t('（') + result.model_count + t(' 个模型）') : ''), 'ok');
      } else {
        notify('失败 — ' + (result.error || ('HTTP ' + result.status)), 'err');
      }
    } catch (err) { notify(err.message, 'err'); }
  }

  async function toggleProvider(provider, enabled) {
    try {
      await api('/api/admin/providers/' + encodeURIComponent(provider.id), { method: 'PUT', body: { enabled: enabled } });
      notify('已保存', 'ok');
      loadProviders();
    } catch (err) { notify(err.message, 'err'); }
  }

  async function duplicateProvider(provider) {
    const newId = window.prompt('新的服务商 ID：', provider.id + '-copy');
    if (!newId) return;
    try {
      await api('/api/admin/providers/' + encodeURIComponent(provider.id) + '/duplicate', { method: 'POST', body: { id: newId } });
      notify('已保存', 'ok');
      loadProviders();
    } catch (err) { notify(err.message, 'err'); }
  }

  async function deleteProvider(provider) {
    // Find models that reference this provider so we can offer cascade delete.
    let usedBy = [];
    try {
      const data = await api('/api/admin/models');
      usedBy = (data.models || []).filter((m) => m.provider === provider.id).map((m) => m.id);
    } catch (err) { /* fall through to the plain delete below */ }

    let cascade = false;
    if (usedBy.length) {
      cascade = window.confirm(
        t('服务商“') + provider.id + t('”被以下模型引用：') + usedBy.join(t('、')) +
        t('。\n\n点击“确定”将连同这些模型一起删除；点击“取消”则不删除任何内容。')
      );
      if (!cascade) return;
    } else if (!window.confirm(t('确定删除服务商“') + provider.id + t('”吗？此操作不可撤销。'))) {
      return;
    }

    try {
      const path = '/api/admin/providers/' + encodeURIComponent(provider.id) +
        (cascade ? '?cascade=true' : '');
      const result = await api(path, { method: 'DELETE' });
      const removed = (result && result.deleted_models) || [];
      notify(removed.length ? t('已删除服务商及 ') + removed.length + t(' 个模型') : t('已删除'), 'ok');
      loadProviders();
    } catch (err) { notify(err.message, 'err'); }
  }

  // ---------------------------------------------------------------- models
  async function loadModels() {
    // Load providers too: the model form needs them for its dropdown, and the
    // "add model" guard must not misfire when the providers page was never
    // visited in this session.
    const [data, providers] = await Promise.all([
      api('/api/admin/models'),
      api('/api/admin/providers'),
    ]);
    state.models = data.models || [];
    state.providers = providers.providers || [];
    renderModels();
  }

  // Ensure providers are known; used before opening the model form.
  async function ensureProviders() {
    if (state.providers.length) return state.providers;
    const data = await api('/api/admin/providers');
    state.providers = data.providers || [];
    return state.providers;
  }

  function renderModels() {
    const container = $('#models-table');
    clear(container);
    if (!state.models.length) {
      container.append(el('p', { class: 'muted', text: '尚未配置任何模型。' }));
      return;
    }
    const rows = state.models.map((m) => {
      const reasoning = m.reasoning || {};
      return el('tr', null, [
        el('td', null, [
          el('div', { text: m.display_name || m.id }),
          el('div', { class: 'mono muted', text: m.id }),
        ]),
        el('td', null, badge(m.provider, 'accent')),
        el('td', { class: 'mono', text: m.upstream_model }),
        el('td', null, reasoning.default ? badge('默认：' + reasoning.default, 'muted') : el('span', { class: 'muted', text: '—' })),
        el('td', null, (reasoning.supported && reasoning.supported.length)
          ? el('div', { class: 'virtual-list' }, reasoning.supported.map((lvl) => el('span', { class: 'chip', text: lvl })))
          : el('span', { class: 'muted', text: '无' })),
        el('td', null, m.enabled ? badge('已启用', 'ok') : badge('已禁用', 'muted')),
        el('td', null, el('div', { class: 'virtual-list' }, (m.virtual_models || []).map((v) =>
          el('span', { class: 'chip' }, [v, el('button', { type: 'button', text: '复制', onClick: () => copyText(v) })])))),
        el('td', null, el('div', { class: 'row-actions' }, [
          actionBtn('编辑', () => openModelForm(m)),
          actionBtn('测试', () => testModel(m)),
          actionBtn('复制一份', () => duplicateModel(m)),
          actionBtn(m.enabled ? '禁用' : '启用', () => toggleModel(m, !m.enabled)),
          actionBtn('删除', () => deleteModel(m), 'danger'),
        ])),
      ]);
    });
    container.append(el('div', { class: 'table-wrap' }, el('table', null, [
      el('thead', null, el('tr', null, [
        el('th', { text: '模型' }), el('th', { text: '服务商' }),
        el('th', { text: '上游模型' }), el('th', { text: '默认档位' }),
        el('th', { text: '支持的档位' }), el('th', { text: '启用' }),
        el('th', { text: '虚拟模型' }), el('th', { text: '操作' }),
      ])),
      el('tbody', null, rows),
    ])));
  }

  // A reasoning level is stored as a JSON mapping object. The UI lets the user
  // pick a well-known destination field plus a strength value, and builds that
  // object; an "advanced" preset keeps raw JSON editing for anything unusual.
  const REASONING_FIELDS = [
    {
      id: 'reasoning.effort',
      label: 'reasoning.effort',
      hint: 'OpenAI Responses 风格',
      valueHint: '例如 high',
      build: (v) => ({ reasoning: { effort: v } }),
    },
    {
      id: 'reasoning_effort',
      label: 'reasoning_effort',
      hint: '扁平字段（部分中转服务）',
      valueHint: '例如 high',
      build: (v) => ({ reasoning_effort: v }),
    },
    {
      id: 'thinking.budget_tokens',
      label: 'thinking.budget_tokens',
      hint: 'Anthropic 思考预算（数字）',
      valueHint: '例如 16000',
      build: (v) => ({ thinking: { type: 'enabled', budget_tokens: v } }),
    },
    {
      id: 'thinking.type',
      label: 'thinking.type',
      hint: 'Anthropic 思考开关',
      valueHint: 'enabled 或 disabled',
      build: (v) => ({ thinking: { type: v } }),
    },
    {
      id: 'enable_thinking',
      label: 'enable_thinking',
      hint: 'Qwen / 通义思考开关（false 关闭思考）',
      valueHint: 'true 或 false',
      build: (v) => ({ enable_thinking: coerceBool(v) }),
    },
    {
      id: 'custom',
      label: '自定义 JSON（高级）',
      hint: '直接写入任意映射对象',
      valueHint: '',
      build: null,
    },
  ];

  function reasoningField(id) {
    return REASONING_FIELDS.find((f) => f.id === id);
  }

  function toNumberIfNumeric(value) {
    const text = String(value).trim();
    if (text === '') return value;
    const n = Number(text);
    return Number.isFinite(n) && String(n) === text ? n : value;
  }

  // Turn a typed value into a real boolean for fields that expect one.
  function coerceBool(value) {
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(text)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(text)) return false;
    return value;
  }

  // Reverse the preset builders so an existing config opens in simple mode.
  function parseReasoningMapping(mapping) {
    const m = mapping || {};
    const keys = Object.keys(m);

    if (keys.length === 1) {
      const key = keys[0];
      const inner = m[key];
      if (key === 'reasoning_effort' && typeof inner !== 'object') {
        return { field: 'reasoning_effort', value: String(inner) };
      }
      if (key === 'enable_thinking' && typeof inner !== 'object') {
        return { field: 'enable_thinking', value: String(inner) };
      }
      if (key === 'reasoning' && inner && typeof inner === 'object' && Object.keys(inner).length === 1 && 'effort' in inner) {
        return { field: 'reasoning.effort', value: String(inner.effort) };
      }
      if (key === 'thinking' && inner && typeof inner === 'object') {
        const tk = Object.keys(inner).sort();
        if (tk.length === 2 && tk[0] === 'budget_tokens' && tk[1] === 'type' && inner.type === 'enabled') {
          return { field: 'thinking.budget_tokens', value: String(inner.budget_tokens) };
        }
        if (tk.length === 1 && tk[0] === 'type') {
          return { field: 'thinking.type', value: String(inner.type) };
        }
      }
    }
    if (keys.length === 0) {
      return { field: 'reasoning.effort', value: '' };
    }
    return { field: 'custom', json: JSON.stringify(m, null, 2) };
  }

  function openModelForm(existing) {
    const isEdit = !!existing;
    const m = existing || { enabled: true, reasoning: { supported: [], mapping: {} } };
    const idInput = el('input', { type: 'text', value: m.id || '', disabled: isEdit, placeholder: 'my-model' });
    const nameInput = el('input', { type: 'text', value: m.display_name || '', placeholder: '我的模型' });
    const providerSelect = el('select', null, state.providers.map((p) =>
      el('option', { value: p.id, text: p.display_name + ' (' + p.id + ')', selected: m.provider === p.id })
    ));
    const upstreamInput = el('input', { type: 'text', value: m.upstream_model || '', placeholder: '实际的上游模型 ID' });
    const enabledInput = el('input', { type: 'checkbox', checked: m.enabled !== false });
    const ignoreClientReasoningInput = el('input', { type: 'checkbox', checked: m.ignore_client_reasoning === true });
    const overridesInput = jsonTextarea(m.request_overrides || {});
    const removeInput = el('textarea', { spellcheck: 'false', text: (m.remove_fields || []).join('\n') });

    const levelsWrap = el('div');
    const previewWrap = el('div', { class: 'virtual-list' });
    const reasoning = m.reasoning || {};
    const levels = (reasoning.supported || []).map((lvl) => {
      const parsed = parseReasoningMapping((reasoning.mapping || {})[lvl]);
      return {
        level: lvl,
        isDefault: reasoning.default === lvl,
        field: parsed.field,
        value: parsed.value || '',
        json: parsed.json || '{}',
      };
    });

    function refreshPreview() {
      clear(previewWrap);
      const base = idInput.value.trim() || '<模型>';
      const virtual = [base].concat(levels.map((l) => l.level ? base + '@' + l.level : ''));
      virtual.filter(Boolean).forEach((v) => previewWrap.append(
        el('span', { class: 'chip' }, [v, el('button', { type: 'button', text: '复制', onClick: () => copyText(v) })])));
    }

    function levelRow(entry) {
      const nameInput = el('input', { type: 'text', value: entry.level, placeholder: 'high' });
      const defaultInput = el('input', { type: 'radio', name: 'default-level', checked: entry.isDefault });
      const fieldSelect = el('select', null, REASONING_FIELDS.map((f) =>
        el('option', { value: f.id, text: f.label, selected: entry.field === f.id })));
      const valueInput = el('input', {
        type: 'text', value: entry.value || '',
        placeholder: (reasoningField(entry.field) || {}).valueHint || '',
      });
      const jsonInput = el('textarea', { spellcheck: 'false', style: 'min-height:70px', text: entry.json || '{}' });
      const jsonWrap = el('div', { class: 'level-json' }, [
        el('div', { class: 'hint', text: '自定义映射 JSON，会直接 deep merge 进上游请求体。' }),
        jsonInput,
      ]);
      const fieldHint = el('div', { class: 'hint' });

      function syncFields() {
        const preset = reasoningField(fieldSelect.value) || {};
        const isCustom = fieldSelect.value === 'custom';
        valueInput.style.display = isCustom ? 'none' : '';
        jsonWrap.style.display = isCustom ? '' : 'none';
        valueInput.placeholder = preset.valueHint || '';
        if (isCustom) {
          fieldHint.textContent = t('直接写入下面这段 JSON（会 deep merge 进上游请求体）。');
        } else {
          const sample = valueInput.value.trim() || (preset.valueHint || '').replace('例如 ', '') || '值';
          const preview = preset.build ? JSON.stringify(preset.build(toNumberIfNumeric(sample))) : '';
          fieldHint.textContent = t((preset.hint || '') + (preview ? '　→ 将写入 ' + preview : ''));
        }
      }
      fieldSelect.addEventListener('change', syncFields);
      valueInput.addEventListener('input', syncFields);

      const block = el('div', { class: 'level-block' }, [
        el('div', { class: 'level-row' }, [
          nameInput,
          fieldSelect,
          valueInput,
          el('label', { class: 'check' }, [defaultInput, '默认']),
          actionBtn('移除', () => {
            const i = levels.indexOf(entry);
            if (i >= 0) levels.splice(i, 1);
            block.remove();
            refreshPreview();
          }),
        ]),
        fieldHint,
        jsonWrap,
      ]);

      entry.inputs = {
        nameInput: nameInput,
        defaultInput: defaultInput,
        fieldSelect: fieldSelect,
        valueInput: valueInput,
        jsonInput: jsonInput,
      };
      syncFields();
      return block;
    }

    const headRow = el('div', { class: 'level-head' }, [
      el('div', { text: '档位名称' }),
      el('div', { text: '写入字段' }),
      el('div', { text: '强度值' }),
      el('div', { text: '默认' }),
      el('div', { text: '' }),
    ]);
    const rowsWrap = el('div', null, [headRow, ...levels.map(levelRow)]);
    // The header only makes sense once there is at least one level row.
    headRow.style.display = levels.length ? '' : 'none';
    levelsWrap.append(rowsWrap, el('button', {
      class: 'btn sm mt', type: 'button', text: '+ 添加档位', onClick: () => {
        headRow.style.display = '';
        const entry = { level: '', isDefault: false, field: 'reasoning.effort', value: '', json: '{}' };
        levels.push(entry);
        rowsWrap.append(levelRow(entry));
      },
    }));

    idInput.addEventListener('input', refreshPreview);

    const body = el('div', null, [
      el('div', { class: 'grid-2' }, [
        field('逻辑模型 ID', idInput, '暴露给 ZCode 的模型标识，不能包含“@”。'),
        field('显示名称', nameInput),
      ]),
      el('div', { class: 'grid-2' }, [
        field('服务商', providerSelect, '请求将被转发到该服务商。'),
        field('上游模型名', upstreamInput, '服务商侧真实的模型 ID。'),
      ]),
      field('启用', el('label', { class: 'check' }, [enabledInput, '该模型处于启用状态'])),
      el('div', { class: 'panel' }, [
        field('忽略客户端思考设置', el('label', { class: 'check' }, [
          ignoreClientReasoningInput,
          '只以所选档位为准，丢弃客户端（ZCode）传来的思考参数',
        ]), '勾选后，网关会在套用档位映射前删掉客户端发来的 reasoning / reasoning_effort / thinking / enable_thinking 等字段，确保 ZCode 的思考开关无法影响结果。推荐对使用不同字段名（如 Qwen 的 reasoning_effort）的模型开启。'),
      ]),
      el('div', { class: 'panel' }, [
        el('h2', { text: '思考档位' }),
        el('p', { class: 'sub', text: '档位名称可以是任意字符串（off、low、high、max、xhigh…）。选择要写入的字段并填一个强度值即可，网关会按该字段拼出映射对象并 deep merge 进上游请求体。需要特殊结构时可选“自定义 JSON”。强度值留空表示该档位不发送任何内容。' }),
        levelsWrap,
      ]),
      el('div', { class: 'panel' }, [
        el('h2', { text: '生成的 ZCode 模型' }),
        previewWrap,
      ]),
      el('div', { class: 'grid-2' }, [
        field('请求覆盖（JSON）', overridesInput, '会 deep merge 进该模型的每一次请求。'),
        field('删除字段', removeInput, '每行一个字段路径，例如 reasoning.summary'),
      ]),
    ]);

    refreshPreview();

    const modal = openModal({
      title: isEdit ? '编辑模型' : '添加模型',
      wide: true,
      body: body,
      footer: [
        el('button', { class: 'btn', type: 'button', text: '取消', onClick: () => modal.close() }),
        el('button', {
          class: 'btn primary', type: 'button', text: '保存', onClick: async () => {
            try {
              const supported = [];
              const mapping = {};
              let defaultLevel = null;
              levels.forEach((entry) => {
                const lvl = (entry.inputs && entry.inputs.nameInput.value || entry.level || '').trim();
                if (!lvl) return;
                supported.push(lvl);
                if (entry.inputs && entry.inputs.defaultInput.checked) defaultLevel = lvl;

                const fieldId = entry.inputs ? entry.inputs.fieldSelect.value : (entry.field || 'custom');
                if (fieldId === 'custom') {
                  const raw = (entry.inputs ? entry.inputs.jsonInput.value : entry.json || '').trim();
                  if (raw && raw !== '{}') {
                    try {
                      mapping[lvl] = JSON.parse(raw);
                    } catch (err) {
                      throw new Error(t('档位“') + lvl + t('”的自定义 JSON 不是合法 JSON：') + err.message);
                    }
                  }
                } else {
                  const preset = reasoningField(fieldId);
                  const value = (entry.inputs ? entry.inputs.valueInput.value : entry.value || '').trim();
                  if (value !== '' && preset && preset.build) {
                    mapping[lvl] = preset.build(toNumberIfNumeric(value));
                  }
                }
              });
              const payload = {
                display_name: nameInput.value.trim(),
                provider: providerSelect.value,
                upstream_model: upstreamInput.value.trim(),
                enabled: enabledInput.checked,
                ignore_client_reasoning: ignoreClientReasoningInput.checked,
                request_overrides: parseJsonField(overridesInput, '请求覆盖', {}),
                remove_fields: removeInput.value.split('\n').map((s) => s.trim()).filter(Boolean),
              };
              if (!payload.upstream_model) throw new Error('上游模型名不能为空。');
              if (!payload.provider) throw new Error('必须选择一个服务商。请先在“服务商”页面添加。');
              if (supported.length) {
                payload.reasoning = { supported: supported, default: defaultLevel || supported[0], mapping: mapping };
              } else {
                payload.reasoning = null;
              }
              if (isEdit) {
                await api('/api/admin/models/' + encodeURIComponent(m.id), { method: 'PUT', body: payload });
              } else {
                payload.id = idInput.value.trim();
                if (!payload.id) throw new Error('逻辑模型 ID 不能为空。');
                await api('/api/admin/models', { method: 'POST', body: payload });
              }
              modal.close();
              notify('已保存', 'ok');
              loadModels();
            } catch (err) { notify(err.message, 'err'); }
          },
        }),
      ],
    });
  }

  async function testModel(model) {
    notify('正在测试 ' + model.id + '…');
    try {
      const result = await api('/api/admin/models/' + encodeURIComponent(model.id) + '/test', { method: 'POST' });
      if (result.ok) notify(t('成功 — HTTP ') + result.status + t('，用时 ') + result.latency_ms + ' ms', 'ok');
      else notify(t('失败 — ') + (result.error || ('HTTP ' + result.status)), 'err');
    } catch (err) { notify(err.message, 'err'); }
  }

  async function toggleModel(model, enabled) {
    try {
      await api('/api/admin/models/' + encodeURIComponent(model.id), { method: 'PUT', body: { enabled: enabled } });
      notify('已保存', 'ok');
      loadModels();
    } catch (err) { notify(err.message, 'err'); }
  }

  async function duplicateModel(model) {
    const newId = window.prompt('新的模型 ID：', model.id + '-copy');
    if (!newId) return;
    try {
      await api('/api/admin/models/' + encodeURIComponent(model.id) + '/duplicate', { method: 'POST', body: { id: newId } });
      notify('已保存', 'ok');
      loadModels();
    } catch (err) { notify(err.message, 'err'); }
  }

  async function deleteModel(model) {
    if (!window.confirm(t('确定删除模型“') + model.id + t('”吗？此操作不可撤销。'))) return;
    try {
      await api('/api/admin/models/' + encodeURIComponent(model.id), { method: 'DELETE' });
      notify('已删除', 'ok');
      loadModels();
    } catch (err) { notify(err.message, 'err'); }
  }

  // --------------------------------------------------------- test console
  async function loadConsoleOptions() {
    const data = await api('/api/admin/models');
    state.models = data.models || [];
    const virtual = data.virtual_models || [];
    const select = $('#console-model');
    const previous = select.value;
    clear(select);
    virtual.forEach((v) => select.append(el('option', { value: v, text: v })));
    if (previous) select.value = previous;
    loadCompareModels();
  }

  function consoleBody(model) {
    const body = { model: model };
    const instructions = $('#console-instructions').value;
    const input = $('#console-input').value;
    if (instructions.trim()) body.instructions = instructions;
    if (input.trim()) body.input = input;
    body.stream = $('#console-stream').checked;
    return body;
  }

  async function runConsole() {
    const model = $('#console-model').value;
    if (!model) { notify('未选择模型，请先添加一个模型。', 'err'); return; }
    const body = consoleBody(model);
    const output = $('#console-output');
    output.textContent = '';
    $('#console-send').disabled = true;
    $('#console-stop').disabled = false;

    if ($('#console-preview').checked) {
      try {
        const preview = await api('/api/admin/preview', { method: 'POST', body: { model: model, body: body } });
        $('#console-preview-panel').style.display = '';
        $('#console-preview-out').textContent = JSON.stringify(preview, null, 2);
      } catch (err) {
        $('#console-preview-panel').style.display = '';
        $('#console-preview-out').textContent = t('预览失败：' + err.message);
      }
    } else {
      $('#console-preview-panel').style.display = 'none';
    }

    state.controller = new AbortController();
    const headers = { 'content-type': 'application/json', 'accept-language': i18n.lang };
    if (state.token) headers['x-admin-token'] = state.token;

    try {
      if (body.stream) {
        await streamConsole(body, headers, output);
      } else {
        const response = await fetch('/v1/responses', { method: 'POST', headers: headers, body: JSON.stringify(body), signal: state.controller.signal });
        const data = await response.json().catch(() => null);
        output.textContent = $('#console-raw').checked
          ? JSON.stringify(data, null, 2)
          : extractResponseText(data);
        if (!response.ok && data) output.textContent = extractError(data) || output.textContent;
      }
    } catch (err) {
      if (err.name === 'AbortError') output.textContent += t('\n[已停止]');
      else output.textContent += t('\n[错误] ') + err.message;
    } finally {
      $('#console-send').disabled = false;
      $('#console-stop').disabled = true;
      state.controller = null;
    }
  }

  function extractResponseText(data) {
    if (!data) return '';
    if (data.output_text) return data.output_text;
    if (Array.isArray(data.output)) {
      return data.output.map((item) => {
        if (item.type === 'message' && Array.isArray(item.content)) {
          return item.content.map((c) => c.text || '').join('');
        }
        if (item.type === 'reasoning') return '[思考] ' + (item.summary || []).map((s) => s.text || '').join('');
        if (item.type === 'function_call') return '[工具调用] ' + item.name + '(' + item.arguments + ')';
        return '';
      }).filter(Boolean).join('\n');
    }
    return JSON.stringify(data, null, 2);
  }

  async function streamConsole(body, headers, output) {
    const raw = $('#console-raw').checked;
    const response = await fetch('/v1/responses', { method: 'POST', headers: headers, body: JSON.stringify(body), signal: state.controller.signal });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      output.textContent = (data && extractError(data)) || 'HTTP ' + response.status;
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop();
      for (const block of blocks) handleSseBlock(block, output, raw);
    }
    if (buffer.trim()) handleSseBlock(buffer, output, raw);
  }

  function handleSseBlock(block, output, raw) {
    const lines = block.split('\n');
    let event = '';
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    const dataText = dataLines.join('\n');
    if (raw) {
      output.textContent += 'event: ' + event + '\ndata: ' + dataText + '\n\n';
      return;
    }
    let data = null;
    try { data = JSON.parse(dataText); } catch (e) { return; }
    if (event === 'response.output_text.delta' && data.delta) output.textContent += data.delta;
    else if (event.indexOf('reasoning_summary_text.delta') !== -1 && data.delta) output.textContent += data.delta;
    else if (event === 'response.function_call_arguments.delta' && data.delta) output.textContent += t('\n[工具参数] ') + data.delta;
    else if (event === 'response.failed' && data.response && data.response.error) {
      output.textContent += t('\n[错误] ') + data.response.error.message;
    }
  }

  // ------------------------------------------------- reasoning comparison
  //
  // Sends one question to every selected reasoning level of a model and lines
  // the answers up side by side, so a user can see whether `model@level`
  // actually changes how much the upstream thinks. Evidence, in order of
  // strength: reported reasoning tokens, then reasoning text length, then
  // latency only (weakest).
  let compareRun = null;

  function compareModels(models) {
    return (models || []).filter(
      (m) => m.enabled && m.reasoning && (m.reasoning.supported || []).length
    );
  }

  function loadCompareModels() {
    const models = compareModels(state.models);
    const select = $('#compare-model');
    const previous = select.value;
    clear(select);
    models.forEach((m) => {
      const label = m.display_name && m.display_name !== m.id ? m.id + '（' + m.display_name + '）' : m.id;
      select.append(el('option', { value: m.id, text: label }));
    });
    if (previous && models.some((m) => m.id === previous)) select.value = previous;
    if (!models.length) {
      $('#compare-levels').append(
        el('span', { class: 'muted', text: '还没有配置思考档位的模型。请先在“模型”页面添加档位。' })
      );
    }
    renderCompareLevels();
  }

  function currentCompareModel() {
    const id = $('#compare-model').value;
    return state.models.find((m) => m.id === id) || null;
  }

  function renderCompareLevels() {
    const box = $('#compare-levels');
    clear(box);
    const model = currentCompareModel();
    const levels = (model && model.reasoning && model.reasoning.supported) || [];
    levels.forEach((level) => {
      const input = el('input', { type: 'checkbox', checked: true });
      input.dataset.level = level;
      box.append(el('label', { class: 'check' }, [
        input,
        el('span', { text: level + t(model.reasoning.default === level ? '（默认）' : '') }),
      ]));
    });
    if (!levels.length) box.append(el('span', { class: 'muted', text: '该模型没有可对比的档位。' }));
  }

  function selectedCompareLevels() {
    return Array.from($('#compare-levels').querySelectorAll('input[type="checkbox"]'))
      .filter((c) => c.checked)
      .map((c) => c.dataset.level);
  }

  async function runCompare() {
    const model = $('#compare-model').value;
    if (!model) { notify('请先选择一个带思考档位的模型。', 'err'); return; }
    const levels = selectedCompareLevels();
    if (!levels.length) { notify('请至少勾选一个思考档位。', 'err'); return; }
    const input = $('#compare-input').value;
    if (!input.trim()) { notify('请输入要发送给各档位的问题。', 'err'); return; }

    const body = {};
    if ($('#compare-instructions').value.trim()) body.instructions = $('#compare-instructions').value;
    body.input = input;

    compareRun = {
      model: model,
      levels: levels,
      results: {},
      controller: new AbortController(),
    };
    clear($('#compare-results'));
    clear($('#compare-summary'));
    $('#compare-summary-panel').style.display = '';
    $('#compare-results').append(el('p', { class: 'muted', text: '正在按档位逐个发送请求…' }));
    $('#compare-send').disabled = true;
    $('#compare-stop').disabled = false;

    const headers = { 'content-type': 'application/json', 'accept-language': i18n.lang };
    if (state.token) headers['x-admin-token'] = state.token;

    try {
      const response = await fetch('/api/admin/compare', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ model: model, levels: levels, body: body, stream: $('#compare-stream').checked }),
        signal: compareRun.controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(extractError(data) || 'HTTP ' + response.status);
      }
      clear($('#compare-results'));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) handleCompareLine(line);
      }
      if (buffer.trim()) handleCompareLine(buffer);
      renderCompareSummary();
    } catch (err) {
      if (err.name === 'AbortError') notify('对比已停止。', 'ok');
      else notify(err.message, 'err');
    } finally {
      $('#compare-send').disabled = false;
      $('#compare-stop').disabled = true;
      compareRun = null;
    }
  }

  function handleCompareLine(line) {
    line = line.trim();
    if (!line) return;
    let event = null;
    try { event = JSON.parse(line); } catch (e) { return; }
    if (event.type === 'started') {
      compareRun.levels = event.levels || compareRun.levels;
      return;
    }
    if (event.type === 'result') {
      compareRun.results[event.level] = event;
      renderCompareResult(event);
      return;
    }
    if (event.type === 'done') {
      renderCompareSummary();
    }
  }

  function compareMetricValue(result) {
    if (result.reasoning_tokens !== null && result.reasoning_tokens !== undefined) {
      return { value: result.reasoning_tokens, unit: '思考 tokens' };
    }
    if (result.reasoning_chars) {
      return { value: result.reasoning_chars, unit: '思考字符' };
    }
    return null;
  }

  function compareResultCard(result) {
    const metrics = [
      el('span', { class: 'chip' }, [t('状态 '), badge(String(result.status || '—'), result.ok ? 'ok' : 'err')]),
      el('span', { class: 'chip' }, [t('总耗时 '), el('strong', { text: result.elapsed_ms + ' ms' })]),
      el('span', {
        class: 'chip',
        text: t('思考 tokens ') + (result.reasoning_tokens === null || result.reasoning_tokens === undefined ? t('未上报') : result.reasoning_tokens),
      }),
      el('span', { class: 'chip', text: t('思考字符 ') + (result.reasoning_chars || 0) }),
      el('span', {
        class: 'chip',
        text: t('首个思考片段 ') + (result.first_reasoning_ms === null || result.first_reasoning_ms === undefined ? '—' : result.first_reasoning_ms + ' ms'),
      }),
      el('span', {
        class: 'chip',
        text: t('输出 tokens ') + (result.output_tokens === null || result.output_tokens === undefined ? t('未上报') : result.output_tokens),
      }),
    ];

    const children = [
      el('div', { class: 'flex-between' }, [
        el('h2', { style: 'margin:0', text: result.level + t(result.is_default ? '（默认）' : '') }),
        el('span', { class: 'mono muted', text: result.virtual_model || '' }),
      ]),
      el('div', { class: 'compare-metrics' }, metrics),
    ];

    if (!result.ok && result.error) {
      children.push(el('div', { class: 'verdict err', text: '失败：' + result.error }));
    }

    const mappingJson = JSON.stringify({
      mapping: result.mapping || {},
      request_overrides: result.request_overrides || {},
    }, null, 2);
    children.push(
      el('div', { class: 'compare-label', text: '注入到上游请求的参数' }),
      el('pre', { class: 'code', text: mappingJson })
    );

    if (result.reasoning_text) {
      children.push(
        el('div', { class: 'compare-label', text: t('思考内容') + t(result.reasoning_truncated ? '（已截断显示）' : '') }),
        el('div', { class: 'compare-text', text: result.reasoning_text })
      );
    }
    if (result.output_text) {
      children.push(
        el('div', { class: 'compare-label', text: t('回答') + t(result.output_truncated ? '（已截断显示）' : '') }),
        el('div', { class: 'compare-text', text: result.output_text })
      );
    }
    return el('div', { class: 'panel', id: 'compare-card-' + result.level }, children);
  }

  function renderCompareResult(result) {
    const card = $('#compare-card-' + result.level);
    const fresh = compareResultCard(result);
    if (card) card.replaceWith(fresh);
    else $('#compare-results').append(fresh);
  }

  function renderCompareSummary() {
    const run = compareRun;
    if (!run) return;
    const box = $('#compare-summary');
    clear(box);
    const levels = run.levels;
    const finished = levels.filter((lvl) => run.results[lvl]);
    if (!finished.length) return;

    // Prefer token counts. A level that produced no thinking at all (chars=0,
    // no tokens) is simply 0 on the token scale, so it does not force the whole
    // comparison down to characters. Characters are the fallback only when
    // some level that did think carries no token count.
    const tokens = {};
    const chars = {};
    finished.forEach((lvl) => {
      const result = run.results[lvl];
      tokens[lvl] = result.reasoning_tokens;
      chars[lvl] = result.reasoning_chars || 0;
    });
    const hasTokens = (lvl) => tokens[lvl] !== null && tokens[lvl] !== undefined;
    const allTokens = finished.every(hasTokens);
    const anyTokens = finished.some(hasTokens);
    const tokenBasis = allTokens
      || (anyTokens && finished.every((lvl) => hasTokens(lvl) || chars[lvl] === 0));
    const values = finished.map((lvl) => (tokenBasis
      ? (hasTokens(lvl) ? tokens[lvl] : 0)
      : chars[lvl]));
    const max = Math.max.apply(null, values.concat([0]));

    const bars = el('div', { class: 'compare-bars' }, finished.map((lvl, i) => {
      const value = values[i];
      const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
      return el('div', { class: 'compare-bar-row' }, [
        el('span', { class: 'compare-bar-label mono', text: lvl }),
        el('div', { class: 'compare-bar-track' }, el('div', {
          class: 'compare-bar', style: 'width:' + width + '%',
        })),
        el('span', { class: 'compare-bar-label', text: compareRowLabel(tokens[lvl], value, tokenBasis) }),
      ]);
    }));
    box.append(bars);

    const failed = finished.filter((lvl) => !run.results[lvl].ok);
    let basisLabel;
    if (tokenBasis) {
      basisLabel = allTokens ? '按思考 token 比较' : '按思考 token 比较，未产生思考的档位按 0 计';
    } else if (anyTokens) {
      basisLabel = '按思考字符数比较，部分档位未上报 token，已同时标注可用 token 数';
    } else {
      basisLabel = '按思考字符数比较，上游未上报 token';
    }
    let verdictKind = 'warn';
    let verdictText = null;

    if (failed.length) {
      verdictKind = 'err';
      verdictText = t('有档位请求失败：')
        + failed.map((lvl) => lvl + t('（') + (run.results[lvl].error || t('未知错误')) + t('）')).join(t('；'))
        + t('。请先解决失败项再判读差异。');
    } else if (finished.length < levels.length) {
      verdictText = t('对比尚未完成，当前为已完成档位的初步结果。');
    } else if (values.every((v) => v === 0)) {
      verdictText = t('各档位都没有返回可观察的思考内容，也没有上报思考 token：无法判断档位是否生效。')
        + t('若上游支持，可在模型配置的 request_overrides 中要求返回思考摘要（例如 Responses 协议加 reasoning.summary=auto），或改用会上报 usage 的服务商。');
    } else if (new Set(values).size > 1) {
      verdictKind = 'ok';
      const descending = levels.slice().sort((a, b) => (
        values[finished.indexOf(b)] - values[finished.indexOf(a)]
      ));
      const detail = descending.map((lvl) => {
        const index = finished.indexOf(lvl);
        return lvl + ' ' + (tokenBasis ? values[index] + ' tokens' : values[index] + t(' 字符'));
      }).join(t('，'));
      verdictText = t('各档位的思考长度存在差异，档位映射已产生不同效果（') + t(basisLabel)
        + t('）。从长到短：') + detail + t('。');
    } else {
      verdictText = t('各档位的思考长度完全相同：可能是上游不区分这些档位的参数，也可能是映射没有真正改变上游行为。')
        + t('建议核对每个档位“注入到上游请求的参数”，并确认该模型在上游确实区分这些参数。');
    }
    box.append(el('div', { class: 'verdict ' + verdictKind, text: verdictText }));
  }

  function compareRowLabel(tokenValue, value, tokenBasis) {
    if (tokenBasis) return value + ' tokens';
    const tokensText = (tokenValue === null || tokenValue === undefined)
      ? 'tokens 未上报'
      : tokenValue + ' tokens';
    return value + ' 字符（' + tokensText + '）';
  }

  // ---------------------------------------------------------- configuration
  let configMode = 'form';

  async function loadConfig() {
    const data = await api('/api/admin/config');
    $('#config-yaml').value = data.yaml || '';
    if (!data.valid) {
      notify('当前配置无效：' + data.error, 'err');
    }
    switchConfigTab(configMode);
  }

  function switchConfigTab(mode) {
    configMode = mode;
    $('#config-tab-form').classList.toggle('active', mode === 'form');
    $('#config-tab-raw').classList.toggle('active', mode === 'raw');
    $('#config-form-mode').style.display = mode === 'form' ? '' : 'none';
    $('#config-raw-mode').style.display = mode === 'raw' ? '' : 'none';
  }

  function switchConsoleTab(mode) {
    $('#console-tab-single').classList.toggle('active', mode === 'single');
    $('#console-tab-compare').classList.toggle('active', mode === 'compare');
    $('#console-single-mode').style.display = mode === 'single' ? '' : 'none';
    $('#console-compare-mode').style.display = mode === 'compare' ? '' : 'none';
  }

  function renderDiff(diff) {
    const container = $('#config-diff');
    clear(container);
    if (!diff) return;
    const parts = [];
    const label = { providers: '服务商', models: '模型' };
    ['providers', 'models'].forEach((key) => {
      const d = diff[key] || {};
      if ((d.added || []).length) parts.push('新增' + label[key] + '：' + d.added.join('、'));
      if ((d.removed || []).length) parts.push('移除' + label[key] + '：' + d.removed.join('、'));
      if ((d.changed || []).length) parts.push('修改' + label[key] + '：' + d.changed.join('、'));
    });
    if (diff.settings_changed) parts.push('全局设置已变更');
    container.append(el('div', { class: 'panel', style: 'margin-bottom:0' }, [
      el('strong', { text: '差异摘要：' }),
      el('ul', { class: 'diff-list' }, parts.length
        ? parts.map((p) => el('li', { text: p }))
        : [el('li', { text: '未检测到变化。' })]),
    ]));
  }

  async function saveConfig() {
    try {
      await api('/api/admin/config', { method: 'PUT', body: { yaml: $('#config-yaml').value } });
      notify('已保存', 'ok');
      loadConfig();
      loadStatus().catch(() => {});
    } catch (err) { notify(err.message, 'err'); }
  }

  async function validateConfig() {
    try {
      const result = await api('/api/admin/config/validate', { method: 'POST', body: { yaml: $('#config-yaml').value } });
      if (result.valid) {
        notify('校验通过', 'ok');
        renderDiff(result.diff);
      } else {
        notify(result.error, 'err');
        clear($('#config-diff'));
      }
    } catch (err) { notify(err.message, 'err'); }
  }

  async function reloadConfig() {
    try {
      await api('/api/admin/config/reload', { method: 'POST' });
      notify('已重新加载', 'ok');
      loadConfig();
    } catch (err) { notify(err.message, 'err'); }
  }

  function downloadConfig() {
    api('/api/admin/config').then((data) => {
      const blob = new Blob([data.yaml || ''], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'config.yaml' });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }).catch((err) => notify(err.message, 'err'));
  }

  function uploadConfig() {
    $('#config-file-input').click();
  }

  async function handleConfigFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    try {
      const result = await api('/api/admin/config/upload', { method: 'POST', body: { yaml: text } });
      $('#config-yaml').value = result.yaml || text;
      switchConfigTab('raw');
      renderDiff(result.diff);
      if (window.confirm('上传的配置有效。现在保存为当前生效配置吗？')) {
        await saveConfig();
      }
    } catch (err) { notify(err.message, 'err'); }
  }

  async function resetConfig() {
    if (!window.confirm('确定将配置重置为 config.example.yaml 吗？这会覆盖当前配置。')) return;
    try {
      await api('/api/admin/config/reset-example', { method: 'POST' });
      notify('已重置为示例配置', 'ok');
      loadConfig();
    } catch (err) { notify(err.message, 'err'); }
  }

  // ------------------------------------------------- full backup (bundle)
  function exportBundle(includeKeys) {
    const path = '/api/admin/config/bundle' + (includeKeys ? '' : '?include_keys=false');
    const headers = { 'accept-language': i18n.lang };
    if (state.token) headers['x-admin-token'] = state.token;
    fetch(path, { headers: headers })
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then((text) => {
        const stamp = new Date().toISOString().slice(0, 10);
        const name = includeKeys ? `zumg-backup-${stamp}.json` : `zumg-config-${stamp}.json`;
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        notify(includeKeys ? '已导出完整备份（含 Key）' : '已导出配置（不含 Key）', 'ok');
      })
      .catch((err) => notify('导出失败：' + err.message, 'err'));
  }

  function importBundle() {
    $('#bundle-file-input').click();
  }

  async function handleBundleFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (err) {
      notify('备份文件不是合法 JSON：' + err.message, 'err');
      return;
    }
    const keys = payload.keys || {};
    const keyCount = Object.keys(keys).length;
    const providerCount = payload.config && payload.config.providers
      ? Object.keys(payload.config.providers).length : 0;
    const modelCount = payload.config && payload.config.models
      ? Object.keys(payload.config.models).length : 0;

    const message = t('将导入该备份：\n\n')
      + t('· 服务商：') + providerCount + t(' 个\n')
      + t('· 模型：') + modelCount + t(' 个\n')
      + t('· API Key：') + keyCount + t(' 个\n\n')
      + '当前配置会被替换（本机已有但备份里没有的 Key 会保留）。确定继续吗？';
    if (!window.confirm(message)) return;

    try {
      const result = await api('/api/admin/config/bundle', { method: 'POST', body: payload });
      notify(t('已导入：') + result.providers + t(' 服务商 / ') + result.models + t(' 模型 / ')
        + (result.keys_restored || []).length + t(' 个 Key'), 'ok');
      await loadConfig();
      loadStatus().catch(() => {});
    } catch (err) { notify(err.message, 'err'); }
  }

  // ------------------------------------------------------------------ logs
  async function loadLogs() {
    const data = await api('/api/admin/logs?limit=100');
    const container = $('#logs-table');
    clear(container);
    const logs = data.logs || [];
    if (!logs.length) {
      container.append(el('p', { class: 'muted', text: '暂无请求记录。' }));
      return;
    }
    container.append(el('div', { class: 'table-wrap' }, el('table', null, [
      el('thead', null, el('tr', null, [
        el('th', { text: '时间' }), el('th', { text: '逻辑模型' }), el('th', { text: '档位' }),
        el('th', { text: '服务商' }), el('th', { text: '上游模型' }), el('th', { text: '协议' }),
        el('th', { text: '状态' }), el('th', { text: '耗时' }), el('th', { text: '错误' }),
      ])),
      el('tbody', null, logs.map((row) => el('tr', null, [
        el('td', { text: fmtTime(row.time_iso || row.time) }),
        el('td', { class: 'mono', text: row.logical_model || '—' }),
        el('td', { text: row.reasoning_level || '—' }),
        el('td', { text: row.provider || '—' }),
        el('td', { class: 'mono', text: row.upstream_model || '—' }),
        el('td', { text: row.protocol || '—' }),
        el('td', null, badge(String(row.status || '—'), row.ok ? 'ok' : 'err')),
        el('td', { text: row.latency_ms != null ? row.latency_ms + ' ms' : '—' }),
        el('td', { text: row.error_type || '—' }),
      ]))),
    ])));
  }

  // ----------------------------------------------------------------- about
  async function loadAbout() {
    const container = $('#about-details');
    clear(container);
    try {
      const meta = state.meta || await api('/api/admin/meta');
      state.meta = meta;
      container.append(
        el('p', null, [el('strong', { text: '版本：' }), meta.version]),
        el('p', null, [el('strong', { text: '支持的协议：' }), (meta.protocols || []).join('、')]),
        el('p', null, [el('strong', { text: '默认 Base URL：' }), meta.default_base_url])
      );
    } catch (err) {
      container.append(el('p', { class: 'muted', text: err.message }));
    }
  }

  // ------------------------------------------------------------------ modal
  //
  // A dialog must only close on an explicit action (×, 取消, 保存, Escape).
  // Clicking the dimmed area does NOT close it, because that is far too easy
  // to do by accident while reaching for a field. We also move focus into the
  // dialog and trap Tab inside it, so keystrokes cannot reach the button that
  // opened the dialog (which would otherwise re-trigger it or dismiss it).
  const FOCUSABLE_SELECTOR = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function openModal(options) {
    const root = $('#modal-root');
    const backdrop = el('div', { class: 'modal-backdrop' });
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      clear(root);
    };

    const modal = el('div', {
      class: 'modal' + (options.wide ? ' wide' : ''),
      role: 'dialog',
      'aria-modal': 'true',
    }, [
      el('div', { class: 'modal-head' }, [
        el('h2', { text: options.title }),
        el('button', {
          class: 'close-x', type: 'button', text: '\u00d7',
          'aria-label': '关闭', onClick: close,
        }),
      ]),
      el('div', { class: 'modal-body' }, options.body),
      options.footer ? el('div', { class: 'modal-foot' }, options.footer) : null,
    ]);

    backdrop.append(modal);

    function focusable() {
      return Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((n) => n.offsetParent !== null || n === document.activeElement);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    // Clicking anywhere on the backdrop is intentionally a no-op.
    backdrop.addEventListener('click', (event) => { event.stopPropagation(); });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown, true);
    root.append(backdrop);

    // Put the caret in the first editable field so typing goes to the dialog.
    const firstField = focusable().find((n) => /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName));
    if (firstField) {
      try { firstField.focus({ preventScroll: true }); } catch (e) { firstField.focus(); }
    } else {
      modal.setAttribute('tabindex', '-1');
      modal.focus({ preventScroll: true });
    }

    return { close: close, modal: modal };
  }

  // ------------------------------------------------------------------ init
  function init() {
    // Record the Chinese source text of the static markup before anything
    // renders, so switching languages can restore it exactly.
    collectStaticText(document.body);
    renderStaticText();
    updateLangToggle();
    document.querySelectorAll('#lang-switch .lang-btn').forEach((button) => {
      button.addEventListener('click', () => setLang(button.dataset.lang));
    });

    initNav();
    $('#copy-base-url').addEventListener('click', () => copyText($('#zcode-base-url').value));
    $('#add-provider').addEventListener('click', () => openProviderForm(null));
    $('#add-model').addEventListener('click', async () => {
      try {
        await ensureProviders();
      } catch (err) {
        notify(err.message, 'err');
        return;
      }
      if (!state.providers.length) {
        notify('请先添加一个服务商。', 'err');
        showView('providers');
        return;
      }
      openModelForm(null);
    });

    $('#console-send').addEventListener('click', () => runConsole().catch((err) => notify(err.message, 'err')));
    $('#console-stop').addEventListener('click', () => { if (state.controller) state.controller.abort(); });
    $('#console-clear').addEventListener('click', () => {
      $('#console-output').textContent = '';
      $('#console-instructions').value = '';
      $('#console-input').value = '';
      $('#console-preview-out').textContent = '';
      $('#console-preview-panel').style.display = 'none';
    });

    $('#console-tab-single').addEventListener('click', () => switchConsoleTab('single'));
    $('#console-tab-compare').addEventListener('click', () => switchConsoleTab('compare'));
    $('#compare-model').addEventListener('change', renderCompareLevels);
    $('#compare-send').addEventListener('click', () => runCompare().catch((err) => notify(err.message, 'err')));
    $('#compare-stop').addEventListener('click', () => { if (compareRun) compareRun.controller.abort(); });

    $('#config-tab-form').addEventListener('click', () => switchConfigTab('form'));
    $('#config-tab-raw').addEventListener('click', () => switchConfigTab('raw'));
    $('#config-save').addEventListener('click', () => saveConfig());
    $('#config-validate').addEventListener('click', () => validateConfig());
    $('#config-reload').addEventListener('click', () => reloadConfig());
    $('#config-download').addEventListener('click', () => downloadConfig());
    $('#config-upload').addEventListener('click', () => uploadConfig());
    $('#config-reset').addEventListener('click', () => resetConfig());
    $('#config-file-input').addEventListener('change', (event) => handleConfigFile(event).catch((err) => notify(err.message, 'err')));
    $('#bundle-export').addEventListener('click', () => exportBundle(true));
    $('#bundle-export-nokey').addEventListener('click', () => exportBundle(false));
    $('#bundle-import').addEventListener('click', () => importBundle());
    $('#bundle-file-input').addEventListener('change', (event) => handleBundleFile(event).catch((err) => notify(err.message, 'err')));

    $('#logs-refresh').addEventListener('click', () => loadLogs().catch((err) => notify(err.message, 'err')));

    api('/api/admin/meta').then((meta) => {
      state.meta = meta;
      $('#version-badge').textContent = 'v' + meta.version;
      $('#zcode-base-url').value = meta.default_base_url;
    }).catch(() => {});

    loadStatus().catch((err) => {
      const badgeEl = $('#config-status');
      badgeEl.textContent = t(err.message.indexOf('Token') !== -1 ? '需要 Token' : '未连接');
      badgeEl.className = 'badge err';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
