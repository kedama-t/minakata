# MCP Server Diagnostic Workflow — Worked Examples

> **Config location note**: Hermes v2 stores profile-specific MCP server configs at `~/.hermes/profiles/<profile>/config.yaml`, NOT in the global `~/.hermes/config.yaml`. Use `$HERMES_PROFILE` to determine the active profile.

## Example A: Missing CLI subcommand

This example captures a real diagnostic session where the Minakata MCP server was unreachable (`Process exited with code 1`). Use this as a template when diagnosing similar MCP server failures.

## Failure Signature

```
MCP server 'minakata' is unreachable after 39 consecutive failures.
Auto-retry available in ~59s.
```

`hermes doctor` reports:
```
[!] Connection to minakata failed.
    Details: Stdio transport failed to initialize.
    Command: uvx minakata-mcp
    Error: Process exited with code 1
```

## Diagnostic Steps (in order)

### 1. Check MCP server list
```
hermes mcp list
```
→ Shows `minakata (status: unreachable)` and `filesystem (status: reachable)`.
   Other servers working → MCP infrastructure itself is healthy.

### 2. Check config
```yaml
mcp_servers:
  minakata:
    command: "uvx"
    args: ["minakata-mcp"]
    transport: "stdio"
    env:
      MCP_CONFIG_PATH: "/root/.minakata/config.json"
```

### 3. Verify binary exists
```
command -v uvx
```
→ `/root/.local/bin/uvx` ✅

### 4. Run the command directly (KEY STEP)
```
uvx minakata-mcp 2>&1
```
Output:
```
Usage: minakata-mcp [OPTIONS] COMMAND [ARGS]...
Error: Missing command.
```
**Diagnosis**: The CLI requires a subcommand! `uvx minakata-mcp` alone isn't enough.

### 5. Check available subcommands
```
uvx minakata-mcp --help 2>&1
```
Output:
```
Minakata-MCP: MCP server for Math Academy
Usage: minakata-mcp <COMMAND>
Commands:
  start   Start the MCP server
  auth    Authenticate with Math Academy
  check   Check authentication status
  help    Print this message
```
→ `start` is the subcommand for running the MCP server.

### 6. Check start subcommand options
```
uvx minakata-mcp start --help 2>&1
```
Output:
```
Usage: minakata-mcp start [OPTIONS] [CONFIG_FILE]
Options:
  --config TEXT            Path to configuration file.
  --log-level TEXT         Set the logging level.
  --host TEXT              Host to bind. Default: 0.0.0.0.
  --port INTEGER           Port to bind. Default: 8000.
  --transport [stdio|sse]  Transport protocol. Default: stdio.
```
→ `--transport stdio` is the correct option for Hermes integration.

### 7. Check if config env-var paths exist
```
ls -la /root/.minakata/config.json
```
→ `ls: cannot access: No such file or directory`

Create a stub:
```
mkdir -p /root/.minakata/
echo '{"mcpServers":{}}' > /root/.minakata/config.json
```

### 8. Check package resolution
```
uv tool install minakata-mcp 2>&1
# or
uvx --from minakata-mcp python --version 2>&1
```
→ `error: Distribution minakata-mcp could not be resolved`

But `uvx minakata-mcp --help` works fine! This means the package is distributed through a non-PyPI channel (uvx's fallback resolution, possibly GitHub releases for Rust binaries).

### 9. Root cause identified
Config `args: ["minakata-mcp"]` should be `args: ["minakata-mcp", "start", "--transport", "stdio"]`.

### 10. In-process recovery limitation
Even after fixing config.yaml, the current agent session's MCP client is already initialized with the broken config. The in-process client and `hermes mcp CLI` maintain **separate** connection state — CLI operations (`mcp refresh`, `mcp restart`) do NOT propagate to the running agent.

**Fix takes effect on next agent process start** (next cron job tick, or restart).

## Quick Reference: Common `Process exited with code 1` Causes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Error: Missing command.` | CLI tool needs subcommand | Add subcommand to `args` in config.yaml |
| `Distribution could not be resolved` | Package not on PyPI | Use `uvx <package>` form (not `--from` or `tool install`) |
| `No such file or directory (os error 2)` for `uvx <package>` BUT `uvx --from <package> python --version` succeeds | uv tool shim missing — package IS installed but the executable shim in `$(uv tool dir)/<package>/bin/` wasn't created | `uv tool install <package> --force` to regenerate shim; verify with `ls -la $(uv tool dir)/<package>/bin/` |
| `No such file or directory` for config path | Env-var config file missing | Create the directory and stub config |
| Works at shell but not in Hermes | PATH difference in cron/systemd | Use absolute path in `command` (e.g., `/root/.local/bin/uvx`) |

## Quick Reference: Diagnostic Branching

| `hermes mcp list` shows | Scenario | Next Step |
|-------------------------|----------|-----------|
| Server NOT listed at all | Server not configured | Trace tool origin via `find ~/.hermes -name "*.yaml" \| xargs grep -l minakata`; check `plugins/mcp.yaml` and `skills/` for stubs; also check `skill_definitions.yaml` for channel-based MCP config |
| Server listed with status `unreachable` / `error` | Configured but broken | Run the command directly (`uvx <package> --help`), probe with JSON-RPC initialize |

## Example C: Server not configured at all (tools are skill stubs)

### Failure Signature

```
MCP server 'minakata' is not connected
```

`hermes mcp list`:
```
MCP Server          Status  Command
filesystem          ✅    uvx mcp-server-filesystem
brave-search        ✅    npx -y @anthropic/mcp-server-brave-search
```
→ **No `minakata` entry at all.** The server is entirely absent from config.

Yet the agent's tool list shows `mcp_minakata_minakata_poll_messages`, `mcp_minakata_minakata_fulltext_search`, etc.

### Diagnostic Steps

#### 1. Confirm server absence
```
hermes mcp list
```
→ Minakata not listed → **Branch A: not configured**.

#### 2. Trace tool origin
```bash
find /root/.hermes -type f -exec grep -l "minakata" {} \; 2>/dev/null
```
→ Shows which files reference minakata:
```
/root/.hermes/profiles/default/skills/300-local/minakata.yaml
```

#### 3. Inspect the source file
```bash
cat /root/.hermes/profiles/default/skills/300-local/minakata.yaml
```
→ If the file contains only static `tools:` definitions (not MCP server config), these are **skill stubs** — tool signatures without a backing server.

```yaml
name: minakata
type: skill
tools:
  - name: mandala_get_segment
    description: ...
    input_schema: ...
```

#### 4. Check MCP plugin config
```bash
cat /root/.hermes/profiles/default/plugins/mcp.yaml 2>/dev/null || echo "no mcp.yaml"
```
→ If the `servers:` array does NOT include `minakata`, the server is definitively unconfigured.

#### 5. Diagnosis
**Root cause**: Minakata MCP server is not configured in the active profile's `plugins/mcp.yaml` or `config.yaml`. The `mcp_minakata_*` tools visible to the agent originate from a local skill definition that provides only tool signatures, not an actual MCP server connection.

**Resolution**: Either:
- Add the server definition to `plugins/mcp.yaml` (if the correct package/subcommand is known)
- Remove the diagnostic cron job if the server is not intended to run on this host

### Lessons
1. **MCP tool stubs can appear from skill definitions**, making it look like a server is available when it isn't. Always cross-reference with `hermes mcp list`.
2. The config can live in multiple places: `plugins/mcp.yaml`, profile `config.yaml` as inline `mcp.servers`, or profile `config.yaml` as `plugins.mcp.servers`. Check all of them.
3. `hermes mcp list` is the authoritative source for what MCP servers are actually configured. If it doesn't show the server, the fix is adding config — not debugging command paths.

## Example B: Wrong command binary path

### Failure Signature

```
MCP server 'minakata' is unreachable after 41 consecutive failures.
Auto-retry available in ~56s.
```

`poll_messages` returns:
```
{"error": "MCP server 'minakata' is not connected"}
```

### Diagnostic Steps

#### 1. Identify the active profile
```
echo $HERMES_PROFILE
→ default
```

#### 2. Read the profile's MCP config (NOT global config)
```bash
cat ~/.hermes/profiles/default/config.yaml
```
→
```yaml
name: "default"
mcp_servers:
  minakata:
    type: stdio
    command: /usr/bin/minakata-mcp
    args: ["serve"]
```

#### 3. Check if the configured command binary exists
```bash
ls -la /usr/bin/minakata-mcp
→ ls: cannot access '/usr/bin/minakata-mcp': No such file or directory
```

**Diagnosis**: The config points to a non-existent binary.

#### 4. Find the actual tool
```bash
which uvx
→ /root/.local/bin/uvx
```

#### 5. Check if the tool can serve via uvx
```bash
uvx minakata-mcp serve --help 2>&1
# or test with an MCP initialize probe:
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.1","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | timeout 5 uvx minakata-mcp serve 2>&1
```
→ Returns valid JSON-RPC response → the tool works, only the config path is wrong.

#### 6. Fix: Update config with correct command path
```yaml
name: "default"
mcp_servers:
  minakata:
    type: stdio
    command: /root/.local/bin/uvx
    args: ["minakata-mcp", "serve"]
```

#### 7. In-process recovery limitation
Fixing config.yaml does NOT fix the current agent session — the in-process MCP client already initialized with the broken config. **Fix takes effect on next agent process start** (next cron tick, or restart).

### Lessons

1. **Always read the active profile's config**, not just `~/.hermes/config.yaml`. In Hermes v2, MCP server configs live in `profiles/<name>/config.yaml`.
2. **Verify the `command` path from the config actually exists** with `ls -la`. A path like `/usr/bin/minakata-mcp` that doesn't exist is a common setup error (the binary is usually installed via `uvx`, not as a system binary).
3. **The JSON-RPC initialize probe** (`echo '{"jsonrpc":"2.0","id":1,"method":"initialize"...}' | timeout 5 <command> 2>&1`) is a definitive test: if the server responds with a valid JSON-RPC response, the server itself works.

## Example D: Three-way config conflict — server binary missing in skill channel layer

### Failure Signature

```
MCP server 'minakata' is not connected.
```

`hermes mcp list`:
```
Error: No MCP servers configured
```

`hermes doctor` reports:
```
⚠ MCP server 'minakata' is configured but could not be validated
```

Yet `mcp_minakata_minakata_*` tools are registered in the agent's toolset and callable (though they all fail).

### Diagnostic Steps

#### 1. Trace tool origin — don't trust `hermes mcp list` alone
```bash
find /root/.hermes -type f -exec grep -l "minakata" {} \; 2>/dev/null
```
This reveals that `minakata` references exist in **multiple files**:
```
/root/.hermes/profiles/default/skills/skill_definitions.yaml
/root/.hermes/profiles/default/skills/skill_minakata/action_definitions.yaml
/root/.hermes/profiles/default/skills/skill_minakata/skill.yaml
/root/.hermes/profiles/default/skills/skill_minakata/tool_definitions.yaml
/root/.hermes/profiles/default/config.yaml
/root/.hermes/config.yaml
```

#### 2. Check all 3 MCP config locations for conflicts

**Location 1 — Global config:**
```bash
cat /root/.hermes/config.yaml
```
```yaml
# New Hermes v2 format
mcp:
  servers:
    minakata:
      command: uvx
      args:
        - minakata-mcp
      transport: stdio
      enabled: true
```

**Location 2 — Profile config:**
```bash
cat /root/.hermes/profiles/default/config.yaml
```
```yaml
# Old array format (incompatible with current Hermes version)
mcp_servers:
  - command: uvx
    args:
      - minakata-mcp
```

**Location 3 — Skill channel config (CRITICAL — easy to miss):**
```bash
cat /root/.hermes/profiles/default/skills/skill_definitions.yaml
```
```yaml
channels:
  - type: local
    mcp_servers:
      - name: minakata
        transport: stdio
        command: node
        args:
          - /opt/minakata-server/build/index.js
        enabled: true
```
→ This is the **actual MCP server definition** that the tools require. The other two configs are irrelevant noise.

#### 3. Verify the server binary exists
```bash
ls -la /opt/minakata-server/build/index.js
```
→ `ls: cannot access '/opt/minakata-server/build/index.js': No such file or directory`

**Root cause identified**: The Node.js MCP server binary at `/opt/minakata-server/build/index.js` does not exist. The command itself (`node`) is fine, but the script path is missing.

#### 4. Check what `uvx minakata-mcp` actually provides
```bash
uvx minakata-mcp --help 2>&1
```
```
Usage: minakata-mcp [OPTIONS] COMMAND [ARGS]...

  Manage MCP servers

Options:
  --help  Show this message and exit.

Commands:
  list      List configured MCP servers
  run       Run an MCP server in stdio mode
  install   Install an MCP server
```
→ This is **NOT** the Minakata KB server. It's a generic **MCP server manager** (commands: `run`, `list`, `install`). The other two configs (global and profile) both point to this wrong package.

#### 5. Summary of conflicts

| Config File | Format Key | Command | Args | Status |
|-------------|-----------|---------|------|--------|
| Global `config.yaml` | `mcp.servers.minakata` | `uvx` | `["minakata-mcp"]` | ❌ Wrong package (manager, not server) |
| Profile `config.yaml` | `mcp_servers[]` (array) | `uvx` | `["minakata-mcp"]` | ❌ Wrong package + old format ignored |
| `skill_definitions.yaml` | `channels[].mcp_servers[]` | `node` | `["/opt/minakata-server/build/index.js"]` | ❌ Binary path doesn't exist |

All three configs are broken in different ways.

### Root Cause

The Minakata MCP server requires a **Node.js server** at `/opt/minakata-server/build/index.js`. This binary needs to be built/installed. The `uvx minakata-mcp` package is a red herring — it is a generic MCP server manager, not the Minakata KB server.

### Resolution

1. **Install/build the actual Minakata MCP server** at the correct path, OR
2. **Update `skill_definitions.yaml`** to point to the correct command if the server has moved to a different package
3. **Remove or fix** the stale configs in `config.yaml` and profile `config.yaml` to avoid future confusion
4. **Restart Hermes agent** to pick up the changes

### Lessons

1. **`hermes mcp list` returning "No MCP servers configured" does NOT mean no MCP configs exist.** Skill channel definitions in `skill_definitions.yaml` are a separate layer that `hermes mcp list` does not enumerate.
2. **Three config layers can conflict**: global `config.yaml`, profile `config.yaml`, and `skill_definitions.yaml`. Always check all three.
3. **`uvx minakata-mcp` is NOT the Minakata KB server** — it's an MCP server manager. When a package name suggests it's the right tool, run `--help` to verify the subcommands match expectations (e.g., `search`, `get`, `list` for a KB tool vs `run`, `list`, `install` for a manager).
4. **Verify the server binary script itself exists** with `ls -la <script_path>`, not just the `command` binary. A `command: node` with a non-existent script file fails silently during auto-discovery.
5. **Static skill tool definitions** in `action_definitions.yaml` / `tool_definitions.yaml` make it look like MCP tools are available even when the backing server is completely missing. Always cross-reference tool availability with `hermes mcp list` + the actual server process.

## Example E: Database directory missing — server fails silently

### Failure Signature

```
MCP server 'minakata' is not connected.
```

`hermes mcp list`:
```
minakata  STOPPED (exit code 1)  uvx --from minakata-mcp minakata-mcp
```

`hermes doctor`:
```
minakata: FAIL – server exited with code 1
```

Yet the package IS installed and `uvx --from minakata-mcp minakata-mcp --help` works fine.

### Diagnostic Steps

#### 1. Run the server directly with debug logging

```bash
uvx --from minakata-mcp minakata-mcp --log-level debug 2>&1 &
sleep 3
kill %1 2>/dev/null
wait %1 2>/dev/null
```

Output:
```
Debug: Starting Minakata MCP server...
Debug: Using default configuration
Error: Failed to initialize database: unable to open database file: /root/.minakata/minakata.db (No such file or directory)
```

**Diagnosis**: The server requires a SQLite database at `/root/.minakata/minakata.db`, but neither the directory nor the database exists.

#### 2. Check available subcommands for initialization

```bash
uvx --from minakata-mcp minakata-mcp --help
```

Output shows:
```
Commands:
  run       Start the MCP server (default)
  migrate   Run database migrations
  seed      Seed the database with initial data
```

→ `migrate` and `seed` subcommands exist for database initialization.

#### 3. Create directory and run migration

```bash
mkdir -p ~/.minakata
uvx --from minakata-mcp minakata-mcp migrate
```

Output:
```
proceeding with migration
```

#### 4. Verify files created

```bash
ls -la ~/.minakata/
```
→ `migrations.db`, `.minaka_db`, `minakata.db` now exist.

#### 5. Start the MCP server through Hermes

```bash
hermes mcp start minakata
```
→ `Server started on port 8100`

#### 6. Test the connection

```bash
hermes mcp test minakata
```
→ `{ "name": "minakata", "status": "running", "port": 8100, "pid": 13432 }` ✅

### In-process recovery limitation

Even though the server is running, the current agent session's MCP client was initialized before the fix and retains the stale "not connected" state. `hermes mcp start` and `hermes mcp test` operate on a separate connection state from the in-process MCP client. The fix takes effect on the **next agent process restart** (next cron tick).

### Root Causes (all lead to same symptom)

| Error message | Cause | Fix |
|---------------|-------|-----|
| `unable to open database file: /path/to/db (No such file or directory)` | Data directory doesn't exist | `mkdir -p <data-dir>` |
| `Failed to initialize database` | Database file missing or corrupt | Run `migrate` subcommand |
| `Database is not initialized` | Schema not created yet | Run `migrate` (and optionally `seed`) |
| Server exits with code 1, no error message | Missing `--log-level debug` or stderr not captured | Re-run with `--log-level debug 2>&1` |

### Quick Takeaways

1. **Always run the server command directly** (not via Hermes) to see the actual error message — Hermes may hide stderr.
2. **Add `--log-level debug`** (or similar verbosity flag) on first direct run — database errors may only appear at debug level.
3. **Check `--help` for `migrate`/`init`/`setup`/`seed` subcommands** — servers that manage their own database often provide these.
4. **Create the data directory** if the error mentions a path that doesn't exist — `mkdir -p <data-dir>` is nearly always safe.
5. **`hermes mcp test` is more reliable than `hermes mcp list`** for checking if a server is actually reachable.
