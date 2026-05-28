import json, os, sys, urllib.request, urllib.error

MCP_URL = "http://minakata:3000/mcp"

def get_token():
    p = "/run/s6/container_environment/MCP_TOKEN"
    if os.path.exists(p):
        return open(p).read().strip()
    return os.environ.get("MCP_TOKEN", "")

MCP_TOKEN = get_token()

def call_tool(name, args):
    headers = {
        "Host": "localhost:3000",
        "Authorization": f"Bearer {MCP_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}
    req = urllib.request.Request(MCP_URL, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"isError": True, "error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"isError": True, "error": str(e)}

# Step 1: Poll for unclaimed messages
result = call_tool("minakata.poll_messages", {})
if result.get("isError"):
    print(f"ERROR polling messages: {result.get('error', result)}", flush=True)
    sys.exit(0)

# Parse messages
messages = None
if "structuredContent" in result and result["structuredContent"]:
    sc = result["structuredContent"]
    if "messages" in sc:
        messages = sc["messages"]
elif "content" in result and len(result["content"]) > 0:
    try:
        messages = json.loads(result["content"][0].get("text", "{}")).get("messages", [])
    except (json.JSONDecodeError, KeyError, IndexError):
        pass

if not messages:
    print("[SILENT]", flush=True)
    sys.exit(0)

print(f"Found {len(messages)} unclaimed message(s)", flush=True)

responses = []

for msg in messages:
    mid = msg.get("id")
    sid = msg.get("session_id")
    content = msg.get("content", "")
    created = msg.get("created_at", "unknown")

    print(f"Processing message {mid} in session {sid}: {content[:100]}", flush=True)

    # Step 2: Claim the message
    claim_result = call_tool("minakata.claim_message", {
        "message_id": mid,
        "claimed_by": "agent:dialogue"
    })

    if claim_result.get("isError"):
        print(f"  WARN: Claim failed for {mid}: {claim_result.get('error', claim_result)}", flush=True)
        responses.append(("SKIP", mid, sid, "claim_failed"))
        continue

    claimed = claim_result.get("claimed", False) or claim_result.get("result", {}).get("claimed", False)
    if not claimed:
        # Check nested structure
        result_val = claim_result.get("result", {})
        if isinstance(result_val, dict) and result_val.get("claimed"):
            claimed = True
        else:
            print(f"  WARN: Claim returned false for {mid}", flush=True)
            responses.append(("SKIP", mid, sid, "claim_false"))
            continue

    print(f"  Claimed message {mid}", flush=True)

    # Step 3: Enqueue research task
    enqueue_result = call_tool("minakata.enqueue_task", {
        "type": "research",
        "priority": "interactive",
        "payload": {
            "query": content,
            "session_id": sid,
            "message_id": mid,
            "source": "user_chat"
        },
        "dedup_key": f"dialogue-{sid}"
    })

    task_id = None
    if enqueue_result.get("isError"):
        print(f"  WARN: Enqueue failed for {mid}: {enqueue_result.get('error', enqueue_result)}", flush=True)
        task_status = "enqueue_failed"
    else:
        task_id = enqueue_result.get("id") or enqueue_result.get("result", {}).get("id", "unknown")
        print(f"  Enqueued task {task_id}", flush=True)
        task_status = "queued"

    # Step 4: Post agent response
    response_text = (
        "📬 **メッセージを受信しました！**\n"
        "リサーチタスクをキューに登録しました。完了まで約3分お待ちください。\n\n"
        "---\n\n"
        "📬 **Message received!**\n"
        "Research task has been queued. Estimated completion: ~3 minutes."
    )

    post_result = call_tool("minakata.post_agent_response", {
        "session_id": sid,
        "content": response_text,
        "is_final": False
    })

    if post_result.get("isError"):
        print(f"  WARN: Post response failed for session {sid}: {post_result.get('error', post_result)}", flush=True)
        resp_status = "post_failed"
    else:
        resp_status = "posted"

    responses.append(("OK", mid, sid, task_status, resp_status))
    print(f"  Posted acknowledgement to session {sid}", flush=True)

# Step 5: Verify - poll again to confirm zero unclaimed remain
verify_result = call_tool("minakata.poll_messages", {})
remaining = 0
if not verify_result.get("isError"):
    if "structuredContent" in verify_result and verify_result["structuredContent"]:
        remaining = len(verify_result["structuredContent"].get("messages", []))
    elif "content" in verify_result and len(verify_result["content"]) > 0:
        try:
            vmsgs = json.loads(verify_result["content"][0].get("text", "{}")).get("messages", [])
            remaining = len(vmsgs)
        except:
            pass

print(f"Verification: {remaining} unclaimed messages remaining", flush=True)
print(f"Processed {len(responses)} messages", flush=True)
print(json.dumps({"processed": len(responses), "remaining": remaining, "details": responses}), flush=True)
