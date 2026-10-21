#!/usr/bin/env python3
"""Decode latest CDP Page.captureScreenshot JSON into a PNG path argv[1]."""
import json, base64, sys
from pathlib import Path

out = Path(sys.argv[1])
logs = sorted(Path("/Users/mmacbookpro/.cursor/browser-logs").glob("cdp-response-Page.captureScreenshot-*.json"))
if not logs:
    raise SystemExit("no cdp screenshot logs")
src = logs[-1]
data = json.loads(src.read_text())

def find(o):
    if isinstance(o, dict):
        if "data" in o and isinstance(o["data"], str) and len(o["data"]) > 1000:
            return o["data"]
        for v in o.values():
            r = find(v)
            if r:
                return r
    return None

b64 = find(data)
if not b64:
    raise SystemExit(f"no data in {src}")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(base64.b64decode(b64))
print(out, out.stat().st_size)
