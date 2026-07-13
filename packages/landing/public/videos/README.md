# Video ad creatives

Drop the exported MP4s here. Everything in `public/` is copied to the site root
as-is, so a file at `public/videos/foo.mp4` is served from `/videos/foo.mp4`.

The `/video-ads/` page (`src/pages/video-ads.astro`) references these
filenames — add the matching file and the poster is replaced by the playing
clip. Until a file exists, the card gracefully shows its poster frame and the
play button is a no-op.

| Slot on the page     | Expected file           | Format | Suggested export |
| -------------------- | ----------------------- | ------ | ---------------- |
| Featured reel        | `chaos-master-reel.mp4` | 16:9   | 1920 × 1080      |
| Paint with chaos     | `preroll-15.mp4`        | 16:9   | 1920 × 1080      |
| Endless mutations    | `short-endless.mp4`     | 9:16   | 1080 × 1920      |
| From noise to art    | `feed-noise-to-art.mp4` | 1:1    | 1080 × 1080      |
| Earth, reimagined    | `short-earth.mp4`       | 9:16   | 1080 × 1920      |
| Live in your browser | `preroll-browser.mp4`   | 16:9   | 1920 × 1080      |
| Any image, remixable | `feed-remix.mp4`        | 1:1    | 1080 × 1080      |

## Tips

- Export straight from Chaos Master's WebCodecs MP4 export (H.264 / AAC plays
  everywhere). Keep clips short — most are 6–30 s.
- Update the poster frame alongside each clip: posters live in
  `public/posters/` and are set per-card in `video-ads.astro`. A frame pulled
  from the same clip makes the hand-off to the live video seamless.
- To add or rename a slot, edit the `featured` / `ads` arrays at the top of
  `src/pages/video-ads.astro`.
