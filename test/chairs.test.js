// Chairs: musical chairs where the chairs are people.
import test from "node:test";
import assert from "node:assert/strict";

import { MODES, TUNING, judgeChairs, nearest } from "../modes.js";

const { CHAIR_BEAT, CHAIR_VERDICT } = TUNING;

function room(names = ["ALFA", "BRAVO", "CHARLIE", "DELTA"], opts = {}) {
  let clock = 1_000_000;
  const list = names.map((name, i) => ({
    id: i + 1, name, alive: true, gone: false, score: 0, placed: true,
    seat: opts.seats ? opts.seats[i] : (i / names.length) * 2 * Math.PI,
  }));
  const log = { notices: [], finished: null };
  let data = {};
  const records = {};
  const live = () => list.filter((p) => p.alive && !p.gone);

  const r = {
    players: list,
    log,
    get data() { return data; },
    at: (name) => list.find((p) => p.name === name),
    advance(ms) { clock += ms; return clock; },
    ctx: {
      now: () => clock,
      players: () => list,
      alive: live,
      get data() { return data; },
      get phase() { return "live"; },
      get records() { return records; },
      seatOf: (p) => p.seat,
      towards: (from, angle) => nearest(live(), from, angle),
      setRecord(key, value) { records[key] = value; return value; },
      notice(text) { log.notices.push(text); },
      eliminate() {},
      award(p, n = 1) { if (p) p.score += n; },
      finishRound(w, h) { log.finished = { winner: w?.name ?? null, headline: h ?? null }; },
      push() {},
    },
  };
  r.start = () => { data = {}; MODES.chairs.start(r.ctx); return r; };
  r.act = (name, msg) => MODES.chairs.act(r.ctx, r.at(name), msg);
  r.tick = () => MODES.chairs.tick(r.ctx, clock);
  r.view = (name) => MODES.chairs.view(r.ctx, r.at(name));
  r.spectate = () => MODES.chairs.spectate(r.ctx);
  return r.start();
}

/** Compass seats: ALFA→east is BRAVO, south CHARLIE, west DELTA. */
const SEATS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

test("judgeChairs: unique claim is YOURS", () => {
  const live = [
    { id: 1, name: "ALFA" }, { id: 2, name: "BRAVO" }, { id: 3, name: "CHARLIE" },
  ];
  const now = 1000;
  const aim = {
    1: { to: 2, at: now },
    2: { to: 3, at: now },
    3: { to: 1, at: now },
  };
  const j = judgeChairs(live, aim, now);
  assert.equal(j.unique, 3);
  assert.equal(j.verdicts[1].title, "YOURS");
  assert.equal(j.verdicts[1].big, "BRAVO");
});

test("judgeChairs: collision names the strangers who also claimed them", () => {
  const live = [
    { id: 1, name: "ALFA" }, { id: 2, name: "BRAVO" }, { id: 3, name: "CHARLIE" }, { id: 4, name: "DELTA" },
  ];
  const now = 1000;
  // ALFA and BRAVO both on CHARLIE; DELTA alone on ALFA
  const aim = {
    1: { to: 3, at: now },
    2: { to: 3, at: now },
    4: { to: 1, at: now },
  };
  const j = judgeChairs(live, aim, now);
  assert.equal(j.verdicts[1].title, "TAKEN");
  assert.equal(j.verdicts[1].big, "CHARLIE");
  assert.equal(j.verdicts[1].sub, "BRAVO");
  assert.equal(j.verdicts[2].sub, "ALFA");
  assert.equal(j.verdicts[4].title, "YOURS");
  assert.equal(j.verdicts[3].title, "NOBODY");
  assert.equal(j.unique, 1);
  assert.equal(j.needed, 2);
});

test("judgeChairs: three-way steal uses also", () => {
  const live = [
    { id: 1, name: "ALFA" }, { id: 2, name: "BRAVO" }, { id: 3, name: "CHARLIE" }, { id: 4, name: "DELTA" },
  ];
  const now = 1000;
  const aim = {
    1: { to: 4, at: now },
    2: { to: 4, at: now },
    3: { to: 4, at: now },
  };
  const j = judgeChairs(live, aim, now);
  assert.equal(j.verdicts[1].sub, "BRAVO, also CHARLIE");
});

test("a view never names who is aiming at you", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: SEATS });
  r.act("BRAVO", { a: "aim", angle: bearingAim(r, "BRAVO", "ALFA") });
  r.act("CHARLIE", { a: "aim", angle: bearingAim(r, "CHARLIE", "ALFA") });
  r.act("DELTA", { a: "aim", angle: bearingAim(r, "DELTA", "ALFA") });
  r.act("ALFA", { a: "aim", angle: bearingAim(r, "ALFA", "BRAVO") });

  const v = r.view("ALFA");
  assert.equal(v.big, "BRAVO", "ALFA sees who ALFA claimed");
  // Three people are pointing at ALFA right now and nothing in the frame may say so.
  assert.doesNotMatch(secretPart(v), /CHARLIE|DELTA/, "the inbound graph is never sent");
  assert.equal(v.title, "POINT");
});

/**
 * A view with the legitimately public parts removed, so a secrecy assertion is about the secret.
 * `ring` is every player name and seat, identical on every phone — it is what draws the gutters.
 * `big` is the person YOU claimed, which is yours to know. Anything else naming another human is
 * a leak.
 */
function secretPart(view) {
  const { ring, big, ...rest } = view;
  return JSON.stringify(rest);
}

function bearingAim(r, from, to) {
  const a = r.at(from), b = r.at(to);
  const dx = Math.cos(b.seat) - Math.cos(a.seat);
  const dy = Math.sin(b.seat) - Math.sin(a.seat);
  return Math.atan2(dy, dx);
}

test("on the beat, collisions become TAKEN with stranger names", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: SEATS });
  r.act("ALFA", { a: "aim", angle: bearingAim(r, "ALFA", "CHARLIE") });
  r.act("BRAVO", { a: "aim", angle: bearingAim(r, "BRAVO", "CHARLIE") });
  r.act("DELTA", { a: "aim", angle: bearingAim(r, "DELTA", "ALFA") });
  // CHARLIE aims nowhere → NOBODY
  r.advance(CHAIR_BEAT);
  r.tick();
  assert.equal(r.data.phase, "verdict");
  assert.equal(r.view("ALFA").title, "TAKEN");
  assert.equal(r.view("ALFA").sub, "BRAVO");
  assert.equal(r.view("DELTA").title, "YOURS");
  assert.equal(r.view("CHARLIE").title, "NOBODY");
  // Still no inbound graph on ALFA's phone
  assert.doesNotMatch(secretPart(r.view("ALFA")), /aiming at you|DELTA claimed/i);
});

test("majority unique climbs the ladder; fail ends with a level record", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE", "DELTA"], { seats: SEATS });
  // Cycle: everyone unique
  r.act("ALFA", { a: "aim", angle: bearingAim(r, "ALFA", "BRAVO") });
  r.act("BRAVO", { a: "aim", angle: bearingAim(r, "BRAVO", "CHARLIE") });
  r.act("CHARLIE", { a: "aim", angle: bearingAim(r, "CHARLIE", "DELTA") });
  r.act("DELTA", { a: "aim", angle: bearingAim(r, "DELTA", "ALFA") });
  r.advance(CHAIR_BEAT);
  r.tick();
  assert.equal(r.data.cleared, true);
  assert.equal(r.data.level, 1);
  r.advance(CHAIR_VERDICT);
  r.tick();
  assert.equal(r.data.phase, "aim");
  assert.equal(r.data.level, 2);

  // Everyone stacks on ALFA → fail
  r.act("BRAVO", { a: "aim", angle: bearingAim(r, "BRAVO", "ALFA") });
  r.act("CHARLIE", { a: "aim", angle: bearingAim(r, "CHARLIE", "ALFA") });
  r.act("DELTA", { a: "aim", angle: bearingAim(r, "DELTA", "ALFA") });
  r.advance(r.data.beatMs);
  r.tick();
  assert.equal(r.data.cleared, false);
  r.advance(CHAIR_VERDICT);
  r.tick();
  assert.equal(r.log.finished.headline.big, "LV 2");
  assert.equal(r.ctx.records.chairs, 2);
});

test("spectate sees collisions; phones still do not", () => {
  const r = room(["ALFA", "BRAVO", "CHARLIE"], { seats: [0, Math.PI * 2 / 3, Math.PI * 4 / 3] });
  r.act("ALFA", { a: "aim", angle: bearingAim(r, "ALFA", "BRAVO") });
  r.act("CHARLIE", { a: "aim", angle: bearingAim(r, "CHARLIE", "BRAVO") });
  const spec = r.spectate();
  assert.equal(spec.kind, "sight");
  assert.ok(spec.aims.some((a) => a.collide));
  assert.match(spec.strap, /NEVER SAY WHO CLAIMED YOU/);
  // The room screen can see the whole graph. The phone must not — and `ring` is the public
  // roster, identical on every handset, so the assertion is about what is left after it.
  assert.doesNotMatch(secretPart(r.view("BRAVO")), /ALFA|CHARLIE/);
});
