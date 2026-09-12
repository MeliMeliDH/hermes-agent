"""Tests for hermes -z --usage-file (per-run JSON usage report)."""

import json
import os

from hermes_cli import oneshot
from hermes_cli.oneshot import _write_usage_file


def _result(**overrides):
    base = {
        "estimated_cost_usd": 0.1234,
        "cost_status": "estimated",
        "cost_source": "pricing-table",
        "input_tokens": 1000,
        "output_tokens": 200,
        "cache_read_tokens": 800,
        "cache_write_tokens": 0,
        "reasoning_tokens": 50,
        "total_tokens": 1250,
        "api_calls": 3,
        "model": "openai/gpt-5.5",
        "provider": "openrouter",
        "session_id": "abc123",
        "completed": True,
        "failed": False,
    }
    base.update(overrides)
    return base


class TestWriteUsageFile:
    def test_writes_report_with_cost_and_tokens(self, tmp_path):
        path = tmp_path / "usage.json"
        _write_usage_file(str(path), _result())
        report = json.loads(path.read_text())
        assert report["estimated_cost_usd"] == 0.1234
        assert report["input_tokens"] == 1000
        assert report["output_tokens"] == 200
        assert report["model"] == "openai/gpt-5.5"
        assert report["api_calls"] == 3
        assert report["failed"] is False
        assert "failure" not in report

    def test_none_path_is_noop(self, tmp_path):
        # Must not raise and must not create a report file.
        _write_usage_file(None, _result())
        assert not (tmp_path / "usage.json").exists()

    def test_failure_marks_failed_and_records_message(self, tmp_path):
        path = tmp_path / "usage.json"
        _write_usage_file(str(path), {}, failure="boom")
        report = json.loads(path.read_text())
        assert report["failed"] is True
        assert report["failure"] == "boom"
        # Missing result fields serialize as null, not KeyError.
        assert report["estimated_cost_usd"] is None


class TestRunOneshotExitStatus:
    def test_failed_result_with_visible_error_is_nonzero(self, monkeypatch, tmp_path, capsys):
        usage_path = tmp_path / "usage.json"
        failed = {
            "failed": True,
            "completed": False,
            "api_calls": 1,
            "final_response": "API call failed after retries",
        }
        monkeypatch.setattr(oneshot, "_run_agent", lambda *args, **kwargs: (failed["final_response"], failed))

        rc = oneshot.run_oneshot("probe", usage_file=str(usage_path))

        assert rc == 2
        assert capsys.readouterr().out == "API call failed after retries\n"
        assert json.loads(usage_path.read_text())["failed"] is True


class TestRunOneshotWorkspaceBinding:
    def test_run_agent_binds_and_clears_task_cwd(self, monkeypatch):
        import hermes_cli.config as config_mod
        import hermes_cli.mcp_startup as mcp_startup
        import hermes_cli.runtime_provider as runtime_provider
        import hermes_cli.tools_config as tools_config
        import run_agent
        import tools.terminal_tool as terminal_tool

        events = []

        class FakeAgent:
            session_id = "oneshot-session"

            def __init__(self, **kwargs):
                self.suppress_status_output = False
                self.stream_delta_callback = object()
                self.tool_gen_callback = object()

            def run_conversation(self, prompt, task_id=None):
                events.append(("run", prompt, task_id))
                return {"final_response": "done", "completed": True}

        monkeypatch.setattr(config_mod, "load_config", lambda: {"model": {"default": "demo", "provider": "custom"}})
        monkeypatch.setattr(runtime_provider, "resolve_runtime_provider", lambda **kwargs: {"provider": "custom"})
        monkeypatch.setattr(tools_config, "_get_platform_tools", lambda cfg, platform: set())
        monkeypatch.setattr(mcp_startup, "ensure_mcp_discovery_before_agent_build", lambda **kwargs: None)
        monkeypatch.setattr(run_agent, "AIAgent", FakeAgent)
        monkeypatch.setattr(oneshot, "_create_session_db_for_oneshot", lambda: object())
        monkeypatch.setattr(oneshot, "_build_preloaded_skills_prompt", lambda skills: None)
        monkeypatch.setattr(oneshot, "get_fallback_chain", lambda cfg: [])
        monkeypatch.setattr(oneshot, "_close_agent", lambda agent, db: events.append(("close",)))
        monkeypatch.setattr(
            terminal_tool,
            "register_task_env_overrides",
            lambda task_id, overrides: events.append(("register", task_id, overrides)),
        )
        monkeypatch.setattr(
            terminal_tool,
            "clear_task_env_overrides",
            lambda task_id: events.append(("clear", task_id)),
        )

        response, result = oneshot._run_agent("probe")

        assert response == "done"
        assert result["completed"] is True
        assert events == [
            ("register", "oneshot-session", {"cwd": os.getcwd()}),
            ("run", "probe", "oneshot-session"),
            ("close",),
            ("clear", "oneshot-session"),
        ]
