#!/usr/bin/env python3
"""Directional focus navigation for the Firefox kiosk via local WebDriver BiDi."""

from __future__ import annotations

import json

import websocket


REMOTE_AGENT = "ws://127.0.0.1:9222/session"


SPATIAL_NAVIGATION_SCRIPT = r"""
((direction) => {
  const selector = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
    '[tabindex]:not([tabindex="-1"])', '[role="button"]', '[role="link"]',
    '[role="menuitem"]', '[role="option"]', '[role="tab"]'
  ].join(',');
  const allRoots = [document];
  for (let i = 0; i < allRoots.length; i++) {
    for (const element of allRoots[i].querySelectorAll('*')) {
      if (element.shadowRoot) allRoots.push(element.shadowRoot);
    }
  }
  const elements = [...new Set(allRoots.flatMap(root => [...root.querySelectorAll(selector)]))];
  const candidates = elements.map(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {element, rect, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
  }).filter(({element, rect}) =>
    !element.disabled && element.getAttribute('aria-hidden') !== 'true' &&
    rect.width >= 18 && rect.height >= 18 &&
    rect.bottom > -innerHeight * 2 && rect.top < innerHeight * 4 &&
    rect.right > -innerWidth * 2 && rect.left < innerWidth * 4 &&
    getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none'
  );
  if (!candidates.length) return 'no-candidates';

  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  let current = candidates.find(candidate => candidate.element === active);
  if (!current) {
    const forward = direction === 'down' || direction === 'right';
    // Disney+ starts with BODY focused. Start on a real content tile instead
    // of an accessibility skip link or a small header control.
    const content = candidates.filter(candidate =>
      candidate.rect.width >= 180 && candidate.rect.height >= 100 && candidate.rect.top > 80
    );
    const startingPool = content.length ? content : candidates;
    current = startingPool.reduce((best, candidate) => {
      const rank = forward ? candidate.y * innerWidth + candidate.x
                           : (innerHeight - candidate.y) * innerWidth + (innerWidth - candidate.x);
      return !best || rank < best.rank ? { ...candidate, rank } : best;
    }, null);
    current.element.focus({preventScroll: true});
    current.element.scrollIntoView({block: 'nearest', inline: 'nearest'});
    return 'focused-initial';
  }

  const vertical = direction === 'up' || direction === 'down';
  const sign = direction === 'up' || direction === 'left' ? -1 : 1;
  const choices = candidates.filter(candidate => {
    if (candidate.element === current.element) return false;
    const primary = vertical ? candidate.y - current.y : candidate.x - current.x;
    return primary * sign > 4;
  }).map(candidate => {
    const primary = Math.abs(vertical ? candidate.y - current.y : candidate.x - current.x);
    const cross = Math.abs(vertical ? candidate.x - current.x : candidate.y - current.y);
    // A narrow directional cone prevents Down from choosing the next inline
    // control merely because it occurs next in DOM order.
    const offAxisPenalty = cross > primary * 1.35 ? 100000 : 0;
    return {candidate, score: primary * 10 + cross * 2 + offAxisPenalty};
  }).sort((a, b) => a.score - b.score);

  if (!choices.length || choices[0].score >= 100000) return 'edge';
  const next = choices[0].candidate.element;
  next.focus({preventScroll: true});
  next.scrollIntoView({block: 'nearest', inline: 'nearest'});
  return 'focused';
})($DIRECTION)
"""


class BidiClient:
    def __init__(self) -> None:
        self.socket = websocket.create_connection(
            REMOTE_AGENT, timeout=3, suppress_origin=True
        )
        self.next_id = 0

    def close(self) -> None:
        self.socket.close()

    def command(self, method: str, params: dict[str, object]) -> dict[str, object]:
        self.next_id += 1
        command_id = self.next_id
        self.socket.send(json.dumps({"id": command_id, "method": method, "params": params}))
        while True:
            response = json.loads(self.socket.recv())
            if response.get("id") != command_id:
                continue
            if response.get("type") == "error":
                raise RuntimeError(response.get("message") or response.get("error") or "BiDi command failed")
            return response["result"]


def move(direction: str) -> str:
    if direction not in {"up", "down", "left", "right"}:
        raise ValueError("Unknown direction")
    client = BidiClient()
    session_started = False
    try:
        client.command("session.new", {"capabilities": {}})
        session_started = True
        tree = client.command("browsingContext.getTree", {"maxDepth": 0})
        contexts = [item for item in tree["contexts"] if "disneyplus.com" in item.get("url", "")]
        if not contexts:
            raise RuntimeError("The Disney+ browser tab is not available")
        expression = SPATIAL_NAVIGATION_SCRIPT.replace("$DIRECTION", json.dumps(direction))
        result = client.command("script.evaluate", {
            "expression": expression,
            "target": {"context": contexts[0]["context"]},
            "awaitPromise": False,
            "userActivation": True,
        })
        if result.get("type") != "success":
            raise RuntimeError("Disney+ rejected spatial navigation")
        outcome = result.get("result", {}).get("value")
        if outcome in {"no-candidates", "edge"}:
            raise RuntimeError("No Disney+ item exists in that direction")
        return f"Disney+ focus moved {direction}"
    finally:
        if session_started:
            try:
                client.command("session.end", {})
            except (OSError, RuntimeError, websocket.WebSocketException):
                pass
        client.close()
