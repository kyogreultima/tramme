# The site's videos

Each video slot on the page (`components/Media.astro`) shows a placeholder until its file is here. Drop the file in, rebuild, and the slot plays it: muted, in a loop, only while it is on screen, and nothing of it loads before it comes near.

| Slot | Files | Size |
|---|---|---|
| hero | `tramme.webm` and/or `tramme.mp4`, `tramme.webp` | 1920×1080 |
| examples | `launch-film`, `anime`, `showreel` (same extensions) | the example's own |
| assistant | `assistant.webm` and/or `assistant.mp4`, `assistant.webp` | 1600×1000 (16:10) |
| proofs (features page, `lib/proofs.ts`) | `proof-<id>.webm` and/or `.mp4`, `.webp`; its two stills in `assets/proofs/` | the footage's own |

- **WebM (VP9) first, MP4 (H.264) as a fallback**: the browser takes the first one it can play. One of the two is enough.
- **The poster** (`.webp`, or `.jpg`) shows before the clip loads: a frame of it, at the clip's size.
- **Keep them light**: no sound track, 2 to 4 Mb/s for 1080p, a few seconds that loop cleanly (the ones here: 10 s, cut and encoded with the commands below).

The examples render with the command line, for example:

```sh
pnpm tramme render examples/launch-film --format webm --mute
pnpm tramme still examples/launch-film --t 2.5
```

A master cut to 10 s for the site (WebM at constant quality, MP4 as a fallback, a poster at 1 s):

```sh
ffmpeg -i master.webm -t 10 -an -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p id.webm
ffmpeg -i master.webm -t 10 -an -c:v libx264 -preset slow -crf 23 -maxrate 3500k -bufsize 7000k -pix_fmt yuv420p -movflags +faststart id.mp4
ffmpeg -ss 1 -i master.webm -frames:v 1 -c:v libwebp -quality 80 id.webp
```
