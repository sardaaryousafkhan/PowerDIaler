# Whoosh test (speed) — status: NOT DONE (strangers) / AGENT TIMING ONLY

## Protocol required
3 strangers on **production** build (`preview :4173`), task: Sign in → open campaign → start call. Verbatim slow/lag questions. Pass = all “no” lag, ≥8/10, <20s.

## Stranger verbatim
**Not collected.**

## Agent stopwatch (production `:4173`) — not a stranger PASS

| Step | Result |
|---|---|
| Campaigns shell after sidebar click | **7ms** to shell paint |
| Campaigns full (rows visible) | **323ms** |
| Campaign detail open | **337ms** |
| Start Dialing → `.live-call` in DOM | **6ms** |
| Live-call 2s rAF sample | **61 fps** avg, worst frame **19ms** |

## If the Mac still “feels slow”
1. Confirm you are on **`http://127.0.0.1:4173`** (preview), not `:5173` (dev).  
2. Dev HMR alone can make the same UI feel laggy.  
3. Remaining: worst frame 19ms vs 16.6ms target; main JS still ~478KB; stranger whoosh still required.
