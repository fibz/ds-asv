"""scripts/update_greenbone.py — fixture runs, atomic-write safety."""

import json
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
