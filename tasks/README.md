# Tasks

**Everyone reads [00-read-this-first.md](00-read-this-first.md) before touching anything.** It has
the architecture, the view protocol, the five non-negotiable rules, and the traps we already paid
for.

## Who has what

| Person | Lane | File to open in Cursor | Owns these files |
|---|---|---|---|
| **Manraj** | Engine and games | [lane-1-engine.md](lane-1-engine.md) | `modes.js`, mode-facing parts of `server.js` |
| **Soumya** | Interface | [lane-2-interface.md](lane-2-interface.md) | `public/index.html` |
| **Xiao** | Room screen and ops | [lane-3-room-and-ops.md](lane-3-room-and-ops.md) | `public/room.html`, `deploy/` |
| **Shaina** | Pitch, prizes, submission | [lane-4-pitch-and-prizes.md](lane-4-pitch-and-prizes.md) | `PITCH.md`, `README.md`, `docs/` |

Swap lanes if someone is clearly stronger elsewhere — but whoever takes a lane takes its files with
it. Four people editing four different files is how four people ship in nine hours.

The game designs live in [GAMES.md](GAMES.md), including **Duel**, **Séance**, **Whisper** and
**Mole**.

## How to work

```bash
git pull
git checkout -b manraj/relay      # yourname/shortthing
npm start                          # http://localhost:8080
# commit small and often
git push -u origin HEAD
```

Comment on your GitHub issue when you start, so nobody doubles up.

## The clock

**Feature freeze 1:00 PM · Submit 3:30 PM · Expo 4:00–6:30.**
After freeze, the only commits allowed are fixes for things the 11 AM playtest found.
