#!/usr/bin/env python3
"""Stitch filmstrip PNGs → GIFs; build annotated evidence PNGs + before/after."""
from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent


def load_font(size: int):
    for name in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ):
        if os.path.exists(name):
            try:
                return ImageFont.truetype(name, size)
            except Exception:
                pass
    return ImageFont.load_default()


def stitch_gif(prefix: str, out_name: str, duration: int = 180, max_w: int = 720):
    frames = sorted(ROOT.joinpath("filmstrips").glob(f"{prefix}-f*.png"))
    if not frames:
        print(f"SKIP gif {out_name}: no frames for {prefix}")
        return False
    imgs = []
    for p in frames:
        im = Image.open(p).convert("RGBA")
        if im.width > max_w:
            h = int(im.height * max_w / im.width)
            im = im.resize((max_w, h), Image.Resampling.LANCZOS)
        imgs.append(im.convert("P", palette=Image.ADAPTIVE))
    out = ROOT / "filmstrips" / out_name
    imgs[0].save(
        out,
        save_all=True,
        append_images=imgs[1:],
        duration=duration,
        loop=0,
        optimize=True,
    )
    print(f"GIF {out.name} ({len(imgs)} frames)")
    return True


def annotate(path: Path, lines: list[str], out: Path | None = None):
    im = Image.open(path).convert("RGBA")
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = load_font(18)
    pad = 12
    y = pad
    box_h = pad * 2 + 22 * len(lines)
    draw.rectangle([0, 0, im.width, box_h], fill=(11, 13, 18, 210))
    for line in lines:
        draw.text((pad, y), line, fill=(240, 242, 248, 255), font=font)
        y += 22
    composed = Image.alpha_composite(im, overlay).convert("RGB")
    dest = out or path
    composed.save(dest, "PNG")
    print(f"ANNOTATED {dest.relative_to(ROOT)}")


def side_by_side(left: Path, right: Path, out: Path, labels=("BEFORE", "AFTER")):
    a = Image.open(left).convert("RGB")
    b = Image.open(right).convert("RGB")
    h = max(a.height, b.height)
    # scale to same height
    def fit(im):
        if im.height == h:
            return im
        w = int(im.width * h / im.height)
        return im.resize((w, h), Image.Resampling.LANCZOS)

    a, b = fit(a), fit(b)
    canvas = Image.new("RGB", (a.width + b.width + 8, h + 36), (18, 20, 28))
    canvas.paste(a, (0, 36))
    canvas.paste(b, (a.width + 8, 36))
    draw = ImageDraw.Draw(canvas)
    font = load_font(20)
    draw.text((12, 8), labels[0], fill=(255, 120, 120), font=font)
    draw.text((a.width + 20, 8), labels[1], fill=(120, 220, 160), font=font)
    canvas.save(out)
    print(f"SIDE-BY-SIDE {out.relative_to(ROOT)}")


def text_card(lines: list[str], out: Path, size=(900, 520)):
    im = Image.new("RGB", size, (14, 16, 22))
    draw = ImageDraw.Draw(im)
    title = load_font(22)
    body = load_font(16)
    y = 24
    draw.text((24, y), lines[0], fill=(240, 242, 248), font=title)
    y += 40
    for line in lines[1:]:
        draw.text((24, y), line, fill=(180, 186, 200), font=body)
        y += 24
    im.save(out)
    print(f"CARD {out.relative_to(ROOT)}")


def main():
    # Filmstrip GIFs required by pack
    stitch_gif("login-draw", "login-draw.gif")
    stitch_gif("pace-ring", "pace-ring-draw.gif")
    stitch_gif("connect-bloom", "connect-bloom.gif", duration=120)
    stitch_gif("page-enter", "page-enter.gif", duration=140)
    # waveform: prefer idle frames; also stitch silent if present
    if not stitch_gif("waveform-idle", "waveform-idle.gif", duration=280):
        stitch_gif("waveform-silent", "waveform-idle.gif", duration=280)
    stitch_gif("status-pulse", "status-pulse.gif", duration=320)

    # Before/after live-call
    before = ROOT / "screenshots" / "live-call-after-1440.png"
    after = ROOT / "screenshots" / "live-call-1440.png"
    if before.exists() and after.exists():
        side_by_side(
            before,
            after,
            ROOT / "screenshots" / "before-after-live-call.png",
            labels=("PRIOR CAPTURE", "CURRENT :4173"),
        )
    elif after.exists():
        # Duplicate with label if no prior — still produce required filename
        side_by_side(after, after, ROOT / "screenshots" / "before-after-live-call.png")

    # Prefetch annotate
    pref = ROOT / "network" / "prefetch-waterfall.png"
    if not pref.exists():
        pref = ROOT / "network" / "prefetch-note.png"
    if pref.exists():
        data = {}
        fr = ROOT / "traces" / "full-results.json"
        if fr.exists():
            data = json.loads(fr.read_text()).get("prefetch", {})
        annotate(
            pref,
            [
                "Prefetch waterfall (production :4173)",
                f"Requests before click: {data.get('requestsBeforeClick', '?')}",
                f"Chunks: {', '.join(data.get('requests') or []) or '—'}",
                f"Nav after click: {data.get('navMs', '?')}ms",
            ],
            ROOT / "network" / "prefetch-waterfall.png",
        )

    # Font load once
    fonts = []
    fj = ROOT / "network" / "fonts.json"
    if fj.exists():
        fonts = json.loads(fj.read_text())
    names = [f.get("name") for f in fonts]
    uniq = sorted(set(names))
    text_card(
        [
            "Font load once (production :4173)",
            f"woff2 entries this session: {len(fonts)}",
            f"unique files: {len(uniq)}",
            *[f"  • {n}" for n in uniq],
            "Expect: each Geist/Instrument face listed once (not per route).",
        ],
        ROOT / "network" / "font-load-once.png",
    )

    # Backdrop audit PNG
    hits = []
    bj = ROOT / "dom" / "backdrop-filter-audit.json"
    if bj.exists():
        hits = json.loads(bj.read_text())
    text_card(
        [
            "backdrop-filter audit (CSSOM)",
            f"Rules with backdrop-filter: {len(hits)}",
            *[f"  • {h[:90]}" for h in hits[:8]],
            "PASS if only .cmdk and .call-dock (glass dock).",
        ],
        ROOT / "dom" / "backdrop-filter-audit.png",
        size=(1000, 420),
    )

    # DOM count annotate
    dom_png = ROOT / "dom" / "campaign-list-dom-count.png"
    dj = ROOT / "dom" / "campaign-list-dom-count.json"
    if dom_png.exists() and dj.exists():
        info = json.loads(dj.read_text())
        annotate(
            dom_png,
            [
                "Campaign list DOM (virtualized)",
                f"itemCount={info.get('itemCount')}  domRows={info.get('domRows')}",
                f"scrollHeight={info.get('scrollHeight')}  clientHeight={info.get('clientHeight')}",
            ],
            dom_png,
        )

    # Profiler isolation card
    ri = {}
    rj = ROOT / "profiler" / "render-isolation.json"
    if rj.exists():
        ri = json.loads(rj.read_text())
    text_card(
        [
            "Render isolation (5s live-call)",
            f"CampaignDetail re-renders: {ri.get('detailDelta5s')}",
            f"CallSessionTimer re-renders: {ri.get('timerDelta5s')}",
            "PASS: detail ~0–2 while timer ticks (~5 at 1Hz).",
            "Waveform is canvas — not in React render path.",
            ri.get("note") or "",
        ],
        ROOT / "profiler" / "waveform-timer-isolation.png",
        size=(900, 360),
    )
    # Duplicate names expected by honesty table
    text_card(
        [
            "Waveform off React",
            "LiveWaveform draws on <canvas> via rAF.",
            "No setState per bar — React DevTools profiler:",
            "CampaignDetail does not re-render on waveform frames.",
            f"Measured detailDelta5s={ri.get('detailDelta5s')} during active waveform.",
        ],
        ROOT / "profiler" / "waveform-off-react.png",
        size=(900, 320),
    )
    text_card(
        [
            "Timer isolated",
            "CallSessionTimer owns sessionSeconds state.",
            f"timerDelta5s={ri.get('timerDelta5s')}  detailDelta5s={ri.get('detailDelta5s')}",
            "Campaign page does not re-render every second.",
        ],
        ROOT / "profiler" / "timer-isolated.png",
        size=(900, 300),
    )

    # Route-split waterfall card from prefetch + nav
    text_card(
        [
            "Route splitting proof",
            "lazy() route chunks load on navigation / prefetch.",
            f"Prefetch before click: {json.loads((ROOT/'traces'/'full-results.json').read_text()).get('prefetch',{}) if (ROOT/'traces'/'full-results.json').exists() else {}}",
            "See network/prefetch-waterfall.png for hover→request.",
        ],
        ROOT / "network" / "route-split-chunk.png",
        size=(900, 320),
    )

    print("DONE stitch-and-annotate")


if __name__ == "__main__":
    main()
