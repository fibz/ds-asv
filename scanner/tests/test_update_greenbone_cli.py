"""scripts/update_greenbone.py — fixture runs, atomic-write safety."""

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "update_greenbone.py"
FIXTURE = Path(__file__).parent / "fixtures" / "gmp_get_nvts.xml"


def _run(*args, env_extra=None):
    env = {"PATH": "/usr/bin:/bin"}
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        env={**env},
    )


def test_cli_builds_cache_from_xml_fixture(tmp_path):
    out = tmp_path / "greenbone_cves.json"
    proc = _run("--gmp-xml", str(FIXTURE), "--out", str(out))
    assert proc.returncode == 0, proc.stderr
    cache = json.loads(out.read_text(encoding="utf-8"))
    assert "openssl:3.0.1" in cache["versioned"]
    assert "nginx:" in cache["versioned"]


def test_cli_writes_to_default_env_path(tmp_path):
    out = tmp_path / "env_cache.json"
    proc = _run(
        "--gmp-xml",
        str(FIXTURE),
        env_extra={"GREENBONE_FEED_PATH": str(out)},
    )
    assert proc.returncode == 0, proc.stderr
    assert out.exists()


def test_cli_rejects_empty_export_and_keeps_last_good(tmp_path):
    good = tmp_path / "good.json"
    proc = _run("--gmp-xml", str(FIXTURE), "--out", str(good))
    assert proc.returncode == 0
    before = good.read_bytes()

    empty = tmp_path / "empty.xml"
    empty.write_text(
        '<get_nvts_response status="200" status_text="OK"/>\n', encoding="utf-8"
    )
    proc = _run("--gmp-xml", str(empty), "--out", str(good))
    assert proc.returncode != 0
    assert good.read_bytes() == before  # never clobbered


def test_cli_rejects_missing_xml_file(tmp_path):
    out = tmp_path / "x.json"
    proc = _run("--gmp-xml", str(tmp_path / "nope.xml"), "--out", str(out))
    assert proc.returncode != 0
    assert not out.exists()


def _load_module():
    """Import scripts/update_greenbone.py in-process (no live gvmd needed)."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("update_greenbone", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_ssh_kwargs_defaults_only_host_and_port(monkeypatch):
    for var in (
        "GREENBONE_HOST",
        "GREENBONE_PORT",
        "GREENBONE_SSH_USER",
        "GREENBONE_SSH_PASSWORD",
        "GREENBONE_SSH_AUTO_ACCEPT",
    ):
        monkeypatch.delenv(var, raising=False)
    assert _load_module()._ssh_kwargs() == {"hostname": "127.0.0.1", "port": 22}


def test_ssh_kwargs_full_env_mapping(monkeypatch):
    monkeypatch.setenv("GREENBONE_HOST", "10.0.0.5")
    monkeypatch.setenv("GREENBONE_PORT", "2222")
    monkeypatch.setenv("GREENBONE_SSH_USER", "kali")
    monkeypatch.setenv("GREENBONE_SSH_PASSWORD", "hunter2")
    monkeypatch.setenv("GREENBONE_SSH_AUTO_ACCEPT", "1")
    assert _load_module()._ssh_kwargs() == {
        "hostname": "10.0.0.5",
        "port": 2222,
        "username": "kali",
        "password": "hunter2",
        "auto_accept_host": True,
    }


def test_ssh_kwargs_auto_accept_falsy_is_omitted(monkeypatch):
    monkeypatch.setenv("GREENBONE_SSH_USER", "kali")
    monkeypatch.setenv("GREENBONE_SSH_AUTO_ACCEPT", "0")
    kwargs = _load_module()._ssh_kwargs()
    assert kwargs["username"] == "kali"
    assert "auto_accept_host" not in kwargs


def test_connection_type_defaults_to_ssh(monkeypatch):
    monkeypatch.delenv("GREENBONE_CONNECTION", raising=False)
    assert _load_module()._connection_type() == "ssh"


def test_connection_type_honors_env(monkeypatch):
    mod = _load_module()
    monkeypatch.setenv("GREENBONE_CONNECTION", "tcp")
    assert mod._connection_type() == "tcp"
    monkeypatch.setenv("GREENBONE_CONNECTION", "unix")
    assert mod._connection_type() == "unix"


def test_connection_type_rejects_unknown(monkeypatch):
    monkeypatch.setenv("GREENBONE_CONNECTION", "carrier-pigeon")
    try:
        _load_module()._connection_type()
        raise AssertionError("expected SystemExit for unknown connection type")
    except SystemExit as exc:
        assert "GREENBONE_CONNECTION" in str(exc)


def test_tcp_connection_from_env(monkeypatch):
    monkeypatch.setenv("GREENBONE_CONNECTION", "tcp")
    monkeypatch.setenv("GREENBONE_HOST", "127.0.0.1")
    monkeypatch.setenv("GREENBONE_PORT", "19390")
    conn = _load_module()._connection()
    assert conn.__class__.__name__ == "TCPConnection"
    assert (conn.host, conn.port) == ("127.0.0.1", 19390)


def test_unix_connection_from_env(monkeypatch):
    monkeypatch.setenv("GREENBONE_CONNECTION", "unix")
    monkeypatch.setenv("GREENBONE_SOCKET", "/tmp/gvmd.sock")
    conn = _load_module()._connection()
    assert conn.__class__.__name__ == "UnixSocketConnection"
    assert conn.path == "/tmp/gvmd.sock"


def test_load_config_missing_file_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setenv("GREENBONE_CONFIG", str(tmp_path / "nope.env"))
    assert _load_module()._load_config() == {}


def test_load_config_sets_defaults_without_overriding_env(monkeypatch, tmp_path):
    cfg = tmp_path / "gb.env"
    cfg.write_text(
        "# a comment\n"
        "GREENBONE_HOST=10.0.0.9\n"
        "GREENBONE_PORT=2222\n"
        "GREENBONE_SSH_USER=from-config\n"
        "GREENBONE_SSH_PASSWORD=cfg-pass\n\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GREENBONE_CONFIG", str(cfg))
    monkeypatch.setenv("GREENBONE_SSH_USER", "from-real-env")
    mod = _load_module()
    loaded = mod._load_config()
    assert loaded == {
        "GREENBONE_HOST": "10.0.0.9",
        "GREENBONE_PORT": "2222",
        "GREENBONE_SSH_USER": "from-config",
        "GREENBONE_SSH_PASSWORD": "cfg-pass",
    }
    assert os.environ["GREENBONE_HOST"] == "10.0.0.9"
    assert os.environ["GREENBONE_PORT"] == "2222"
    assert os.environ["GREENBONE_SSH_USER"] == "from-real-env"  # env wins
    assert os.environ["GREENBONE_SSH_PASSWORD"] == "cfg-pass"


def test_cli_uses_config_defaults_for_feed_path(tmp_path, monkeypatch):
    cfg = tmp_path / "gb.env"
    cfg.write_text(
        f"GREENBONE_FEED_PATH={tmp_path / 'from-config.json'}\n", encoding="utf-8"
    )
    monkeypatch.setenv("GREENBONE_CONFIG", str(cfg))
    # Pass GREENBONE_CONFIG explicitly: _run builds a minimal env, so the
    # subprocess must not fall back to the REAL scanner/greenbone.env.
    proc = _run("--gmp-xml", str(FIXTURE), env_extra={"GREENBONE_CONFIG": str(cfg)})
    assert proc.returncode == 0, proc.stderr
    assert (tmp_path / "from-config.json").exists()
