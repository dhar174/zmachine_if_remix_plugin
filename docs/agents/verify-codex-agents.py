"""Check project roles with a native Codex executable and a loopback mock.

No live model, credentials, integration install, or user configuration is used.
Exit 3 means admission is blocked or requires a full capability audit;
1 means the probe itself failed. This utility never grants admission.
Requires Python 3.11+.
This is contributor configuration tooling, not a game/runtime probe.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import os
import re
import subprocess
import tempfile
import threading
import tomllib


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def advertised_tools(data):
    names = set()
    for item in data.get("input", []):
        for tool in item.get("tools", []):
            for child in tool.get("tools", []):
                names.add(tool["name"] + "." + child["name"])
                if child["name"] == "exec":
                    names.update(re.findall(r"^### `([^`]+)`", child.get("description", ""), re.M))
    return sorted(names)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex-exe", type=Path, required=True)
    parser.add_argument("--scratch-parent", type=Path, required=True,
                        help="Existing non-system-temp directory outside this checkout")
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    binary = args.codex_exe.resolve(strict=True)
    scratch = args.scratch_parent.resolve(strict=True)
    assert binary.suffix.lower() == ".exe", "Use the native executable, never the wrapper"
    assert not scratch.is_relative_to(root), "Scratch must be outside the repository"
    profiles = {}
    hashes = {}
    expected_features = dict.fromkeys(
        ["shell_tool", "apps", "plugins", "memories", "request_permissions_tool"], False)
    for path in sorted((root / ".codex/agents").glob("*.toml")):
        profile = tomllib.loads(path.read_text(encoding="utf-8"))
        assert profile["name"] == path.stem and profile["description"]
        assert profile["features"] == expected_features
        assert set(profile) == {"name", "description", "developer_instructions", "features", "skills"}
        assert profile["skills"] == {"include_instructions": False, "bundled": {"enabled": False}}
        source = root / ".zcode/agents" / (path.stem + ".md")
        _, frontmatter, body = source.read_text(encoding="utf-8").split("---", 2)
        assert json.loads(re.search(r"^name: (.+)$", frontmatter, re.M)[1]) == path.stem
        if path.stem == "zmachine-acceptance-reviewer":
            body = body.replace("`.zcode/agents/*.md`", "`.zcode/agents/*.md`, `.codex/agents/*.toml`")
        assert profile["developer_instructions"].endswith(body.strip() + "\n")
        profiles[path.stem] = profile
        hashes[path.relative_to(root).as_posix()] = fingerprint(path)
        hashes[source.relative_to(root).as_posix()] = fingerprint(source)
    assert len(profiles) == 8
    assert set(profiles) == {p.stem for p in (root / ".zcode/agents").glob("zmachine-*.md")}
    hashes[Path(__file__).resolve().relative_to(root).as_posix()] = fingerprint(Path(__file__))

    requests, finished, server_errors = [], set(), []
    lock = threading.Lock()
    root_sent = False

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            self.send_error(405)

        def do_POST(self):
            nonlocal root_sent
            try:
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                if self.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                data = json.loads(raw)
                is_child = any(i.get("role") == "developer" and "## Codex adapter" in str(i)
                               for i in data["input"])
                role = re.search(r"CHILD_ROLE_PROBE\|([a-z-]+)\|", str(data))[1] if is_child else None
                with lock:
                    serial = len(requests)
                    requests.append((role, data))
                if not is_child and not root_sent:
                    root_sent = True
                    outputs = [{"id": f"fc_{j}", "type": "function_call", "namespace": "collaboration",
                                "name": "spawn_agent", "call_id": f"spawn_{j}",
                                "arguments": json.dumps({"agent_type": name, "fork_turns": "none",
                                    "task_name": f"probe_{j}", "message": f"CHILD_ROLE_PROBE|{name}| "
                                    "Task zirp-config-probe: configuration smoke only. No substantive "
                                    "investigation, writes, shell, network, goal changes, or delegation. "
                                    "The deterministic provider inspects tool presence without calling "
                                    "any mutating tool. This is not independent review."})}
                               for j, name in enumerate(profiles)]
                elif is_child and not any(i.get("type") == "custom_tool_call_output" for i in data["input"]):
                    outputs = [{"id": "inspect_" + role, "type": "custom_tool_call", "namespace": "functions",
                                "name": "exec", "call_id": "inspect_" + role,
                                "input": "text({shell: typeof tools.exec_command, patch: typeof tools.apply_patch, "
                                         "names: ALL_TOOLS.map(x => x.name)});"}]
                elif not is_child and len(finished) < len(profiles):
                    outputs = [{"id": f"wait_{serial}", "type": "function_call", "namespace": "collaboration",
                                "name": "wait_agent", "call_id": f"wait_{serial}",
                                "arguments": '{"timeout_ms":10000}'}]
                else:
                    outputs = [{"id": f"msg_{serial}", "type": "message", "role": "assistant",
                                "status": "completed", "content": [{"type": "output_text",
                                "text": "LOCAL_MOCK_CHILD_COMPLETE" if is_child else "LOCAL_MOCK_ROOT_COMPLETE",
                                "annotations": []}]}]
                events = [{"type": "response.output_item.done", "output_index": j, "item": item}
                          for j, item in enumerate(outputs)]
                events.append({"type": "response.completed", "response": {"id": f"resp_{serial}",
                               "status": "completed", "output": outputs,
                               "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}})
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for event in events:
                    self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
                self.wfile.flush()
                if is_child and outputs[0]["type"] == "message":
                    with lock:
                        finished.add(role)
            except Exception as error:
                server_errors.append(repr(error))

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="zirp-agent-home-", dir=scratch) as home:
            config = f'''model = "gpt-6.1-sol"
model_provider = "probe"
web_search = "disabled"
[model_providers.probe]
name = "Local deterministic agent probe"
base_url = "http://127.0.0.1:{server.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
[features]
multi_agent_v2 = true
hooks = false
shell_snapshot = false
apps = false
plugins = false
memories = false
request_permissions_tool = false
[agents]
max_concurrent_threads_per_session = 8
[skills]
include_instructions = false
[skills.bundled]
enabled = false
[analytics]
enabled = false
[projects.'{str(root)}']
trust_level = "trusted"
'''
            config_path = Path(home) / "config.toml"
            config_path.write_text(config, encoding="utf-8")
            assert config_path.read_text(encoding="utf-8") == config
            env = {k: v for k, v in os.environ.items() if not any(
                term in k.upper() for term in ["TOKEN", "SECRET", "API_KEY", "OPENAI", "CODEX"])}
            env["CODEX_HOME"] = home
            env["NO_PROXY"] = "127.0.0.1,localhost"
            version = subprocess.run([str(binary), "--version"], env=env, capture_output=True,
                                     text=True, encoding="utf-8", timeout=10)
            assert version.returncode == 0 and not version.stderr.strip(), version.stderr
            command = [str(binary), "--no-daemon", "-a", "never", "exec", "--json", "-C", str(root),
                       "-s", "read-only", "CONFIGURATION_PROBE_ONLY: exercise project roles using the loopback mock."]
            result = subprocess.run(command, env=env, input="", capture_output=True,
                                    text=True, encoding="utf-8", timeout=45)
    finally:
        server.shutdown()
        server.server_close()
    # This exact informational line is emitted when the CLI sees redirected stdin.
    assert result.returncode == 0 and result.stderr.strip() in (
        "", "Reading additional input from stdin..."), (result.returncode, result.stderr)
    assert not server_errors, server_errors
    assert finished == set(profiles), "A role exercise did not complete"
    assert "LOCAL_MOCK_ROOT_COMPLETE" in result.stdout
    roles = {}
    for name, profile in profiles.items():
        child_requests = [data for role, data in requests if role == name]
        assert len(child_requests) == 2, (name, "missing tool introspection round trip")
        texts = [part.get("text", "") for item in child_requests[0]["input"]
                 if item.get("role") == "developer" for part in item.get("content", [])]
        assert any(profile["developer_instructions"] in text for text in texts), (name, "instructions mismatch")
        introspections = [part["text"] for item in child_requests[1]["input"]
                          if item.get("type") == "custom_tool_call_output"
                          for part in item["output"] if part.get("type") == "input_text"
                          and part.get("text", "").startswith('{"shell":')]
        assert len(introspections) == 1
        roles[name] = {"mock_invocation_completed": True, "instruction_match": True,
                       "advertised_tools": advertised_tools(child_requests[0]),
                       "runtime_tools": json.loads(introspections[0])}
    unsafe = any(role["runtime_tools"]["shell"] != "undefined"
                 or "apply_patch" in role["runtime_tools"]["names"]
                 or "create_goal" in role["runtime_tools"]["names"]
                 or "update_goal" in role["runtime_tools"]["names"]
                 or any(t.startswith("collaboration.") for t in role["advertised_tools"])
                 for role in roles.values())
    receipt = {"kind": "deterministic-local-codex-configuration-probe",
               "checked_at_utc": datetime.now(timezone.utc).isoformat(), "version": version.stdout.strip(),
               "executable_sha256": fingerprint(binary), "file_sha256": hashes,
               "native_exit": result.returncode, "native_stderr": result.stderr,
               "static_profile_checks": "passed", "roles": roles,
               "admission": "blocked" if unsafe else "requires-read-tool-and-parent-capability-audit",
               "independent_review": "not performed", "live_model_behavior": "not tested"}
    value = json.dumps(receipt, indent=2) + "\n"
    args.receipt.write_text(value, encoding="utf-8", newline="\n")
    assert args.receipt.read_text(encoding="utf-8") == value
    print(f"Static checks: 8/8; mock role invocation: {len(roles)}/8; native exit: {result.returncode}")
    print("Admission: " + receipt["admission"])
    # Never report a pass from absence of the specific forbidden names checked above.
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
