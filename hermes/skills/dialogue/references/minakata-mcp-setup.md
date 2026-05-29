# Minakata MCP Server — Setup & Database Initialization

> **⚠️ Package version note**: The CLI interface differs between versions. This document describes the **current** interface (`serve` subcommand, default port 8080). If you see `run`/`migrate`/`seed` subcommands and port 8000, you have an older version — see [Version History](#version-history) below.

## Overview

The `minakata-mcp` package provides an MCP server that communicates over **HTTP** (port 8080 by default). The Hermes config runs it via `transport: stdio`, which means Hermes spawns the process and connects its stdin/stdout for JSON-RPC message passing — but this version appears to start an HTTP server on the given port regardless. The server was observed to be functional after resolving port conflicts (see [Port Conflicts](#port-conflicts) below).

## Package Identity

- **Package name**: `minakata-mcp`
- **Installation**: `uv tool install minakata-mcp` or auto-resolved via `uvx minakata-mcp`
- **Command name**: `minakata-mcp` (single subcommand: `serve`)
- **Verified `--help` output**:
  ```
  usage: minakata-mcp [-h] {serve} ...

  MCP server for Minakata

  positional arguments:
    {serve}
      serve    Start the MCP server

  options:
    -h, --help  show this help message and exit
  ```
- **Verified `serve --help` output**:
  ```
  usage: minakata-mcp serve [-h] [--host HOST] [--port PORT] [--data-dir DIR] [--log-level LEVEL]

  options:
    -h, --help           show this help message and exit
    --host HOST          Host to bind (default: 127.0.0.1)
    --port PORT          Port to bind (default: 8080)
    --data-dir DIR       Data directory (default: ~/.minakata/data)
    --log-level LEVEL    Log level (default: INFO)
  ```
- **Correct config.yaml entry**:
  ```yaml
  mcp_servers:
    minakata:
      command: uvx
      args:
        - minakata-mcp
        - serve
      env: {}
      disabled: false
      autoApprove: []
      transport: stdio
  ```

## CLI Interface

The package has a single subcommand:

| Subcommand | Description |
|------------|-------------|
| `serve`    | Start the MCP server (only available subcommand) |

**No `migrate`, `seed`, `init`, or `run` subcommands exist** in this version. The server creates its data directory automatically.

## Database / Data Directory

- **Data directory**: `~/.minakata/data/` (default, configurable via `--data-dir`)
- **Contents observed**: Empty directory — the server creates what it needs at runtime

## Port Configuration

- **Default port**: **8080** (via `--port` flag in `serve` subcommand)
- **Default bind host**: `127.0.0.1`
- The server binds to this port immediately on startup.

## Port Conflicts

### Symptom
When attempting to start the server, it fails with:
```
Starting Minakata MCP server on 127.0.0.1:8080...
Error: Failed to initialize MCP server: Address already in use (os error 98)
```

### Cause
A previous MCP server instance (from an earlier cron session or manual `hermes mcp start`) is still running and holding port 8080. This is a recurring issue because each cron session that fails to cleanly terminate leaves the HTTP server process bound to the port.

### Resolution

```bash
# 1. Identify the process holding the port
fuser 8080/tcp
# → 8080/tcp:            12345

# 2. Kill the process
fuser -k 8080/tcp

# 3. Restart the MCP server via Hermes
hermes mcp restart minakata

# 4. Verify
hermes mcp test minakata
# → ✓ Connection successful. Tools available: 8
```

### Note on in-process MCP client
After resolving the port conflict and restarting the server via CLI (`hermes mcp restart`), the **current agent session's in-process MCP client will not recover** — it was initialized before the restart. The fix takes effect on the **next agent session** (next cron invocation), which creates a fresh MCP client connection.

## `hermes mcp test` vs `hermes mcp list` — Current State

With this version of the package and config, `hermes mcp test` and `hermes mcp list` are consistent with each other:

- `hermes mcp list` → shows the server as configured and enabled
- `hermes mcp test minakata` → tests the connection

If the server has been stopped (e.g., port conflict killed the process), `hermes mcp test` will show "not connected". In that case, use `hermes mcp restart minakata` first.

## Version History

The `minakata-mcp` package has undergone a CLI redesign. If you encounter different subcommands than described above, you may have a different version:

| Interface | Subcommands | Default Port | Observed In |
|-----------|-------------|-------------|-------------|
| **Current (v2 / Rust rewrite?)** | `serve` only | 8080 | May 2026 cron sessions |
| **Older (Python / FastAPI)** | `run`, `migrate`, `seed` | 8000 | Prior to May 2026 |

### Detecting which version you have

Run `uvx minakata-mcp --help` and check the output:

- **Current version**: Shows `{serve}` as the only positional argument, port 8080
- **Older version**: Shows `run`, `migrate`, `seed` commands, port 8000, `--reload` flag
