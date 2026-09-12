# Handoff: make this actually fun

Paste this whole file into a fresh session as the opening prompt.

---

You are taking over a hackathon project with roughly ten hours left. It works, it is tested, and it
is **not fun**. The team played it and the verdict was "super bad". Your entire job is game feel.
You are not here to add features.

## The situation

**Event:** HackCMU 2026. Feature freeze 1:00 PM, submission 3:30 PM via a Google Form, expo and
judging 4:00–6:30 PM. Judges get 3 minutes, in a room, and will play on their own phones.

**Judged on five roughly equal criteria:** originality ("entirely novel"), technical difficulty
("real technical challenges vs ChatGPT wrapper"), demo quality ("clear, understandable, under 3
minutes"), usefulness, and relevance to the chosen track. We are submitting to the **Multiplayer**
track, whose blurb is "this is how you can meet people and touch grass". Separate prizes on top:
People's Favourite (voted by the room at the expo), Best Design, and MLH categories.

**Repo:** https://github.com/Manraj10/huddle — clone it, it is public.

## What exists

Huddle is an engine for phone party games. Everyone opens one URL, no install. A Node + `ws` server
is authoritative. **Every player is sent a different view of the same room** — `view(ctx, player)`
runs once per player per broadcast — which is what makes hidden information real rather than a
client-side pinky promise. There are tests that assert the secret is actually secret.

```
server.js          room, players, phases, sockets, seat placement
modes.js           the games. start / act / tick / view / spectate
public/index.html  the phone. renders whatever view it is handed
public/room.html   the laptop director view. sees everything, needs ?key=
test/modes.test.js 31 tests, all passing
```

Seven modes exist: **Blindside** (hidden fuse, swipe it at a person), **Flash** (every phone lights
up on the same millisecond), **Impostor**, **Relay**, **Chain**, **Wiretap**, **Duel** (ships on each
phone, bullets crossing between screens, invisible while they cross the gap).

Run it:

```bash
npm install && npm start            # http://localhost:8080
cloudflared tunnel --url http://localhost:8080   # public HTTPS, needed for real phones
```

## Your first thirty minutes: do not write code

Get **four phones** on it — real phones, not browser tabs, because a background tab is throttled and
touch is nothing like a mouse. Play every mode. Write down, for each one:

- How many seconds from "here, hold this" to someone laughing. If it is over twenty, the mode is dead.
- Every moment a player looks confused, asks "what do I do", or looks at the wrong thing.
- Every input that produced no visible, immediate reaction.
- Whether anyone asked to play it again. That is the only metric that matters.

Then **delete the modes that failed.** Shipping two games that feel incredible beats seven that
feel like a tech demo. Breadth was our argument for "it is an engine"; you can make that argument
with two games and the forty-line mode interface.

## The bar: DUAL — and the thing we got wrong about it

DUAL (Seabaa, 2014) is the reference. Two phones side by side, a bullet crosses from your screen
onto your friend's. It is a tiny game and it is *great*.

**The critical detail we missed: DUAL is played with the GYROSCOPE.** You tilt the phone to move
your ship. It is not tapping, it is not dragging. That single fact is most of why it feels good and
why our version does not:

- **A tap is a discrete event that happens somewhere else.** A tilt is your hand physically
  connected to the thing on screen, every frame, continuously. That is the "weight" our input is
  missing.
- **Zero reading.** You understand it by watching someone do it for two seconds, because their whole
  body is doing the input.
- **It is visible across a room.** People lean, twist, lift the phone over their head. Bystanders
  watch the *players*, not the screens. That is exactly what wins a room-voted prize at an expo, and
  exactly what the Multiplayer track blurb is asking for.
- **One mechanic, perfected**, not six mechanics sketched.

This is also proven with these judges: HackCMU 2025's Retro track was won by `null_pointer`, which
turned a phone gyroscope into a Wii-style controller. Gyro play lands here. Our separation from that
project is that the phones are the game board too, not just controllers for one screen.

**So: make tilt the primary input of the game you choose to perfect.** Every change you make should
be judged against — does this get us closer to DUAL?

## Gyroscope: the technical brief

This is the highest-value work in the repo. Get it right and the rest follows.

**The API.** `deviceorientation` gives `beta` (front-back tilt, −180..180) and `gamma` (left-right,
−90..90). It fires at roughly 60 Hz on a real phone — this team measured 58.8 Hz on an actual
iPhone, so do not believe old posts claiming 1 Hz.

**iOS permission.** Safari requires `DeviceOrientationEvent.requestPermission()` called from a real
user gesture, over HTTPS. The Join button is already a gesture and already creates the AudioContext
— request orientation in the same handler. Android needs no permission but still needs HTTPS. The
tunnel gives you HTTPS; plain `http://<lan-ip>` will silently give you no sensor at all, which looks
exactly like a bug.

**Calibrate on round start.** Capture the current beta/gamma as neutral so a player can hold the
phone however they like — flat on a table, at their chest, whatever. Offer a recalibrate on tap.
Without this, half the room is fighting a tilt offset and thinks the game is broken.

**Send velocity, not position.** The client sends tilt (throttled to ~20–30 Hz, and only when it
changes meaningfully); the server integrates it into a position and stays authoritative. Never let a
phone declare where its ship is — that breaks rule 2 and makes cheating trivial.

**Dead zone and clamp.** A few degrees of dead zone around neutral, and clamp the extremes, or ships
jitter constantly and nobody can hold still.

**Fallbacks, in order.** No gyro, permission denied, or a laptop: fall back to drag. Announce it on
screen once, never mid-round. Someone who cannot tilt a phone must still be able to play, which is
also the accessibility answer here.

**Landscape vs portrait.** `gamma` and `beta` swap meaning when the phone rotates. Either lock the
orientation for the duration of the round or read `screen.orientation.angle` and rotate the vector.
Test this before anything else; it is the classic silent gyro bug.

## What is probably wrong right now (verify before believing)

- **Too much waiting.** In Blindside, five of six players sit on a "?" screen doing nothing while
  one person acts. Agency per player is terrible. A player with nothing to do is a player who puts
  the phone down.
- **Input has no weight, and this is the big one.** Every mode uses discrete taps and swipes. A
  swipe sends a message and something happens somewhere else. Tilt is continuous, physical, and
  visible to the room — see the gyroscope brief above.
- **No stakes in the first ten seconds.** Rounds start with a countdown and nothing happening.
- **Too much reading.** Titles and subtitles explaining state, instead of state being obvious.
- **The room screen is a separate artefact** rather than the thing everyone is looking at while they
  play.

## The rules you cannot break

1. **Never send a rendered number from the server.** Send the deadline (`countdownTo`, `flashAt`) and
   let each phone compute it against its synced clock. Violating this froze every countdown and made
   Flash never light up at all, because a waiting game produces no state changes and therefore no
   broadcasts.
2. **The server is the only source of truth.** Clients send intent, never state.
3. **Hidden information is hidden in `view()`**, never by asking the client not to look.
4. **No framework, no build step, no bundler.** Plain HTML, CSS, ES modules, one dependency (`ws`).
   It is why the page loads instantly on venue WiFi, and it is not up for discussion today.
5. **No signal may be audio-only or colour-only.** iOS Safari has no vibration, so haptics can never
   be the accessibility answer.

## Traps already paid for — do not rediscover these

- `pkill` does not kill node on Windows. Use `Get-NetTCPConnection -LocalPort 8080 | Stop-Process`,
  or you will test against a stale server and chase ghosts for an hour. This happened.
- A phone that locks its screen drops the socket **without firing onclose**. Identity lives in a
  `sessionStorage` token and the client reconnects on ping silence. Do not break that.
- A background browser tab is throttled to about 1 fps. Timing looks broken when it is fine.
- `touch-action` does not inherit; it must sit on the element receiving the gesture.
- iOS needs a real user gesture to start audio. The Join button creates the AudioContext.
- An idle phone that never places a seat must never be able to block a round. Someone scans the QR
  at an expo, wanders off, and the room must still be able to play.
- The room screen feed is the full truth. It needs `?key=`, or a player opens it on their own phone
  and wins every hidden-information game.

## Prior art — know it, name it, do not get caught by it

Spaceteam (2012) did private per-phone state for in-person play. Jackbox and AirConsole own
no-install phones-as-controllers. Chrome Racer (2013) put a game across five browser phones. DUAL
(2014) did the cross-screen bullet, and an itch.io game published days ago describes the same gap
idea in nearly our words. Bomb Party owns hidden-timer hot potato.

**The one claim with no prior art found anywhere:** your input targets *a human being, at the angle
they are actually sitting*, because players drag themselves onto a ring to say where they are. Do
not break the seat system. Lean on it — it is the most defensible thing here, and it is the one that
matches the track blurb about being in a room with people.

## Still open when this was written (an adversarial review found these)

- **Blindside's fuse is `rand(14000, 26000)` plus a 2.4 s gap.** A worst-case first round eats 28 s
  of a 3-minute pitch, and the novelty line is scheduled to land while a judge is holding a live
  bomb and is not listening. Shorten the fuse for demos, or move the talking to before the round.
- **`deploy/setup.sh` aborts on a re-run**: first run clones as root then chowns to `huddle`, so
  every later run trips git's dubious-ownership check.
- **Two MLH claims are written but not built.** MongoDB Atlas (stats currently write a JSON file to
  disk) and ElevenLabs (there is no speech in the product at all). Either build them or keep them
  out of the pitch — the docs now say NOT EARNED YET, do not quietly flip that back.
- **`renderLobby` depends on five element ids.** If a redesign renames any of them, `render()`
  throws and the lobby never paints, which means the Start button ships dead. Check the lobby in a
  real browser after any markup change.

## What not to do

- Do not add an eighth game.
- Do not rewrite the engine. It works, it is tested, and it is not the problem.
- Do not add a framework or a build step.
- Do not chase sponsor prizes before a single round is fun.
- Do not spend time on documentation. There is plenty and it is judge-facing already.

## Definition of done

A stranger walks up to a table with no explanation, is handed a phone, and within twenty seconds is
laughing and wants to play again. Four judges can do the same thing, in a room, in three minutes,
with nothing installed.

If you get one game to that bar, we win the Multiplayer track and People's Favourite. If you get two,
the engine claim carries the technical line too.

Start by playing it. Report what you found before you change anything.
