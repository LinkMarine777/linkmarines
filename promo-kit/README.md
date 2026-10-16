# Promo video kit

How the Terminal 7 promo video was made: a produced motion-graphics video in the site's style, not a screen recording.
Not part of the website (`promo-kit/` is in `.assetsignore`).

## Paste this into a new chat

> Make a promo video for terminal7.xyz with `promo-kit/` (read `promo-kit/README.md` first and follow it exactly).
> Do NOT make a screen recording with captions. Record short clips of the real site per scene, then build the video in
> `stage.html`: pixel headlines + bullets + device frames playing those clips, plus animated "EXAMPLE" scenes for things
> that can't be filmed (a big buy alert, a payout landing, a score climbing). Render it frame by frame, add the Australian
> voiceover and the generated music, keep it under 2:20 for X. Scenes I want: [list them].

## What it is

Each scene = left: blue kicker line, big VT323 headline (white line + green line), ▸ bullets; right: a desktop browser
frame and/or a phone frame playing a real clip of the live site, with a slow zoom ("camera") onto the part that matters.
Things that can't be filmed are animated cards in the site's style, tagged **EXAMPLE**. Helmet + TERMINAL 7 bottom-left,
terminal7.xyz bottom-right, blue→green bar at the bottom. 1920×1080, 30 fps.

## Files

| file | does |
|---|---|
| `rec.js` | records one clip per scene from the live site (Playwright + Chrome screencast, with a visible cursor). Desktop 1280×800, phone 390×844 @2x. `node rec.js name1 name2` records only those |
| `clips2seq.py` | turns each clip into `seq/<name>/0001.jpg…` at a steady 30 fps; prints frame counts |
| `stage.html` | the video itself: every scene as code, drawn by `render(t)` for any time `t` |
| `render.js` | `node render.js stills 10 30 62` = still images to check layout; `node render.js full` = every frame into `out/` |
| `audio/tts.py`, `audio/voice.py` | the voiceover: `vo.json` lines → `ft_<key>.wav` (Microsoft "Natasha", Australian, +18% speed) |
| `audio/music.py` | original synthwave bed (A minor, 120 BPM): pads, bass, drums drop in at `DROP`, arp from `FULL2`, fade at `OUT` |
| `audio/mix.py` | places each voice line in its scene, ducks the music under it, levels to −15 LUFS → `mix.wav` |

## Steps

Work in the scratchpad, not the repo (frames are gigabytes):

```bash
W=<scratchpad>/promo && mkdir -p $W && cp -r promo-kit/* $W/ && cp helmet-1024.png $W/ && cd $W
pip install -q edge-tts numpy
curl -s -o card_wallet.png https://terminal7.xyz/card/wallet/<WALLET>.png      # share card for the X-Ray scene
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8                                       # see "gotchas"
NODE_PATH=$(npm root -g) node rec.js                                             # all clips (~10 min)
python3 clips2seq.py                                                             # → put the counts in SEQ in stage.html
cd audio && python3 voice.py                                                     # line lengths → scene durations
```

Scene durations = each voice line's length + ~0.85 s (min ~5 s for animated scenes). Put them in `ND` in `stage.html`
(same order as `vo.json`); the scenes' animations and clips speed up or slow down to fit. Set `TOTAL`/`DROP`/`FULL2`/`OUT`
in `music.py` to the new timeline (DROP = the swap scene's start, OUT = the outro's start). Then:

```bash
python3 music.py && python3 mix.py 5.6,6.0,4.9,...                               # same durations as ND
cd .. && NODE_PATH=$(npm root -g) node render.js stills 3 20 45                  # look at them before the full render
NODE_PATH=$(npm root -g) node render.js full                                     # ~5 min for 90 s
ffmpeg -y -framerate 30 -i out/%05d.jpg -i audio/mix.wav -filter_complex "[1]apad[a]" -map 0:v -map "[a]" \
  -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart promo.mp4
```

Check a contact sheet before sending: `ffmpeg -i promo.mp4 -vf "fps=1/3,scale=240:-1,tile=8x4" -frames:v 1 sheet.png`.

## Adding or changing a scene

In `stage.html`, each scene is one `add(duration, build, animate)`:
- `textBlock(s,{kick,hl:[white line, green line],bul:[...]})` + `animText(T,lt)` for the left side
- `desk(s,x,y,width,'clipname')` / `phone(...)` for devices; `devIn(dev,lt,delay)` slides them in;
  `dev.im.src=frameOf('clipname',lt-.3)` plays the clip; `cam(dev,{x,y,w})` zooms (fractions of the source; animate
  between two with `lerpC(a,b,prog(lt,start,dur))`)
- animated cards: plain HTML in the build, styled with `.card`; set values from `lt` in animate; add
  `el('div','tag','EXAMPLE',s)` on anything simulated
- a new real clip: add a `clip('name', D or M, async h=>{...})` block in `rec.js` (`h.mv(selector)` moves the cursor and
  clicks, `h.btn(container,'TEXT')`, `h.scroll(y)`, `h.start()` begins recording), then `node rec.js name`,
  `python3 clips2seq.py name`, add its count to `SEQ`

## Gotchas (all hit while making v1–v3)

- **Jupiter's swap widget renders black** in headless Chrome unless the locale is `en-US` (`LANG`/`LC_ALL` + `locale:'en-US'`
  in the browser context — already in `rec.js`). The container's default locale crashes it.
- Many elements exist twice (desktop + phone layouts): select the **visible** one (`>> visible=true`; `h.mv` already does).
  The token page's "BILLBOARD" heading is not the checkout's BILLBOARD filter button — use `button:has-text("BILLBOARD")`.
- `edge-tts` needs the proxy's CA bundle: `tts.py` points it at `/root/.ccr/ca-bundle.crt` (verification stays on).
- Say "Clobber" in the voice script for CLOBr, "stonk fun" for stonkfun, "P and L", "terminal seven dot x y z".
- X limit: 2:20. Files over 30 MB can't be sent back in chat: use crf 21–22.
- Don't claim "no extra fee": Jupiter's quote shows a 0.1% platform fee. The site's own words are "no fee of our own".
- The voice is from the free Edge read-aloud service; for a voice with clear rights, make the lines in ElevenLabs and
  drop the files in as `ft_<key>.wav`.
- Don't `pkill -f` (it can kill the shell); don't `rm` relative globs after `cd` (blocked) — write to a new folder instead.
- Pick a featured wallet whose full history read is finished (its numbers stop changing): warm it with
  `curl .../wallet/<w>?full=1` until `hist.done` is true.
