# Branding assets

Phase 7.2 deliverables (IMPLEMENTATION_PLAN.md §8's "simple logo mark: two
overlapping coins ... in Telegram blue on white"). Two overlapping coins =
the "split" concept — a shared expense split between people. Telegram blue
(`#3390EC`) matches the `accent` design token from §8's palette table.

## Files

| File | Size | Use |
|---|---|---|
| `bot-avatar-512.svg` / `.png` | 512×512 | BotFather bot profile photo (`/setuserpic`) |
| `miniapp-photo-640x360.svg` / `.png` | 640×360 | BotFather `/newapp` Mini App photo |
| `bot-texts.md` | — | `/start` description copy in EN/RU/UK, for BotFather's bot description/about fields |
| `../web/src/assets/branding/logo-mark.svg` | 100×100 (vector) | Canonical source geometry — see its own doc comment |
| `../web/public/favicon.svg` / `favicon-32.png` | favicon | Browser-tab/PWA icon |
| `../web/public/apple-touch-icon.png` | 180×180 | iOS home-screen icon if the Mini App is ever added to a home screen |
| `../web/src/components/LogoMark.tsx` | — | In-app header mark (Feed screen) — inlines the same geometry as a React component, no extra network request |

The bot-avatar geometry is **not** pixel-identical to the in-app mark: a bot
avatar gets circle-cropped by Telegram, so its two coins sit further from
the canvas edges (see that file's own comment for the exact margins). The
in-app mark and favicon use a rounded-square canvas instead, since neither
gets circle-cropped.

## Regenerating the PNGs

The SVGs are the source of truth; PNGs are derived. If you edit any `.svg`
here (or `web/src/assets/branding/logo-mark.svg` / `web/public/favicon.svg`),
regenerate the PNGs.

**Important gotcha found while producing these:** `sharp`/`resvg` (the
Node-based rasterizer available in this environment) has **no font
database wired up in its prebuilt binary** — it silently renders empty
space wherever an SVG `<text>` element should be, even though the fonts
themselves are installed on the machine. This only bit the Mini App photo
(the only asset with a wordmark/tagline); the bot avatar and favicon are
pure vector shapes and rendered fine with either tool.

The commands below use **macOS's own WebKit-based SVG renderer** via
`qlmanage` (QuickLook) instead, which has full system-font support. This is
what actually produced the PNGs committed here — a portable ImageMagick/
rsvg-convert alternative is given first if those happen to be installed on
your machine (they weren't in this environment: `rsvg-convert`, `convert`,
and `magick` were all absent, and there was no working internet-independent
way to add them).

### Option A — ImageMagick / librsvg (if installed; has font support)

```sh
# Bot avatar
rsvg-convert -w 512 -h 512 branding/bot-avatar-512.svg -o branding/bot-avatar-512.png
# Mini App photo
rsvg-convert -w 640 -h 360 branding/miniapp-photo-640x360.svg -o branding/miniapp-photo-640x360.png
# Favicon
rsvg-convert -w 32 -h 32 web/public/favicon.svg -o web/public/favicon-32.png
rsvg-convert -w 180 -h 180 web/public/favicon.svg -o web/public/apple-touch-icon.png
```

### Option B — macOS QuickLook (what produced the committed PNGs)

`qlmanage -t` always renders into a **square** thumbnail sized to fit the
`-s` bound, letterboxing non-square documents — so the 640×360 landscape
photo needs a centered crop back to its real aspect ratio afterwards
(`sips -c`), then a resize down to the exact target size:

```sh
mkdir -p /tmp/ql

# Bot avatar — already square, one step.
qlmanage -t -s 512 -o /tmp/ql branding/bot-avatar-512.svg
cp "/tmp/ql/bot-avatar-512.svg.png" branding/bot-avatar-512.png

# Mini App photo — render at 2x (1280 square), crop the centered 16:9
# content (1280x720), then downscale to the exact 640x360 target.
qlmanage -t -s 1280 -o /tmp/ql branding/miniapp-photo-640x360.svg
sips -c 720 1280 "/tmp/ql/miniapp-photo-640x360.svg.png" --out /tmp/ql/cropped.png
sips -z 360 640 /tmp/ql/cropped.png --out branding/miniapp-photo-640x360.png

# Favicon variants (pure vector, either tool is fine).
qlmanage -t -s 256 -o /tmp/ql web/public/favicon.svg
sips -z 32 32 "/tmp/ql/favicon.svg.png" --out web/public/favicon-32.png
sips -z 180 180 "/tmp/ql/favicon.svg.png" --out web/public/apple-touch-icon.png
```

## Owner's manual step

Uploading these to BotFather (`/setuserpic` for the bot avatar, `/newapp`'s
photo prompt for the Mini App photo) is **not** automatable from here — do
it once from the BotFather chat in Telegram, per
`docs/deploy/SETUP.md`/IMPLEMENTATION_PLAN.md §7's BotFather setup steps.
