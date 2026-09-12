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
  env: { ...process.env, PORT: String(PORT), HUDDLE_ROOM_KEY: KEY },
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
class Phone {
  constructor(name) { this.name = name; this.latest = null; this.id = null; }
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
  join() { this.send({ t: "join", name: this.name, token: `tok-${this.name}` }); }
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
