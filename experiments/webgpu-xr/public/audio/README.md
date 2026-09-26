# Irchiinnuss — Arrival

An original synthesized ambient score created for this Lumen Apeiron prototype.
There are no recordings, samples, downloaded songs, vocals, or third-party music
inputs. The composition and synthesis source are included in
`../../scripts/generate-ambient.mjs`; the asset carries the same project terms
as that source. This is a stereo soundtrack, rather than a spatial source that
turns with the listener's head.

The 48-second loop layers slowly overlapping D-minor-family pads, a pentatonic
glass melody, a quiet bass tone, and circular stereo delay taps. Oscillator
frequencies complete integer cycles in 48 seconds and the delay wraps around
the score, so the PCM source has no silent padding or abrupt envelope reset at
the loop boundary. Vorbis is lossy; the bundled file preserves all 1,536,000
stereo frames. Playback adds 25 ms fades on explicit start/pause. Audible loop
quality still needs listening checks, including on the headset.

Chromium 148.0.7778.96 decoded the Ogg to 48.022 seconds: 1,536,704 frames at
32 kHz, or 2,305,056 frames after resampling to 48 kHz. A SHA-256 comparison of
both channels proved the first 1,536,000 frames at 32 kHz exactly match the
48-second FFmpeg decode. The remaining 704 frames are a trailing decoder tail,
not a leading delay or additional score. The player explicitly sets `loopEnd`
to 48 seconds and uses that same duration for resume offsets and the elapsed
display. It rejects a decoded buffer shorter than the score.

The measured left-channel boundary step fell from 0.22121 to 0.02492 at 32 kHz
and from 0.21034 to 0.01069 at 48 kHz after excluding the tail. These measurements
prove the padding was removed; they do not establish an inaudible seam.

Reproduce from any directory with Node and FFmpeg (libvorbis enabled):

```sh
rtk proxy timeout 120 node /home/maff/.codex/worktrees/webgpu-xr-spike/chaos-master-fp/experiments/webgpu-xr/scripts/generate-ambient.mjs
```

An optional absolute path as the final argument also saves the source PCM WAV.
The generator prints hashes and signal measurements. Two runs produced the
same hashes with the installed FFmpeg; other encoder versions may produce
different compressed bytes from the same PCM source.

| Property                  | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| File                      | `irchiinnuss-arrival.ogg`                                          |
| Format                    | Vorbis, 32 kHz, stereo, quality 5                                  |
| Duration                  | 48.000 seconds                                                     |
| Download                  | 334,119 bytes                                                      |
| PCM peak / RMS            | 0.5500 / 0.137875                                                  |
| Decoded Vorbis peak / RMS | 0.546268 / 0.138080                                                |
| Source WAV SHA-256        | `48b86344b492d12dc415959143762ccbbfd72782f4fc18926ce338a70d354753` |
| Bundled Ogg SHA-256       | `05f5b8fcbb330b1e242caa58ed2e9e7c6ed57d2de0414ac4267a10b795dce914` |

No AudioContext, download, or playback is started until the user presses Play.
Default output volume is 55%; mute and volume act after the analyser so the
orb's visual response can continue silently. Pausing freezes both the transport
and the current visual envelopes; resuming continues the same point. Restart
resets the music clock and envelopes. The music clock stays continuous across
loop boundaries, while the elapsed time display wraps every 48 seconds.

Analysis uses actual decoded audio: RMS energy and spectral power in 40–250 Hz,
250–2,000 Hz, and 2,000–8,000 Hz bands, clamped to 0–1 with 180 ms attack and
750 ms release. Frames delayed longer than 250 ms have their envelope update
capped to avoid a large jump. These are artistic controls, not calibrated
audio meters. The analyser precedes user output volume, so they are not a
measure of headphone loudness.

Node tests cover transport/async disposal contracts and deterministic envelope
math. They do not prove browser decoding, audible quality, headset speaker
balance, or native XR audio behavior; those require browser/device checks.
