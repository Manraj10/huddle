# Read this first — every lane, every Cursor session

Paste this file into Cursor as context before you start your lane's tasks. It is the contract
between four people working on the same repo at the same time.

## What this is

**Huddle** is an engine for phone party games. Everyone opens one URL, no install. The engine's one
unusual property: **every player is sent a different view of the same room.** That is what makes
hidden information possible — in Blindside, only the holder can see the bomb, and everyone else
genuinely cannot, because the server never told them.

A game is ~40 lines in `modes.js` and ships **nothing** to the phones. The client is a renderer.

## Architecture in 60 seconds

```
phone  ──WebSocket──►  server.js  ──►  modes.js
  ▲                        │
  └── {t:'view', view} ────┘   view() runs ONCE PER PLAYER, per broadcast
```

- `server.js` owns the room, players, phases, sockets. Modes never touch a socket.
- `modes.js` owns games. Each mode implements `start / act / tick / view / spectate`.
- `public/index.html` renders whatever `view` it is handed. It knows nothing about any game.
- `public/room.html` (Lane 3) connects with `?spectate` and is allowed to see everything.

## The view protocol — the contract between Lane 1 and Lane 2

A view is a plain object. The client renders these fields:

| Field | Meaning |
|---|---|
| `kind` | `"text"` today. `"arena"` is coming for Duel |
| `big` | the huge centre string |
| `countdownTo` | server-epoch ms. **The phone renders the number itself** |
| `flashAt` | server-epoch ms. The phone decides when to light up |
| `title`, `sub` | the two lines under the big thing |
| `bg`, `ink` | full-screen colour, and text colour on it |
| `hot` | background heats up as the fuse burns |
| `tone`, `toneFrom`, `toneTo` | audio urgency ramp, computed from the synced clock |
| `pulse`, `dim`, `braced` | state flags the renderer styles |
| `ring` | `[{name, angle}]` — other players at their seat angles |
| `lobby` | show the mode picker |

**Adding a field is free.** Lane 1 sends it, Lane 2 renders it. Say so in the issue so the other
lane knows.

## Five rules that are not negotiable

1. **Never send a rendered number.** Send the deadline (`countdownTo`, `flashAt`) and let each phone
   compute it against its synced clock. We shipped `big: "23.4"` once: the countdown froze between
   broadcasts, and Flash never lit up at all, because a game that is waiting produces no state
   changes and therefore no frames.
2. **The server is the only source of truth.** Clients send intent (`{t:'act', a:'swipe', angle}`),
   never state. A phone must not be able to lie about who has the bomb.
3. **Hidden information is hidden in `view()`, not in the client.** If the client has to ignore a
   field to keep a secret, the secret is already leaked in devtools.
4. **Nothing ships to the phone but one HTML file.** No framework, no build step, no bundler on the
   client — that is why it loads instantly on venue wifi, and it is the claim the pitch makes. The
   server may take a dependency when it earns one: `ws` for sockets, and `mongodb` lazily imported
   only when `MONGODB_URI` is set. Neither reaches a player's browser. Do not add anything to the
   client bundle.
   This is a deliberate choice: it is why the phone loads instantly on venue WiFi.
5. **No signal may be audio-only or colour-only.** A deaf player must see the tension; a colourblind
   player must read state from shape and text. iOS Safari has **no vibration**, so haptics can never
   be the accessibility answer.

## Who owns which file — do not edit outside your lane

| Person | Lane | Owns | Never touches |
|---|---|---|---|
| **Manraj** | Engine | `modes.js`, the mode-facing parts of `server.js` | `public/*` |
| **Soumya** | Interface | `public/index.html` | `modes.js`, `room.html` |
| **Xiao** | Room + ops | `public/room.html`, `deploy/`, ops scripts | `modes.js`, `index.html` |
| **Shaina** | Pitch | `docs/`, `PITCH.md`, `README.md` | all code |

If your task genuinely needs a change in someone else's file, comment on their issue instead of
editing it. A merge conflict at 11 AM costs more than a five-minute wait.

## Workflow

```bash
git pull
git checkout -b lane1/relay        # lane + short name
# work, commit small
git push -u origin HEAD
gh pr create --fill                # or push straight to master if the team agrees
```

Comment on your issue when you start so nobody doubles up.

## Running it

```bash
npm install
npm start                                         # http://localhost:8080
cloudflared tunnel --url http://localhost:8080    # public HTTPS so real phones can join
```

Test with three or more browser tabs — the game needs a minimum player count and most bugs only
appear with 3+. **A tab in the background gets throttled by the browser**, so timing looks broken
when it is not. Use separate windows side by side, or real phones.

## Known traps, already paid for

- `pkill` does not kill node on Windows. Use `Get-NetTCPConnection -LocalPort 8080 | Stop-Process`,
  or you will test against a stale server and chase ghosts. This cost us an hour.
- A phone that locks its screen drops the socket **without firing onclose**. That is why identity
  lives in a `sessionStorage` token and the client reconnects on ping silence.
- `touch-action` does not inherit. It has to sit on the element receiving the gesture.
- iOS needs a real user gesture to start audio, which is why the Join button creates the
  AudioContext.

## The deadline

**Feature freeze 1:00 PM. Submit 3:30 PM. Expo 4:00–6:30.**
After freeze, the only commits allowed are ones that fix something the playtest broke.
