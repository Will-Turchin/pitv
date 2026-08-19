#!/usr/bin/env python3
"""piPlay local web server and Raspberry Pi TV-control API."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


APP_ROOT = Path(__file__).resolve().parent
DIST_ROOT = APP_ROOT / "dist"
STATE_FILE = APP_ROOT / ".piplay-state.json"
BROWSER_URL_FILE = APP_ROOT / ".piplay-browser-url"
PORT = int(os.environ.get("PIPLAY_PORT", "4173"))
CEC_DEVICE = os.environ.get("PIPLAY_CEC_DEVICE", "/dev/cec1")
CEC_PHYSICAL_ADDRESS = os.environ.get("PIPLAY_CEC_PHYSICAL_ADDRESS", "2.0.0.0")
DISPLAY_WIDTH = int(os.environ.get("PIPLAY_DISPLAY_WIDTH", "1920"))
DISPLAY_HEIGHT = int(os.environ.get("PIPLAY_DISPLAY_HEIGHT", "1080"))
HOME_URL = f"http://127.0.0.1:{PORT}/"
APP_URLS = {
    "Home": HOME_URL,
    "Disney+": "https://www.disneyplus.com/home",
    "Spotify": "https://open.spotify.com/",
}
CONTROL_ENV = {
    **os.environ,
    "HOME": str(Path.home()),
    "XDG_RUNTIME_DIR": f"/run/user/{os.getuid()}",
    "WAYLAND_DISPLAY": "wayland-0",
    "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{os.getuid()}/bus",
}

STATE_LOCK = threading.Lock()
ACTION_LOCK = threading.Lock()
SCREENSHOT_LOCK = threading.Lock()


def run(command: list[str], timeout: float = 8, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        env=CONTROL_ENV,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=check,
    )


def read_state() -> dict[str, object]:
    with STATE_LOCK:
        try:
            return json.loads(STATE_FILE.read_text())
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {"mode": "Home", "updated": time.time()}


def write_state(mode: str) -> None:
    with STATE_LOCK:
        STATE_FILE.write_text(json.dumps({"mode": mode, "updated": time.time()}))


def is_active(unit: str) -> bool:
    return run(["systemctl", "--user", "is-active", "--quiet", unit]).returncode == 0


def stop_unit(unit: str) -> None:
    """Stop a display app without allowing a slow GUI shutdown to wedge the API."""
    try:
        run(["systemctl", "--user", "stop", unit], timeout=8)
    except subprocess.TimeoutExpired:
        run(["systemctl", "--user", "kill", "--kill-whom=all", "--signal=KILL", unit], timeout=3)
    # GUI processes can report a non-zero exit while shutting down normally.
    # Do not leave that stale result presented as a current service failure.
    run(["systemctl", "--user", "reset-failed", unit], timeout=3)


def audio_status() -> tuple[int, bool]:
    output = run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"]).stdout
    match = re.search(r"Volume:\s+([0-9.]+)", output)
    volume = round(float(match.group(1)) * 100) if match else 0
    return max(0, min(100, volume)), "[MUTED]" in output


def tv_power_status() -> str:
    try:
        output = run(
            [
                "cec-ctl", "-d", CEC_DEVICE, "--playback", "-o", "piPlay",
                "--to", "0", "--give-device-power-status",
            ],
            timeout=4,
        ).stdout.lower()
        match = re.search(r"pwr-state:\s+([a-z-]+)", output)
        return match.group(1) if match else "unknown"
    except (OSError, subprocess.TimeoutExpired):
        return "unavailable"


def local_ip() -> str:
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("1.1.1.1", 80))
        address = probe.getsockname()[0]
        probe.close()
        return address
    except OSError:
        return "127.0.0.1"


def status_payload(include_tv: bool = True) -> dict[str, object]:
    volume, muted = audio_status()
    disk = shutil.disk_usage(Path.home())
    state = read_state()
    return {
        "online": True,
        "hostname": socket.gethostname(),
        "ip": local_ip(),
        "mode": state.get("mode", "Home"),
        "volume": volume,
        "muted": muted,
        "tvPower": tv_power_status() if include_tv else "unknown",
        "display": "VIZIO D32x-D1 · HDMI 2",
        "browser": is_active("piplay-living-room-tv-browser.service"),
        "kodi": is_active("piplay-kodi.service"),
        "freeGb": round(disk.free / 1_000_000_000),
        "updated": int(time.time()),
    }


def wtype_key(*keys: str) -> None:
    for key in keys:
        run(["wtype", "-k", key], timeout=3, check=True)


def type_text(value: str) -> None:
    """Type user-provided text without passing it through a shell."""
    if not value or len(value) > 512:
        raise ValueError("Text must be between 1 and 512 characters")
    if any(ord(character) < 32 for character in value):
        raise ValueError("Text contains unsupported control characters")
    run(["wtype", "--", value], timeout=8, check=True)


def capture_display() -> bytes:
    """Capture the current Wayland output at preview resolution."""
    with SCREENSHOT_LOCK:
        result = subprocess.run(
            ["grim", "-t", "png", "-s", "0.5", "-l", "3", "-"], env=CONTROL_ENV,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5,
        )
    if result.returncode != 0 or not result.stdout:
        raise RuntimeError(result.stderr.decode(errors="replace").strip() or "Display capture failed")
    return result.stdout


def navigate_browser(url: str) -> None:
    stop_unit("piplay-kodi.service")
    expected_origin(url)
    BROWSER_URL_FILE.write_text(url)
    run(["systemctl", "--user", "restart", "piplay-living-room-tv-browser.service"], timeout=15, check=True)
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if is_active("piplay-living-room-tv-browser.service"):
            process = run(["pgrep", "-f", "firefox.*piplay-kiosk"], timeout=2)
            if process.returncode == 0:
                return
        time.sleep(0.25)
    raise RuntimeError("Firefox kiosk did not start")


def expected_origin(url: str) -> tuple[str, str, int | None]:
    parsed = urlparse(url)
    allowed = {urlparse(candidate) for candidate in APP_URLS.values()}
    if parsed not in allowed:
        raise ValueError("Browser destination is not allowlisted")
    return parsed.scheme, parsed.hostname or "", parsed.port


def launch(mode: str) -> str:
    if mode == "My Media":
        stop_unit("piplay-living-room-tv-browser.service")
        run(["systemctl", "--user", "start", "piplay-kodi.service"], timeout=15, check=True)
        message = "Kodi launched"
    elif mode in APP_URLS:
        navigate_browser(APP_URLS[mode])
        message = f"{mode} launched"
    else:
        raise ValueError("Unknown app")
    write_state(mode)
    return message


def media_action(value: str) -> str:
    playerctl = {"playpause": "play-pause", "previous": "previous", "next": "next"}
    result = run(["playerctl", playerctl[value]], timeout=3)
    if result.returncode != 0:
        fallback = {"playpause": "space", "previous": "XF86AudioPrev", "next": "XF86AudioNext"}
        wtype_key(fallback[value])
    return value.replace("playpause", "play / pause").title()


def cec(*arguments: str) -> str:
    command = ["cec-ctl", "-d", CEC_DEVICE, "--playback", "-o", "piPlay", *arguments]
    result = run(command, timeout=5)
    if result.returncode != 0 or "failed" in result.stdout.lower():
        raise RuntimeError(result.stdout.strip() or "CEC command failed")
    return result.stdout


def delayed_system_action(command: str) -> None:
    def execute() -> None:
        run(["sudo", "systemctl", command], timeout=5)
    threading.Timer(1.0, execute).start()


def perform_action(payload: dict[str, object]) -> tuple[str, dict[str, object]]:
    action = str(payload.get("action", ""))
    value = str(payload.get("value", ""))
    with ACTION_LOCK:
        if action == "launch":
            message = launch(value)
        elif action == "key":
            key_map = {
                "up": "Up", "down": "Down", "left": "Left", "right": "Right",
                "ok": "Return", "back": "Escape", "tab": "Tab", "delete": "BackSpace",
            }
            if value == "shift-tab":
                run(["wtype", "-M", "shift", "-k", "Tab", "-m", "shift"], timeout=3, check=True)
            elif value not in key_map:
                raise ValueError("Unknown key")
            else:
                wtype_key(key_map[value])
            message = f"{value.title()} sent"
        elif action == "text":
            type_text(value)
            message = "Text sent"
        elif action == "pointer":
            parts = value.split(":")
            if parts[0] == "move" and len(parts) == 3:
                dx, dy = (max(-500, min(500, int(part))) for part in parts[1:])
                run(["wlrctl", "pointer", "move", str(dx), str(dy)], timeout=3, check=True)
                message = "Pointer moved"
            elif parts[0] == "click" and len(parts) == 3:
                x, y = (float(part) for part in parts[1:])
                if not 0 <= x <= 1 or not 0 <= y <= 1:
                    raise ValueError("Pointer coordinates are outside the display")
                run(["wlrctl", "pointer", "move", "-10000", "-10000"], timeout=3, check=True)
                run(["wlrctl", "pointer", "move", str(round(x * DISPLAY_WIDTH)), str(round(y * DISPLAY_HEIGHT))], timeout=3, check=True)
                run(["wlrctl", "pointer", "click"], timeout=3, check=True)
                message = "TV clicked"
            elif parts[0] == "scroll" and len(parts) == 2:
                amount = max(-10, min(10, int(parts[1])))
                run(["wlrctl", "pointer", "scroll", str(amount), "0"], timeout=3, check=True)
                message = "Scrolled"
            elif value == "click":
                run(["wlrctl", "pointer", "click"], timeout=3, check=True)
                message = "Clicked"
            else:
                raise ValueError("Unknown pointer action")
        elif action == "media":
            if value not in {"playpause", "previous", "next"}:
                raise ValueError("Unknown media action")
            message = media_action(value)
        elif action == "volume":
            if value == "up":
                run(["wpctl", "set-volume", "-l", "1.0", "@DEFAULT_AUDIO_SINK@", "5%+"], check=True)
                message = "Volume up"
            elif value == "down":
                run(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "5%-"], check=True)
                message = "Volume down"
            elif value == "mute":
                run(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"], check=True)
                message = "Mute toggled"
            else:
                raise ValueError("Unknown volume action")
        elif action == "tv":
            if value == "standby":
                cec("--to", "0", "--standby")
                message = "TV standby requested"
            elif value == "wake":
                cec("--to", "0", "--image-view-on")
                cec("--active-source", f"phys-addr={CEC_PHYSICAL_ADDRESS}")
                message = "TV wake requested"
            else:
                raise ValueError("Unknown TV action")
        elif action == "system":
            if value == "reconnect":
                stop_unit("piplay-kodi.service")
                BROWSER_URL_FILE.write_text(HOME_URL)
                run(["systemctl", "--user", "restart", "piplay-living-room-tv-browser.service"], timeout=15, check=True)
                write_state("Home")
                message = "Display reconnected"
            elif value == "exit":
                stop_unit("piplay-kodi.service")
                stop_unit("piplay-living-room-tv-browser.service")
                message = "Display app stopped"
            elif value in {"reboot", "poweroff"}:
                delayed_system_action(value)
                message = "Pi restart scheduled" if value == "reboot" else "Pi shutdown scheduled"
            else:
                raise ValueError("Unknown system action")
        else:
            raise ValueError("Unknown action")
    return message, status_payload(include_tv=False)


class PiPlayHandler(SimpleHTTPRequestHandler):
    server_version = "piPlay/1.0"

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(DIST_ROOT), **kwargs)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.client_address[0]} - {format % args}", flush=True)

    def send_json(self, payload: dict[str, object], status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        return urlparse(origin).netloc == self.headers.get("Host")

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/status":
            try:
                self.send_json(status_payload())
            except Exception as error:
                self.send_json({"online": False, "error": str(error)}, HTTPStatus.SERVICE_UNAVAILABLE)
            return
        if path == "/api/screen":
            try:
                image = capture_display()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(image)))
                self.send_header("Cache-Control", "no-store, max-age=0")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(image)
            except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                self.send_json({"ok": False, "error": str(error)}, HTTPStatus.SERVICE_UNAVAILABLE)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/action":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self.same_origin():
            self.send_json({"ok": False, "error": "Cross-origin request rejected"}, HTTPStatus.FORBIDDEN)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > 4096:
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(length))
            message, status = perform_action(payload)
            self.send_json({"ok": True, "message": message, "status": status})
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({"ok": False, "error": str(error)}, HTTPStatus.BAD_REQUEST)
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            self.send_json({"ok": False, "error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)


if __name__ == "__main__":
    if not DIST_ROOT.is_dir():
        raise SystemExit(f"Missing production build: {DIST_ROOT}")
    mimetypes.add_type("application/javascript", ".js")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), PiPlayHandler)
    print(f"piPlay serving {DIST_ROOT} on 0.0.0.0:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
