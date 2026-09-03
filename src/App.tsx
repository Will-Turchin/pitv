import { useEffect, useRef, useState } from "react";

type Mode = "Home" | "Spotify" | "Disney+" | "My Media";
type RemoteTab = "Remote" | "TV Preview";

type PiStatus = {
  online: boolean;
  hostname: string;
  ip: string;
  mode: Mode;
  volume: number;
  muted: boolean;
  tvPower: string;
  display: string;
  browser: boolean;
  kodi: boolean;
  freeGb: number;
  nowPlaying: NowPlaying | null;
};

type NowPlaying = { status: string; title: string; artist: string; album: string; artUrl: string; lengthMs: number; positionMs: number };

const initialStatus: PiStatus = {
  online: false,
  hostname: "pitv",
  ip: "—",
  mode: "Home",
  volume: 0,
  muted: false,
  tvPower: "checking",
  display: "HDMI display",
  browser: false,
  kodi: false,
  freeGb: 0,
  nowPlaying: null,
};

const serviceTiles = [
  { name: "Disney+", className: "disney", eyebrow: "Streaming", meta: "Streaming", mark: "Disney+" },
  { name: "Spotify", className: "spotify", eyebrow: "Music", meta: "Music", mark: "Spotify" },
  { name: "My Media", className: "kodi", eyebrow: "Library", meta: "Kodi", mark: "Kodi" },
];

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function BrandIcon({ name }: { name: Mode }) {
  if (name === "Spotify") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M6.8 9.4c3.8-1.1 7.8-.8 10.9.9M7.5 12.5c3.1-.8 6.6-.5 9.3.8M8.2 15.4c2.7-.6 5.5-.3 7.8.7" fill="none" stroke="#132019" strokeWidth="1.7" strokeLinecap="round"/></svg>;
  if (name === "Disney+") return <svg viewBox="0 0 34 24" aria-hidden="true"><path d="M2 9.2C8.4 2 21.4 1.2 29 6.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M5 11.5v7h3.2c3 0 4.6-1.2 4.6-3.6 0-2.3-1.6-3.4-4.6-3.4H5Zm13.2 0v7m-3.2-7v7m10-5v5m-2.5-2.5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (name === "My Media") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 4 4-4 4-4-4 4-4Zm-6 6 4 4-4 4-4-4 4-4Zm12 0 4 4-4 4-4-4 4-4Zm-6 6 4 4-4 4-4-4 4-4Z" fill="currentColor"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8v10h-6v-6H9v6H3V11Z" fill="currentColor"/></svg>;
}

const haptic = () => { if (navigator.vibrate) navigator.vibrate(8); };

export default function Home() {
  const [mode, setMode] = useState<Mode>("Home");
  const [tab, setTab] = useState<RemoteTab>("Remote");
  const [volume, setVolume] = useState(68);
  const [muted, setMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState("Ready to control your TV");
  const [clock, setClock] = useState("");
  const [status, setStatus] = useState<PiStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardText, setKeyboardText] = useState("");
  const commandEpoch = useRef(0);

  const refreshStatus = async () => {
    const epoch = commandEpoch.current;
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Pi did not respond");
      const next = await response.json() as PiStatus;
      if (epoch !== commandEpoch.current) return;
      setStatus(next);
      setVolume(next.volume);
      setMuted(next.muted);
      if (next.mode) setMode(next.mode);
    } catch {
      setStatus((current) => ({ ...current, online: false }));
    }
  };

  const sendCommand = async (actionName: string, value: string) => {
    commandEpoch.current += 1;
    setBusy(true);
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionName, value }),
      });
      const result = await response.json() as { ok: boolean; message?: string; error?: string; status?: PiStatus };
      if (!response.ok || !result.ok) throw new Error(result.error || "Command failed");
      if (result.status) {
        setStatus(result.status);
        setVolume(result.status.volume);
        setMuted(result.status.muted);
      }
      setToast(result.message || "Command sent");
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Command failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date()));
    tick();
    const timer = window.setInterval(tick, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const setAppMode = async (next: Mode) => {
    setMode(next);
    setTab("Remote");
    setToast(`Launching ${next}…`);
    const worked = await sendCommand("launch", next);
    if (!worked) setMode(status.mode);
  };

  const move = (direction: "left" | "right" | "up" | "down") => {
    haptic();
    void sendCommand("key", direction);
  };

  const action = (label: string) => {
    haptic();
    if (label === "Play / Pause") { void sendCommand("media", "playpause"); return; }
    if (label === "Previous") { void sendCommand("media", "previous"); return; }
    if (label === "Next") { void sendCommand("media", "next"); return; }
    if (label === "Mute") { void sendCommand("volume", "mute"); return; }
    if (label === "Volume Up") { void sendCommand("volume", "up"); return; }
    if (label === "Volume Down") { void sendCommand("volume", "down"); return; }
    if (label === "Center / OK") { void sendCommand("key", "ok"); return; }
    if (label === "Back") { void sendCommand("key", "back"); return; }
    setToast(label);
  };

  const sendTypedText = async () => {
    if (!keyboardText) return;
    if (await sendCommand("text", keyboardText)) setKeyboardText("");
  };

  const sendPointer = async (value: string) => {
    try {
      const response = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pointer", value }) });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Pointer command failed");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Pointer command failed");
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><span></span><span></span><span></span></div>
          <div><p className="brand-name">pi<span>play</span></p><p className="brand-sub">LOCAL TV REMOTE</p></div>
        </div>
        <div className="topbar-actions">
          <div className="network-pill"><span className="status-dot"></span><span className="hide-mobile">{status.online ? status.ip : "Pi offline"}</span><span className="wifi-symbol">⌁</span></div>
          <button className="top-icon" onClick={() => setSettingsOpen((value) => !value)} aria-label="Open settings">☼</button>
        </div>
      </header>

      <div className="workspace">
        <section className="phone-column">
          <div className="phone-heading">
            <div><p className="overline">REMOTE CONTROL</p><h1>Living Room TV</h1></div>
            <button className="more-button" onClick={() => setSettingsOpen((value) => !value)} aria-label="Toggle system panel">•••</button>
          </div>

          <div className="mobile-tabs" role="tablist" aria-label="Choose remote or TV preview">
            {(["Remote", "TV Preview"] as RemoteTab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => { haptic(); setTab(item); }} role="tab" aria-selected={tab === item}>{item === "Remote" ? <Icon>⌁</Icon> : <Icon>▣</Icon>}{item}</button>)}
          </div>

          <div className={`phone-surface ${tab === "TV Preview" ? "tab-hidden" : ""}`}>
            <>
              <RemoteControls mode={mode} move={move} action={action} setAppMode={setAppMode} volume={volume} muted={muted} busy={busy} keyboardOpen={keyboardOpen} setKeyboardOpen={setKeyboardOpen} keyboardText={keyboardText} setKeyboardText={setKeyboardText} sendTypedText={sendTypedText} sendCommand={sendCommand} />
              <ContextPanel mode={mode} nowPlaying={status.nowPlaying} action={action} />
              <div className="launcher-grid">
                {serviceTiles.map((tile) => <button key={tile.name} className={`launcher-card ${tile.className} ${mode === tile.name ? "selected" : ""}`} onClick={() => { haptic(); void setAppMode(tile.name as Mode); }}><span className="launcher-mark"><BrandIcon name={tile.name as Mode} /></span><span className="launcher-copy"><strong>{tile.name}</strong><small>{tile.meta}</small></span></button>)}
              </div>
              <button className={`home-launcher ${mode === "Home" ? "selected" : ""}`} onClick={() => { haptic(); void setAppMode("Home"); }}><span className="home-launcher-icon"><BrandIcon name="Home" /></span><span><strong>Home</strong><small>piPlay home</small></span><span className="launch-arrow">↗</span></button>
              <Trackpad sendPointer={sendPointer} />
              <div className="device-status-card">
                <span className="status-dot"></span><span className="device-name">{status.online ? "Living Room TV connected" : "Living Room TV offline"}</span>
                <span className="device-meta">{status.hostname} · {status.display}</span><span className="mode-chip">{mode}</span>
              </div>
            </>
          </div>

          <div className={`mobile-preview ${tab === "Remote" ? "tab-hidden" : ""}`}><LivePreview sendPointer={sendPointer} /></div>
          <div className="toast" aria-live="polite">{toast && <><span className="toast-pulse"></span>{toast}</>}</div>
        </section>

        <section className="preview-column">
          <div className="preview-heading"><div><p className="overline">CONNECTED DISPLAY</p><h2>TV Preview</h2></div><div className="preview-live"><span className="status-dot"></span>Live preview</div></div>
          <div className="tv-frame"><div className="tv-screen"><LivePreview sendPointer={sendPointer} /></div><div className="tv-stand"><span></span></div></div>
          <div className="preview-foot"><span><span className="tiny-led"></span> HDMI 1</span><span>Connected over local network</span><span>{clock || "—"}</span></div>
        </section>
      </div>

      <footer className="bottom-bar"><div className="footer-signal"><span className="status-dot"></span> Raspberry Pi {status.online ? "online" : "offline"}</div><div className="footer-hint"><span className="keycap">⌁</span> Live controls over your private network</div><button className="settings-link" onClick={() => setSettingsOpen((value) => !value)}><Icon>⚙</Icon> System</button></footer>

      {settingsOpen && <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="System information"><div className="settings-panel"><div className="panel-header"><div><p className="overline">SYSTEM CONTROL</p><h2>{status.hostname}</h2></div><button className="close-panel" onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button></div><div className="system-list"><SystemRow label="Display" value={status.display} good={status.tvPower === "on"} /><SystemRow label="TV power" value={status.tvPower} good={status.tvPower === "on"} /><SystemRow label="Network" value={status.ip} good={status.online} /><SystemRow label="HDMI audio" value={`${muted ? "Muted · " : ""}${volume}%`} good={!muted} /><SystemRow label="Local storage" value={`${status.freeGb} GB available`} /><SystemRow label="Kodi" value={status.kodi ? "Running" : "Stopped"} good={status.kodi} /><SystemRow label="Firefox" value={status.browser ? "Running" : "Stopped"} good={status.browser} /></div><div className="system-actions"><button disabled={busy} onClick={() => void sendCommand("tv", "wake")}>Wake TV</button><button disabled={busy} onClick={() => void sendCommand("tv", "standby")}>TV Standby</button><button disabled={busy} onClick={() => { setToast("Reconnecting display…"); void sendCommand("system", "reconnect"); }}>Reconnect</button><button disabled={busy} onClick={() => { if (window.confirm("Restart the Raspberry Pi now?")) void sendCommand("system", "reboot"); }}>Restart Pi</button><button className="danger" disabled={busy} onClick={() => { if (window.confirm("Shut down the Raspberry Pi now?")) void sendCommand("system", "poweroff"); }}>Shut Down</button><button className="danger" disabled={busy} onClick={() => { setSettingsOpen(false); void sendCommand("system", "exit"); }}>Exit Display</button></div></div></div>}
    </main>
  );
}

function SystemRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className="system-row"><span>{label}</span><strong className={good ? "good-value" : ""}>{good && <span className="status-dot"></span>}{value}</strong></div>;
}

function RemoteControls({ mode, move, action, setAppMode, volume, muted, busy, keyboardOpen, setKeyboardOpen, keyboardText, setKeyboardText, sendTypedText, sendCommand }: { mode: Mode; move: (direction: "left" | "right" | "up" | "down") => void; action: (label: string) => void; setAppMode: (mode: Mode) => void; volume: number; muted: boolean; busy: boolean; keyboardOpen: boolean; setKeyboardOpen: (value: boolean) => void; keyboardText: string; setKeyboardText: (value: string) => void; sendTypedText: () => Promise<void>; sendCommand: (action: string, value: string) => Promise<boolean> }) {
  return <div className="remote-controls">
    <div className="control-label"><span>REMOTE</span><span className="control-mode">{busy ? "Sending…" : mode === "Home" ? "Ready" : mode}</span></div>
    <div className="dpad-wrap"><div className="dpad"><button disabled={busy} className="dpad-up" onClick={() => move("up")} aria-label="Up">↑</button><button disabled={busy} className="dpad-left" onClick={() => move("left")} aria-label="Left">←</button><button disabled={busy} className="dpad-ok" onClick={() => action("Center / OK")} aria-label="Center / OK">OK</button><button disabled={busy} className="dpad-right" onClick={() => move("right")} aria-label="Right">→</button><button disabled={busy} className="dpad-down" onClick={() => move("down")} aria-label="Down">↓</button></div><div className="back-home"><button disabled={busy} onClick={() => action("Back")}><span>↩</span>Back</button><button disabled={busy} onClick={() => { haptic(); void setAppMode("Home"); }}><span>⌂</span>Home</button></div></div>
    <div className="media-controls"><button disabled={busy} onClick={() => action("Previous")} aria-label="Previous"><span>◀</span><small>PREV</small></button><button disabled={busy} className="play-control" onClick={() => action("Play / Pause")} aria-label="Play or pause"><span>▶Ⅱ</span><small>PLAY / PAUSE</small></button><button disabled={busy} onClick={() => action("Next")} aria-label="Next"><span>▶</span><small>NEXT</small></button></div>
    <div className="volume-controls"><button disabled={busy} onClick={() => action("Volume Down")} aria-label="Volume down">−</button><div className="volume-track"><span style={{ width: `${muted ? 0 : volume}%` }}></span></div><button disabled={busy} onClick={() => action("Volume Up")} aria-label="Volume up">+</button><button disabled={busy} className="mute-button" onClick={() => action("Mute")} aria-label="Mute">{muted ? "×" : "⌁"}</button></div>
    <div className="browser-controls"><button disabled={busy} onClick={() => void sendCommand("key", "shift-tab")}>⇤ Previous</button><button disabled={busy} onClick={() => void sendCommand("key", "tab")}>Next ⇥</button><button className={`keyboard-toggle ${keyboardOpen ? "active" : ""}`} onClick={() => { haptic(); setKeyboardOpen(!keyboardOpen); }} aria-label="Open text entry" aria-expanded={keyboardOpen}>⌨<span>Text</span></button></div>
    {keyboardOpen && <form className="remote-keyboard" onSubmit={(event) => { event.preventDefault(); void sendTypedText(); }}><label htmlFor="remote-text">Type into the selected field on TV</label><div><input id="remote-text" type="text" value={keyboardText} onChange={(event) => setKeyboardText(event.target.value)} placeholder="Search or enter text" autoComplete="off" autoFocus /><button type="submit" disabled={busy || !keyboardText}>Send</button></div><div className="keyboard-actions"><button type="button" disabled={busy} onClick={() => void sendCommand("key", "delete")}>⌫ Delete</button><button type="button" disabled={busy} onClick={() => void sendCommand("key", "ok")}>↵ Enter</button></div><small>Text is sent directly to the TV and never stored.</small></form>}
  </div>;
}

function ContextPanel({ mode, nowPlaying, action }: { mode: Mode; nowPlaying: NowPlaying | null; action: (label: string) => void }) {
  if (mode === "Spotify" && nowPlaying) return <section className="context-panel spotify-context"><div className="mini-art" aria-hidden="true">{/^https?:|^data:/.test(nowPlaying.artUrl) ? <img src={nowPlaying.artUrl} alt="" /> : <BrandIcon name="Spotify" />}</div><div className="context-copy"><small>NOW PLAYING</small><strong>{nowPlaying.title}</strong><span>{[nowPlaying.artist, nowPlaying.album].filter(Boolean).join(" · ")}</span></div><span className={`playing-dot ${nowPlaying.status === "playing" ? "active" : ""}`}>{nowPlaying.status === "playing" ? "Playing" : "Paused"}</span></section>;
  if (mode === "Spotify") return <section className="context-panel spotify-context empty-context"><div className="mini-art" aria-hidden="true"><BrandIcon name="Spotify" /></div><div className="context-copy"><small>SPOTIFY IS OPEN</small><strong>Choose something to play</strong><span>Track details will appear here</span></div></section>;
  if (mode === "Disney+") return <section className="context-panel disney-context"><div className="context-copy"><small>DISNEY+ IS OPEN</small><strong>Browse on the TV</strong><span>The focused title is shown in the live preview</span></div><button onClick={() => action("Center / OK")}>Open</button></section>;
  return <div className="apps-heading"><span>APPS</span><small>Launch on TV</small></div>;
}

function LivePreview({ sendPointer }: { sendPointer: (value: string) => Promise<void> }) {
  const [source, setSource] = useState(`/api/screen?t=${Date.now()}`);
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setSource(`/api/screen?t=${Date.now()}`), 1500);
    return () => window.clearInterval(timer);
  }, []);
  const clickScreen = (event: React.MouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const imageRatio = event.currentTarget.naturalWidth / event.currentTarget.naturalHeight;
    const boxRatio = rect.width / rect.height;
    const width = boxRatio > imageRatio ? rect.height * imageRatio : rect.width;
    const height = boxRatio > imageRatio ? rect.height : rect.width / imageRatio;
    const x = (event.clientX - rect.left - (rect.width - width) / 2) / width;
    const y = (event.clientY - rect.top - (rect.height - height) / 2) / height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) void sendPointer(`click:${x}:${y}`);
  };
  return <div className="live-screen">{available === false && <div className="preview-error"><strong>Live preview unavailable</strong><span>The controller could not capture the TV display.</span><button onClick={() => { setAvailable(null); setSource(`/api/screen?t=${Date.now()}`); }}>Retry</button></div>}<img className={available ? "loaded" : ""} src={source} alt="Live view of the TV display; tap anywhere to click" onClick={clickScreen} onLoad={() => setAvailable(true)} onError={() => setAvailable(false)} />{available && <><span className="live-screen-badge">LIVE · TAP TO CLICK</span></>}</div>;
}

function Trackpad({ sendPointer }: { sendPointer: (value: string) => Promise<void> }) {
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const dragDistance = useRef(0);
  const pending = useRef({ x: 0, y: 0 });
  const timer = useRef<number | null>(null);
  const flush = () => {
    timer.current = null;
    const { x, y } = pending.current;
    pending.current = { x: 0, y: 0 };
    if (x || y) void sendPointer(`move:${Math.round(x)}:${Math.round(y)}`);
  };
  const movePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!lastPoint.current) return;
    const dx = event.clientX - lastPoint.current.x;
    const dy = event.clientY - lastPoint.current.y;
    dragDistance.current += Math.abs(dx) + Math.abs(dy);
    pending.current.x += dx * 2;
    pending.current.y += dy * 2;
    lastPoint.current = { x: event.clientX, y: event.clientY };
    if (timer.current === null) timer.current = window.setTimeout(flush, 45);
  };
  return <section className="trackpad-section"><div className="control-label"><span>POINTER</span><span className="control-mode">Tap to click · drag to move</span></div><div className="trackpad" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragDistance.current = 0; lastPoint.current = { x: event.clientX, y: event.clientY }; }} onPointerMove={movePointer} onPointerUp={() => { lastPoint.current = null; flush(); if (dragDistance.current < 8) { haptic(); void sendPointer("click"); } }}><span>Tap to click</span><small>Drag to move the TV pointer</small></div><div className="pointer-buttons"><button onClick={() => void sendPointer("click")}>Click</button><button onClick={() => void sendPointer("scroll:-4")}>Scroll up</button><button onClick={() => void sendPointer("scroll:4")}>Scroll down</button></div></section>;
}
