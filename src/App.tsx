import { useEffect, useMemo, useState } from "react";

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
};

const initialStatus: PiStatus = {
  online: false,
  hostname: "pitv",
  ip: "—",
  mode: "Home",
  volume: 0,
  muted: false,
  tvPower: "checking",
  display: "VIZIO TV · HDMI",
  browser: false,
  kodi: false,
  freeGb: 0,
};

const serviceTiles = [
  { name: "Disney+", className: "disney", eyebrow: "Streaming", meta: "Chromium fullscreen", mark: "D+" },
  { name: "Spotify", className: "spotify", eyebrow: "Music", meta: "Spotify Web Player", mark: "◉" },
  { name: "My Media", className: "kodi", eyebrow: "Library", meta: "Kodi local media", mark: "K" },
];

const spotifyTrack = {
  title: "Midnight City",
  artist: "M83",
  album: "Hurry Up, We’re Dreaming",
  color: "#f09b75",
};

const disneyItems = [
  { title: "The Mandalorian", kind: "Series", color: "#344869", accent: "#8dd6ff" },
  { title: "Luca", kind: "Movie", color: "#278d93", accent: "#ffd979" },
  { title: "Andor", kind: "Series", color: "#392b38", accent: "#df7659" },
  { title: "Encanto", kind: "Movie", color: "#6b3f82", accent: "#ffd76a" },
  { title: "Moana", kind: "Movie", color: "#0c7584", accent: "#f9b869" },
];

const mediaItems = [
  { title: "Movies", meta: "Kodi library", color: "#4d6572", icon: "▶" },
  { title: "TV Shows", meta: "Kodi library", color: "#c26237", icon: "▣" },
  { title: "Videos", meta: "Local files", color: "#bd7947", icon: "V" },
  { title: "Pictures", meta: "Local files", color: "#3a7569", icon: "P" },
  { title: "Music", meta: "Kodi library", color: "#70568d", icon: "♪" },
];

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("Home");
  const [tab, setTab] = useState<RemoteTab>("Remote");
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(42);
  const [volume, setVolume] = useState(68);
  const [muted, setMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState("Ready to control your TV");
  const [clock, setClock] = useState("");
  const [status, setStatus] = useState<PiStatus>(initialStatus);
  const [busy, setBusy] = useState(false);

  const refreshStatus = async () => {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Pi did not respond");
      const next = await response.json() as PiStatus;
      setStatus(next);
      setVolume(next.volume);
      setMuted(next.muted);
      if (next.mode) setMode(next.mode);
    } catch {
      setStatus((current) => ({ ...current, online: false }));
    }
  };

  const sendCommand = async (actionName: string, value: string) => {
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
    if (!isPlaying || mode !== "Spotify") return;
    const timer = window.setInterval(() => setProgress((value) => value >= 100 ? 0 : value + 0.25), 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, mode]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selection = useMemo(() => mode === "Disney+" ? disneyItems[selectedIndex % disneyItems.length] : mediaItems[selectedIndex % mediaItems.length], [mode, selectedIndex]);

  const setAppMode = async (next: Mode) => {
    setMode(next);
    setTab("Remote");
    setSelectedIndex(next === "Disney+" ? 1 : 0);
    setToast(`Launching ${next}…`);
    const worked = await sendCommand("launch", next);
    if (!worked) setMode(status.mode);
  };

  const move = (direction: "left" | "right" | "up" | "down") => {
    const step = direction === "left" || direction === "up" ? -1 : 1;
    const total = mode === "Disney+" ? disneyItems.length : mode === "My Media" ? mediaItems.length : 3;
    setSelectedIndex((current) => (current + step + total) % total);
    void sendCommand("key", direction);
  };

  const action = (label: string) => {
    if (label === "Play / Pause") { setIsPlaying((value) => !value); void sendCommand("media", "playpause"); return; }
    if (label === "Previous") { void sendCommand("media", "previous"); return; }
    if (label === "Next") { void sendCommand("media", "next"); return; }
    if (label === "Mute") { void sendCommand("volume", "mute"); return; }
    if (label === "Volume Up") { void sendCommand("volume", "up"); return; }
    if (label === "Volume Down") { void sendCommand("volume", "down"); return; }
    if (label === "Center / OK") { void sendCommand("key", "ok"); return; }
    if (label === "Back") { void sendCommand("key", "back"); return; }
    setToast(label);
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

          <div className="device-status-card">
            <div className="device-orb"><span>π</span></div>
            <div className="device-copy"><div className="device-name">Living Room TV <span className="connected"><span className="status-dot"></span>{status.online ? "Connected" : "Offline"}</span></div><div className="device-meta">{status.hostname} <span className="meta-separator">·</span> {status.display}</div></div>
            <div className="mode-chip">{mode}</div>
          </div>

          <div className="mobile-tabs" role="tablist" aria-label="Choose remote or TV preview">
            {(["Remote", "TV Preview"] as RemoteTab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>{item === "Remote" ? <Icon>⌁</Icon> : <Icon>▣</Icon>}{item}</button>)}
          </div>

          <div className={`phone-surface ${tab === "TV Preview" ? "tab-hidden" : ""}`}>
            <>
              <div className="launcher-grid">
                {serviceTiles.map((tile) => <button key={tile.name} className={`launcher-card ${tile.className} ${mode === tile.name ? "selected" : ""}`} onClick={() => setAppMode(tile.name as Mode)}><span className="launcher-mark">{tile.mark}</span><span className="launcher-copy"><strong>{tile.name}</strong><small>{tile.meta}</small></span><span className="launch-arrow">↗</span></button>)}
              </div>
              <button className={`home-launcher ${mode === "Home" ? "selected" : ""}`} onClick={() => setAppMode("Home")}><span className="home-launcher-icon">⌂</span><span><strong>Home</strong><small>piPlay home</small></span><span className="launch-arrow">↗</span></button>
              <RemoteControls mode={mode} move={move} action={action} setAppMode={setAppMode} volume={volume} muted={muted} busy={busy} />
            </>
          </div>

          <div className={`mobile-preview ${tab === "Remote" ? "tab-hidden" : ""}`}><TvScreen mode={mode} clock={clock} selectedIndex={selectedIndex} isPlaying={isPlaying} progress={progress} selection={selection} setAppMode={setAppMode} /></div>
          <div className="toast" aria-live="polite">{toast && <><span className="toast-pulse"></span>{toast}</>}</div>
        </section>

        <section className="preview-column">
          <div className="preview-heading"><div><p className="overline">CONNECTED DISPLAY</p><h2>TV Preview</h2></div><div className="preview-live"><span className="status-dot"></span>Live preview</div></div>
          <div className="tv-frame"><div className="tv-screen"><TvScreen mode={mode} clock={clock} selectedIndex={selectedIndex} isPlaying={isPlaying} progress={progress} selection={selection} setAppMode={setAppMode} /></div><div className="tv-stand"><span></span></div></div>
          <div className="preview-foot"><span><span className="tiny-led"></span> HDMI 1</span><span>Connected over local network</span><span>{clock || "—"}</span></div>
        </section>
      </div>

      <footer className="bottom-bar"><div className="footer-signal"><span className="status-dot"></span> Raspberry Pi {status.online ? "online" : "offline"}</div><div className="footer-hint"><span className="keycap">⌁</span> Live controls over your private network</div><button className="settings-link" onClick={() => setSettingsOpen((value) => !value)}><Icon>⚙</Icon> System</button></footer>

      {settingsOpen && <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="System information"><div className="settings-panel"><div className="panel-header"><div><p className="overline">SYSTEM CONTROL</p><h2>{status.hostname}</h2></div><button className="close-panel" onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button></div><div className="system-list"><SystemRow label="Display" value={status.display} good={status.tvPower === "on"} /><SystemRow label="TV power" value={status.tvPower} good={status.tvPower === "on"} /><SystemRow label="Network" value={status.ip} good={status.online} /><SystemRow label="HDMI audio" value={`${muted ? "Muted · " : ""}${volume}%`} good={!muted} /><SystemRow label="Local storage" value={`${status.freeGb} GB available`} /><SystemRow label="Kodi" value={status.kodi ? "Running" : "Ready"} good={status.kodi} /><SystemRow label="Chromium" value={status.browser ? "Running" : "Stopped"} good={status.browser} /></div><div className="system-actions"><button disabled={busy} onClick={() => void sendCommand("tv", "wake")}>Wake TV</button><button disabled={busy} onClick={() => void sendCommand("tv", "standby")}>TV Standby</button><button disabled={busy} onClick={() => { setToast("Reconnecting display…"); void sendCommand("system", "reconnect"); }}>Reconnect</button><button disabled={busy} onClick={() => { if (window.confirm("Restart the Raspberry Pi now?")) void sendCommand("system", "reboot"); }}>Restart Pi</button><button className="danger" disabled={busy} onClick={() => { if (window.confirm("Shut down the Raspberry Pi now?")) void sendCommand("system", "poweroff"); }}>Shut Down</button><button className="danger" disabled={busy} onClick={() => { setSettingsOpen(false); void sendCommand("system", "exit"); }}>Exit Display</button></div></div></div>}
    </main>
  );
}

function SystemRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className="system-row"><span>{label}</span><strong className={good ? "good-value" : ""}>{good && <span className="status-dot"></span>}{value}</strong></div>;
}

function RemoteControls({ mode, move, action, setAppMode, volume, muted, busy }: { mode: Mode; move: (direction: "left" | "right" | "up" | "down") => void; action: (label: string) => void; setAppMode: (mode: Mode) => void; volume: number; muted: boolean; busy: boolean }) {
  return <div className="remote-controls"><div className="control-label"><span>REMOTE</span><span className="control-mode">{busy ? "Sending…" : mode === "Home" ? "Choose an app" : `Navigate ${mode}`}</span></div><div className="dpad-wrap"><div className="dpad"><button disabled={busy} className="dpad-up" onClick={() => move("up")} aria-label="Up">↑</button><button disabled={busy} className="dpad-left" onClick={() => move("left")} aria-label="Left">←</button><button disabled={busy} className="dpad-ok" onClick={() => action("Center / OK")} aria-label="Center / OK">OK</button><button disabled={busy} className="dpad-right" onClick={() => move("right")} aria-label="Right">→</button><button disabled={busy} className="dpad-down" onClick={() => move("down")} aria-label="Down">↓</button></div><div className="back-home"><button disabled={busy} onClick={() => action("Back")}><span>↩</span>Back</button><button disabled={busy} onClick={() => setAppMode("Home")}><span>⌂</span>Home</button></div></div><div className="media-controls"><button disabled={busy} onClick={() => action("Previous")} aria-label="Previous"><span>◀</span><small>PREV</small></button><button disabled={busy} className="play-control" onClick={() => action("Play / Pause")} aria-label="Play or pause"><span>▶Ⅱ</span><small>PLAY</small></button><button disabled={busy} onClick={() => action("Next")} aria-label="Next"><span>▶</span><small>NEXT</small></button></div><div className="volume-controls"><button disabled={busy} onClick={() => action("Volume Down")} aria-label="Volume down">−</button><div className="volume-track"><span style={{ width: `${muted ? 0 : volume}%` }}></span></div><button disabled={busy} onClick={() => action("Volume Up")} aria-label="Volume up">+</button><button disabled={busy} className="mute-button" onClick={() => action("Mute")} aria-label="Mute">{muted ? "×" : "⌁"}</button></div></div>;
}

function SpotifyRemote({ progress, setProgress, isPlaying, setIsPlaying, volume, muted, setMuted, action }: { progress: number; setProgress: (value: number) => void; isPlaying: boolean; setIsPlaying: (value: boolean) => void; volume: number; muted: boolean; setMuted: (value: boolean) => void; action: (label: string) => void }) {
  const minutes = Math.floor((progress / 100) * 243 / 60);
  const seconds = Math.floor((progress / 100) * 243) % 60;
  return <div className="spotify-remote"><div className="now-playing-label"><span className="spotify-mini">◉</span><span>NOW PLAYING</span><span className="playing-eq"><i></i><i></i><i></i></span></div><div className="album-art" style={{ background: `linear-gradient(145deg, ${spotifyTrack.color}, #3e283c 60%, #171c2d)` }}><div className="album-sun"></div><div className="album-lines"></div><strong>M83</strong><small>HURRY UP,<br />WE’RE DREAMING</small></div><div className="track-details"><h2>{spotifyTrack.title}</h2><p>{spotifyTrack.artist} <span>·</span> {spotifyTrack.album}</p></div><div className="progress-area"><input type="range" min="0" max="100" value={progress} onChange={(event) => setProgress(Number(event.target.value))} aria-label="Playback progress" /><div><span>{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span><span>04:03</span></div></div><div className="spotify-actions"><button onClick={() => action("Shuffle")} aria-label="Shuffle">⤨</button><button onClick={() => action("Previous")} aria-label="Previous">◀</button><button className="spotify-play" onClick={() => { setIsPlaying(!isPlaying); action(isPlaying ? "Paused" : "Playing"); }} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? "Ⅱ" : "▶"}</button><button onClick={() => action("Next")} aria-label="Next">▶</button><button onClick={() => action("Repeat")} aria-label="Repeat">↻</button></div><div className="spotify-volume"><span>⌁</span><input type="range" min="0" max="100" value={muted ? 0 : volume} readOnly aria-label="Volume" /><button onClick={() => { setMuted(!muted); action(muted ? "Unmuted" : "Muted"); }}>{muted ? "×" : "●"}</button></div><p className="connect-note"><span className="status-dot"></span> Playing on Living Room TV via Spotify Connect</p></div>;
}

function TvScreen({ mode, clock, selectedIndex, isPlaying, progress, selection, setAppMode }: { mode: Mode; clock: string; selectedIndex: number; isPlaying: boolean; progress: number; selection: { title: string; kind?: string; color: string; accent?: string; meta?: string; icon?: string }; setAppMode: (mode: Mode) => void }) {
  if (mode === "Spotify") return <div className="tv-spotify"><div className="tv-spotify-ambient"></div><div className="tv-spotify-content"><div className="tv-kicker"><span className="spotify-mini">◉</span> SPOTIFY WEB PLAYER <span>· LIVING ROOM TV</span></div><div className="tv-spotify-body"><div className="tv-album-art" style={{ background: "linear-gradient(145deg, #57c785, #173f2a 65%, #111b17)" }}><div className="album-sun"></div><strong>◉</strong></div><div className="tv-track"><p>ACTIVE APP</p><h2>Spotify</h2><h3>Web Player</h3><span>Sign in on the TV, then use the media controls here.</span><div className="tv-progress"><span style={{ width: "100%" }}></span></div><div className="tv-progress-time"><span>Remote ready</span><span>HDMI audio</span></div><div className="tv-track-buttons"><span>⤨</span><span>◀</span><b>▶</b><span>▶</span><span>↻</span></div></div></div></div><div className="tv-clock">{clock}</div></div>;
  if (mode === "Disney+") return <div className="tv-disney"><div className="tv-appbar"><span className="disney-word">Disney<span>+</span></span><span>Home　 Originals　 Movies　 Series</span><b>{clock}</b></div><div className="disney-hero" style={{ background: `radial-gradient(circle at 68% 45%, ${selection.accent}44, transparent 27%), linear-gradient(90deg, ${selection.color} 0%, #101724 78%)` }}><div className="hero-copy"><small>{selection.kind} · New this week</small><h2>{selection.title}</h2><p>Stream a new adventure, only on Disney+.</p><button onClick={() => setAppMode("Disney+")}>Watch now <span>→</span></button></div><div className="hero-moon"></div></div><div className="tv-row-heading"><span>Recommended for you</span><small>Use the remote to browse</small></div><div className="tv-card-row">{disneyItems.map((item, index) => <div key={item.title} className={`tv-content-card ${index === selectedIndex ? "focused" : ""}`} style={{ background: `linear-gradient(145deg, ${item.accent}77, ${item.color})` }}><strong>{item.title}</strong><small>{item.kind}</small></div>)}</div><div className="tv-disney-footer"><span>Disney+ · Chromium Fullscreen</span><span>HDMI 1</span></div></div>;
  if (mode === "My Media") return <div className="tv-kodi"><div className="kodi-top"><div className="kodi-logo">KODI</div><div className="kodi-tabs"><span className="active">Movies</span><span>TV Shows</span><span>Music</span></div><span>{clock}</span></div><div className="kodi-body"><p className="kodi-kicker">MY MEDIA <span>· Local library</span></p><h2>{selection.title}</h2><p className="kodi-sub">Browse your collection from the phone remote</p><div className="kodi-card-row">{mediaItems.map((item, index) => <div key={item.title} className={`kodi-card ${index === selectedIndex ? "focused" : ""}`} style={{ background: `linear-gradient(145deg, ${item.color}, #171a24)` }}><span>{item.icon}</span><strong>{item.title}</strong><small>{item.meta}</small></div>)}</div><div className="kodi-status"><span><i></i> Library updated just now</span><span>347 GB available</span></div></div></div>;
  return <div className="tv-home"><div className="home-top"><span className="pi-word"><b>π</b> piPlay</span><span><span className="tv-wifi">⌁</span> Wi-Fi connected　 {clock}</span></div><div className="home-center"><p>GOOD EVENING</p><h2>What would you like to watch?</h2><div className="home-tv-tiles">{serviceTiles.map((tile) => <button key={tile.name} onClick={() => setAppMode(tile.name as Mode)} className={`home-tv-tile ${tile.className}`}><span>{tile.mark}</span><strong>{tile.name}</strong><small>{tile.eyebrow}</small></button>)}</div></div><div className="home-bottom"><span>Raspberry Pi 5 · HDMI 1</span><span>⚙ Settings</span></div></div>;
}
