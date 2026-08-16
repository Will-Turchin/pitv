# piPlay · Living Room TV

This is the standalone piPlay Living Room TV controller for a Raspberry Pi. The interface talks to a local Python API that launches Chromium or Kodi, sends Wayland remote-control keys, controls PipeWire HDMI audio, and controls TV power over HDMI-CEC.

## Requirements

- Node.js 20.19 or newer
- npm (included with Node.js)
- Python 3.11 or newer
- `cec-ctl`, `wpctl`, `wtype`, `playerctl`, Chromium, and Kodi

## Run locally

```bash
npm install
npm run dev
```

Build the frontend, then run `python3 server.py`. Open port 4173 from another device on the same private network.

## Production build

```bash
npm install
npm run build
npm run preview
```

The static production files are written to `dist/`. Serve that directory with any static web server, such as Nginx or Caddy, on the Raspberry Pi.

## Notes

The production service files are in `deploy/`. `browser_launcher.py` starts Chromium at the URL selected by the controller. The default hardware configuration targets `/dev/cec1`, physical HDMI address `2.0.0.0`, and Wayland display `wayland-0`; these can be overridden with environment variables in the service.
