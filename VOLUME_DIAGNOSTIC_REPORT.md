# Volume Attenuation Diagnostic Report

Date: 2026-08-18  
System: piPlay Living Room TV  
Playback observed: Disney+ in Firefox (`Moon Knight | Disney+`)

## Reported behavior

The audible volume slowly decreases after several minutes and can become effectively inaudible. The behavior is gradual and inconsistent, not a binary mute event.

The volume had reportedly been set to 40%. During diagnosis, all live readings of the HDMI sink reported 60%; the source of that discrepancy was not identified.

## Live observations

- PipeWire HDMI sink: `alsa_output.platform-107c706400.hdmi.hdmi-stereo`
- HDMI sink gain: `0.60` (60%)
- Firefox stream gain: `1.00` (100%)
- Firefox stream state: active, live, and uncorked
- Audio format: stereo PCM at 48 kHz
- PipeWire processing errors/underruns observed: zero
- Sink idle suspension: disabled (`node.pause-on-idle = false`)
- ALSA HDMI device: no separate hardware volume mixer exposed
- Controller and Firefox services remained running

Both the HDMI sink and Firefox stream gains were sampled every five seconds for four minutes. They remained exactly 60% and 100%, respectively, without muting or measurable gain drift.

## Code inspection

The piPlay controller does not contain a timer, idle handler, or automatic volume-reduction routine.

The server can change volume only in response to an explicit `/api/action` request:

- `volume/up` runs `wpctl set-volume ... 5%+`
- `volume/down` runs `wpctl set-volume ... 5%-`
- `volume/mute` runs `wpctl set-mute ... toggle`

The web interface polls status every 15 seconds, but that operation only reads and displays the sink volume and mute state.

## Conclusion

The initial binary-mute theory was incorrect. No mute event or gradual change in the system-controlled gain was observed.

The audible attenuation occurs outside the gain stages reported by piPlay. The leading location is the decoded audio signal produced by Disney+/Firefox, which can become quieter while the Firefox stream and HDMI sink remain active at constant gain. Processing in the receiving TV or other downstream HDMI equipment is another possible location.

The piPlay percentage is therefore not a measurement of audible output. It reports only the PipeWire HDMI sink gain and cannot reveal changes within the program's PCM audio or downstream television processing.

A Disney+ playback-session JavaScript error appeared in the Firefox service log before the investigation. This is consistent with a player-side problem but is not sufficient to prove causation.

## Limitations and useful next capture

The attenuation did not correspond to a gain change during the four-minute observation window. To isolate a future occurrence conclusively, capture these simultaneously while the loudness is actively falling:

1. HDMI sink gain
2. Firefox stream gain
3. PCM signal level at the HDMI sink monitor
4. TV/receiver sound-mode and automatic-volume settings

If gains 1 and 2 remain fixed while PCM amplitude falls, the source is Firefox/Disney+ or the program audio. If PCM amplitude remains stable while audible output falls, the fault is in the TV or downstream HDMI audio path.

## Safety record

The investigation was read-only. No files, settings, volume levels, services, or playback state were changed during diagnosis.
