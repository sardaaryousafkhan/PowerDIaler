# Dial campaigns vs SMS campaigns

## Behavior

- **Dial (`kind: DIAL`)** — Progressive voice dialing, start/pause/resume, call attempts, optional SMS broadcast from the workspace.
- **SMS (`kind: SMS`)** — Text-only lists: the API **rejects** start/pause/resume for the voice dialer; the worker **skips** dial jobs for these campaigns; the UI hides dial controls.

## Known limitations (not bugs)

- **Contact status values** are still the dial-oriented enum (`PENDING`, `DIALING`, `DIALED`, `SKIPPED`). SMS campaigns do not advance contacts through voice states; rows typically stay `PENDING` until you add SMS-specific lifecycle tracking later.
- **SMS campaigns** do not auto-advance to `COMPLETED` when all messages are sent; status may remain `DRAFT` unless you add rules for that.
