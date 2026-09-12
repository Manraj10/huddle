# Huddle pitch

## The one-sentence version

Huddle is an engine for phone party games where every player is sent a different view of the same
room — and the game it exists to prove is **Standoff**, where you point your phone at a person and
it will not tell you who is pointing at you.

## Why the room is the mechanic

Point your phone across the table. It says a name — the name of the human sitting at that angle,
because everyone dragged their own dot onto a ring to say where they actually are. Turn your body,
and the name changes.

Someone is holding a bomb on a hidden fuse. They throw it at whoever they are pointing at. Your
phone says **INCOMING**. It does not say who threw it. The server knows. The laptop knows. Your
phone will not say, and the throw is in the air for nine hundred milliseconds — so the only way to
send it back is to look up, work out which person in the room has their phone aimed at you, and
face them before it lands.

That is the product. A game whose central mechanic is **looking at other people**.

## Say the prior art out loud, first

Every atom of this has an ancestor and we can name all of them. Getting caught reads as ignorance;
pre-empting reads as taste.

| What | Who did it first |
|---|---|
| Private per-phone state in a co-located room | **Spaceteam**, 2012 |
| Phones as no-install controllers | **Jackbox** 2014, **AirConsole** 2015 |
| One game spanning several browser phones | **Chrome Racer**, Google, 2013 |
| A bullet crossing the gap between two phones | **DUAL**, Seabaa, 2015 — and **Spatial Revenge**, itch.io, published days before this event, gyroscope and "dead zone between screens" included |
| Tilt as a social, body-visible input | **Bounden** 2014, **Heads Up!** 2013 |
| Phones working out where they are sitting, by sound | **Sonoloc**, MobiSys 2018, hundreds of phones — built on **BeepBeep**, 2007 |
| Knowing which *person* you are facing | **Apple U1 / Nearby Interaction** 2020, **Samsung UWB Point to Share** 2020 |
| Screenless, room-visible local multiplayer | **Johann Sebastian Joust**, 2011 |
| Hidden-timer hot potato | Bomb Party, and a children's party game |

**Then the delta, which is five clauses of constraint and survives every one of those:**

> Apple's U1 and Samsung's UWB can already tell you which person you are facing — if you bought the
> right phone in the right year. Sonoloc can make a hundred phones chirp at each other until they
> know who is sitting where. What none of them do is this: **no install, no app store, no camera, no
> UWB chip, no dongle.** You drag your own dot onto a ring to say where you are sitting, and from
> then on your phone resolves the direction you are pointing to *the actual human at that angle* —
> while the server holds a different truth for every phone in the room.

## The three-minute script

- **0:00** "Everyone take out your phone and scan this." Loaner phones go out already joined.
- **0:20** "Drag your dot to where you're actually sitting." Twenty seconds, and it is the only
  setup — but it is also the claim, so say what it is for.
- **0:35** **Standoff.** "Point your phone at someone." Every judge's phone names a person. They
  turn; the name changes. No instructions needed past that sentence.
- **1:05** Someone gets INCOMING. They look up. The room starts looking at each other — that is
  the beat to shut up and let happen.
- **1:30** Turn to the laptop. "Their phones know who is aiming at them. The phones will not say."
  Every line of sight in the room, the holder's in red, the marked player ringed and labelled
  DOESN'T KNOW.
- **1:50** The prior art, in the wording above. Name the ancestors, then the five constraints.
- **2:15** The engineering: `view(ctx, player)` runs once per player per broadcast, so the secret
  is kept in the engine and not by asking the client not to look; median clock offset so every
  phone agrees on the same millisecond; identity that survives a screen lock; rounds that carry on
  when a phone leaves; and tests that assert a marked player's frame has the same key set as an
  unmarked one, because a key set leaks as loudly as a value.
- **2:40** The floor number: people who have played today, rounds, fastest reaction.
- **2:50** "One link. No install. On whatever is already in your pocket."

## Answers to the two questions a judge will ask

**"My iPhone already knows the direction of my friend's iPhone."**
> It does — iPhone 11 and up, U1, Nearby Interaction. Samsung shipped "point at the people you're
> facing" on the Note20. Both need the silicon in *both* phones. We get the same social geometry
> from a two-second drag, in Safari, on anything with a browser. Nobody at this expo has to own the
> right phone.

**"Couldn't the phones work this out themselves with sound?"**
> Yes — Sonoloc did exactly that at MobiSys 2018, on top of BeepBeep from 2007. We deliberately
> didn't. A chirp-ranging pass costs seconds of silence, degrades in a loud hall, and needs a
> microphone permission from every walk-up. Declaring your seat takes two seconds, never fails, and
> is *more* accurate than trilateration — because the player is the sensor.

## Run of show

- Never demo with fewer than four phones. Standoff's block is disabled at two on purpose.
- Two or three loaner phones face-down, already joined and already seated, named JUDGE 1/2/3.
- One person runs the laptop and the phones; one person talks.
- Printed QR as backup if the laptop dies.
- The table runs continuously through the expo. A finished round reopens the lobby on its own.

## Track

**Multiplayer** — "this is how you can meet people and touch grass." The central mechanic is
working out which human is looking at you. It does not work over the internet, and it does not work
if you are alone.

## Prizes

Honest about which are earned:

- **Multiplayer track** and **People's Favourite** — the game is the argument.
- **Best Design** — the phone is legible at arm's length; the room screen is built for an audience.
- **MLH Vultr** — only if the server actually runs there.
- **MLH MongoDB Atlas** — NOT EARNED. Stats write a JSON file (`deploy/stats.js`). Point that
  writer at Atlas before claiming it, or drop the claim.
- **MLH ElevenLabs** — NOT EARNED. There is no speech in the product; the only audio is one
  oscillator. Build the announcer or drop the claim.

A judge who catches one false claim discounts every other one.
