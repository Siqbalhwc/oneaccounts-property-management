"""
A tiny event bus so optional plug-ins can react to core events WITHOUT the
core knowing they exist.

  core:    emit("tenants.created", row=..., company_id=...)
  plug-in: hooks.on("tenants.created")(my_handler)

Rules that keep the core safe:
  * With no handlers registered, emit() does nothing at all (zero cost).
  * A handler that crashes is logged and swallowed -- a plug-in problem can
    never fail, slow down or roll back the core action that triggered it.
  * Detaching a plug-in = not registering it. Nothing else in the core changes.
"""

import logging
from typing import Callable, Dict, List

_log = logging.getLogger("app.hooks")
_handlers: Dict[str, List[Callable]] = {}


def on(event: str):
    def _register(fn: Callable) -> Callable:
        _handlers.setdefault(event, []).append(fn)
        return fn

    return _register


def emit(event: str, **payload) -> None:
    for fn in _handlers.get(event, ()):
        try:
            fn(**payload)
        except Exception:  # noqa: BLE001 -- deliberate: plug-ins must never break the core
            _log.exception("hook handler %s failed for event %s", getattr(fn, "__name__", fn), event)
