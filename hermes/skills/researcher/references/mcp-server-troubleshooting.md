# MCP Server Unreachable — Troubleshooting Reference

## Error patterns

| Error message | Meaning | Action |
|---|---|---|
| `unreachable after N consecutive failures` | MCP client has been retrying and the server hasn't responded for N attempts. | **Stop immediately — do NOT retry.** Switch to terminal diagnostics or report failure. |
| `not connected` | Auto-retry countdown has expired; the client is idle. | The next call will trigger a fresh connect attempt but it will likely also fail. Do not attempt — go to terminal diagnostics first. |
| `not connected` → `unreachable after N+1 consecutive failures` | The fresh connect attempt also failed. | Stop retrying — server is fully down. |
| `timeout` | Server process is running but not responding within the timeout. | Server may be hung/blocked on something. Harder to recover without restart. |
| `repeated_exact_failure_warning; count=N` | Tool system detects the same failing call being repeated. | **Emergency stop signal.** Immediately cease all MCP tool calls this turn. |
| `MCP server 'X' is not connected` (from `poll_tasks` first call) | Server does not exist in the current profile's MCP config, OR the session's in-process MCP client never connected. | Check if the server is configured at all (see "MCP Server Not Configured" section below). If configured but not connected, proceed to terminal diagnostics. |
| `MCP server 'X' not found in configuration` (from `hermes mcp test`) | The server name is not defined in any `mcp_servers` block for the active profile. | **Server is not configured.** Go to "MCP Server Not Configured" section. |
| `No MCP servers configured` (from `hermes mcp list`) | No `mcp_servers` block exists in the active profile's config or mcp.json. | **No MCP infrastructure exists.** Go to "MCP Server Not Configured" section. |

## MCP Server Not Configured

When the terminal indicates the server is not configured at all (as opposed to configured but unreachable):

### Identification

These signals mean the server is simply not configured:

1. `hermes mcp list` returns `"No MCP servers configured"` (not a list of servers with states)
2. `hermes mcp test minakata` returns `"MCP server 'minakata' not found in configuration"`
3. The active profile's `mcp.json` contains `{"mcpServers": {}}`

### Profile-aware diagnosis

MCP configurations are **per-profile** in Hermes v2+. The active profile determines which MCP servers are available:

```bash
# 1. Find the active profile
grep active_profile ~/.hermes/config.yaml
# or
echo $HERMES_PROFILE

# 2. Check the profile's mcp.json
cat ~/.hermes/profiles/<profile>/mcp.json

# 3. List all profiles for cross-reference
ls ~/.hermes/profiles/
cat ~/.hermes/profiles/<other>/mcp.json   # e.g., coding profile
```

### Recovery: Add the missing server

**Method A — via CLI (`hermes mcp add`):**

The `hermes mcp add` syntax changed between Hermes versions. Check your version first:
```bash
hermes version       # e.g. "Hermes v0.18.0-dev"
hermes mcp add --help  # check whether --name flag exists
```

- **Hermes >= v0.18.0** (has `--name`/`--command`/`--args` flags):
  ```bash
  hermes mcp add --name minakata --command npx --args "-y" --args "@minakata/mcp-server"
  ```
- **Hermes < v0.18.0** (`--` positional separator):
  ```bash
  hermes mcp add minakata -- npx -y @minakata/mcp-server
  ```

**PATH note for subagent terminal sessions:** If running through `delegate_task`, the subagent's shell may not have `/usr/local/bin` in PATH. Use the full path:
```bash
hermes mcp add --name minakata --command /usr/bin/npx --args "-y" --args "@minakata/mcp-server"
```

**Method B — manual mcp.json edit:**
```bash
# Write the config directly to the active profile's mcp.json
cat > ~/.hermes/profiles/<profile>/mcp.json << 'EOF'
{
  "mcpServers": {
    "minakata": {
      "command": "npx",
      "args": ["-y", "@minakata/mcp-server"]
    }
  }
}
EOF
```

### After adding

```bash
# Verify the server is recognized
hermes mcp test minakata

# List all configured servers
hermes mcp list
```

If the test returns "connected", the server configuration is correct but the session's in-process MCP client may still be stale. A new cron invocation (fresh session) should pick up the config. **Do not retry MCP tools from the current session after adding the config** — the in-process client was initialized before the config existed.

### Root cause — why this happens

| Cause | Why | Fix |
|---|---|---|
| Profile mismatch | MCP config exists in `coding/` profile but session is running under `default/` profile | Copy config to the active profile, or switch profiles |
| Config never set | Minakata MCP server was never added to this Hermes instance | Add via `hermes mcp add` or mcp.json edit |
| Config removed | Someone cleaned up the config or the profile was recreated | Restore from another profile or add fresh |
| CLI tool call mismatch | MCP tools (`mcp_minakata_*`) are injected into session toolset by the application layer without a backing server config | Cannot be fixed from agent side; needs user to configure the server or the session to be restarted with the correct profile |

## Error evolution timeline (what to expect)

When the server goes down, the MCP client progresses through phases:

1. **Phase 1**: Calls fail with increasing failure counts (16, 17, 18...) and an auto-retry countdown (~50s)
2. **Phase 2**: Countdown expires → next call returns `"not connected"` briefly
3. **Phase 3**: Client attempts reconnect → if that also fails → back to Phase 1

The key insight: **do not poll through the countdown phase**. The countdown means the MCP client itself is rate-limiting. Each call during countdown will:
- cost a tool call
- waste context
- delay the countdown by restarting it (observed: each retry adds ~3-4s delay)

### ⚠️ The Auto-Retry Trap (Critical)

**This session demonstrated a dangerous failure mode**: When the MCP server is "unreachable after N consecutive failures" and an auto-retry countdown is active (~Ns), the platform automatically re-invokes the same tool call. If the agent responds by calling the MCP tool again (even with the same arguments), it creates a **self-reinforcing loop**:

1. Agent calls MCP tool → "unreachable" + "auto-retry available in ~50s"
2. Platform auto-retries → "unreachable" again
3. Agent calls again (thinking it's a new attempt) → countdown resets
4. Repeat until the agent exhausts its context or the tool system issues `repeated_exact_failure_warning`

In this session, this produced **23 consecutive identical failed calls** in a single turn.

**How to break out**:
- After the FIRST "unreachable" response, **do not call any MCP tool again** in the same turn.
- The auto-retry that fires on its own is NOT your call — do not follow it up with another MCP call.
- Switch immediately to a non-MCP tool (terminal, web_search, or just report).
- If you are already in the loop and see `repeated_exact_failure_warning`, **stop calling the MCP tool immediately**. Call a completely different tool (terminal) or end the turn with a report.
- **Do not wait for the auto-retry countdown to expire**. Waiting does not help — the next fresh attempt will also fail if the server is still down, and the countdown resets each time you call.

## When terminal is available

If you have `terminal` access, diagnose with:

```bash
# List configured MCP servers
hermes mcp list

# Test specific server
hermes mcp test minakata

# Restart MCP server (common patterns)
hermes mcp remove minakata && hermes mcp add minakata --command "<restore-command>"
# or restart the whole gateway
hermes gateway restart

# Check gateway logs for server-side errors
grep -i "minakata\|mcp" ~/.hermes/logs/gateway.log | tail -30
```

## When terminal is NOT directly available (delegate_task bridge)

If the agent does NOT have a direct `terminal` or `execute_command` tool, but DOES have `delegate_task`, you can still run terminal diagnostics by spawning a subagent with terminal toolsets:

```python
# Pattern: spawn a terminal subagent for diagnostics
delegate_task(
    goal="Run `hermes mcp list` and report the exact output.",
    context="Working directory: /root",
    toolsets=["terminal", "file"]
)
```

**Critical caveat — subagent execution unreliability:** The subagent (`delegate_task`) may self-report as "completed" without actually executing any commands (`tool_trace` is empty). This is a known model behavior pattern — the subagent describes what it plans to run but never calls the tool. **Mitigations:**

1. **Keep each subagent task small** — one command per call, not a sequence.
2. **If a subagent returns empty tool_trace**, try again with a simpler prompt: just the command to run, no instructions beyond "run this command and return the exact output."
3. **For critical operations** (file writes, config changes), verify the result independently rather than trusting the subagent's self-report.
4. **If subagents consistently fail to execute** (empty tool_trace across multiple attempts), you may be unable to use this bridge.

**Fully blocked case:** If you can only use MCP tools and the MCP server they depend on is down, AND delegate_task is unavailable or the subagent bridge fails:
- **You cannot fix it from here.** Accept the limitation.
- **Do NOT retry.** One failure is enough — further retries will not help and only waste turns.
- **Report clearly** that the MCP server is unreachable.
- The failure will be auto-retried on the next cron cycle.

## Cron delivery report examples

**Good** (concise, actionable):
```
Researcher Cycle — FAILED
MCP server "minakata" is unreachable after 17 consecutive failures.
Could not poll task queue. All MCP operations blocked.
To fix: restart the Minakata MCP server or gateway.
```

**Bad** (verbose, non-actionable):
```
I tried to connect to the MCP server many many times... it didn't work... [long narration of each attempt]
```

## Common crash causes

When the MCP server process starts but crashes immediately, `hermes mcp restart` may **return success** even though the process died. Always verify with `hermes mcp test`.

### 1. Missing Python module (most common)

The server log will show a `ModuleNotFoundError` traceback:
```
$ cat ~/.hermes/logs/minakata.2026-05-28.log | grep -i "error\\|traceback\\|module" | tail -20
ModuleNotFoundError: No module named 'minakata_mcp'
```

**Fix:**
```bash
cd /opt/hermes && source .venv/bin/activate
uv pip install <missing-module>
hermes mcp stop minakata && hermes mcp start minakata
hermes mcp test minakata   # must return "connected"
```

### 2. Wrong working directory or missing config file

The server process may fail because it expects to be run from a specific directory.
Check the `command` in the MCP server configuration.

## `hermes mcp restart` false positive

**Issue**: `hermes mcp restart minakata` returns `✓ minakata: started` even when the spawned process crashes before initializing. The CLI only verifies the process was launched, not that it's healthy.

**Workaround**: Use explicit `stop` + `start` instead of `restart`, and ALWAYS verify with `hermes mcp test`:
```bash
hermes mcp stop minakata
hermes mcp start minakata
hermes mcp test minakata   # critical verification step
```

## Stale MCP client connections

Once the Hermes agent session has started, the in-process MCP client opens connections to MCP servers at initialization time. If a server goes down and is later restarted:

| Layer | What was fixed | Will the next tool call work? |
|---|---|---|
| Server process | ✅ Restarted and healthy | ❌ Client connection is still stale |
| MCP client connection | ❌ Not automatically re-established | ❌ Must wait for auto-retry cooldown |
| Agent session | ❌ Running | ❌ Needs session restart |

**Symptoms of stale connection:**
- `hermes mcp test <server>` returns "connected" from terminal
- But MCP tools in the agent still return `"unreachable after N failures"` or `"not connected"`
- The tool works from a new subagent/terminal but not from the running agent

**Resolution:** A session restart (new process) is required. The stale client connection is cached in the running Python process and cannot be cleared without restarting the agent.

### In-practice confirmation (this session)

Observed pattern that confirms stale connection:

1. `poll_tasks` → `"unreachable after 116 consecutive failures"` (pre-existing failures from earlier runs)
2. Terminal diagnostics via `delegate_task` → `hermes mcp test minakata` → ✅ connected
3. Restarted server anyway: `hermes mcp stop` + `hermes mcp start` → both OK
4. `hermes mcp test minakata` → ✅ connected (server is healthy)
5. `poll_tasks` again → `"not connected"` then `"unreachable after 117 consecutive failures"`

**Key confirmation points:**
- The stale connection survived a full server restart (stop + start). The server was healthy at the terminal level throughout.
- The error progressed from "unreachable after 116 failures" → "not connected" → "unreachable after 117 failures" as the session's client attempted reconnection and failed each time.
- Only a **session restart** (next cron invocation = new Hermes process) resolved this.

**Action recommendation when stale connection is confirmed (§5b passes but §5g fails):**
- Do NOT restart the server again — it will not help (§5e-f are wasted steps)
- Do NOT re-poll — the same error will repeat
- Report the stale connection and let the next cron session handle it

## Subagent tool unreliability pattern

Subagents (`delegate_task`) frequently **self-report results that diverge from actual tool execution**. Two variants observed:

### Variant A: False negatives (tools work but subagent claims failure)

The subagent claims tools are broken/missing, but the `tool_trace` shows `status: "ok"` with real data:
- Subagent claims `web_search` and `web_extract` are broken (e.g., "firecrawl missing") → tool_trace shows both returning 695–1213 bytes with `status: "ok"`
- Subagent claims no `bash`/terminal tool is available → tool_trace shows a bash call returning 68 bytes with `status: "ok"`

**Mitigation**: Check the `tool_trace` in the response. If traces show `status: "ok"` and non-zero `result_bytes`, tools actually worked — the subagent's self-report is unreliable. For operations with external side-effects (HTTP calls, MCP calls, file writes), require the subagent to return verifiable handles (URLs, IDs, status codes) and verify independently.

### Variant B: Empty execution (subagent describes without acting)

The subagent describes what commands it will run, shows code blocks with the commands, but **never actually calls the terminal tool** — the `tool_trace` is empty. This is common with certain models (e.g., deepseek-v4-flash) in subagent mode. The subagent outputs a plan or a description but the actual tool invocation never happens.

**Symptoms:**
- `tool_trace` is empty `[]` in the response
- The summary contains code blocks with commands but no actual output
- The subagent status is "completed" but nothing was executed
- Multiple retries with the same subagent produce the same pattern

**Mitigation (in priority order):**
1. Keep subagent tasks small and simple — a single command per subagent call works better than a sequence
2. If a subagent returns empty tool_trace, try breaking the task into individual calls
3. For critical operations (file writes, config changes), verify the result directly rather than trusting the subagent's self-report
4. For elaborate diagnostic sequences, consider running them inline in the parent session instead of delegating

**In-practice workaround that succeeded across multiple sessions:**

The key refinement is adding an **explicit output format constraint** to the goal. Without it, the subagent model often describes the command in prose without executing it:

- **Failed** (empty tool_trace): Multi-command goal asking to run 4-5 commands sequentially
- **Partially failed**: Single-command goal without format constraint (`"Return the exact stdout and stderr"`) — subagent still described what *would* happen without running it
- **Succeeded consistently**: Single-command goal with explicit format anchor

**Template for reliable subagent terminal calls:**
```
goal="Run: <single command>. Return ONLY: OUTPUT: followed by the raw stdout."
context=""
toolsets=["terminal"]
```

**Why the format constraint works**: The subagent model (especially deepseek-v4-flash) can slip into plan-description mode when the goal is phrased abstractly. Adding `"Return ONLY: OUTPUT: <raw output>"` anchors the response to a literal output format that forces actual execution — the model produces the OUTPUT: line as the summary and the tool execution naturally fills it.

**If the format constraint still fails** (very rare, but observed with certain model versions):
```
goal="Tell me the raw output of this command: <command>"
```
Sometimes reversing the phrasing (from imperative to inquiry) triggers the model's fact-retrieval pathway, which in turn calls the terminal tool to provide the answer.

**Iterative escalation pattern (this session's confirmed flow):**
```python
# Level 1 — simple single command
delegate_task(goal="Run: hermes mcp test minakata. Return raw output.")

# If empty tool_trace — add explicit format constraint
delegate_task(goal="Run: hermes mcp test minakata 2>&1. Return ONLY: OUTPUT: <raw output>")

# If still empty — shorten to minimum viable prompt
delegate_task(
  goal="Tell me the raw output of: hermes mcp test minakata",
  context="Start your response with the exact raw text the command printed."
)

**If STILL empty (confirmed in this session) — escalate to alternative shell syntaxes before giving up**
  Before declaring the bridge broken, try 2-3 shell syntax variants. One may execute even when another produces empty tool_trace:

  **Escalation ladder (confirmed in this session to produce results):**

  | Level | Pattern | Example | Success rate |
  |---|---|---|---|
  | 1a | Multi-command goal | `Run: cmd1 && cmd2` | ❌ Usually empty |
  | 1b | Single-command, plan-style goal | `Run: hermes mcp test` | ⚠️ Sometimes empty |
  | 2 | Single-command + PATH= prefix | `PATH=/usr/local/bin:/usr/bin:/bin hermes mcp list` | ✅ Works for reads |
  | 3 | **Echo redirect (NOT heredoc) for writes** | `echo '{"key":"val"}' > path` | ✅ Works for writes |
  | 4 | Heredoc for writes | `cat > path << 'EOF' ... EOF` | ❌ **Always empty** for this model |
  | 5 | Sequential single-command + shell operators | `cmd1 && echo ---SEP--- && cmd2` | ⚠️ Mixed |

  **Key finding — echo redirect > heredoc for subagent file writes:**
  When writing files via delegate_task subagents, use `echo 'json-string' > path` instead of `cat << 'EOF' ... EOF`. The heredoc syntax consistently produces empty tool_trace with certain models (deepseek-v4-flash), while the one-liner echo redirect executes reliably.

  **Example that worked (file write):**
  ```python
  delegate_task(
      goal="Write minakata config to mcp.json using echo redirect, then verify with cat.",
      context="Run: echo '{"mcpServers":{"minakata":{"command":"npx","args":["-y","@minakata/mcp-server"]}}}' > /root/.hermes/profiles/default/mcp.json && cat /root/.hermes/profiles/default/mcp.json",
      toolsets=["terminal"]
  )
  ```

  **If the escalation ladder still fails** (all 5 levels produce empty tool_trace) — **accept the bridge is broken** at this point. Multiple attempts at escalating the goal phrasing and shell syntax have all failed. The subagent model is consistently skipping tool execution for terminal tasks. Do NOT keep iterating — it wastes turns and context. Fall back to: report-only mode (§5i.2 in the researcher skill). The terminal bridge via delegate_task is unavailable for this session.
```

**When to stop escalating**: If 3-4 attempts across the above levels all return empty tool_trace, the delegate_task bridge is broken for this session/model combination. Further attempts will not help. Report the failure and move on.

**Model dependency**: The empty-execution pattern is more pronounced with certain subagent models. In this session, `deepseek-v4-flash` as the subagent model consistently produced empty tool_trace for multi-command goals but executed single-command goals with format constraints. If the model changes, re-test the boundary — the pattern may shift.

**PATH isolation in subagent shells**: Subagent terminal sessions may have a different PATH than the parent session. Specifically, `/usr/local/bin` (where `hermes` is typically installed) is often missing. This causes `hermes: command not found` even when the parent session can run `hermes` fine.

**Symptoms:**
- Command fails silently (just no output or "Error: Command 'hermes' not found.")
- The parent knows `which hermes` → `/usr/local/bin/hermes`
- But subagent reports `Command 'hermes' not found.`

**Mitigation:**
- Use full paths in all subagent terminal commands: `/usr/local/bin/hermes ...`
- Or prepend PATH: `PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/hermes ...`
- Do NOT rely on PATH defaults being set up the same as the parent session.

## Preventing this session's mistake

This session retried 15+ times with the same failing call. Here's what the correct behavior should have been:

| Attempt | Action | Result | Verdict |
|---|---|---|---|
| 1st | poll_tasks | "unreachable after 16 failures" | **STOP immediately** — do not retry. |
| - | Switch to terminal diagnostics | `hermes mcp list`, logs | Diagnose the root cause. |
| - | Report failure | Deliver to user | Done |

Total wasted: 15+ calls → should have been 1. The lesson: **zero retries on "unreachable".** The platform's auto-retry mechanism will fire on its own, but the agent must NOT compound it by calling the same tool again.
