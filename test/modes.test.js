// Mode logic, with no sockets and no clock.
//
// Everything in modes.js talks to the room through `ctx`, so the whole engine can be driven from
// a plain object. That is the only reason these games are testable at all: there is no way to sit
// four phones down at a table inside CI, but there is a way to prove the rules they will meet.
import test from "node:test";
import assert from "node:assert/strict";

import { MODES, TUNING, apart, nearest, seatBlocker } from "../modes.js";

// ---- a room in a test tube --------------------------------------------------

/** Seats four people at the corners of a square by default, all placed. */
function room(names = ["ALFA", "BRAVO", "CHARLIE", "DELTA"], opts = {}) {
  let clock = 1_000_000;
  const list = names.map((name, i) => ({
    id: i + 1, name, alive: true, gone: false, score: 0, placed: true,
    seat: opts.seats ? opts.seats[i] : (i / names.length) * 2 * Math.PI,
  }));
  const log = { notices: [], eliminated: [], finished: null };
  const records = {};
  let data = {};

  const r = {
    players: list,
    log,
    records,
    get data() { return data; },
    at: (name) => list.find((p) => p.name === name),
    advance(ms) { clock += ms; return clock; },
    now: () => clock,
    drop(name) { r.at(name).gone = true; },
    ctx: {
      now: () => clock,
      players: () => list,
      alive: () => list.filter((p) => p.alive && !p.gone),
      get data() { return data; },
      get phase() { return "live"; },
      get records() { return records; },
      seatOf: (p) => p.seat,
      towards: (from, angle) => nearest(list.filter((p) => p.alive && !p.gone), from, angle),
      setRecord(key, value) { records[key] = value; return value; },
      notice(text) { log.notices.push(text); },
      eliminate(p, why) {
        if (p) p.alive = false;
        log.eliminated.push({ name: p?.name ?? null, why });
      },
      award(p, n = 1) { if (p) p.score += n; },
      finishRound(winner, headline) { log.finished = { winner: winner?.name ?? null, headline: headline ?? null }; },
      push() {},
    },
  };
  r.start = (key) => { data = {}; MODES[key].start(r.ctx); return r; };
  r.act = (name, msg) => MODES[r.key].act(r.ctx, r.at(name), msg);
  r.tick = () => MODES[r.key].tick(r.ctx, clock);
  r.view = (name) => MODES[r.key].view(r.ctx, r.at(name));
  r.spectate = () => MODES[r.key].spectate(r.ctx);
  r.play = (key) => { r.key = key; return r.start(key); };
  return r;
}

// ---- seat geometry ----------------------------------------------------------

test("angular distance wraps across zero", () => {
  assert.ok(Math.abs(apart(0.1, 2 * Math.PI - 0.1) - 0.2) < 1e-9);
  assert.ok(Math.abs(apart(0, Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(apart(-3, 3) - (2 * Math.PI - 6)) < 1e-9);
});

test("a swipe reaches the person sitting at that angle, not the next one to join", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  const alfa = r.at("ALFA");
  // straight left of ALFA is CHARLIE at pi, whatever order anyone joined in
  assert.equal(nearest(r.players, alfa, Math.PI).name, "CHARLIE");
  assert.equal(nearest(r.players, alfa, Math.PI / 2 + 0.2).name, "BRAVO");
  assert.equal(nearest(r.players, alfa, -Math.PI / 2).name, "DELTA");
  // and never the person doing the swiping, even when they swipe at their own seat
  assert.notEqual(nearest(r.players, alfa, 0).name, "ALFA");
  assert.equal(nearest([alfa], alfa, 0), null);
});

test("the seat blocker names who the room is waiting on, and says nothing when it should not", () => {
  const one = [{ name: "ALFA", seat: 0, placed: false }];
  assert.equal(seatBlocker(one), null, "one phone alone is not a seating problem");

  const none = [
    { name: "ALFA", seat: 0, placed: false },
    { name: "BRAVO", seat: 0, placed: false },
  ];
  assert.equal(seatBlocker(none), "everyone: drag your seat to where you are actually sitting");

  const some = [
    { name: "ALFA", seat: 0, placed: true },
    { name: "BRAVO", seat: 2, placed: true },
    { name: "CHARLIE", seat: 0, placed: false },
  ];
  assert.equal(seatBlocker(some), "waiting on CHARLIE to place a seat");

  const stacked = [
    { name: "ALFA", seat: 1.0, placed: true },
    { name: "BRAVO", seat: 1.1, placed: true },
  ];
  assert.equal(seatBlocker(stacked), "ALFA, BRAVO are in the same place — one of you move");

  const fine = [
    { name: "ALFA", seat: 0, placed: true },
    { name: "BRAVO", seat: 2, placed: true },
    { name: "CHARLIE", seat: 4, placed: true },
  ];
  assert.equal(seatBlocker(fine), null);
});

test("the blocker is derived, so placing the last seat clears it with no bookkeeping", () => {
  const list = [
    { name: "ALFA", seat: 0, placed: true },
    { name: "BRAVO", seat: 2, placed: true },
    { name: "CHARLIE", seat: 4, placed: false },
  ];
  assert.match(seatBlocker(list), /CHARLIE/);
  list[2].placed = true;
  assert.equal(seatBlocker(list), null);
});

// ---- relay ------------------------------------------------------------------

test("relay: a clean lap round the ring finishes and becomes the room's record", () => {
  const r = room().play("relay");
  const d = r.data;
  const name = (id) => r.players.find((p) => p.id === id).name;
  for (let i = 0; i < d.order.length; i++) {
    const holder = name(d.order[d.at]);
    const next = r.players.find((p) => p.id === d.order[(d.at + 1) % d.order.length]);
    r.advance(300);
    assert.equal(r.act(holder, { a: "swipe", angle: next.seat }), true);
  }
  assert.equal(d.passes, d.need, "the token came all the way back round");
  assert.equal(d.done, true);
  r.tick();
  assert.equal(r.log.finished.winner, null, "co-op: nobody is eliminated and nobody wins");
  assert.equal(r.records.relay, d.total);
  assert.match(r.log.finished.headline.title, /RECORD/);
});

test("relay: passing to the wrong neighbour costs the room two seconds and not the turn", () => {
  const r = room().play("relay");
  const d = r.data;
  const name = (id) => r.players.find((p) => p.id === id).name;
  const holder = name(d.order[d.at]);
  const wrong = r.players.find((p) => p.id === d.order[(d.at + 2) % d.order.length]);
  assert.equal(r.act(holder, { a: "swipe", angle: wrong.seat }), true);
  assert.equal(d.penalty, TUNING.RELAY_PENALTY);
  assert.equal(d.passes, 0, "a wrong pass does not advance the lap");
  assert.equal(d.order[d.at], r.at(holder).id, "and the token stays where it was");
  // and the room can see it cost them
  const bystander = r.players.find((p) => p.id !== r.at(holder).id);
  assert.match(r.view(bystander.name).sub, /2\.0s/);
});

test("relay: someone else's turn is not yours", () => {
  const r = room().play("relay");
  const d = r.data;
  const notTheHolder = r.players.find((p) => p.id !== d.order[d.at]);
  assert.equal(r.act(notTheHolder.name, { a: "swipe", angle: 0 }), false);
});

test("relay: the direction alternates between rounds", () => {
  const r = room().play("relay");
  const first = r.data.clockwise;
  r.start("relay");
  assert.equal(r.data.clockwise, !first);
  r.start("relay");
  assert.equal(r.data.clockwise, first);
});

test("relay: a phone leaving mid-lap does not strand the token", () => {
  const r = room().play("relay");
  const d = r.data;
  const name = (id) => r.players.find((p) => p.id === id).name;
  const holder = name(d.order[d.at]);
  r.drop(holder);
  assert.equal(r.tick(), true);
  assert.deepEqual(r.log.notices, ["a phone dropped — the lap carries on"]);
  assert.equal(d.order.length, 3);
  assert.ok(!d.order.includes(r.at(holder).id));
  assert.ok(d.order.includes(d.order[d.at]), "the token points at somebody who is still here");
  // and the shortened lap can still be completed
  for (let i = 0; i < 6 && !d.done; i++) {
    const who = name(d.order[d.at]);
    const next = r.players.find((p) => p.id === d.order[(d.at + 1) % d.order.length]);
    r.advance(200);
    r.act(who, { a: "swipe", angle: next.seat });
  }
  assert.equal(d.done, true, "the lap still completes with three");
});

test("relay: a lap with fewer than two phones left is abandoned, not wedged", () => {
  const r = room().play("relay");
  r.drop("BRAVO"); r.drop("CHARLIE"); r.drop("DELTA");
  assert.equal(r.tick(), true);
  assert.equal(r.log.finished.headline.title, "lap abandoned");
});

test("relay: the token holder is shown something nobody else is shown", () => {
  const r = room().play("relay");
  const d = r.data;
  const holder = r.players.find((p) => p.id === d.order[d.at]).name;
  const other = r.players.find((p) => p.id !== d.order[d.at]).name;
  assert.equal(r.view(holder).big, "GO");
  assert.match(r.view(holder).title, /^PASS TO /);
  assert.notEqual(r.view(other).big, "GO");
  assert.equal(r.view(other).title, "round the ring");
});

// ---- chain ------------------------------------------------------------------

test("chain: the extender sees the sequence and nobody else does", () => {
  const r = room().play("chain");
  const d = r.data;
  const extender = r.players.find((p) => p.id === d.ring[d.turn]);
  const victim = r.players.find((p) => p.id !== extender.id);
  r.act(extender.name, { a: "swipe", angle: victim.seat });
  assert.deepEqual(d.seq, [victim.id]);
  assert.equal(d.phase, "recall");

  // back to extend so the asymmetry is visible
  r.act(victim.name, { a: "tap" });
  assert.equal(d.phase, "extend");
  const next = r.players.find((p) => p.id === d.ring[d.turn]);
  const theirView = r.view(next.name);
  const anyoneElse = r.players.find((p) => p.id !== next.id);
  assert.equal(theirView.sub, victim.name, "the extender is shown the actual chain");
  assert.ok(!r.view(anyoneElse.name).sub.includes(" → "), "everyone else is shown a number");
});

test("chain: recall in order advances, out of turn breaks it", () => {
  const r = room().play("chain");
  const d = r.data;
  const extender = r.players.find((p) => p.id === d.ring[d.turn]);
  const first = r.players.find((p) => p.id !== extender.id);
  r.act(extender.name, { a: "swipe", angle: first.seat });

  const wrongPerson = r.players.find((p) => p.id !== first.id);
  r.act(wrongPerson.name, { a: "tap" });
  assert.equal(d.phase, "fail");
  assert.equal(d.failed, wrongPerson.id);

  r.advance(2000);
  r.tick();
  assert.deepEqual(r.log.eliminated, [{ name: wrongPerson.name, why: `${wrongPerson.name} tapped out of turn` }]);
});

test("chain: you are told your own places and never the room's progress", () => {
  const r = room().play("chain");
  const d = r.data;
  const extender = r.players.find((p) => p.id === d.ring[d.turn]);
  const first = r.players.find((p) => p.id !== extender.id);
  r.act(extender.name, { a: "swipe", angle: first.seat });
  const v = r.view(first.name);
  assert.equal(v.title, "TAP IN ORDER");
  assert.match(v.sub, /you are 1st/);
  assert.ok(!("at" in v), "the recall view never carries the position the room has reached");
  assert.equal(r.view(extender.name).sub.startsWith("you are not in the chain yet"), true);
});

test("chain: a phone leaving rebuilds the chain instead of putting an innocent player out", () => {
  const r = room().play("chain");
  const d = r.data;
  const extender = r.players.find((p) => p.id === d.ring[d.turn]);
  const first = r.players.find((p) => p.id !== extender.id);
  r.act(extender.name, { a: "swipe", angle: first.seat });
  assert.equal(d.phase, "recall");

  r.drop(first.name);
  assert.equal(r.tick(), true);
  assert.deepEqual(r.log.eliminated, [], "nobody is eliminated for a chain they cannot complete");
  assert.deepEqual(d.seq, []);
  assert.equal(d.phase, "extend");
  assert.ok(!d.ring.includes(first.id));
  assert.match(r.log.notices.at(-1), /a phone dropped/);
});

// ---- wiretap ----------------------------------------------------------------

test("wiretap: exactly two share a word and every decoy is distinct, over 40 rounds", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT"]);
  r.key = "wiretap";
  for (let round = 0; round < 40; round++) {
    r.start("wiretap");
    const d = r.data;
    const words = r.players.map((p) => d.word[p.id]);
    assert.equal(words.filter((w) => w === d.shared).length, 2, "the shared word is held by exactly two");
    assert.equal(d.pair.length, 2);
    assert.notEqual(d.pair[0], d.pair[1]);
    for (const id of d.pair) assert.equal(d.word[id], d.shared);
    // Every non-pair word is unique. A single shared decoy makes two strangers read as the
    // hidden pair to each other, and the round resolves on a lie the engine told.
    const decoys = r.players.filter((p) => !d.pair.includes(p.id)).map((p) => d.word[p.id]);
    assert.equal(new Set(decoys).size, decoys.length, `round ${round}: duplicate decoy`);
    assert.ok(!decoys.includes(d.shared));
  }
});

test("wiretap: the pair's screen is byte-identical to everyone else's but for the word", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO"]).play("wiretap");
  const d = r.data;
  const inPair = r.players.find((p) => d.pair.includes(p.id));
  const outside = r.players.find((p) => !d.pair.includes(p.id));
  const a = r.view(inPair.name), b = r.view(outside.name);
  assert.deepEqual(Object.keys(a), Object.keys(b));
  for (const key of ["kind", "title", "sub", "countdownTo", "bg", "ink", "dim", "pulse"]) {
    assert.deepEqual(a[key], b[key], `"${key}" differs and would give the pair away`);
  }
  assert.equal(a.ring.length, b.ring.length);
  assert.notEqual(a.big, b.big);
});

test("wiretap: the pair scoring two each requires both of them to swipe at each other", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO"]).play("wiretap");
  const d = r.data;
  const [a, b] = d.pair.map((id) => r.players.find((p) => p.id === id));
  r.act(a.name, { a: "swipe", angle: b.seat });
  assert.equal(d.over, false, "one half of a pair reaching out is not a pair finding each other");
  r.act(b.name, { a: "swipe", angle: a.seat });
  assert.equal(d.over, true);
  assert.equal(a.score, 2);
  assert.equal(b.score, 2);
  assert.match(r.log.finished.headline.sub, /found each other/);
});

test("wiretap: an outsider who guesses a pair member hands the round to the room", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO"]).play("wiretap");
  const d = r.data;
  const target = r.players.find((p) => d.pair.includes(p.id));
  const outsider = r.players.find((p) => !d.pair.includes(p.id));
  r.act(outsider.name, { a: "swipe", angle: target.seat });
  assert.equal(d.over, true);
  assert.equal(outsider.score, 1);
  assert.equal(target.score, 0, "the pair score nothing when they are caught");
  for (const p of r.players) if (!d.pair.includes(p.id)) assert.equal(p.score, 1);
});

test("wiretap: half a pair leaving ends the round and reveals", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO"]).play("wiretap");
  const d = r.data;
  r.drop(r.players.find((p) => p.id === d.pair[0]).name);
  assert.equal(r.tick(), true);
  assert.equal(d.over, true);
  assert.match(r.log.finished.headline.sub, /left before anyone found them/);
  assert.equal(r.log.finished.headline.big, d.shared);
});

// ---- blindside --------------------------------------------------------------

test("blindside: a brace is a real save, spent once, and the bomb goes back into the room", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE"]).play("blindside");
  const d = r.data;
  const holder = r.players.find((p) => p.id === d.holder);
  const bracer = r.players.find((p) => p.id !== d.holder);
  r.act(bracer.name, { a: "tap" });
  assert.ok(d.braced[bracer.id] > r.now());

  // put the bomb on the braced player, then burn the fuse down
  d.holder = bracer.id;
  d.fuseAt = r.now();
  assert.equal(r.tick(), true);
  assert.equal(bracer.alive, true, "the brace absorbed it");
  assert.deepEqual(r.log.eliminated, []);
  assert.equal(d.braced[bracer.id], undefined, "and it is spent, so it cannot be reused");
  assert.notEqual(d.holder, bracer.id, "the bomb jumps to somebody else");
  const short = d.fuseAt - r.now();
  assert.ok(short >= 6000 && short <= 10000, `relit fuse should be short, got ${short}`);
  assert.match(r.log.notices.at(-1), /braced and took the blast/);

  // second time round, with the save gone, it eliminates
  d.holder = bracer.id;
  d.fuseAt = r.now();
  r.tick();
  assert.equal(bracer.alive, false);
  assert.equal(r.log.eliminated.at(-1).why, `${bracer.name} was holding it`);
});

test("blindside: the holder's phone leaving does not take the round with it", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE"]).play("blindside");
  const d = r.data;
  const holder = r.players.find((p) => p.id === d.holder);
  r.drop(holder.name);
  assert.equal(r.tick(), true);
  assert.ok(d.holder !== holder.id && d.holder != null, "the bomb landed on somebody still here");
});

test("blindside: only the holder is told there is a bomb", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE"]).play("blindside");
  const d = r.data;
  const holder = r.players.find((p) => p.id === d.holder).name;
  const other = r.players.find((p) => p.id !== d.holder).name;
  assert.equal(r.view(holder).title, "YOU HAVE IT");
  assert.equal(r.view(holder).countdownTo, d.fuseAt);
  assert.equal(r.view(other).big, "?");
  assert.equal(r.view(other).countdownTo, undefined, "a non-holder is not even told when it ends");
});

// ---- duel -------------------------------------------------------------------

test("duel: lanes follow seat order, left to right", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE"], { seats: [2, 0, 1] }).play("duel");
  assert.deepEqual(r.data.order.map((id) => r.players.find((p) => p.id === id).name),
    ["BRAVO", "CHARLIE", "ALFA"]);
});

test("duel: the ends of the row are forced to fire inward", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE"], { seats: [0, 1, 2] }).play("duel");
  const d = r.data;
  const [left, , right] = d.order.map((id) => r.players.find((p) => p.id === id));

  r.act(left.name, { a: "fire", dir: Math.PI });          // aimed off the left-hand end
  assert.ok(d.bullets.at(-1).vx > 0, "the leftmost phone cannot shoot into nothing");

  r.advance(TUNING.GAP + 1000);
  r.act(right.name, { a: "fire", dir: 0 });               // aimed off the right-hand end
  assert.ok(d.bullets.at(-1).vx < 0, "and neither can the rightmost");
});

test("duel: a shot straight up still crosses the screen", () => {
  const r = room(["ALFA", "BRAVO"], { seats: [0, 1] }).play("duel");
  const d = r.data;
  const left = r.players.find((p) => p.id === d.order[0]);
  r.act(left.name, { a: "fire", dir: -Math.PI / 2 });
  assert.ok(Math.abs(d.bullets[0].vx) > 0.1, "a bullet that never leaves your phone is not the game");
});

test("duel: a bullet in the gap between two phones is on nobody's screen", () => {
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  const d = r.data;
  const left = r.players.find((p) => p.id === d.order[0]);
  const right = r.players.find((p) => p.id === d.order[1]);
  r.act(left.name, { a: "fire", dir: 0 });
  assert.equal(d.bullets.length, 1);

  for (let i = 0; i < 60 && !d.bullets[0].arriveAt; i++) { r.advance(50); r.tick(); }
  assert.ok(d.bullets[0].arriveAt, "the bullet reached the edge and entered the gap");
  assert.equal(d.bullets[0].lane, 1, "it now belongs to the next phone along");

  // This is the whole claim. It exists on the server and it is on neither screen.
  assert.deepEqual(r.view(left.name).objects, []);
  assert.deepEqual(r.view(right.name).objects, []);

  r.advance(TUNING.GAP + 60);
  r.tick();
  assert.equal(d.bullets[0].arriveAt, 0);
  assert.equal(r.view(right.name).objects.length, 1, "and then it lands on the neighbour's screen");
  assert.equal(r.view(left.name).objects.length, 0);
});

test("duel: the arena view is normalised 0-1 and knows which edges have a neighbour", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE"], { seats: [0, 1, 2] }).play("duel");
  const d = r.data;
  const names = d.order.map((id) => r.players.find((p) => p.id === id).name);
  assert.equal(r.view(names[0]).edge, "right");
  assert.equal(r.view(names[1]).edge, "both");
  assert.equal(r.view(names[2]).edge, "left");
  const v = r.view(names[1]);
  assert.equal(v.kind, "arena");
  assert.ok(v.you.x >= 0 && v.you.x <= 1 && v.you.y >= 0 && v.you.y <= 1);
  assert.equal(v.you.hp, 3);
});

test("duel: movement and firing are different messages", () => {
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  const me = r.players.find((p) => p.id === r.data.order[0]);
  assert.equal(r.act(me.name, { a: "move", x: 0.2, y: 0.8 }), true);
  assert.deepEqual({ x: r.data.ship[me.id].x, y: r.data.ship[me.id].y }, { x: 0.2, y: 0.8 });
  assert.equal(r.act(me.name, { a: "move", x: 9, y: -9 }), true);
  assert.deepEqual({ x: r.data.ship[me.id].x, y: r.data.ship[me.id].y }, { x: 1, y: 0 }, "clamped to the screen");
});

test("duel: an unflown ship cannot win by standing still once its phone has gone", () => {
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  r.drop("BRAVO");
  r.advance(50);
  assert.equal(r.tick(), true);
  assert.equal(r.log.finished.winner, "ALFA");
});
