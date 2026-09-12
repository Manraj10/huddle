// Standoff: the mode where the input targets a human at the angle they are actually sitting.
//
// Everything here runs with no sockets and no clock, on the same `room()` harness pattern as
// modes.test.js. The tests that matter most are not the ones about throwing — they are the ones
// that assert what is NOT in a view. The whole game is a field we refuse to send.
import test from "node:test";
import assert from "node:assert/strict";

import { MODES, TUNING, nearest } from "../modes.js";

const { AIM_STALE, SO_FLIGHT, SO_LOCK } = TUNING;

/** Four people at the compass points, all seated, all alive. */
function room(names = ["ALFA", "BRAVO", "CHARLIE", "DELTA"], opts = {}) {
  let clock = 1_000_000;
  const list = names.map((name, i) => ({
    id: i + 1, name, alive: true, gone: false, score: 0, placed: true,
    seat: opts.seats ? opts.seats[i] : (i / names.length) * 2 * Math.PI,
  }));
  const log = { notices: [], eliminated: [], finished: null };
  let data = {};
  const live = () => list.filter((p) => p.alive && !p.gone);

  const r = {
    players: list,
    log,
    get data() { return data; },
    at: (name) => list.find((p) => p.name === name),
    advance(ms) { clock += ms; return clock; },
    now: () => clock,
    drop(name) { r.at(name).gone = true; },
    ctx: {
      now: () => clock,
      players: () => list,
      alive: live,
      get data() { return data; },
      get phase() { return "live"; },
      get records() { return {}; },
      seatOf: (p) => p.seat,
      towards: (from, angle) => nearest(live(), from, angle),
      setRecord: (k, v) => v,
      notice(text) { log.notices.push(text); },
      eliminate(p, why) { if (p) p.alive = false; log.eliminated.push({ name: p?.name ?? null, why }); },
      award(p, n = 1) { if (p) p.score += n; },
      finishRound(w, h) { log.finished = { winner: w?.name ?? null, headline: h ?? null }; },
      push() {},
    },
  };
  r.start = () => { data = {}; MODES.standoff.start(r.ctx); return r; };
  r.act = (name, msg) => MODES.standoff.act(r.ctx, r.at(name), msg);
  r.tick = () => MODES.standoff.tick(r.ctx, clock);
  r.view = (name) => MODES.standoff.view(r.ctx, r.at(name));
  r.spectate = () => MODES.standoff.spectate(r.ctx);
  /** Force a known holder, since start() picks at random. */
  r.give = (name) => { data.holder = r.at(name).id; data.lockUntil = clock; return r; };
  return r.start();
}

/**
 * A view with the parts that are legitimately public removed, so a secrecy assertion is about the
 * secret rather than about the roster. `ring` is every player's name and seat, identical on every
 * phone. `big` is the person YOU are aiming at, which is yours to know.
 */
function secretPart(view) {
  const { ring, big, ...rest } = view;
  return JSON.stringify(rest);
}

// ---- the claim --------------------------------------------------------------

test("an aim resolves to the person at that physical angle, not to a position in a list", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  const alfa = r.at("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });
  assert.equal(r.data.aim[alfa.id].to, r.at("CHARLIE").id, "straight across is CHARLIE");
  r.act("ALFA", { a: "aim", angle: -Math.PI / 2 });
  assert.equal(r.data.aim[alfa.id].to, r.at("DELTA").id);
  // And it is exactly what the shared geometry would say, because it IS the shared geometry.
  assert.equal(r.data.aim[alfa.id].to, nearest(r.players, alfa, -Math.PI / 2).id);
});

test("join order decides nothing — the same seats in a different order aim the same way", () => {
  const forward = room(["ALFA", "BRAVO", "CHARLIE"], { seats: [0, 2, 4] });
  const backward = room(["CHARLIE", "BRAVO", "ALFA"], { seats: [4, 2, 0] });
  for (const r of [forward, backward]) r.act("ALFA", { a: "aim", angle: 2 });
  const nameOf = (r) => r.players.find((p) => p.id === r.data.aim[r.at("ALFA").id].to).name;
  assert.equal(nameOf(forward), "BRAVO");
  assert.equal(nameOf(backward), "BRAVO", "you cannot get this game by counting off 1-2-3");
});

test("an aim never owns the broadcast", () => {
  // Every phone streams this at 20-30Hz. Answering true would serialise the whole room once per
  // message per player; the 50ms tick is the only broadcaster.
  const r = room();
  assert.equal(r.act("ALFA", { a: "aim", angle: 1 }), false);
  assert.equal(r.tick(), true, "and the tick reports a frame regardless");
});

test("garbage on the wire changes nothing", () => {
  const r = room();
  const before = JSON.stringify(r.data);
  // null, "" and true all become finite numbers under Number(), so each of these would be a
  // perfectly good aim at a direction nobody chose if the boundary only checked isFinite.
  for (const angle of [NaN, Infinity, -Infinity, undefined, "north", null, "", true, "1.5", {}, []]) {
    r.act("ALFA", { a: "aim", angle });
  }
  assert.equal(JSON.stringify(r.data), before);
});

test("a hundred aims cost the same as the last one", () => {
  const r = room();
  const alfa = r.at("ALFA");
  for (let i = 0; i < 100; i++) r.act("ALFA", { a: "aim", angle: (i / 100) * 6 });
  const many = { ...r.data.aim[alfa.id] };
  const fresh = room();
  fresh.act("ALFA", { a: "aim", angle: (99 / 100) * 6 });
  assert.equal(many.to, fresh.data.aim[fresh.at("ALFA").id].to, "latest wins, nothing queues");
  assert.equal(Object.keys(r.data.aim).length, 1);
});

// ---- the block --------------------------------------------------------------

test("facing the throw sends it straight back", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });          // ALFA aims at CHARLIE
  assert.equal(r.act("ALFA", { a: "tap" }), true, "the throw goes");
  assert.equal(r.data.flight.to, r.at("CHARLIE").id);

  r.advance(200);
  r.act("CHARLIE", { a: "aim", angle: 0 });             // CHARLIE turns and faces ALFA
  r.advance(SO_FLIGHT);
  r.tick();

  assert.equal(r.data.holder, r.at("ALFA").id, "it goes back to whoever threw it");
  assert.equal(r.at("CHARLIE").score, 1);
  assert.deepEqual(r.log.eliminated, [], "nobody is out for blocking");
  assert.equal(r.data.lastEvent.kind, "block");
  assert.match(r.log.notices.at(-1), /CHARLIE/);
});

test("looking the wrong way catches it", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });
  r.act("ALFA", { a: "tap" });
  r.act("CHARLIE", { a: "aim", angle: Math.PI / 2 });   // facing BRAVO, not ALFA
  r.advance(SO_FLIGHT + 10);
  r.tick();
  assert.equal(r.data.holder, r.at("CHARLIE").id);
  assert.equal(r.data.lastEvent.kind, "catch");
});

test("a block has to be live — you cannot leave your phone facing someone and walk away", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  r.give("ALFA");
  r.act("CHARLIE", { a: "aim", angle: 0 });             // CHARLIE faces ALFA, then stops moving
  r.advance(AIM_STALE + 100);
  r.act("ALFA", { a: "aim", angle: Math.PI });
  r.act("ALFA", { a: "tap" });
  r.advance(SO_FLIGHT + 10);
  r.tick();
  assert.equal(r.data.holder, r.at("CHARLIE").id, "a stale aim blocks nothing");
});

test("with two phones nobody can block, so the round can actually end", () => {
  // With one other person every aim resolves to them, so a block would always land and the holder
  // could never lose. Two phones is the first thing anyone tries.
  const r = room(["ALFA", "BRAVO"], { seats: [0, Math.PI] });
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });
  r.act("ALFA", { a: "tap" });
  r.act("BRAVO", { a: "aim", angle: 0 });               // facing straight back at ALFA
  r.advance(SO_FLIGHT + 10);
  r.tick();
  assert.equal(r.data.holder, r.at("BRAVO").id, "it lands anyway");

  r.data.fuseAt = r.now();
  r.tick();
  assert.equal(r.log.eliminated.at(-1).name, "BRAVO", "and the fuse still decides it");
});

// ---- the throw --------------------------------------------------------------

test("you cannot throw what you are not holding, or aim you do not have", () => {
  const r = room();
  r.give("ALFA");
  assert.equal(r.act("BRAVO", { a: "tap" }), false, "not yours to throw");
  assert.equal(r.act("ALFA", { a: "tap" }), false, "and you have not aimed at anybody");
  assert.equal(r.data.flight, null);

  r.act("ALFA", { a: "aim", angle: Math.PI });
  r.data.lockUntil = r.now() + 500;
  assert.equal(r.act("ALFA", { a: "tap" }), false, "and you just caught it");
  r.advance(600);
  assert.equal(r.act("ALFA", { a: "tap" }), true);
});

test("a swipe aims and throws in one gesture, for anyone with no sensor", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  r.give("ALFA");
  assert.equal(r.act("ALFA", { a: "swipe", angle: Math.PI }), true);
  assert.equal(r.data.flight.to, r.at("CHARLIE").id, "the same person nearest() would pick");
});

// ---- the secret -------------------------------------------------------------

test("a phone is never told who is aiming at it", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });          // ALFA has CHARLIE in the crosshairs
  const v = r.view("CHARLIE");
  assert.equal(v.marked, true, "CHARLIE is told they are marked — one bit");
  assert.equal(v.countdownTo, undefined, "nor how long the fuse has left");
  assert.equal(v.from, undefined);
  assert.equal(v.holder, undefined);

  // `ring` is the public roster — who is in the room and at what angle — and it is the same for
  // everyone, so it cannot identify anyone. `big` is the person CHARLIE is aiming at, which is
  // CHARLIE's own business. Strip those two and no other name may survive.
  assert.doesNotMatch(secretPart(v), /ALFA/, "and never told by whom");
});

test("the phone catching it is not told who threw it either", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });
  r.act("ALFA", { a: "tap" });
  const v = r.view("CHARLIE");
  assert.equal(v.title, "INCOMING");
  assert.ok(v.incomingAt > 0, "a deadline, so the phone does its own arithmetic");
  assert.equal(v.from, undefined);
  assert.doesNotMatch(secretPart(v), /ALFA/, "face whoever threw it — go and find out");
});

test("two unmarked bystanders get views of identical shape", () => {
  // Key sets and array lengths leak as loudly as values do: if the marked player's view had one
  // extra field, every phone in the room could tell who it was by the size of the frame.
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });          // marks CHARLIE
  const marked = r.view("CHARLIE"), plain = r.view("BRAVO");
  assert.deepEqual(Object.keys(marked).sort(), Object.keys(plain).sort());
  assert.equal(marked.ring.length, plain.ring.length);
  assert.notEqual(marked.marked, plain.marked, "the only difference is the one bit");
});

test("the room screen is the only client that knows the whole truth", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });
  r.act("CHARLIE", { a: "aim", angle: 0 });
  const s = r.spectate();
  assert.equal(s.kind, "sight");
  assert.equal(s.map.holder, r.at("ALFA").id);
  const pair = s.aims.find((a) => a.from === r.at("ALFA").id);
  assert.equal(pair.to, r.at("CHARLIE").id, "it can see every line of sight in the room");
  assert.equal(pair.holder, true);
});

// ---- a room full of strangers ----------------------------------------------

test("a phone that never aims all round neither stalls the room nor loses by default", () => {
  const r = room();
  r.give("ALFA");
  for (let i = 0; i < 5; i++) { r.advance(200); assert.equal(r.tick(), true); }
  assert.deepEqual(r.log.eliminated, [], "silence is not a loss");
  r.data.fuseAt = r.now();
  r.tick();
  assert.equal(r.log.eliminated.at(-1).name, "ALFA", "the fuse decides, as it always did");
});

test("the holder's phone leaving re-homes the bomb instead of wedging the round", () => {
  const r = room();
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: 3 });
  r.drop("ALFA");
  r.advance(50);
  assert.equal(r.tick(), true);
  assert.notEqual(r.data.holder, r.at("ALFA").id);
  assert.ok(r.data.holder != null, "somebody still has it");
  assert.equal(r.data.aim[r.at("ALFA").id], undefined, "and their aim stops being drawn");
});

test("a phone leaving mid-flight does not strand the bomb in the air", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: [0, Math.PI / 2, Math.PI, -Math.PI / 2] });
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });
  r.act("ALFA", { a: "tap" });
  r.drop("CHARLIE");
  r.advance(50);
  r.tick();
  assert.equal(r.data.flight, null);
  assert.ok(r.data.holder != null && r.data.holder !== r.at("CHARLIE").id);
});

test("no view in any mode ships a rendered duration", () => {
  // Rule 1. A server-rendered number freezes between broadcasts, and a waiting game produces no
  // broadcasts at all — which is how Flash once never lit up.
  const r = room();
  r.give("ALFA");
  r.act("ALFA", { a: "aim", angle: Math.PI });
  for (const name of ["ALFA", "BRAVO", "CHARLIE", "DELTA"]) {
    assert.doesNotMatch(JSON.stringify(r.view(name)), /\b\d+\.\d\s?s\b/, `${name} was sent a number`);
  }
});
