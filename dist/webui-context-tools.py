"""
title: dev-tool chat context
description: Owned-chat context status and explicit compaction after the current reply.
version: 1.0.0
"""
import asyncio
import re
import json
import os
import sqlite3
import time
from open_webui.env import DATA_DIR
from open_webui.models.chats import Chats
from open_webui.models.users import Users
from open_webui.tasks import has_active_tasks
from open_webui.utils.context_compaction import compact_chat_branch, get_chat_context_usage

_tasks = {}
_windows = {}
_active = {"queued", "compacting"}
_transitions = {
    "queued": {"compacting", "cancelled", "expired", "superseded", "failed", "interrupted"},
    "compacting": {"done", "skipped", "cancelled", "failed", "interrupted"},
}
# A separate receipt store avoids stale browser chat saves overwriting job state.
# Workers sharing DATA_DIR serialize reservations in SQLite, off the event loop.
_store = DATA_DIR / "dt-context-requests.sqlite3"


def _store_sync(owner, chat_id, operation, request_id=None, patch=None):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(_store), timeout=5) as db:
        os.chmod(_store, 0o600)
        db.execute("CREATE TABLE IF NOT EXISTS requests (owner TEXT, chat TEXT, id TEXT, body TEXT, PRIMARY KEY(owner,chat,id))")
        db.execute("BEGIN IMMEDIATE")
        records = {row[0]: json.loads(row[1]) for row in db.execute("SELECT id,body FROM requests WHERE owner=? AND chat=?", (owner, chat_id))}
        now = time.time()
        for key, record in records.items():
            if record.get("state") in _active and now - record.get("createdAt", now) > 600:
                record.update(state="interrupted", compacted=None, reason="Request lease expired; inspect the native checkpoint before retrying", updatedAt=now)
                db.execute("UPDATE requests SET body=? WHERE owner=? AND chat=? AND id=?", (json.dumps(record), owner, chat_id, key))
        if operation == "reserve":
            if request_id in records:
                return records[request_id], True
            pending = next((r for r in records.values() if r.get("state") in _active), None)
            if pending:
                return pending, True
            if len(records) >= 256:
                raise ValueError("Retained compaction request capacity reached; use /compact")
        if operation in {"reserve", "save"}:
            record = {**records.get(request_id, {}), **patch, "request_id": request_id, "updatedAt": now}
            # An expired worker cannot overwrite a later terminal observation.
            if operation == "save" and records.get(request_id, {}).get("state") == "interrupted":
                return records[request_id]
            previous = records.get(request_id, {}).get("state")
            if previous and record["state"] != previous and record["state"] not in _transitions.get(previous, set()):
                raise ValueError("Invalid compaction request transition")
            db.execute("INSERT OR REPLACE INTO requests VALUES (?,?,?,?)", (owner, chat_id, request_id, json.dumps(record)))
            return (record, False) if operation == "reserve" else record
        return records


async def _records(owner, chat_id):
    return await asyncio.to_thread(_store_sync, owner, chat_id, "read")


async def _save(owner, chat_id, request_id, patch):
    return await asyncio.to_thread(_store_sync, owner, chat_id, "save", request_id, patch)


async def _owned(user_data, metadata):
    user_id = (user_data or {}).get("id")
    chat_id = (metadata or {}).get("chat_id")
    if not user_id or not chat_id:
        raise ValueError("A saved, authenticated chat is required")
    user = await Users.get_user_by_id(user_id)
    chat = await Chats.get_chat_by_id_and_user_id(chat_id, user_id)
    if not user or not chat:
        raise ValueError("Chat is not owned by the authenticated user")
    return user, chat



async def _emit(emitter, record, summary=None):
    if not emitter:
        return
    try:
        if record["state"] == "done":
            await emitter({"type": "context_compaction", "data": {"action": "context_compaction", "description": "Context compacted", "done": True, "context_summary": summary}})
        else:
            await emitter({"type": "status", "data": {"description": "Context compaction: " + record["state"], "done": record["state"] not in _active}})
    except Exception:
        pass  # UI delivery never changes the persisted outcome.


async def _run(user, chat_id, request_id, message_id, model_id, request, emitter):
    began = False
    try:
        deadline = time.monotonic() + 300
        while await has_active_tasks(request.app.state.redis, chat_id):
            if time.monotonic() >= deadline:
                record = await _save(user.id, chat_id, request_id, {"state": "expired", "compacted": False, "reason": "Current reply did not finish within five minutes"})
                await _emit(emitter, record)
                return
            await asyncio.sleep(0.25)
        chat = await Chats.get_chat_by_id_and_user_id(chat_id, user.id)
        if not chat:
            raise ValueError("Chat is no longer owned by this user")
        current = chat.current_message_id or (chat.chat or {}).get("history", {}).get("currentId")
        if current != message_id:
            record = await _save(user.id, chat_id, request_id, {"state": "superseded", "compacted": False, "reason": "Chat branch or response changed before compaction"})
            await _emit(emitter, record)
            return
        await _save(user.id, chat_id, request_id, {"state": "compacting"})
        began = True
        result = await asyncio.wait_for(compact_chat_branch(request, user, chat, model_id, request.app.state.MODELS), timeout=180)
        record = await _save(user.id, chat_id, request_id, {"state": "done" if result.get("compacted") else "skipped", "compacted": bool(result.get("compacted")), "result": result})
        saved = await Chats.get_chat_by_id_and_user_id(chat_id, user.id)
        summary = ((saved.chat or {}).get("history", {}).get("messages", {}).get(message_id, {}) if saved else {}).get("contextSummary")
        await _emit(emitter, record, summary)
    except asyncio.CancelledError:
        record = await _save(user.id, chat_id, request_id, {"state": "cancelled", "compacted": None if began else False, "reason": "Explicit cancellation; inspect the native checkpoint if summarization had started"})
        await _emit(emitter, record)
    except Exception as cause:
        record = await _save(user.id, chat_id, request_id, {"state": "failed", "compacted": None if began else False, "errorType": type(cause).__name__})
        await _emit(emitter, record)
    finally:
        _tasks.pop((user.id, chat_id, request_id), None)


class Tools:
    async def context_status(self, __user__=None, __metadata__=None, __request__=None) -> dict:
        """Read this owned chat's native token-usage estimate and explicit compaction jobs. Active-reply usage may lag; no compaction is performed."""
        user, chat = await _owned(__user__, __metadata__)
        model = (__metadata__ or {}).get("model") or {}
        model_id = (__metadata__ or {}).get("model_id") or (model.get("id") if isinstance(model, dict) else model)
        usage = await get_chat_context_usage(chat, model_id)
        window = _windows.get(model_id)
        tokens = (usage or {}).get("tokens", (usage or {}).get("estimated_tokens"))
        pressure = {"contextWindow": window, "estimatedUsedTokens": tokens, "advisory": True,
                    "compactionRecommended": bool(window and tokens is not None and tokens >= window * 0.8)}
        running = await has_active_tasks(__request__.app.state.redis, chat.id)
        records = await _records(user.id, chat.id)
        recent = sorted(records.items(), key=lambda item: item[1].get("updatedAt", 0), reverse=True)[:12]
        visible = dict(recent + [(key, record) for key, record in records.items() if record.get("state") in _active])
        return {"chat": chat.id, "usage": usage, "pressure": pressure, "usageSource": "native-provider/history estimate", "activeReply": bool(running), "usageMayLag": bool(running), "requests": visible, "requestCount": len(records), "requestsTruncated": len(visible) < len(records), "guidance": "Manual mode's native threshold is not the serving window. Pressure uses dt's configured serving window when known. Save progress before context_compact. Status shows twelve recent receipts plus active work; retrying an older request_id returns its retained receipt."}

    async def context_compact(self, request_id: str, reason: str, __user__=None, __metadata__=None, __request__=None, __event_emitter__=None) -> dict:
        """Explicitly queue compaction of this owned chat after the current reply finishes. Reuse request_id on retries. Save a task checkpoint first, then finish this reply; this call does not shrink its active tool loop."""
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}", request_id or "") or not reason or len(reason) > 500:
            raise ValueError("Provide a stable request_id and a short reason")
        user, chat = await _owned(__user__, __metadata__)
        message_id = (__metadata__ or {}).get("message_id")
        if not message_id or __request__ is None:
            raise ValueError("An active saved response is required; otherwise use /compact")
        if len(_tasks) >= 128:
            raise ValueError("Compaction worker capacity reached; use /compact")
        record, replayed = await asyncio.to_thread(_store_sync, user.id, chat.id, "reserve", request_id, {"state": "queued", "compacted": False, "reason": reason, "message_id": message_id, "createdAt": time.time()})
        if replayed:
            return {**record, "replayed": True, "guidance": "Inspect context_status; a pending request needs this reply to finish"}
        model = (__metadata__ or {}).get("model") or {}
        model_id = (__metadata__ or {}).get("model_id") or (model.get("id") if isinstance(model, dict) else model)
        model_id = model_id or (chat.chat or {}).get("history", {}).get("messages", {}).get(message_id, {}).get("model")
        task = asyncio.create_task(_run(user, chat.id, request_id, message_id, model_id, __request__, __event_emitter__))
        _tasks[(user.id, chat.id, request_id)] = task
        # Consume exceptions if both the action and its receipt storage fail.
        task.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        await _emit(__event_emitter__, record)
        return {**record, "guidance": "Queued, not compacted yet. Finish this reply now so compaction can run. Check context_status after completion; a newer branch/reply supersedes this request."}

    async def context_compact_cancel(self, request_id: str, __user__=None, __metadata__=None) -> dict:
        """Cancel an owned queued compaction request. If summarization already began its outcome may be unknown; inspect the native checkpoint."""
        user, chat = await _owned(__user__, __metadata__)
        record = (await _records(user.id, chat.id)).get(request_id)
        if not record:
            raise ValueError("No such compaction request in this owned chat")
        task = _tasks.get((user.id, chat.id, request_id))
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            record = (await _records(user.id, chat.id))[request_id]
            if record["state"] == "queued":
                record = await _save(user.id, chat.id, request_id, {"state": "cancelled", "compacted": False})
            return record
        return {**record, "cancelled": False, "guidance": "No local running task was found. A queued state may belong to another worker or an interrupted server; it is not proof of completion."}
