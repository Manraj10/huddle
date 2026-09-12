# The game backlog

Every game here is ~40 lines in `modes.js` and ships nothing to the phones. They are ordered by
what they prove about the engine, because the engine is what we are submitting.

The engine gives you four powers. A game is good here when it uses at least two:

1. **Per-player truth** — `view()` runs once per player, so two people can be told different things.
2. **Seat geometry** — a swipe is a direction, and a direction is a person sitting there.
3. **A shared clock** — every phone agrees on "now" to within a few milliseconds.
4. **The room itself** — people can see and hear each other. The phone is not the whole game.

Shipped: **Blindside** (1, 2), **Flash** (3), **Impostor** (1).

---

## Duel — the cross-phone shooter

**Powers: 2, 3, 4.** The one we set out to build.

Phones lie in a row, ordered by seat angle. Each player has a ship on their own screen. Drag to
move, tap to fire. A bullet leaving your right edge enters your neighbour's left edge at the same
height and the same speed — and **while it crosses the real gap between the two phones it exists on
the server and is on nobody's screen.** Lead your shot into a gap you cannot see into.

```js
// world is normalised per screen; the server owns everything
d = {
  ships:   { [id]: {x: 0.5, y: 0.5, hp: 3} },
  bullets: [ {owner, lane, x, y, vx, vy, bornAt} ],   // lane = index into the seat order
  order:   [id, id, id],                              // left to right by seat angle
}
```

- `tick`: advance bullets. When `x > 1`, hand the bullet to `lane + 1` at `x = 0` with the same `y`
  and `vy`, **arriving `GAP_MS` later** (start at 250 ms and tune with real phones on a real table).
  While in transit it belongs to no lane and appears in nobody's view.
- `view`: only the bullets in this player's lane, positions normalised to their screen.
- `spectate`: the whole row, gaps included — the room screen is the only place the full truth exists,
  which is the best thing about this mode.

**Say DUAL out loud when you demo it.** Seabaa shipped it in 2014 for two devices over Bluetooth,
and an itch.io game published days before this hackathon describes the same gap idea. Our delta is
N players, no install, open web, and the gap as a hiding place rather than a timing detail.

Needs a new `arena` view kind from Lane 2. Agree the shape before starting.

---

## Séance — the room agrees on a moment, with no signal

**Powers: 3, 4.** My pick for the most original thing we could ship today.

No countdown, no cue, nothing on screen but a single word: **WHEN**. Every player must tap at the
same moment. The score is the spread between the earliest and latest tap, in milliseconds, measured
on the shared clock and displayed enormous on the room screen.

Under 100 ms is a room that is genuinely watching each other. The only way to win is to look up from
your phone — which is precisely what the track asks for.

```js
seance: {
  name: "Séance", min: 3,
  blurb: "Tap at the same moment. No countdown. Look at each other.",
  start(ctx) { ctx.data.taps = {}; ctx.data.openedAt = ctx.now(); },
  act(ctx, p, msg) {
    if (msg.a !== "tap" || ctx.data.taps[p.id]) return false;
    ctx.data.taps[p.id] = ctx.now();
    return true;
  },
  tick(ctx, now) {
    const d = ctx.data, live = ctx.alive();
    if (!live.every(p => d.taps[p.id]) ) return now - d.openedAt > 20000 ? (d.spread = Infinity, true) : false;
    const times = live.map(p => d.taps[p.id]);
    d.spread = Math.max(...times) - Math.min(...times);
    ctx.finishRound(null);                  // co-op: nobody is out
    return true;
  },
  view(ctx, p) {
    const d = ctx.data;
    return d.taps[p.id]
      ? { kind: "text", big: "✓", title: "waiting on the room", dim: true }
      : { kind: "text", big: "WHEN", title: "tap together", sub: "no countdown is coming" };
  },
  spectate(ctx) { /* the spread in ms, huge, plus the day's best */ },
}
```

Round two: **make them do it with their eyes closed.** The room has to breathe together.

---

## Whisper — the same word, corrupted differently for everyone

**Powers: 1, 2, 4.** The purest possible demonstration of per-player truth, and very funny.

A word goes round the ring. Each player sees the word **as the previous player's phone rendered it**,
with one letter swapped, dropped, or transposed — a different corruption per player, chosen by the
server. You say what you see out loud, then swipe it onward. At the end the room screen reveals the
original next to what came out.

The joke writes itself: everyone is sure they read it correctly, and the room screen proves the
server lied to each of them differently.

```js
d = { word: "SUBMARINE", chain: [{id, shown}], at: 0 }
// corrupt(word, seed) — one edit per hop, deterministic from the player id
```

Scoring: the room scores 1 if the final word matches the original. Co-op, nobody sits out.

---

## Mole — everyone got the same instruction, except one

**Powers: 1, 3, 4.** Séance plus Impostor, and it is nastier than either.

Every phone shows the same instruction: **"tap on 3."** One phone shows **"tap on 4."** The room taps,
the clock records everyone to the millisecond, and then the room votes on who was off the beat.

The mole's only defence is to guess when everyone else will tap. The room's only tool is the timing
they felt, plus the room screen showing the spread after the vote.

```js
d = { mole: id, beat: 3, taps: {}, votes: {}, phase: "tap" | "vote" }
```

- The mole scores 2 if they survive the vote, 0 if caught.
- Everyone else scores 1 if the mole is caught.
- The room screen shows the actual tap times **after** the vote, which is the reveal: you can see
  the mole was 380 ms late and nobody noticed.

---

## Relay — the room's lap time

**Powers: 2, 4.** Co-op, so an eliminated stranger never walks away from the table.

A token travels the ring in seat order as fast as the room can pass it. Total time is the score,
chased against the day's record on the room screen. A pass to the wrong neighbour costs two seconds.

The seat order matters, which makes it the game that proves the seating is real.

---

## Chain — a sequence only one person can see

**Powers: 1, 2.**

A growing order of players: A, then C, then B. **Only the player extending it sees the full
sequence**; everyone else sees the length. Then the room must tap in that order from memory, and
tapping out of turn puts you out.

The same room state renders as a secret for one person and a number for everyone else. That is the
one-sentence explanation of the engine, as a game.

---

## Wiretap — two people share a word and must find each other

**Powers: 1, 4.**

Everyone is shown a word. Two players secretly share the same one. The pair must find each other and
swipe at each other, without the rest of the room noticing. If anyone else swipes at a member of the
pair first, the room wins.

It turns the table into a room full of people trying to signal one person and nobody else, which is
the best social texture on this list.

---

## Countdown Chicken — hold, and hold, and hold

**Powers: 3, 4.** Thirty lines, no skill barrier, and it makes a crowd shout.

Everyone holds a finger on their screen. The last person still holding wins the round — except the
charge goes off at a random moment, and whoever is still holding when it does is out. Everyone can
see, on the room screen, how many fingers are still down.

Perfect walk-up game for the expo: the rules fit in six words.

---

## If you only build three more

**Duel** (the one we promised), **Séance** (the most original, and the cheapest), **Relay** (co-op,
so nobody sits out). That set covers every power the engine has, and each one demos in under a
minute.
