# Huddle pitch

## The one-sentence version

Huddle is an engine for social party games where every player gets a different view of the same room, so the room itself becomes the mechanic — not the phone, not the avatar, and not a generic leaderboard.

## Why this matters

The most common critique of phone-based party games is that they are really just app wrappers around a screen. Huddle is different. The product only works when people are physically in the same room, looking at each other, reacting to each other, and making decisions based on someone’s actual position at the table.

This is the technology layer that makes hidden information possible without leaking it to anyone else:

- per-player truth: `view()` runs once per player, and each phone receives a different truth
- seat geometry: a swipe is a direction, and a direction is a person in the room
- shared-clock precision: every phone agrees on the same moment, to milliseconds
- room-native play: people see, hear, and react to the same shared social space

## The three-minute judge script

0:00 — "Everyone take out your phone and scan this."

0:15 — We hand over already-joined loaner phones. The room is live in under twenty seconds, and judges are playing before the pitch has even started.

0:20 — "Flash." Every phone lights up on the same millisecond. The room screen shows reaction times, and the room can immediately see the precision of the clock sync.

0:50 — "Blindside." One person sees the fuse. Everyone else sees a room that looks normal. The room screen knows the truth and the players do not.

1:25 — "Spaceteam did private per-phone state in 2012. Jackbox and AirConsole proved the phone-first room. Google’s Chrome Racer showed a room spanning several browsers. DUAL put a bullet across two screens in 2014. But what nobody has done is make the target of your input a person, at the angle they are actually sitting."

1:55 — We show the seats being placed in real time. A swipe is no longer a generic action; it is aimed at the person in front of you.

2:10 — "The engineering is the point here: authoritative server, per-player views, median clock offset, recovery when a phone drops mid-round, and a room screen that tells the truth while the phones hide it."

2:30 — The floor stat: number of people played, rounds completed, and the room’s actual pace.

2:50 — "One link. No install. On whatever is already in your pocket."

## The demo run of show

- Keep 2–3 spare phones already joined and face-down on the table as JUDGE 1 / JUDGE 2 / JUDGE 3
- Never demo with fewer than four phones
- Keep a printed QR code as backup if the laptop dies
- One teammate runs the room screen and the phones; one teammate speaks
- Open with Flash, then Blindside, then seat placement

## Prior art to name before the judges do

Say the names before a judge does:

- Spaceteam — private per-phone state driving in-room social play
- Jackbox / AirConsole — room-scale phone-first party games
- Chrome Racer — a shared room spanning multiple devices
- DUAL — a bullet crossing the physical gap between two screens

Our delta is not "a party game with phones." Our delta is that the game is built around a real room, real seat angles, and real physical attention. Your input targets a person in front of you, not a name in a list and not an avatar in a virtual arena.

## Proof points the room should show

- authoritative server: the room is the source of truth, not the clients
- clock sync: every phone agrees on the same moment to within a few milliseconds
- seat geometry: the desk plan is part of the mechanic
- hidden-info gaming: the game state is kept in `view()`, not in the client

This is what makes the project feel like a platform, not a one-off demo.

## Track and prize framing

Track: Multiplayer

Justification: this is not a solo game on a screen. Huddle only works when people are in the same room together, talking, reacting, and physically sharing attention. That is exactly the social context the track is trying to reward.

Prize targets:

- People's Favourite
- Best Design
- MLH Vultr
- MLH MongoDB Atlas (only if the stats writer is pointed at Atlas first — today it writes a JSON file)
- MLH ElevenLabs (only if the room-screen announcer gets built — there is no speech today)

Our stack stays deliberately lean: no login friction, no wallet, no token gimmick, no bolt-on “startup” layer. The product is strongest when it feels like a room game, not an app trying to win a prize by adding unrelated complexity.

## Submission and project notes

The repo should stay public through the event, and judges should be able to understand the engine in less than thirty seconds without reading a huge technical doc. The code shows the engine, but the pitch explains why it matters.

The whole product is one room, one URL, and a shared set of rules that produce different truths for different people. That is Huddle.
