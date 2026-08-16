#!/usr/bin/env python3
"""Launch the piPlay kiosk in Firefox at an allowlisted destination."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse


APP_ROOT = Path(__file__).resolve().parent
HOME_URL = "http://127.0.0.1:4173/"
URL_FILE = APP_ROOT / ".piplay-browser-url"
ALLOWED_URLS = {
    HOME_URL,
    "https://open.spotify.com/",
    "https://www.disneyplus.com/home",
}
PROFILE = Path.home() / ".mozilla" / "firefox" / "piplay-kiosk"


def requested_url() -> str:
    try:
        candidate = URL_FILE.read_text().strip()
    except OSError:
        return HOME_URL
    if candidate not in ALLOWED_URLS:
        return HOME_URL
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return HOME_URL
    return candidate


if __name__ == "__main__":
    PROFILE.mkdir(parents=True, exist_ok=True)
    # Debian/Raspberry Pi Firefox otherwise presents an Enable DRM banner.
    # These preferences permit Firefox to install and use its Widevine CDM.
    (PROFILE / "user.js").write_text(
        '\n'.join(
            [
                'user_pref("media.eme.enabled", true);',
                'user_pref("media.gmp-widevinecdm.enabled", true);',
                'user_pref("media.gmp-widevinecdm.visible", true);',
                'user_pref("media.gmp-manager.updateEnabled", true);',
                'user_pref("browser.shell.checkDefaultBrowser", false);',
                'user_pref("browser.tabs.warnOnClose", false);',
                '',
            ]
        )
    )
    firefox = "/usr/bin/firefox"
    os.execv(
        firefox,
        [
            firefox,
            "--no-remote",
            "--profile",
            str(PROFILE),
            "--kiosk",
            requested_url(),
        ],
    )
