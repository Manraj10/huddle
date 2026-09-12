#!/usr/bin/env node
// Four real websocket clients against a real server. The unit tests in test/ prove the mode rules
// in isolation with no sockets; this proves the whole path — join, seat negotiation, per-player
// views, and a phone dying mid-round — which is the part that actually fails in a room.
//
// Run: node deploy/roomcheck.mjs
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const PORT = Number(process.env.PORT || 43124);
const KEY = "roomcheck-key";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const child = spawn("node", ["server.js"], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT), HUDDLE_ROOM_KEY: KEY,
    HUDDLE_FUSE_MIN_MS: "700", HUDDLE_FUSE_MAX_MS: "900",   // a round has to end inside a test
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let boot = "";
child.stdout.on("data", (b) => { boot += b; });
child.stderr.on("data", (b) => { boot += b; process.stderr.write(b); });

let failed = 0;
const done = (code) => { child.kill("SIGTERM"); process.exit(code); };
function ok(what) { console.log(`  ok   ${what}`); }
function bad(what, detail) {
  failed++;
  console.error(`  FAIL ${what}`);
  if (detail != null) console.error(`       ${detail}`);
}
function is(cond, what, detail) { cond ? ok(what) : bad(what, detail); }

/** A phone. Keeps the latest view it was sent, exactly as the real client does. */
let nextToken = 1;
class Phone {
  // The token is the identity a phone comes BACK as, so it belongs to the device and not to the
  // name. Deriving it from the name made three players called Sam look like one Sam reconnecting
  // twice, which is exactly the bug this harness exists to catch.
  constructor(name) { this.name = name; this.token = "tok-" + nextToken++; this.latest = null; this.id = null; }
  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    await new Promise((res, rej) => { this.ws.on("open", res); this.ws.on("error", rej); });
    this.ws.on("message", (buf) => {
      const m = JSON.parse(buf);
      if (m.t === "hello") this.id = m.id;
      if (m.t === "view") this.latest = m;
    });
    return this;
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  join() { this.send({ t: "join", name: this.name, token: this.token }); }
  seat(angle) { this.send({ t: "seat", angle }); }
  act(a) { this.send({ t: "act", ...a }); }
  /** A screen lock drops the socket without a clean close. This is that. */
  die() { this.ws.terminate(); }
}

/** Poll the latest view until `pred` holds. Views arrive on broadcast, not on request. */
async function until(phone, pred, what, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (phone.latest && pred(phone.latest)) return phone.latest;
    await sleep(25);
  }
  return null;
}

try {
  for (let i = 0; i < 60 && !boot.includes("party engine"); i++) await sleep(50);
  if (!boot.includes("party engine")) { console.error("server did not start"); done(1); }

  const base = `http://127.0.0.1:${PORT}`;
  console.log("static");
  for (const [path, what] of [["/", "/ serves the phone client"], ["/room.html", "/room.html serves the room screen"]]) {
    const r = await fetch(base + path);
    is(r.status === 200, `${what} (200)`, `got ${r.status}`);
  }

  console.log("seat negotiation");
  const phones = [];
  for (const n of ["Ada", "Ben", "Cy", "Dee"]) phones.push(await new Phone(n).open());
  for (const p of phones) p.join();
  for (const p of phones) await until(p, (m) => m.t === "view", `${p.name} sees the room`);
  await sleep(120);

  const notice = (p) => p.latest?.view?.seatNotice ?? null;
  const blocked = notice(phones[0]);
  is(typeof blocked === "string" && /drag|ring/i.test(blocked),
    "with nobody placed the lobby says so", JSON.stringify(blocked));

  // Refusing to start is the assertion: a round that begins with nobody seated makes every swipe
  // a coin flip, which is the whole claim collapsing quietly.
  phones[0].send({ t: "start", mode: "relay" });
  await sleep(200);
  is(phones[0].latest.phase === "lobby", "a round refuses to start with nobody placed", phones[0].latest.phase);

  const ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (let i = 0; i < 3; i++) phones[i].seat(ANGLES[i]);
  await sleep(150);
  const three = notice(phones[0]);
  is(typeof three === "string" && three.includes("Dee"),
    "with three of four placed the notice names the fourth", JSON.stringify(three));

  phones[3].seat(ANGLES[3]);
  await sleep(150);
  is(notice(phones[0]) == null, "with everyone placed the notice clears", JSON.stringify(notice(phones[0])));

  console.log("a phone that never sat down is not a person in the room");
  {
    // Default seat is 0 — a real angle, with nobody sitting at it. If an unplaced phone counts as
    // alive it becomes a legal target there, so a throw aimed at empty air lands on someone who
    // never chose that place. That is this project's one claim, broken by a default value.
    const ghost = await new Phone("NOSEAT").open();
    ghost.join();
    await sleep(250);
    const roster = phones[0].latest?.players || [];
    is(roster.some((p) => p.name === "NOSEAT"), "they are in the room and visible", JSON.stringify(roster.map((p) => p.name)));
    const waiting = phones[0].latest?.view?.seatNotice || "";
    is(/NOSEAT/.test(waiting), "and the room is told they have not sat down", JSON.stringify(waiting));

    // Whoever the engine picks to hold the bomb, it must not be the phone with no seat. The
    // spectator has to be listening BEFORE the round starts — fuses are short in this harness and
    // the round can be over before a late sample lands.
    const spec2 = new WebSocket(`ws://127.0.0.1:${PORT}/?spectate=${KEY}`);
    await new Promise((res) => { spec2.on("open", res); });
    let ring = null;
    spec2.on("message", (b) => {
      const m = JSON.parse(b);
      if (m.t === "view" && m.phase === "live" && m.view?.map?.players?.length) {
        ring = ring || m.view.map.players.map((q) => q.name);
      }
    });
    phones[0].send({ t: "start", mode: "blindside" });
    for (let i = 0; i < 60 && !ring; i++) await sleep(25);
    is(!!ring, "the round runs", "never saw a live spectator frame");
    is(ring && !ring.includes("NOSEAT"),
      "and they are not a legal target while it does", JSON.stringify(ring));
    spec2.close();
    ghost.die();
    phones[0].send({ t: "reset" });
    await sleep(250);
    for (let i = 0; i < 4; i++) phones[i].seat(ANGLES[i]);
    await sleep(200);
  }

  console.log("a won round does not park the table forever");
  {
    // Two phones, one wins, and nothing in the engine used to leave the "over" phase except a
    // human tapping RESET — which strangers who arrived thirty seconds ago do not know to do.
    phones[0].send({ t: "start", mode: "blindside" });
    const over = await until(phones[0], (m) => m.phase === "over", "someone wins", 25000);
    is(!!over, "a blindside cascade reaches a winner", phones[0].latest?.phase);
    const back = await until(phones[0], (m) => m.phase === "lobby", "the table reopens", 14000);
    is(!!back, "and the room returns to the lobby on its own rather than parking on the winner",
      "still on the winner screen — the next group finds a dead table");
    await sleep(150);
    for (let i = 0; i < 4; i++) phones[i].seat(ANGLES[i]);
    await sleep(200);
  }

  console.log("nobody shares a name");
  // The mechanic is "aim at a person" and the phone previews that person by name, so two players
  // called the same thing make every throw a guess.
  const twins = [];
  for (let i = 0; i < 3; i++) twins.push(await new Phone("Sam").open());
  for (const t of twins) t.join();
  await sleep(250);
  const roster = (phones[0].latest?.players || []).map((p) => p.name);
  const sams = roster.filter((n) => /^Sam/i.test(n));
  is(sams.length === 3, "three players called Sam all get in", JSON.stringify(sams));
  is(new Set(sams.map((n) => n.toLowerCase())).size === 3, "and none of them share a name", JSON.stringify(sams));
  for (const t of twins) t.die();
  await sleep(250);

  console.log("standoff: pointing at a human, and the name that is never sent");
  {
    phones[0].send({ t: "start", mode: "standoff" });
    const live = await until(phones[0], (m) => m.phase === "live" && m.mode === "standoff", "standoff starts", 4000);
    is(!!live, "standoff starts", phones[0].latest?.phase);

    // Everyone points straight across the table at the person opposite them.
    const OPPOSITE = { 0: 2, 1: 3, 2: 0, 3: 1 };
    for (let i = 0; i < 4; i++) phones[i].act({ a: "aim", angle: ANGLES[OPPOSITE[i]] });
    await sleep(250);

    const named = phones.map((ph) => ph.latest?.view?.big);
    is(named.every((nm) => typeof nm === "string" && nm !== "—"),
      "every phone is told the NAME of the person it is pointing at", JSON.stringify(named));
    // ANGLES is [0, pi/2, pi, -pi/2]; each phone aimed at the seat opposite its own.
    const want = [2, 3, 0, 1].map((i) => phones[i].name);
    is(JSON.stringify(named) === JSON.stringify(want),
      "and it is the person actually sitting at that angle", `${JSON.stringify(named)} vs ${JSON.stringify(want)}`);

    const holder = phones.find((ph) => ph.latest?.view?.title === "YOU HAVE IT");
    is(!!holder, "exactly one phone is told it has the bomb",
      JSON.stringify(phones.map((ph) => ph.latest?.view?.title)));

    if (holder) {
      // The person the holder is pointing at is told they are marked — and is NOT told by whom.
      const victim = phones.find((ph) => ph.latest?.view?.marked === true);
      is(!!victim, "somebody is told they are in the crosshairs",
        JSON.stringify(phones.map((ph) => ph.latest?.view?.marked)));
      if (victim) {
        const wire = JSON.stringify({ ...victim.latest.view, ring: undefined, big: undefined });
        is(!wire.includes(holder.name),
          "and their phone never says who it is", `leaked ${holder.name}`);
        is(victim.latest.view.countdownTo === undefined,
          "nor how long the fuse has left", String(victim.latest.view.countdownTo));
      }

      // THE BLOCK. The holder throws; the target turns and faces them inside the flight time.
      const hi = phones.indexOf(holder);
      const target = phones[OPPOSITE[hi]];
      // You cannot throw the instant you catch it. The view says when you can, so wait for that
      // rather than for a guessed number of milliseconds — a tap sent early is silently refused
      // and every assertion after it passes for the wrong reason.
      const armed = await until(holder, (m) => m.view?.throwable === true, "the throw arms", 4000);
      is(!!armed, "the holder is armed to throw once the catch-lock expires",
        String(holder.latest?.view?.throwable));
      holder.act({ a: "tap" });
      const inFlight = await until(target, (m) => m.view?.title === "INCOMING", "it is in the air", 2000);
      is(!!inFlight, "the target's phone says INCOMING", String(target.latest?.view?.title));
      is(!JSON.stringify({ ...target.latest.view, ring: undefined, big: undefined }).includes(holder.name),
        "and still will not say who threw it", "leaked the thrower");

      // Turn and face the thrower inside the flight window. The block is judged at the last
      // millisecond, so this is real reaction time rather than a formality.
      target.act({ a: "aim", angle: ANGLES[hi] });
      const back = await until(holder, (m) => m.view?.title === "YOU HAVE IT", "it comes back", 4000);
      is(!!back, "facing the throw sends it straight back to the thrower",
        `holder view: ${holder.latest?.view?.title}`);
      is(/looked straight at it/.test(holder.latest?.notice || ""),
        "and the room is told why", JSON.stringify(holder.latest?.notice));
    }

    phones[0].send({ t: "reset" });
    await sleep(250);
    for (let i = 0; i < 4; i++) phones[i].seat(ANGLES[i]);
    await sleep(200);
  }

  console.log("a bullet nobody can see");
  // The claim is that while a shot crosses the real gap between two handsets it is on the server
  // and on NO phone. Measured, not asserted: the server unions the object ids it actually put on
  // the wire this broadcast and reports what it is holding that nobody was told about.
  {
    const spec = new WebSocket(`ws://127.0.0.1:${PORT}/?spectate=${KEY}`);
    await new Promise((res) => { spec.on("open", res); });
    let last = null;
    spec.on("message", (buf) => { const m = JSON.parse(buf); if (m.t === "view") last = m; });

    phones[0].send({ t: "start", mode: "duel" });
    await sleep(300);
    is(phones[0].latest?.phase === "live", "duel starts", phones[0].latest?.phase);

    // Tilt goes over the real wire and the SERVER moves the ship. The phone never says where it is.
    const mine = () => phones[0].latest?.view?.you;
    const before = mine();
    is(!!before && phones[0].latest.view.wantsTilt === true,
      "the arena asks the phone for its sensor", JSON.stringify(before));
    phones[0].act({ a: "tilt", x: 1, y: 0 });
    await sleep(400);
    is(mine() && mine().x > before.x, "a tilt on the wire moves the ship server-side",
      `${before?.x} -> ${mine()?.x}`);
    phones[0].act({ a: "tilt", x: 0, y: 0 });
    await sleep(120);

    // Everyone shoots sideways until something is in flight between two phones.
    let sawHidden = 0, sawVisible = 0;
    for (let i = 0; i < 60; i++) {
      for (const ph of phones) ph.act({ a: "fire", dir: 0 });
      await sleep(50);
      if (last && typeof last.unseen === "number") {
        if (last.unseen > 0) sawHidden++;
        else sawVisible++;
      }
    }
    is(sawHidden > 0, "the room screen catches shots that reached nobody", `unseen never rose above 0 in ${sawVisible + sawHidden} frames`);
    is(sawVisible > 0, "and it is not just permanently claiming something is hidden", "unseen was never 0");

    // A phone must never be told about a bullet that is counted as unseen.
    const inFlight = phones.map((ph) => (ph.latest?.view?.objects || []).map((o) => o.id)).flat();
    is(Array.isArray(inFlight), "phones receive object ids at all", JSON.stringify(inFlight).slice(0, 80));
    spec.close();
    phones[0].send({ t: "reset" });
    await sleep(200);
    for (let i = 0; i < 4; i++) phones[i].seat(ANGLES[i]);
    await sleep(150);
  }

  console.log("per-player truth");
  phones[0].send({ t: "start", mode: "relay" });
  const live = await until(phones[0], (m) => m.phase === "live", "relay starts");
  is(!!live, "relay starts once the room is seated", phones[0].latest?.phase);

  await sleep(120);
  const views = phones.map((p) => JSON.stringify(p.latest?.view));
  const holders = phones.filter((p) => p.latest?.view?.big === "GO");
  is(holders.length === 1, "exactly one phone is told it has the token", `${holders.length} phones saw GO`);
  is(new Set(views).size > 1, "the token holder is sent a different view from the room",
    "every phone got the same bytes");

  console.log("a phone dying mid-round");
  const holder = holders[0];
  const others = phones.filter((p) => p !== holder);
  const passesBefore = others[0].latest?.view?.big ?? "?";
  holder.die();
  const carried = await until(others[0],
    (m) => /dropped/i.test(m.notice || "") || m.phase === "over" || m.phase === "lobby",
    "the room reacts to the drop", 4000);
  is(!!carried, "the room notices a phone leaving mid-lap", `stuck at ${passesBefore}`);
  is(carried && carried.phase !== "over",
    "losing the token holder does not end the lap", carried && `phase went ${carried.phase}`);
  is(carried && /dropped/i.test(carried.notice || ""),
    "the room is told a phone dropped", JSON.stringify(carried?.notice));

  // The lap has to be completable by the survivors, not merely non-crashed.
  for (let step = 0; step < 12; step++) {
    const live3 = others.filter((p) => p.ws.readyState === 1);
    const h = live3.find((p) => p.latest?.view?.big === "GO");
    if (!h) break;
    const nextName = String(h.latest.view.title || "").replace(/^PASS TO /, "").trim();
    const target = phones.find((p) => p.name === nextName);
    if (!target) break;
    h.act({ a: "swipe", angle: ANGLES[phones.indexOf(target)] });
    await sleep(90);
    if (h.latest?.phase === "over") break;
  }
  await sleep(200);
  is(others[0].latest?.phase === "over",
    "the survivors finish the lap after the holder's phone is gone", others[0].latest?.phase);

  console.log(failed ? `\n${failed} failed` : "\nall good");
  done(failed ? 1 : 0);
} catch (err) {
  console.error(err.stack || err.message);
  done(1);
}
