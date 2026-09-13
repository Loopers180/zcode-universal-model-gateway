"""Admin API backing the Web UI.

All ``/api/admin/*`` endpoints optionally require a token: when the
``GATEWAY_ADMIN_TOKEN`` environment variable is set, every request must carry
it. Secrets (API keys, Authorization headers, temporary keys) are never
returned — only availability status.
"""

from __future__ import annotations

import hmac
import json
import os
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response, StreamingResponse

from .. import __version__
from ..adapters import supported_protocols
from ..compare import run_comparison, select_levels
from ..config import (
    Config,
    ConfigError,
    ConfigManager,
    ModelConfig,
    ProviderConfig,
    load_config_text,
    parse_config,
)
from ..errors import GatewayError
from ..i18n import tr
from ..metrics import Metrics
from ..router import Router, test_connection
from ..secrets import SecretStore

ADMIN_TOKEN_ENV = "GATEWAY_ADMIN_TOKEN"

# Marker for the single-file backup that carries the configuration *and* the
# saved API keys, so one file can be moved to another machine.
BUNDLE_FORMAT = "zumg.bundle.v1"
BUNDLE_VERSION = 1

#: Responses that can contain credentials must never be cached anywhere.
NO_STORE = "no-store"


def _is_loopback_host(host: str) -> bool:
    """True for ``localhost``, ``127.0.0.0/8`` and ``::1`` forms."""
    hostname = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
    hostname = hostname.strip("[]").lower()
    if hostname in ("localhost", "::1"):
        return True
    return hostname.startswith("127.")


def _same_origin(request: Request) -> bool:
    """Reject cross-site browser requests against the admin API.

    A malicious web page can issue requests to a loopback gateway even without
    reading the response (classic CSRF), and a DNS-rebinding page can make its
    requests look same-origin. Non-browser clients (curl, ZCode) send no
    ``Origin`` header and are unaffected.

    Two cheap checks:

    1. an ``Origin`` header, when present, must match the ``Host`` header;
    2. when the server is bound to a loopback address, the ``Host`` header must
       also be a loopback form (blocks DNS rebinding in the default setup).
    """
    origin = request.headers.get("origin")
    host = request.headers.get("host")
    if origin:
        if not host:
            return False
        origin_netloc = urlsplit(origin).netloc.lower()
        if origin_netloc and origin_netloc != host.lower():
            return False
    server = request.scope.get("server") or ("", 0)
    if _is_loopback_host(str(server[0])) and host and not _is_loopback_host(host):
        return False
    return True


def require_admin(request: Request) -> None:
    """Guard every admin endpoint with two independent layers.

    - same-origin/Host validation (always on — this is what keeps a random web
      page from driving the admin API of a token-less loopback gateway);
    - ``GATEWAY_ADMIN_TOKEN`` when it is configured.
    """
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail=tr("admin.cross_site_denied"))
    expected = os.environ.get(ADMIN_TOKEN_ENV)
    if not expected:
        return
    supplied = request.headers.get("x-admin-token")
    if not supplied:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            supplied = auth[7:].strip()
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail=tr("admin.token_required"))


def _provider_status(provider: ProviderConfig, secrets: SecretStore, provider_id: str) -> dict:
    return secrets.status(provider_id, provider.api_key_env)


def _ndjson(payload: dict[str, Any]) -> bytes:
    """One line of an NDJSON response stream (encoding is UTF-8, not ASCII)."""
    return (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def _provider_dict(provider_id: str, provider: ProviderConfig, secrets: SecretStore) -> dict:
    data = provider.model_dump(mode="json")
    data["id"] = provider_id
    data["key_status"] = _provider_status(provider, secrets, provider_id)
    return data


def _model_dict(model_id: str, model: ModelConfig, config: Config) -> dict:
    data = model.model_dump(mode="json")
    data["id"] = model_id
    data["provider_enabled"] = bool(
        config.providers.get(model.provider)
        and config.providers[model.provider].enabled
    )
    virtual = [model_id]
    if model.reasoning and model.reasoning.supported:
        virtual = [model_id] + [f"{model_id}@{lvl}" for lvl in model.reasoning.supported]
    data["virtual_models"] = virtual if model.enabled else []
    return data


def _config_diff(old: Config, new: Config) -> dict[str, Any]:
    def delta(attr: str) -> dict[str, list[str]]:
        o = set(getattr(old, attr))
        n = set(getattr(new, attr))
        return {
            "added": sorted(n - o),
            "removed": sorted(o - n),
            "changed": sorted(
                k
                for k in (o & n)
                if getattr(old, attr)[k].model_dump() != getattr(new, attr)[k].model_dump()
            ),
        }

    return {
        "providers": delta("providers"),
        "models": delta("models"),
        "settings_changed": old.settings.model_dump() != new.settings.model_dump(),
    }


def build_admin_router(
    manager: ConfigManager,
    secrets: SecretStore,
    metrics: Metrics,
    router: Router,
) -> APIRouter:
    api = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

    # -- status / meta ---------------------------------------------------

    @api.get("/status")
    async def status() -> dict[str, Any]:
        config = manager.config
        available_keys = sum(
            1
            for pid, provider in config.providers.items()
            if secrets.status(pid, provider.api_key_env)["available"]
        )
        return {
            "version": __version__,
            "config_path": str(manager.path),
            "config_valid": manager.load_error is None,
            "config_error": manager.load_error,
            "loaded_at": manager.loaded_at,
            "providers": len(config.providers),
            "models": len(config.models),
            "virtual_models": len(config.virtual_model_ids()),
            "providers_with_keys": available_keys,
            "metrics": metrics.snapshot(),
            "recent_requests": metrics.recent_requests(5),
            "recent_errors": metrics.recent_errors(5),
        }

    @api.get("/meta")
    async def meta() -> dict[str, Any]:
        return {
            "version": __version__,
            "protocols": supported_protocols(),
            "default_base_url": "http://127.0.0.1:8787/v1",
        }

    @api.get("/logs")
    async def logs(limit: int = Query(default=100, ge=1, le=1000)) -> dict[str, Any]:
        return {"logs": metrics.logs(limit)}

    @api.get("/metrics")
    async def metrics_endpoint() -> dict[str, Any]:
        return metrics.snapshot()

    # -- providers -------------------------------------------------------

    @api.get("/providers")
    async def list_providers() -> dict[str, Any]:
        config = manager.config
        return {
            "providers": [
                _provider_dict(pid, provider, secrets)
                for pid, provider in config.providers.items()
            ]
        }

    @api.post("/providers")
    async def create_provider(payload: dict = Body(...)) -> dict[str, Any]:
        provider_id = str(payload.pop("id", "") or "").strip()
        if not provider_id:
            raise HTTPException(status_code=400, detail=tr("provider.id_empty"))
        if "@" in provider_id:
            raise HTTPException(status_code=400, detail=tr("provider.id_at"))

        def mutate(config: Config) -> None:
            if provider_id in config.providers:
                raise HTTPException(status_code=409, detail=tr("provider.exists"))
            config.providers[provider_id] = _validate_provider(payload)

        manager.update(mutate)
        provider = manager.config.providers[provider_id]
        return {"provider": _provider_dict(provider_id, provider, secrets)}

    @api.put("/providers/{provider_id}")
    async def update_provider(provider_id: str, payload: dict = Body(...)) -> dict[str, Any]:
        def mutate(config: Config) -> None:
            existing = config.providers.get(provider_id)
            if existing is None:
                raise HTTPException(status_code=404, detail=tr("provider.not_found"))
            merged = existing.model_dump(mode="json")
            merged.update({k: v for k, v in payload.items() if k != "id"})
            config.providers[provider_id] = _validate_provider(merged)

        manager.update(mutate)
        provider = manager.config.providers[provider_id]
        return {"provider": _provider_dict(provider_id, provider, secrets)}

    @api.delete("/providers/{provider_id}")
    async def delete_provider(
        provider_id: str, cascade: bool = Query(default=False)
    ) -> dict[str, Any]:
        """Delete a provider.

        By default a provider that is still referenced by models is refused,
        so a dangling reference can never be written. With ``?cascade=true``
        the calling models are deleted together with the provider.
        """
        config = manager.config
        if provider_id not in config.providers:
            raise HTTPException(status_code=404, detail=tr("provider.not_found"))
        used_by = [
            mid for mid, model in config.models.items() if model.provider == provider_id
        ]
        if used_by and not cascade:
            raise HTTPException(
                status_code=409,
                detail=(
                    tr("provider.in_use", models=", ".join(used_by))
                ),
            )

        def mutate(cfg: Config) -> None:
            for model_id in used_by:
                cfg.models.pop(model_id, None)
            cfg.providers.pop(provider_id, None)

        manager.update(mutate)
        secrets.clear(provider_id)
        return {"deleted": provider_id, "deleted_models": used_by}

    @api.post("/providers/{provider_id}/duplicate")
    async def duplicate_provider(
        provider_id: str, payload: dict = Body(default_factory=dict)
    ) -> dict[str, Any]:
        config = manager.config
        source = config.providers.get(provider_id)
        if source is None:
            raise HTTPException(status_code=404, detail=tr("provider.not_found"))
        new_id = str(payload.get("id") or f"{provider_id}-copy").strip()
        if new_id in config.providers:
            raise HTTPException(status_code=409, detail=tr("provider.target_exists"))
        data = source.model_dump(mode="json")
        data["display_name"] = f"{source.display_name} (copy)"

        def mutate(cfg: Config) -> None:
            cfg.providers[new_id] = _validate_provider(data)

        manager.update(mutate)
        provider = manager.config.providers[new_id]
        return {"provider": _provider_dict(new_id, provider, secrets)}

    @api.post("/providers/{provider_id}/test")
    async def test_provider(provider_id: str) -> dict[str, Any]:
        config = manager.config
        provider = config.providers.get(provider_id)
        if provider is None:
            raise HTTPException(status_code=404, detail=tr("provider.not_found"))
        await router.startup()
        return await test_connection(provider, secrets, provider_id, router.client)

    @api.put("/providers/{provider_id}/key")
    async def set_provider_key(
        provider_id: str, payload: dict = Body(...)
    ) -> dict[str, Any]:
        """Set a provider's API key.

        ``persist=true`` saves it to the local key file so it survives restarts
        (this is the "enter it once" option). ``persist=false`` keeps it only in
        process memory for the current session.
        """
        provider = manager.config.providers.get(provider_id)
        if provider is None:
            raise HTTPException(status_code=404, detail=tr("provider.not_found"))
        key = str(payload.get("api_key") or "")
        persist = bool(payload.get("persist"))
        if persist:
            secrets.set_persistent(provider_id, key)
            # A saved local key is the effective one now; drop any session key.
            secrets.clear_temporary(provider_id)
        else:
            secrets.set_temporary(provider_id, key)
        return {
            "provider": provider_id,
            "key_status": secrets.status(provider_id, provider.api_key_env),
        }

    @api.delete("/providers/{provider_id}/key")
    async def clear_provider_key(provider_id: str) -> dict[str, Any]:
        """Forget a provider's key (both the session key and the saved local one)."""
        secrets.clear(provider_id)
        provider = manager.config.providers.get(provider_id)
        api_key_env = provider.api_key_env if provider else None
        return {
            "provider": provider_id,
            "key_status": secrets.status(provider_id, api_key_env),
        }

    # Backwards-compatible aliases for the original temporary-only endpoints.
    @api.put("/providers/{provider_id}/temporary-key")
    async def set_temporary_key(provider_id: str, payload: dict = Body(...)) -> dict[str, Any]:
        if provider_id not in manager.config.providers:
            raise HTTPException(status_code=404, detail=tr("provider.not_found"))
        key = payload.get("api_key") or ""
        secrets.set_temporary(provider_id, str(key))
        return {
            "provider": provider_id,
            "temporary_key_active": secrets.has_temporary(provider_id),
        }

    @api.delete("/providers/{provider_id}/temporary-key")
    async def clear_temporary_key(provider_id: str) -> dict[str, Any]:
        secrets.clear_temporary(provider_id)
        return {"provider": provider_id, "temporary_key_active": False}

    # -- models ----------------------------------------------------------

    @api.get("/models")
    async def list_models_endpoint() -> dict[str, Any]:
        config = manager.config
        return {
            "models": [
                _model_dict(mid, model, config) for mid, model in config.models.items()
            ],
            "virtual_models": config.virtual_model_ids(),
        }

    @api.post("/models")
    async def create_model(payload: dict = Body(...)) -> dict[str, Any]:
        model_id = str(payload.pop("id", "") or "").strip()
        if not model_id:
            raise HTTPException(status_code=400, detail=tr("model.id_empty"))
        if "@" in model_id:
            raise HTTPException(status_code=400, detail=tr("model.id_at"))

        def mutate(config: Config) -> None:
            if model_id in config.models:
                raise HTTPException(status_code=409, detail=tr("model.exists"))
            config.models[model_id] = _validate_model(payload, config)

        manager.update(mutate)
        return {
            "model": _model_dict(model_id, manager.config.models[model_id], manager.config)
        }

    @api.put("/models/{model_id}")
    async def update_model(model_id: str, payload: dict = Body(...)) -> dict[str, Any]:
        def mutate(config: Config) -> None:
            existing = config.models.get(model_id)
            if existing is None:
                raise HTTPException(status_code=404, detail=tr("model.not_found"))
            merged = existing.model_dump(mode="json")
            merged.update({k: v for k, v in payload.items() if k != "id"})
            config.models[model_id] = _validate_model(merged, config)

        manager.update(mutate)
        return {
            "model": _model_dict(model_id, manager.config.models[model_id], manager.config)
        }

    @api.delete("/models/{model_id}")
    async def delete_model(model_id: str) -> dict[str, Any]:
        def mutate(config: Config) -> None:
            if model_id not in config.models:
                raise HTTPException(status_code=404, detail=tr("model.not_found"))
            del config.models[model_id]

        manager.update(mutate)
        return {"deleted": model_id}

    @api.post("/models/{model_id}/duplicate")
    async def duplicate_model(
        model_id: str, payload: dict = Body(default_factory=dict)
    ) -> dict[str, Any]:
        config = manager.config
        source = config.models.get(model_id)
        if source is None:
            raise HTTPException(status_code=404, detail=tr("model.not_found"))
        new_id = str(payload.get("id") or f"{model_id}-copy").strip()
        if new_id in config.models:
            raise HTTPException(status_code=409, detail=tr("model.target_exists"))
        data = source.model_dump(mode="json")
        data["display_name"] = f"{source.display_name} (copy)"

        def mutate(cfg: Config) -> None:
            cfg.models[new_id] = _validate_model(data, cfg)

        manager.update(mutate)
        return {
            "model": _model_dict(new_id, manager.config.models[new_id], manager.config)
        }

    @api.post("/models/{model_id}/test")
    async def test_model(model_id: str, payload: dict = Body(default_factory=dict)) -> dict[str, Any]:
        manager.maybe_reload()
        model = manager.config.models.get(model_id)
        if model is None:
            raise HTTPException(status_code=404, detail=tr("model.not_found"))
        provider = manager.config.providers.get(model.provider)
        if provider is None:
            raise HTTPException(status_code=409, detail=tr("model.provider_not_found"))
        await router.startup()
        result = await test_connection(provider, secrets, model.provider, router.client)
        result["model"] = model_id
        result["upstream_model"] = model.upstream_model
        return result

    @api.get("/models/{model_id}/virtual")
    async def virtual_models(model_id: str) -> dict[str, Any]:
        config = manager.config
        model = config.models.get(model_id)
        if model is None:
            raise HTTPException(status_code=404, detail=tr("model.not_found"))
        virtual = [model_id]
        if model.reasoning and model.reasoning.supported:
            virtual += [f"{model_id}@{lvl}" for lvl in model.reasoning.supported]
        return {"virtual_models": virtual}

    # -- request preview -------------------------------------------------

    @api.post("/preview")
    async def preview(payload: dict = Body(...)) -> dict[str, Any]:
        model = payload.get("model")
        body = payload.get("body") or payload.get("input")
        if not model:
            raise HTTPException(status_code=400, detail=tr("request.model_required"))
        if isinstance(body, str):
            body = {"model": model, "input": body}
        elif body is None:
            body = {"model": model}
        else:
            body = dict(body)
            body.setdefault("model", model)
        try:
            return router.preview(model, body)
        except GatewayError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.to_dict()) from exc

    # -- reasoning level comparison --------------------------------------

    @api.post("/compare")
    async def compare_levels(payload: dict = Body(...)) -> StreamingResponse:
        """Run one prompt across several reasoning levels of a model.

        Streams NDJSON: one ``{"type": "result", ...}`` line per level as it
        finishes, then ``{"type": "done"}``. This is a real (billable) call per
        level — the UI labels it as such.
        """
        manager.maybe_reload()
        model_id = str(payload.get("model") or "").strip()
        if not model_id:
            raise HTTPException(status_code=400, detail=tr("request.model_required"))
        # Accept a virtual id (``foo@max``) as well: the comparison always
        # spans the model's levels, so the alias part is dropped.
        model_id = model_id.split("@", 1)[0]

        body = payload.get("body")
        if body is None:
            body = {}
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail=tr("app.body_not_object"))

        try:
            levels = select_levels(router, model_id, payload.get("levels"))
        except GatewayError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.to_dict()) from exc

        stream = bool(payload.get("stream"))
        await router.startup()

        async def events() -> AsyncIterator[bytes]:
            yield _ndjson({"type": "started", "model": model_id, "levels": levels})
            count = 0
            async for result in run_comparison(
                router, model_id, levels, body, stream=stream
            ):
                count += 1
                yield _ndjson({"type": "result", **result})
            yield _ndjson({"type": "done", "model": model_id, "count": count})

        return StreamingResponse(
            events(),
            media_type="application/x-ndjson",
            headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
        )

    # -- configuration ---------------------------------------------------

    @api.get("/config")
    async def get_config() -> dict[str, Any]:
        return {
            "yaml": manager.config.to_yaml(),
            "path": str(manager.path),
            "valid": manager.load_error is None,
            "error": manager.load_error,
        }

    @api.post("/config/validate")
    async def validate_config(payload: dict = Body(...)) -> dict[str, Any]:
        text = payload.get("yaml")
        if text is None:
            raise HTTPException(status_code=400, detail=tr("request.yaml_required"))
        try:
            new_config = load_config_text(text)
        except ConfigError as exc:
            return {"valid": False, "error": str(exc)}
        return {
            "valid": True,
            "diff": _config_diff(manager.config, new_config),
            "config": new_config.to_dict(),
        }

    @api.put("/config")
    async def save_config(payload: dict = Body(...)) -> dict[str, Any]:
        text = payload.get("yaml")
        if text is None:
            raise HTTPException(status_code=400, detail=tr("request.yaml_required"))
        try:
            new_config = load_config_text(text)
        except ConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        # Only validated configs are written (atomic replace).
        manager.save_config(new_config)
        return {"saved": True, "providers": len(new_config.providers), "models": len(new_config.models)}

    @api.post("/config/reload")
    async def reload_config() -> dict[str, Any]:
        try:
            manager.reload()
        except ConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"reloaded": True, "loaded_at": manager.loaded_at}

    @api.get("/config/download")
    async def download_config() -> Response:
        return PlainTextResponse(
            manager.config.to_yaml(),
            media_type="application/x-yaml",
            headers={
                "content-disposition": 'attachment; filename="config.yaml"',
                "cache-control": NO_STORE,
            },
        )

    @api.post("/config/upload")
    async def upload_config(payload: dict = Body(...)) -> dict[str, Any]:
        text = payload.get("yaml")
        if text is None:
            raise HTTPException(status_code=400, detail=tr("request.yaml_required"))
        try:
            new_config = load_config_text(text)
        except ConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "valid": True,
            "diff": _config_diff(manager.config, new_config),
            "yaml": new_config.to_yaml(),
        }

    @api.post("/config/reset-example")
    async def reset_example() -> dict[str, Any]:
        example = Path(manager.path).parent / "config.example.yaml"
        if not example.exists():
            raise HTTPException(status_code=404, detail=tr("config.example_not_found"))
        manager.save_text(example.read_text(encoding="utf-8"))
        return {"reset": True}

    # -- full backup (config + saved keys in one file) --------------------

    @api.get("/config/bundle")
    async def export_bundle(include_keys: bool = Query(default=True)) -> Response:
        """Download one file containing the configuration and saved keys.

        This is the "carry it to another machine" file. It holds plaintext
        credentials, so it must be stored somewhere private.
        """
        config = manager.config
        keys = (
            secrets.export_keys(only_providers=set(config.providers))
            if include_keys
            else {}
        )
        payload = {
            "format": BUNDLE_FORMAT,
            "version": BUNDLE_VERSION,
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "config": config.to_dict(),
            "keys": keys,
        }
        return Response(
            content=json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            media_type="application/json",
            headers={
                "content-disposition": 'attachment; filename="zumg-backup.json"',
                "cache-control": NO_STORE,
            },
        )

    @api.post("/config/bundle")
    async def import_bundle(payload: dict = Body(...)) -> dict[str, Any]:
        """Restore a backup created by :func:`export_bundle`.

        The configuration replaces the active one (after validation); keys are
        merged so providers that only exist on this machine keep their key.
        """
        if payload.get("format") != BUNDLE_FORMAT:
            raise HTTPException(
                status_code=400,
                detail=tr("bundle.bad_format"),
            )
        config_data = payload.get("config")
        if not isinstance(config_data, dict):
            raise HTTPException(status_code=400, detail=tr("bundle.no_config"))

        previous = manager.config
        try:
            new_config = parse_config(config_data)
        except ConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        keys = payload.get("keys") or {}
        if not isinstance(keys, dict):
            raise HTTPException(status_code=400, detail=tr("bundle.bad_keys"))

        # Validate keys belong to providers that exist in the restored config,
        # so a hand-edited backup cannot introduce orphaned credentials.
        unknown = [pid for pid in keys if pid not in new_config.providers]
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=tr("bundle.foreign_keys", providers=", ".join(map(str, unknown))),
            )

        manager.save_config(new_config)
        written = secrets.import_keys(keys)
        return {
            "imported": True,
            "providers": len(new_config.providers),
            "models": len(new_config.models),
            "keys_restored": written,
            "diff": _config_diff(previous, new_config),
        }

    return api


# -- validation helpers --------------------------------------------------


def _validate_provider(data: dict) -> ProviderConfig:
    try:
        return ProviderConfig.model_validate(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=tr("provider.invalid_config", error=exc)) from exc


def _validate_model(data: dict, config: Config) -> ModelConfig:
    provider = data.get("provider")
    if provider and provider not in config.providers:
        raise HTTPException(
            status_code=400, detail=tr("provider.unknown", provider=provider)
        )
    try:
        return ModelConfig.model_validate(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=tr("model.invalid_config", error=exc)) from exc
