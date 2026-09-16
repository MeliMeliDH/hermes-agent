"""session.create must resolve `info.model` against the SELECTED profile's config,
not the caller's ambient one (chat-web #87 bug: banner showed the caller's Claude
model even when `profile=ollamaworker` was passed and correctly bound `profile_home`).

`_resolve_model()` reads config via `_load_cfg()` -> `_active_config_path()`, which is
keyed off the ambient HERMES_HOME override (`get_hermes_home_override()`), NOT off a
per-call param. The fix wraps the read in `_profile_build_scope(profile_home)`, the
same context manager already used to bind HERMES_HOME for the async agent build, so
`session.create`'s response reflects the just-selected profile's config synchronously.

Every test drives the real JSON-RPC entry point (`server.handle_request`), same
pattern as `test_session_profile_db.py`, since handler bodies are rebound onto
`server.py`'s globals by `method_ctx.HandlerRegistry.install()` and calling them
directly would bypass the path the gateway actually executes.

NOTE: `server._hermes_home` is a module-global baked in at first import, not re-read
from the HERMES_HOME env var per test — `monkeypatch.setenv` alone does not affect it
once the module is already imported in this test process (see
`test_profile_target_unavailable.py` for the same pattern). Both `_hermes_home` AND
the env var must be patched for `_active_config_path()`'s default-branch to see the
per-test tmp_path.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import yaml


@pytest.fixture()
def hermes_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    (home / "config.yaml").write_text(yaml.safe_dump({"model": {"default": "claude-sonnet-5", "provider": "anthropic"}}))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    yield home


@pytest.fixture()
def other_profile_home(tmp_path):
    profile_home = tmp_path / "profiles" / "ollamaworker"
    profile_home.mkdir(parents=True)
    (profile_home / "config.yaml").write_text(
        yaml.safe_dump({"model": {"default": "meituan/longcat-2.0:free", "provider": "nous"}})
    )
    return profile_home


@pytest.fixture()
def server(hermes_home, monkeypatch):
    with patch.dict(
        "sys.modules",
        {
            "hermes_cli.env_loader": MagicMock(),
            "hermes_cli.banner": MagicMock(),
        },
    ):
        mod = importlib.import_module("tui_gateway.server")

    # `_hermes_home` is a module-global resolved at first import; re-point it at this
    # test's tmp_path so `_active_config_path()`'s no-override branch reads OUR config.
    monkeypatch.setattr(mod, "_hermes_home", hermes_home)

    methods = dict(mod._methods)
    yield mod
    mod._methods.clear()
    mod._methods.update(methods)
    mod._sessions.clear()
    mod._pending.clear()
    mod._answers.clear()
    mod._db = None
    mod._cfg_cache = None
    mod._cfg_mtime = None
    mod._cfg_path = None


def _rpc(server, method, params):
    return server.handle_request({"id": "1", "method": method, "params": params})


def test_session_create_default_profile_resolves_own_model(server, hermes_home):
    """Sanity baseline: no `profile` param -> the launch/default profile's config.yaml."""
    response = _rpc(server, "session.create", {"cols": 96, "source": "chat-web"})
    assert response["result"]["info"]["model"] == "claude-sonnet-5"


def test_session_create_other_profile_resolves_that_profiles_model(server, hermes_home, other_profile_home, monkeypatch):
    """The actual bug: session.create(profile='ollamaworker') must return LongCat's model,
    not the caller's ambient claude-sonnet-5 — even though the async agent build (which
    binds HERMES_HOME properly) hasn't run yet at response time."""
    monkeypatch.setattr(server, "_profile_home", lambda profile: other_profile_home if profile == "ollamaworker" else None)
    response = _rpc(server, "session.create", {"cols": 96, "profile": "ollamaworker", "source": "chat-web"})
    assert response["result"]["info"]["model"] == "meituan/longcat-2.0:free"


def test_session_create_reverts_ambient_home_after_profile_read(server, hermes_home, other_profile_home, monkeypatch):
    """The profile-scoped read must not leak: a SUBSEQUENT default-profile session.create
    in the same process must still resolve the launch profile's own model afterward."""
    monkeypatch.setattr(server, "_profile_home", lambda profile: other_profile_home if profile == "ollamaworker" else None)
    _rpc(server, "session.create", {"cols": 96, "profile": "ollamaworker", "source": "chat-web"})
    response = _rpc(server, "session.create", {"cols": 96, "source": "chat-web"})
    assert response["result"]["info"]["model"] == "claude-sonnet-5"
