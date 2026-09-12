// Mode logic, with no sockets and no clock.
//
// Everything in modes.js talks to the room through `ctx`, so the whole engine can be driven from
// a plain object. That is the only reason these games are testable at all: there is no way to sit
// four phones down at a table inside CI, but there is a way to prove the rules they will meet.
import test from "node:test";
import assert from "node:assert/strict";

import { MODES, TUNING, apart, nearest, seatBlocker, seatWaiting } from "../modes.js";

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
  assert.match(seatBlocker(none), /drag a seat/, "nobody placed: there is nothing to start");
  assert.match(seatWaiting(none), /drag your seat/);

  // An idle phone must NOT be able to hold the room hostage. Someone scans the QR at an expo,
  // never sits down, and wanders off: the round starts without them and says so.
  const some = [
    { name: "ALFA", seat: 0, placed: true },
    { name: "BRAVO", seat: 2, placed: true },
    { name: "CHARLIE", seat: 0, placed: false },
  ];
  assert.equal(seatBlocker(some), null, "two placed players are enough to start");
  assert.match(seatWaiting(some), /CHARLIE/, "but the room is told who is sitting it out");

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

test("the notices are derived, so placing the last seat clears them with no bookkeeping", () => {
  const list = [
    { name: "ALFA", seat: 0, placed: true },
    { name: "BRAVO", seat: 2, placed: true },
    { name: "CHARLIE", seat: 4, placed: false },
  ];
  assert.match(seatWaiting(list), /CHARLIE/, "the room is told who is sitting out");
  assert.equal(seatBlocker(list), null, "but the round can still start");
  list[2].placed = true;
  assert.equal(seatWaiting(list), null);
  assert.equal(seatBlocker(list), null);
});

test("a round with too few seats placed is blocked, and says how many more are needed", () => {
  const list = [
    { name: "ALFA", seat: 0, placed: true },
    { name: "BRAVO", seat: 2, placed: false },
    { name: "CHARLIE", seat: 4, placed: false },
  ];
  assert.match(seatBlocker(list, 2), /1 more phone/);
  list[1].placed = true;
  assert.equal(seatBlocker(list, 2), null);
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

test("duel: the table has no ends, so nobody's shot is turned round for them", () => {
  // There used to be a special case reflecting the end players' shots back inward, because a row
  // has ends and a shot off the end goes nowhere. Around a table there are no ends, so a shot
  // leaves in the direction it was aimed, whoever fired it.
  const r = room(["ALFA", "BRAVO", "CHARLIE"], { seats: [0, 1, 2] }).play("duel");
  const d = r.data;
  const [first, , last] = d.order.map((id) => r.players.find((p) => p.id === id));

  r.act(first.name, { a: "fire", dir: Math.PI });
  assert.ok(d.bullets.at(-1).vx < 0, "aimed left, goes left, even from the first seat");

  r.advance(TUNING.GAP + 1000);
  r.act(last.name, { a: "fire", dir: 0 });
  assert.ok(d.bullets.at(-1).vx > 0, "aimed right, goes right, even from the last seat");
});

test("duel: a bullet goes all the way round the table and gets you in the back", () => {
  // The seating of four real humans is the topology of the world: leaving the right edge of the
  // last phone enters the left edge of the first, because those two people are sitting next to
  // each other. Fire, and four seconds later your own shot arrives from the other side.
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, 1.5, 3, 4.5] }).play("duel");
  const d = r.data;
  const me = r.players.find((p) => p.id === d.order[0]);
  // Everyone else ducks, so the shot is not stopped on the way round by a ship parked in the
  // lane. What is being tested is the topology, not marksmanship.
  for (const id of d.order.slice(1)) d.ship[id].y = 0.9;
  const myHp = d.ship[me.id].hp;

  r.act(me.name, { a: "fire", dir: 0 });
  const shot = d.bullets.at(-1);
  assert.equal(shot.hops, 0);
  assert.equal(shot.lane, 0);

  const lanes = new Set([0]);
  for (let i = 0; i < 400; i++) {
    r.advance(25);
    r.tick();
    const b = d.bullets.find((x) => x.id === shot.id);
    if (!b) break;                                  // it landed, or it expired
    lanes.add(b.lane);
  }
  assert.equal(lanes.size, 4, "it crossed every phone at the table");
  assert.equal(d.ship[me.id].hp, myHp - 1, "and then it came back and hit the person who fired it");
});

test("duel: your own shot cannot hit you before it has left your phone", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE"], { seats: [0, 2, 4] }).play("duel");
  const d = r.data;
  const me = r.players.find((p) => p.id === d.order[0]);
  const before = d.ship[me.id].hp;
  r.act(me.name, { a: "fire", dir: 0 });
  // Park the shot right on top of the shooter, still on its home lane.
  const b = d.bullets.at(-1);
  b.x = d.ship[me.id].x; b.y = d.ship[me.id].y;
  r.advance(25);
  r.tick();
  assert.equal(d.ship[me.id].hp, before, "hops is 0, so this is still your own muzzle");
});

test("duel: a shot that has been all the way round is spent, not immortal", () => {
  // With the ring closed a bullet has no edge to fall off, so something has to end it or the
  // arena fills up with lost shots for the rest of the round.
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  const d = r.data;
  const me = r.players.find((p) => p.id === d.order[0]);
  d.ship[d.order[0]].y = 0.05;
  d.ship[d.order[1]].y = 0.95;                    // keep both ships out of the flight path
  r.act(me.name, { a: "fire", dir: 0 });
  const id = d.bullets.at(-1).id;
  let alive = true;
  for (let i = 0; i < 600 && alive; i++) {
    r.advance(25);
    r.tick();
    alive = d.bullets.some((x) => x.id === id);
  }
  assert.equal(alive, false, "it expires once it has been round");
});

test("duel: a shot straight up still crosses the screen", () => {
  const r = room(["ALFA", "BRAVO"], { seats: [0, 1] }).play("duel");
  const d = r.data;
  const left = r.players.find((p) => p.id === d.order[0]);
  r.act(left.name, { a: "fire", dir: -Math.PI / 2 });
  assert.ok(Math.abs(d.bullets[0].vx) > 0.1, "a bullet that never leaves your phone is not the game");
});

test("duel: a shot carries how far it has travelled, so a lap is visible", () => {
  // The mode's best moment is your own shot arriving back from the far side after crossing other
  // people's phones. If the phone cannot tell that bullet from one fired next door a second ago,
  // nobody in the room ever learns that the table wraps — and the closed ring is the whole thing
  // that separates this from two phones in a straight line.
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, 1.5, 3, 4.5] }).play("duel");
  const d = r.data;
  const me = r.players.find((p) => p.id === d.order[0]);
  for (const id of d.order.slice(1)) d.ship[id].y = 0.97;      // everyone ducks
  r.act(me.name, { a: "fire", dir: 0 });

  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    r.advance(25);
    r.tick();
    for (const q of r.players) {
      const v = r.view(q.name);
      for (const o of v.objects || []) {
        assert.equal(typeof o.hops, "number", "every shot reports its hops");
        assert.equal(typeof o.id, "number", "and keeps a stable id for interpolation");
        seen.add(o.hops);
      }
    }
    if (!d.bullets.length) break;
  }
  assert.ok(seen.has(0), "it was fresh once");
  assert.ok([...seen].some((h) => h > 0), "and it was seen after crossing a gap");

  // The arena also says how many phones make up the ring, so the phone knows what a full lap is.
  assert.equal(r.view("ALFA").seats, 4);
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
  // Every seat at a round table has a neighbour on both sides. Nobody is an end any more.
  for (const n of names) assert.equal(r.view(n).edge, "both");
  const v = r.view(names[1]);
  assert.equal(v.kind, "arena");
  assert.ok(v.you.x >= 0 && v.you.x <= 1 && v.you.y >= 0 && v.you.y <= 1);
  assert.equal(v.you.hp, 3);
});

test("duel: movement and firing are different messages", () => {
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  const me = r.players.find((p) => p.id === r.data.order[0]);
  r.act(me.name, { a: "move", x: 0.2, y: 0.8 });
  assert.deepEqual({ x: r.data.ship[me.id].x, y: r.data.ship[me.id].y }, { x: 0.2, y: 0.8 });
  r.act(me.name, { a: "move", x: 9, y: -9 });
  assert.deepEqual({ x: r.data.ship[me.id].x, y: r.data.ship[me.id].y }, { x: 1, y: 0 }, "clamped to the screen");
});

test("duel: a continuous input never owns the broadcast", () => {
  // act() returning true is the server's cue to serialise the whole room once per player. A
  // finger on a screen produces 60-120 pointermoves a second and a tilted phone produces 30, so
  // a continuous input that answered true would turn four players into thousands of view() calls
  // a second. It updates state and says nothing; the 50ms tick owns the frame.
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  const me = r.players.find((p) => p.id === r.data.order[0]);
  assert.equal(r.act(me.name, { a: "move", x: 0.3, y: 0.3 }), false, "a move must not force a broadcast");
  assert.equal(r.data.ship[me.id].x, 0.3, "and must still have moved the ship");
  // The tick is what puts an arena on screen, and it reports a frame every time.
  r.advance(50);
  assert.equal(r.tick(), true, "the tick owns the arena frame");
  // Firing is discrete and rare, so it keeps the right to push immediately.
  assert.equal(r.act(me.name, { a: "fire", dir: 0 }), true, "a shot is discrete and pushes at once");
});

test("duel: the phone sends the stick and the SERVER decides where the ship is", () => {
  // The handoff is explicit about this and it is the whole authority model: a client that could
  // declare its own position could declare that it is standing on top of yours.
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  const d = r.data;
  const me = r.players.find((p) => p.id === d.order[0]);
  const ship = d.ship[me.id];
  const startedAt = { x: ship.x, y: ship.y };

  assert.equal(r.act(me.name, { a: "tilt", x: 1, y: 0 }), false, "a stick never owns the broadcast");
  assert.deepEqual({ x: ship.x, y: ship.y }, startedAt, "and it moves nothing on its own");

  r.advance(100);
  r.tick();
  assert.ok(ship.x > startedAt.x, "the tick integrates it");
  assert.equal(ship.y, startedAt.y, "and only along the axis that was tilted");

  // Held at full tilt, the ship covers TILT_SPEED of a screen per second.
  const was = ship.x;
  r.advance(200);
  r.tick();
  assert.ok(Math.abs((ship.x - was) - TUNING.TILT_SPEED * 0.2) < 1e-6, "at the tuned speed");
});

test("duel: a tilted ship stops at the edge of its own screen", () => {
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  const d = r.data;
  const me = r.players.find((p) => p.id === d.order[0]);
  r.act(me.name, { a: "tilt", x: -1, y: -1 });
  for (let i = 0; i < 60; i++) { r.advance(50); r.tick(); }
  assert.equal(d.ship[me.id].x, 0, "a ship leaves the screen only as a bullet does");
  assert.equal(d.ship[me.id].y, 0);
});

test("duel: a stick outside the unit square is clamped, not trusted", () => {
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  const d = r.data;
  const me = r.players.find((p) => p.id === d.order[0]);
  r.act(me.name, { a: "tilt", x: 50, y: -50 });
  assert.equal(d.ship[me.id].tx, 1);
  assert.equal(d.ship[me.id].ty, -1);
  r.act(me.name, { a: "tilt", x: "nonsense", y: 0 });
  assert.equal(d.ship[me.id].tx, 1, "garbage on the wire changes nothing");
});

test("duel: a finger overrides the tilt instead of fighting it", () => {
  // Someone whose phone has no sensor drags. If the last stick kept integrating underneath, the
  // ship would crawl away from wherever they put it and the fallback would feel broken.
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  const d = r.data;
  const me = r.players.find((p) => p.id === d.order[0]);
  r.act(me.name, { a: "tilt", x: 1, y: 1 });
  r.act(me.name, { a: "move", x: 0.25, y: 0.75 });
  r.advance(500);
  r.tick();
  assert.deepEqual({ x: d.ship[me.id].x, y: d.ship[me.id].y }, { x: 0.25, y: 0.75 });
});

test("duel: the arena asks the phone for the sensor, and nothing else does", () => {
  // The client only powers the gyroscope, and only pays for it on the wire, when a view asks.
  const duel = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  assert.equal(duel.view("ALFA").wantsTilt, true);
  const blind = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("blindside");
  assert.ok(!blind.view("ALFA").wantsTilt);
  assert.ok(!blind.view("BRAVO").wantsTilt);
});

test("duel: no two ships start on the same line", () => {
  // A bullet leaves one phone and enters the next at the same height. When every ship spawned at
  // y 0.5, a shot fired straight ahead on the first frame arrived dead-centre on the neighbour
  // every time — four players firing wiped the round inside a second, before anyone had tilted.
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, 1.5, 3, 4.5] }).play("duel");
  const ys = r.data.order.map((id) => r.data.ship[id].y);
  assert.equal(new Set(ys).size, ys.length, "every ship has its own height");
  for (const y of ys) assert.ok(y > 0.05 && y < 0.95, `${y} is off the screen`);
  // and a straight shot from the first seat does not simply land on the second
  const me = r.players.find((p) => p.id === r.data.order[0]);
  r.act(me.name, { a: "fire", dir: 0 });
  const b = r.data.bullets.at(-1);
  assert.ok(Math.abs(b.y - r.data.ship[r.data.order[1]].y) > 0.05, "not aimed straight at them");
});

test("duel: a shot that comes back round says so, and does not say it wrong", () => {
  // The old message subtracted lane indices, which is 0 for a bullet that went all the way round
  // — so the best moment in the game announced itself as "CHARLIE got CHARLIE across 0 phones".
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, 1.5, 3, 4.5] }).play("duel");
  const d = r.data;
  const me = r.players.find((p) => p.id === d.order[0]);
  for (const id of d.order.slice(1)) d.ship[id].y = 0.97;    // everyone else ducks
  d.ship[me.id].hp = 1;
  r.act(me.name, { a: "fire", dir: 0 });
  for (let i = 0; i < 400 && !r.log.eliminated.length; i++) { r.advance(25); r.tick(); }
  assert.equal(r.log.eliminated.at(-1)?.name, "ALFA", "their own shot got them");
  assert.match(r.log.eliminated.at(-1).why, /all the way round/);
  assert.doesNotMatch(r.log.eliminated.at(-1).why, /0 phones/);
});

test("duel: an unflown ship cannot win by standing still once its phone has gone", () => {
  const r = room(["ALFA", "BRAVO"], { seats: [0, 3] }).play("duel");
  r.drop("BRAVO");
  r.advance(50);
  assert.equal(r.tick(), true);
  assert.equal(r.log.finished.winner, "ALFA");
});
