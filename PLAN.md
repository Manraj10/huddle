# Huddle — build plan

**Deadline: Saturday 4:00 PM.** Google Form, project description + one track. We submit at **3:30**.
**Track: Multiplayer.** Its blurb is "this is how you can meet people and touch grass."

---

## What we are submitting, in one sentence

Not a game. **An engine for party games where every player is sent a different view of the same
room** — which is what makes hidden information possible at all — with several games on it, joined
by one link, installing nothing.

That sentence is doing a lot of work. It answers three rubric lines at once: originality (an engine,
not a toy), technical difficulty (per-player state, clock sync, authoritative server), and track
relevance (it only works with people in a room together).

## The one thing that is actually novel — protect it

Adversarial research found a famous ancestor for every mechanic we have:

| What we do | Who did it first |
|---|---|
| Private per-phone state driving in-person play | **Spaceteam**, 2012 |
| No install, phones as the interface | **Jackbox**, **AirConsole** |
| A game spanning several browser phones | **Chrome Racer**, Google, 2013 |
| A bullet crossing the gap between two phones | **DUAL**, Seabaa, 2014 — and *Spatial Revenge* on itch.io, published days ago, describes "the dead zone between screens" in nearly our words |
| Hidden-timer hot potato | Bomb Party, Mario Party, and a children's party game |

**The one thing with no prior art anywhere: your input targets a human being at the angle they are
actually sitting.** Not a name in a list. Not an avatar in a virtual arena. A person, in the room,
in a direction.

Right now that claim is **false** — seats come from join order. Making it true is the highest-value
work left (see P0-1). Say the prior art out loud in the pitch before a judge finds it; getting
caught reads as ignorance, pre-empting reads as taste.

---

## Four lanes

Claim issues on GitHub so nobody collides. Every task below is an issue.

### Lane 1 — Engine and games (`modes.js`, `server.js`)
Owns game logic and feel. A game is ~40 lines and ships nothing to the phones.

### Lane 2 — Interface (`public/index.html`)
Owns what a player sees and feels. **Best Design is its own prize and nobody else will contest it
seriously.** Colour is the primary signal on a phone held at arm's length — the screen state should
be readable from across a table without reading a word.

### Lane 3 — Room screen and ops (`public/room.html`, deployment)
Owns the laptop screen and everything that keeps the demo alive. Research was blunt: *if you build
exactly one more thing, build the director view.* A hidden-information game gives a non-playing
judge nothing to look at, and the room screen is where the audience sees what the players cannot.

### Lane 4 — Pitch, prizes, submission
Owns the 3-minute script, the MLH conversation, playtests with strangers, the form. This lane is
not "the non-coder lane" — it is the lane that decides whether the other three get scored.

---

## Priorities

### P0 — before anything else (tonight / first thing)

**P0-1 · Real seats (Lane 1, 45 min).** Delete `seats()` in `server.js`. Each phone shows the ring
and you drag your own dot to where you are actually sitting; send `{t:'seat', angle}` (the server
already accepts it). This converts our only novel claim from fiction into fact, and it forces
players to look at each other and negotiate before a round — the track blurb, enacted.

**P0-2 · Room screen v1 (Lane 3, 2 h).** `room.html`, connects with `?spectate`. Shows: a big QR to
join, the ring of players by seat, where the bomb actually is, throw arcs, the fuse, and
eliminations. The audience sees everything the players cannot. This is the single highest-value
remaining build.

**P0-3 · Vultr + Caddy (Lane 3, 1 h).** The Cloudflare quick tunnel caps around 200 connections and
is one blip away from dropping every phone at once. Move to a real box before the expo. Vultr is
also an MLH prize.

**P0-4 · Design pass (Lane 2, 3 h).** See the interface spec below.

**P0-5 · Pitch script + loaner phones (Lane 4, 1 h).** Two or three spare phones already joined,
face-down, named JUDGE 1/2/3, handed over connected so joining costs zero seconds. Never demo with
fewer than four phones.

### P1 — makes it a real product

- **P1-1 · Relay (Lane 1).** Co-op: a token must travel the ring in seat order as fast as possible;
  the room's combined time is the score. Nobody is eliminated, so nobody sits out — the fix for
  elimination games at an expo where strangers walk up.
- **P1-2 · Chain (Lane 1).** A growing order of players, shown only to whoever is extending it.
  Everyone taps in sequence from memory.
- **P1-3 · Wiretap (Lane 1).** Two players secretly share a word; everyone else has a different one.
  The pair must find each other and swipe at each other without the room noticing.
- **P1-4 · Stats (Lane 3).** MongoDB Atlas: rounds played, players seen, fastest reaction. The last
  slide of the pitch is a number from the actual expo floor, not a claim.
- **P1-5 · Announcer (Lane 2/4).** ElevenLabs on the room screen calling eliminations by name.
- **P1-6 · MLH rep at 10 AM (Lane 4).** Which categories are live here, and where do we opt in given
  submission is a Google Form? The event is a confirmed MLH member event but publishes no list.

### P2 — the swings

- **P2-1 · Duel (Lane 1).** The DUAL-style shooter: ships on each phone, bullets crossing between
  screens, invisible while they cross the real gap. Needs an `arena` view kind. Name DUAL in the
  pitch when showing it.
- **P2-2 · Phones listen to each other (Lane 3).** Seating discovered by sound: each phone chirps
  in turn near 19 kHz, every other phone records how loudly it heard it, and the room is ordered by
  loudness. **Rank by amplitude, not time-of-flight** — we need the seating order, not centimetres,
  and amplitude needs no sample-level timing. Time-of-flight and true distances are the upgrade if
  this lands early. Self-contained: it either produces an ordering or it doesn't, and the manual
  seats stay as the fallback.
- **P2-3 · Hot Mic (Lane 1).** Every phone plays a tone; one plays a different pitch; find it by ear.
  Needs a visual equivalent for deaf players before it can ship.

---

## Interface spec (Lane 2)

The phone is held at arm's length by someone who is looking at other people, not at their screen.

- **Colour is the message.** Each state owns the whole screen: holding the bomb is hot and rising,
  bracing is cool green, out is grey, the flash is white. A player across the table should read
  someone else's state from the colour bouncing off their face.
- **One number, enormous.** Tabular figures so the countdown doesn't jitter. Nothing else competes.
- **Motion with a reason.** The pulse rate tracks the fuse. The throw gets a directional swipe
  trail. Elimination is a hard cut, not a fade.
- **Type:** one display face with real personality for the big number and the game name, one neutral
  face for everything else. Not Inter.
- **Never audio-only or colour-only.** A deaf player must see the tension; a colourblind player must
  read the state from shape and text. Do not offer haptics as the accessibility answer — iOS Safari
  has no vibration.
- **The join screen is the poster.** It is what a stranger sees first at the expo.

## Room screen spec (Lane 3)

- Huge QR plus the short URL, always visible.
- The ring: every player at their real seat angle, with names.
- The truth: where the bomb is, the 700 ms flight arc, who braced, the fuse as a shrinking ring.
- Eliminations land big, with the announcer voice.
- A ticker: rounds played today, people who have played, fastest reaction of the day.

---

## Schedule

| Time | What |
|---|---|
| now → 3:00 AM | P0-1 seats, P0-3 box, design exploration. Play five rounds and write down every "wait, what do I do?" |
| 3:00 → 7:30 | Sleep. Not optional. |
| 8:00 | Standup, 10 min, each lane demos |
| 8:00 → 11:00 | Room screen, design pass, two new games, stats |
| 10:00 | MLH rep |
| 11:00 → 12:30 | **Playtest on strangers at the venue.** The most valuable hour of the weekend |
| 12:30 → 1:00 | Fix only what the playtest broke |
| **1:00 PM** | **Feature freeze** |
| 1:00 → 2:00 | Rehearse the pitch 3× against a timer. Record the backup video |
| 2:00 → 3:30 | Screenshots, README, form draft |
| **3:30 PM** | **Submit** |
| 4:00 → 6:30 | Expo. The game runs continuously. Every player is a People's Favourite vote |

---

## The pitch, 3 minutes

- **0:00** "Everyone take out your phone and scan this." Judges are playing inside twenty seconds.
- **0:20** **Flash.** Every phone lights up on the same millisecond; reaction times land on the room
  screen. The clock sync, made visible.
- **0:50** **Blindside.** They go blind. The room screen does not. They laugh.
- **1:50** "Spaceteam did private per-phone state in 2012. DUAL put a bullet across two phones in
  2014. What nobody has done is make the target of your input *a person, at the angle they are
  actually sitting*." Then show the seats being placed.
- **2:10** The engineering: per-player views, authoritative server, median clock offset, recovery
  when a phone drops mid-round.
- **2:30** The number from the expo floor.
- **2:50** "One link. No install. On whatever is already in your pocket."

## Prizes we are actually chasing

Multiplayer track · People's Favourite (room vote — this is ours to lose) · Best Design ·
MLH Vultr · MLH MongoDB · MLH ElevenLabs. Grand Prize is a live shot.

Skip Auth0 and Solana. Login friction kills walk-up play, and a token would read as prize-chasing
on the exact rubric line that punishes bolt-ons.

## Rules that keep us out of trouble

- The repo stays **public** through the event — hard MLH eligibility condition.
- Everything was built during the event. Say so.
- AI tools are allowed and MLH asks you to disclose them. We disclose.

---

## Working on this

```bash
npm install
npm start                                  # http://localhost:8080
cloudflared tunnel --url http://localhost:8080   # public HTTPS for phones
```

A new game is one entry in `modes.js`:

```js
myGame: {
  name: "My Game", min: 2, blurb: "one line for the lobby",
  start(ctx) { ctx.data.deadline = ctx.now() + 8000 },
  act(ctx, player, msg) { /* {a:'swipe',angle} | {a:'tap'} */ return true },
  tick(ctx, now) { return false },
  view(ctx, player) { return { kind: "text", countdownTo: ctx.data.deadline, title: "GO" } },
  spectate(ctx) { return { kind: "text", title: "what the room sees" } },
}
```

**Never send a rendered number.** Send the deadline (`countdownTo`, `flashAt`) and let each phone
compute it against its synced clock. We learned this the hard way: Flash never lit up because a
waiting game produces no state changes and therefore no frames.
