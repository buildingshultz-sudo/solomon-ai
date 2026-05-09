# Solomon's Forge — Mobile (iOS)

Native iOS companion for the Solomon's Forge desktop app. Built with Expo / React Native; ships through EAS Build → TestFlight.

The mobile app is a thin client over the Solomon's Forge **server** running on your PC. Set the server URL in **Setup → Server URL** to your Tailscale IP (e.g. `http://100.64.0.5:3737`) or your Cloudflare Tunnel URL.

---

## Features

| Tab     | What it does                                                                 |
|---------|------------------------------------------------------------------------------|
| Chat    | Talk to Solomon (routes through the same agent + memory + tools as desktop). |
| Tasks   | List + complete tasks; pull-to-refresh.                                       |
| Memory  | Browse the long-term memory store seeded by Manus Import.                    |
| Tools   | Live feed of tool runs (success / error / stub) with duration + trigger.     |
| Setup   | Server URL, connection test, remote-access how-to.                           |

The **KILL ALL** button is in the header on every screen.

Push notifications are wired (Expo Push). The app registers its token with `notifications.registerDevice` on first launch; the server can push task-completion / alert messages.

---

## Pre-shipped config

- Bundle ID: `com.shultzenterprises.solomonsforge`
- App name: `Solomon's Forge`
- Apple Team ID: `R95MDW5XX7`
- Apple ID for submit: `irishcraftsman7@gmail.com`
- Icon + splash already generated under `assets/`

---

## Build → TestFlight

You'll do this from any computer (Mac, Windows, or Linux). EAS does the actual iOS build on Expo's hosted Mac fleet — no Mac of your own required.

### One-time setup (5 min)

```bash
npm install -g eas-cli
cd mobile
npm install
eas login                       # Expo account (free)
eas init --id <will-prompt>     # creates the EAS project, fills extra.eas.projectId in app.json
```

### First build to TestFlight (15–20 min, mostly waiting)

```bash
# Generates an .ipa on EAS's hosted Mac fleet.
eas build --platform ios --profile preview

# When it asks "Generate a new Apple Distribution Certificate?" → yes.
# When it asks "Generate a new Apple Provisioning Profile?" → yes.
# It will ask for your Apple ID (irishcraftsman7@gmail.com) + 2FA code.
```

When the build finishes, you'll get a URL to the `.ipa`. To push it to TestFlight:

```bash
# First time you'll be prompted for your App Store Connect app's "ascAppId".
# Get this from App Store Connect → My Apps → (create if needed) → App Information → Apple ID.
# Paste it into eas.json under submit.production.ios.ascAppId, then:

eas submit --platform ios --latest
```

After Apple processes the build (~5–15 min), open **TestFlight** on your iPhone and accept the invite (or add your Apple ID as an Internal Tester in App Store Connect first).

### Updates

```bash
# Bump version in app.json, then:
eas build --platform ios --profile production
eas submit --platform ios --latest
```

---

## Local dev (Expo Go on your iPhone)

```bash
cd mobile
npm install
npm run start
# Scan the QR code with the Expo Go app from the App Store.
```

In Expo Go, set **Setup → Server URL** to your Tailscale IP.

---

## Architecture notes

- `app/` — expo-router file routes (Stack at root, Tabs nested).
- `src/lib/api.ts` — direct `fetch` against the desktop server's tRPC HTTP endpoints; no `@trpc/client` to keep bundle small.
- `src/lib/push.ts` — Expo push registration, fires on app start.
- `src/components/KillSwitchButton.tsx` — calls `killSwitch.killAll` mutation.
- `assets/` — icon (1024 opaque iOS), splash, adaptive (Android), favicon. Generated from the desktop icon for consistency.

---

## Why no `@trpc/client`?

It pulls in ~200 KB and a bunch of React Query plumbing the mobile app doesn't strictly need. The 5 endpoints we use are all simple JSON GET/POST against `/trpc/<proc>`, so a thin `rpc()` helper is enough. If the API surface grows past ~15 procedures, swap in `@trpc/client` for type-safety.
