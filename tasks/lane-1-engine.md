# Lane 1 — Engine and games

**You own:** `modes.js`, and the mode-facing parts of `server.js`.
**You never touch:** anything in `public/`.

Read `tasks/00-read-this-first.md` first. Every task below is written so you can paste it into
Cursor as-is.

---

## 1.1 — Real seats (P0, do this before anything else, ~45 min)

### Why this is the most valuable task in the repo

Research checked every mechanic we have against prior art. Spaceteam did private per-phone state in
2012. Jackbox owns no-install phones. Chrome Racer put a game across five browser phones in 2013.
DUAL did the cross-screen bullet in 2014. **The only claim with no prior art is that your input
targets a human being at the angle they are actually sitting.**

And right now that claim is false. `seats()` in `server.js` assigns angles by join order, so the
ring on your screen has nothing to do with where anyone is sitting. This task makes it true.

### Do

In `server.js`:

1. Delete the `seats()` function and every call to it. Keep `p.seat`, default `0`.
2. The `{t:'seat', angle}` handler already exists and writes `me.seat`. Leave it.
3. Add to the lobby view (`lobbyView`) a flag the client can render a seat picker from:
   ```js
   return { kind: "text", title: m.name, sub: ..., lobby: true,
            seatPicker: true, seats: players().map(p => ({ id: p.id, name: p.name, angle: p.seat })) };
   ```
4. Add a guard in `startRound`: if two players are within 0.25 rad of each other, set
   `room.notice = "two people are sitting in the same place — spread out"` and stay in lobby.
   Without it, a swipe is ambiguous and the game feels broken.

Then comment on Lane 2's issue: *"lobby view now sends `seatPicker` and `seats: [{id,name,angle}]`;
phones should let a player drag their own dot and send `{t:'seat', angle}`."*

### Done when

Four people sit in a square, each places their own dot, and a swipe to the left reaches the person
physically on the left. Test with four browser windows arranged on screen — place the dots to match
where the windows are, then swipe between them.

---

## 1.2 — Relay, the co-op mode (P1, ~40 min)

### Why

Every game we have eliminates people. At an expo, an eliminated stranger walks away. Relay keeps
everyone in and gives the room a shared score to beat, which is also what makes people call their
friends over.

### Spec

A token starts at a random player. It must travel the ring **in seat order** — each player swipes it
to their neighbour — all the way around. The room's total time is the score. Passing to the wrong
person resets the lap and costs two seconds of penalty.

```js
relay: {
  name: "Relay", min: 3,
  blurb: "Pass it all the way round, in order, as fast as the room can manage.",
  start(ctx) {
    const ring = ctx.alive().slice().sort((a, b) => a.seat - b.seat);
    const d = ctx.data;
    d.order = ring.map(p => p.id);
    d.at = 0;                       // index into d.order
    d.startedAt = ctx.now();
    d.penalty = 0;
    d.done = false;
  },
  act(ctx, p, msg) {
    const d = ctx.data;
    if (msg.a !== "swipe" || d.done) return false;
    if (p.id !== d.order[d.at]) return false;            // not your turn
    const want = ctx.players().find(q => q.id === d.order[(d.at + 1) % d.order.length]);
    const got = ctx.towards(p, msg.angle);
    if (!want || !got) return false;
    if (got.id !== want.id) { d.penalty += 2000; return true; }   // wrong neighbour
    d.at++;
    if (d.at >= d.order.length) { d.done = true; d.finishedAt = ctx.now(); }
    return true;
  },
  tick(ctx, now) {
    const d = ctx.data;
    if (!d.done || d.settled) return false;
    d.settled = true;
    const total = d.finishedAt - d.startedAt + d.penalty;
    ctx.finishRound(null);            // nobody is eliminated
    ctx.data.total = total;
    return true;
  },
  view(ctx, p) {
    const d = ctx.data;
    const mine = d.order[d.at] === p.id;
    return mine
      ? { kind: "text", big: "GO", title: "PASS IT LEFT", sub: "to the person on your left",
          bg: "#12351f", pulse: true, ring: /* just the next player */ }
      : { kind: "text", big: `${d.at}/${d.order.length}`, title: "round the ring", dim: true,
          countdownTo: null };
  },
  spectate(ctx) { /* lap progress + the running clock + today's record */ },
}
```

### Decisions left to you

- Direction: always clockwise, or announce it at round start? Announcing it and alternating is more
  fun and costs one line.
- Show the running clock on every phone, or only the room screen? Try both; the room screen version
  makes people look up, which is better.

### Done when

Four people can complete a lap, the total time lands on the room screen, and a wrong pass visibly
costs the room two seconds.

---

## 1.3 — Chain, the memory mode (P1, ~40 min)

A sequence of players that grows each turn: `A → C → B → ...`. **Only the player whose turn it is to
extend sees the full sequence**; everyone else sees just the length. Then the room must tap in that
order from memory, and anyone who taps out of turn is out.

This is the purest demonstration of per-player views: the same room state renders as a secret for
one person and a number for everyone else.

```js
d = { seq: [id, id, ...], phase: "extend" | "recall", at: 0, shownTo: id }
```

- `extend`: the current player sees the sequence plus "add someone", swipes at a person, which
  appends them and moves to `recall`.
- `recall`: everyone must tap in sequence order. A tap out of turn eliminates the tapper.
- Each successful lap adds one to the sequence.

### Done when

Five people can get to a sequence of four without the server getting confused about whose turn it
is, and the room screen shows the true sequence while players are guessing.

---

## 1.4 — Wiretap, hidden pairs (P1, ~40 min)

Everyone is shown a word. **Two players secretly share the same word**; everyone else has a
different one. The pair have to find each other and both swipe at each other, without the rest of
the room working out who they are.

- If the pair find each other: the pair score 2 each.
- If anyone else correctly swipes at a member of the pair first: the room scores 1 each, the pair
  score 0.
- Round ends when either happens, or after 90 seconds.

Word list: reuse the pairs already in `impostor`, or add a longer list. Keep words concrete and
sayable out loud.

### Done when

Four to eight people can play a full round out loud, and the room screen reveals the pair at the
end.

---

## 1.5 — Duel, the cross-phone shooter (P2, ~2 h, only if 1.1–1.3 are done)

The one that started all this. Ships on each phone, bullets crossing screen to screen.

**This needs a new view kind and therefore Lane 2.** Agree the shape with them before you start:

```js
{ kind: "arena", you: {x, y}, objects: [{x, y, r, c, kind}], edge: "left" | "right" | "both" }
```

Coordinates are **normalised 0–1 within your own screen**. The server owns the world; each phone
gets only what is currently on its own screen, which is also the hidden-information story: a bullet
in the gap between two phones exists on the server and is on nobody's screen.

- Phones are ordered by seat angle, left to right.
- A bullet leaving your right edge enters your right-hand neighbour's left edge at the same height
  and speed, after a flight time proportional to the real gap (default 250 ms — tune it).
- Tap to fire, drag to move.

**Say DUAL out loud when you demo this.** Seabaa shipped it in 2014 for two devices over Bluetooth,
and an itch.io game published days ago describes the same idea. Our delta is N players, no install,
open web.

### Done when

Three phones in a row, a bullet fired on the left arrives on the right, and the hit registers on the
right person's screen.

---

## Small things worth doing between tasks

- **Fuse length** in `blindside` is `rand(14000, 26000)`. Play five rounds and tune it. It should
  feel slightly too short.
- **Flight time** is 700 ms. That is the blackout window, and it is the heart of the game. Try 400
  and 1000 and pick with actual humans, not by reasoning.
- **Brace** currently lasts 1500 ms and does nothing but change colour. Either give it a real effect
  (braced players survive one explosion) or cut it.
