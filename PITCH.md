# Huddle pitch

## The one-sentence version

Huddle is an engine for phone party games where every player is sent a different view of the same
room — and the game it exists to prove is **Chairs**: musical chairs where the chairs are people.

## Why the room is the mechanic

Point your phone across the table. It says a name — the human sitting at that angle, because
everyone dragged their own dot onto a ring. Turn your body, and the name changes.

Every few seconds the whole room gets one order: **point at someone nobody else is pointing at.**
On the beat the server freezes every arm at once. Your phone tells you who YOU claimed. It will
not tell you who claimed YOU. If two people stacked on the same stranger, you get a verdict that
names them: **TAKEN — PRIYA, also KAI.** Nobody is eliminated. The room climbs a speed ladder, and
the best level of the day survives every group that plays the table.

That is the product. A game whose central mechanic is **shouting strangers' names at each other**.

## Say the prior art out loud, first

| What | Who did it first |
|---|---|
| Private per-phone state in a co-located room | **Spaceteam**, 2012 |
| Phones as no-install controllers | **Jackbox** 2014, **AirConsole** 2015 |
| Knowing which *person* you are facing | **Apple U1 / Nearby Interaction** 2020 |
| Musical chairs / unique-claim social games | party games forever |

**Then the delta:**

> No install, no camera, no UWB. You drag your seat onto a ring, your phone resolves the direction
> you are pointing to a *human*, and the server judges every arm on the same beat — while
> withholding the inbound graph from every phone in the room.

## The three-minute script

- **0:00** "Everyone take out your phone and scan this." Loaner phones already joined.
- **0:20** "Drag your dot to where you're actually sitting."
- **0:35** **Chairs.** "Point at someone. Your phone will name them." They turn; the name changes.
- **0:50** "Rule is one sentence: point at someone nobody else is pointing at." Beat lands.
  Verdicts fire. Someone shouts a name. Shut up and let that happen.
- **1:20** Turn to the laptop. "Every line of sight is here. Collision seats say TAKEN. Their phones
  know who they claimed — the phones will not say who claimed them."
- **1:50** Prior art, then the delta above.
- **2:15** Engineering: `view(ctx, player)` per phone; median clock offset so the beat is the same
  millisecond; seat geometry so an angle is a person; day-best level in `records`.
- **2:40** Floor number: people today, rounds, best Chairs level.
- **2:50** "One link. No install. On whatever is already in your pocket."

## Answers judges will ask

**"My iPhone already knows which friend I'm facing."**
> U1 / Nearby Interaction needs the silicon in *both* phones. We get the social geometry from a
> two-second seat drag, in Safari, on anything with a browser.

**"Isn't this just musical chairs?"**
> Musical chairs eliminates people and needs furniture. Chairs never eliminates anyone — the room
> climbs a shared speed ladder — and the "chair" is a stranger whose name your phone just taught
> you how to shout.

## Run of show

- Never demo with fewer than three phones (Chairs min is 3); four is better.
- Loaner phones face-down, already joined and seated, named JUDGE 1/2/3.
- One person runs the laptop; one talks.
- Printed QR backup.
- Table runs continuously through the expo. A finished round reopens the lobby on its own.

## Track

**Multiplayer** — "this is how you can meet people and touch grass." The mechanic is learning and
shouting real names in a room. It does not work over the internet.

## Prizes

- **Multiplayer track** and **People's Favourite** — the game is the argument.
- **Best Design** — phone legible at arm's length; room screen for the audience.
- **MLH Vultr / MongoDB / ElevenLabs** — only if live and earned. Never claim a dark wire.
