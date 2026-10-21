# Code signing plan (Phase 5)

Unsigned Mac/Windows builds work but show scary OS warnings. Plan for production:

## Apple (macOS)

1. Enroll in [Apple Developer Program](https://developer.apple.com/) (~$99/year).
2. Create Developer ID Application certificate.
3. In `apps/desktop/package.json` electron-builder `mac`:
   - `identity`: your Developer ID name
   - enable `hardenedRuntime: true`
   - add entitlements file for network client
4. Notarize with `xcrun notarytool` (electron-builder can automate with Apple ID app-specific password).

## Windows

1. Purchase a code-signing certificate (OV or EV) from a public CA.
2. Set electron-builder `win.certificateFile` / `certificatePassword` (or Azure Trusted Signing).
3. Rebuild `dist:win` on a Windows machine or CI.

## Until certificates exist

- Ship unsigned builds from `apps/desktop/release/`.
- Tell customers: on Mac use **System Settings → Privacy & Security → Open Anyway**; on Windows click **More info → Run anyway**.

Auto-update is deferred for v1.
