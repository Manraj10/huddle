// Games. Server-side only — phones render whatever view they are handed, so a new game is an
// entry here and nothing ships to the clients.
//
// RULE LEARNED THE HARD WAY: never send a pre-rendered number. Send the DEADLINE
// (`countdownTo`, `flashAt`) and let each phone do the arithmetic against its own synced clock.
// Sending "23.4" meant the number froze between broadcasts, and it meant Flash never lit up at
// all, because a waiting game produces no state changes and therefore no broadcasts.
//
// Every mode has to survive a phone leaving mid-round. Screens lock, batteries die, and people
// wander off at an expo; a round that wedges because one socket went away is a round the room
// watches die. Each `tick` below reconciles its own state against `ctx.alive()` first.

// Every timing that decides how the game feels is an environment variable, so the room can be
// retuned between playtests without a redeploy. Defaults are what we are shipping with.
const ms = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const TUNING = {
  FLIGHT: ms("HUDDLE_FLIGHT_MS", 700),          // blackout while the bomb is between two phones
  LOCK: ms("HUDDLE_LOCK_MS", 420),              // you cannot throw it the instant you catch it
  BRACE: ms("HUDDLE_BRACE_MS", 2200),           // how long a brace stays armed
  FUSE_MIN: ms("HUDDLE_FUSE_MIN_MS", 11000),
  FUSE_MAX: ms("HUDDLE_FUSE_MAX_MS", 20000),
  GAP: ms("HUDDLE_GAP_MS", 250),                // flight time across the real gap between phones
  RELAY_PENALTY: ms("HUDDLE_RELAY_PENALTY_MS", 2000),
  CHAIN_EXTEND: ms("HUDDLE_CHAIN_EXTEND_MS", 12000),
  WIRETAP: ms("HUDDLE_WIRETAP_MS", 90000),
  TILT_SPEED: ms("HUDDLE_TILT_SPEED", 900) / 1000,   // screens per second at full tilt
  AIM_STALE: ms("HUDDLE_AIM_STALE_MS", 1500),   // an aim older than this cannot block anyone
  SO_FLIGHT: ms("HUDDLE_SO_FLIGHT_MS", 900),    // the throw's time in the air IS the reaction window
  SO_LOCK: ms("HUDDLE_SO_LOCK_MS", 700),
  SO_FUSE_MIN: ms("HUDDLE_SO_FUSE_MIN_MS", 14000),
  SO_FUSE_MAX: ms("HUDDLE_SO_FUSE_MAX_MS", 22000),
};

// A room-wide escape hatch for the one number nobody can verify without a phone in their hand.
// If the first playtest finds every aim landing on the person opposite, set this to 180 and the
// room is playable in ten seconds instead of waiting on a redeploy.
const AIM_OFFSET = (Number(process.env.HUDDLE_AIM_OFFSET_DEG) || 0) * Math.PI / 180;

const { FLIGHT, LOCK, BRACE, FUSE_MIN, FUSE_MAX, GAP, RELAY_PENALTY, CHAIN_EXTEND, TILT_SPEED,
        AIM_STALE, SO_FLIGHT, SO_LOCK, SO_FUSE_MIN, SO_FUSE_MAX } = TUNING;
const CHAIN_RECALL = Math.round(CHAIN_EXTEND / 2);   // per tap, not per sequence

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const secs = (n) => `${(n / 1000).toFixed(1)}s`;
const ringOf = (ctx, me) => ctx.alive().filter((p) => p.id !== me.id).map((p) => ({ name: p.name, angle: p.seat }));

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function ord(n) {
  const tail = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (tail[(v - 20) % 10] || tail[v] || tail[0]);
}

// ---- seat geometry ----------------------------------------------------------
// Moved to public/seats.js and re-exported here so nothing that already imports it has to care.
// It lives under public/ because the PHONE needs the same arithmetic: the client shows you who
// you are about to throw at while your finger is still down, and the server decides who actually
// catches it. Two copies of this would eventually disagree, and the preview would start lying.
export { apart, nearest, SAME_SEAT, seatBlocker, seatWaiting } from "./public/seats.js";

/**
 * Record where a player is physically pointing, and resolve it to a HUMAN.
 *
 * This one call is the project's whole claim. The phone sends an angle and nothing else — never a
 * name, never an id, never a position — and the server decides which person is sitting there,
 * using the seat that person dragged onto the ring themselves. Join order is not involved, which
 * is the difference between this and a game you could get by making four people count off.
 */
function takeAim(ctx, d, p, angle) {
  // typeof, not Number(): this is a trust boundary and JS coercion is full of traps here.
  // Number(null) is 0, Number("") is 0, Number(true) is 1 — each of which would sail through a
  // Number.isFinite check as a perfectly good aim at a direction nobody chose.
  if (typeof angle !== "number" || !Number.isFinite(angle)) return false;
  const a = Math.atan2(Math.sin(angle + AIM_OFFSET), Math.cos(angle + AIM_OFFSET));
  const prev = d.aim[p.id];
  const t = ctx.towards(p, a);
  const to = t ? t.id : null;
  d.aim[p.id] = { angle: a, at: ctx.now(), to, since: prev && prev.to === to ? prev.since : ctx.now() };
  return true;
}

export const MODES = {
  // ------------------------------------------------- the one that needs the room to be a room
  // Everyone is aiming, all the time, and every aim resolves through the seat angles the players
  // declared themselves — so your phone can tell you the NAME of the person you are pointing at.
  // When the bomb is thrown at you your phone says INCOMING and refuses to say who threw it.
  // That one withheld field is the entire game: the only way to find out is to look up, find the
  // person whose phone is aimed at you, and face them back before it lands.
  standoff: {
    name: "Standoff", min: 2, wedgeMs: 60000,
    blurb: "Point your phone at a person. It will not tell you who is pointing at you.",
    start(ctx) {
      const d = ctx.data;
      d.holder = pick(ctx.alive()).id;
      d.fuseAt = ctx.now() + rand(SO_FUSE_MIN, SO_FUSE_MAX);
      d.startedAt = ctx.now();
      d.lockUntil = ctx.now() + SO_LOCK;
      d.flight = null;
      d.aim = {};
      d.lastEvent = null;
    },
    act(ctx, p, msg) {
      const d = ctx.data;
      if (msg.a === "aim") {
        takeAim(ctx, d, p, msg.angle);
        // ALWAYS false. Every phone streams this at 20-30Hz, and answering true would serialise
        // the whole room once per message per player. The 50ms tick is the only broadcaster,
        // and this mode reports a frame every tick anyway.
        return false;
      }
      // A swipe both aims and throws, in one gesture. That is how a laptop plays, and how a
      // phone whose owner refused motion access plays. It is not a degraded mode.
      if (msg.a === "swipe") takeAim(ctx, d, p, msg.angle);
      else if (msg.a !== "tap") return false;

      if (d.holder !== p.id || d.flight || ctx.now() < d.lockUntil) return false;
      const mine = d.aim[p.id];
      if (!mine || mine.to == null || ctx.now() - mine.at > AIM_STALE) return false;
      const target = ctx.players().find((q) => q.id === mine.to && q.alive && !q.gone);
      if (!target) return false;
      d.flight = { from: p.id, to: target.id, arriveAt: ctx.now() + SO_FLIGHT };
      d.holder = null;
      return true;
    },
    tick(ctx, now) {
      const d = ctx.data;
      const live = ctx.alive();
      const ids = new Set(live.map((q) => q.id));

      // An aim belonging to a phone that has gone would still be drawn as a needle on the room
      // screen, pointing out of an empty seat.
      for (const id of Object.keys(d.aim)) if (!ids.has(Number(id))) delete d.aim[id];

      if (d.holder != null && !ids.has(d.holder)) {
        d.holder = pick(live)?.id ?? null;
        d.lockUntil = now + SO_LOCK;
      }
      if (d.flight && !ids.has(d.flight.to)) {
        d.flight = null;
        d.holder = pick(live)?.id ?? null;
        d.lockUntil = now + SO_LOCK;
      }

      if (d.flight && now >= d.flight.arriveAt) {
        // Judged at the LAST millisecond, so the flight is real reaction time and not a formality.
        const { from, to } = d.flight;
        const target = ctx.players().find((q) => q.id === to && q.alive && !q.gone);
        const th = d.aim[to];
        const facing = th && now - th.at <= AIM_STALE && th.to === from && ids.has(from);
        // Blocking is off in a two-player room. With exactly one other person every aim
        // resolves to them, so a block would always land and the holder could never lose. At
        // two this collapses cleanly into hot potato with a hidden fuse — a game that starts,
        // plays and ends — and two phones is the first thing anyone tries.
        const blocked = live.length > 2 && !!target && !!facing;
        d.flight = null;
        d.lockUntil = now + SO_LOCK;
        if (blocked) {
          d.holder = from;
          ctx.award(target, 1);
          d.lastEvent = { kind: "block", by: to, from, at: now };
          ctx.notice(`${target.name} looked straight at it`);
        } else {
          d.holder = (target || pick(live) || {}).id ?? null;
          d.lastEvent = { kind: "catch", by: d.holder, from, at: now };
        }
      }

      if (now >= d.fuseAt) {
        const id = d.holder ?? d.flight?.to;
        const loser = ctx.players().find((q) => q.id === id);
        d.holder = null;
        d.flight = null;
        d.fuseAt = Infinity;
        ctx.eliminate(loser, loser ? `${loser.name} was still holding it` : "nobody was holding it");
      }
      // Unconditionally true: a room of turning bodies needs a frame every tick. Safe against the
      // wedge watchdog only because d.fuseAt always expires and always ends the round.
      return true;
    },
    /**
     * HARD RULE 3, AND THE PITCH. A player who is not holding the bomb is never sent the fuse
     * deadline, never sent who is holding it, and — the important one — never sent who is aiming
     * at them. They get ONE BIT: marked. The server knows the name. The room screen knows the
     * name. The phone will not say it, and the only way to find out is to look up at the actual
     * people in the actual room. Do not "fix" this by adding the name.
     */
    view(ctx, p) {
      const d = ctx.data;
      if (!p.alive) return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in`, tone: 0 };
      // The rising tone and the draining bar play on EVERY phone off the same deadline, so the
      // whole room feels the fuse without anyone learning where it is.
      const shared = { tone: 1, toneFrom: d.startedAt, toneTo: d.fuseAt, wantsAim: true, ring: ringOf(ctx, p) };
      const mine = d.aim[p.id];
      const fresh = mine && ctx.now() - mine.at <= AIM_STALE;
      const at = fresh && mine.to != null ? ctx.players().find((q) => q.id === mine.to) : null;
      const aimName = at ? at.name : null;

      if (d.flight?.to === p.id) {
        return {
          ...shared, kind: "text", big: aimName || "—", title: "INCOMING",
          sub: "face whoever threw it", incomingAt: d.flight.arriveAt, hot: true, pulse: true,
        };
      }
      if (d.holder === p.id) {
        return {
          ...shared, kind: "text", big: aimName || "—", countdownTo: d.fuseAt, title: "YOU HAVE IT",
          sub: aimName ? "tap to throw" : "turn until it names someone",
          hot: true, pulse: true, throwable: !!aimName && ctx.now() >= d.lockUntil,
        };
      }
      const holderAim = d.holder != null ? d.aim[d.holder] : null;
      const marked = !!holderAim && holderAim.to === p.id && ctx.now() - holderAim.at <= AIM_STALE;
      return {
        ...shared, kind: "text", big: aimName || "—",
        title: marked ? "IN THE CROSSHAIRS" : "someone has it",
        sub: marked ? "look up. find them. face them." : "point at people",
        marked,
      };
    },
    spectate(ctx) {
      const d = ctx.data;
      const live = ctx.alive();
      const holder = ctx.players().find((q) => q.id === d.holder);
      const aims = [];
      for (const q of live) {
        const a = d.aim[q.id];
        if (a && a.to != null && ctx.now() - a.at <= AIM_STALE) {
          aims.push({ from: q.id, to: a.to, holder: q.id === d.holder });
        }
      }
      return {
        kind: "sight", countdownTo: d.fuseAt,
        title: d.flight ? "IN THE AIR" : (holder?.name || "—"),
        sub: "nobody's phone says who is aiming at them",
        strap: "THEIR PHONES KNOW WHO IS AIMING AT THEM. THE PHONES WILL NOT SAY.",
        flightMs: SO_FLIGHT, lastEvent: d.lastEvent, aims,
        map: { holder: d.holder, flight: d.flight, players: live.map((q) => ({ id: q.id, name: q.name, angle: q.seat })) },
      };
    },
  },
  // ------------------------------------------------------------------ hidden state
  blindside: {
    name: "Blindside", min: 2,
    blurb: "Only the holder sees the fuse. Swipe it at someone before it burns down.",
    start(ctx) {
      const d = ctx.data;
      d.holder = pick(ctx.alive()).id;
      d.fuseAt = ctx.now() + rand(FUSE_MIN, FUSE_MAX);
      d.startedAt = ctx.now();
      d.lockUntil = ctx.now() + LOCK;
      d.flight = null;
      d.braced = {};
    },
    act(ctx, p, msg) {
      const d = ctx.data;
      if (msg.a === "tap") {
        // Non-holders get one decision per round so the "?" screen is a choice, not a wait.
        if (d.holder === p.id || d.braced[p.id]) return false;
        d.braced[p.id] = ctx.now() + BRACE;
        return true;
      }
      if (msg.a !== "swipe" || d.holder !== p.id || d.flight || ctx.now() < d.lockUntil) return false;
      const target = ctx.towards(p, msg.angle);
      if (!target) return false;
      d.flight = { to: target.id, arriveAt: ctx.now() + FLIGHT };
      d.holder = null;
      return true;
    },
    tick(ctx, now) {
      const d = ctx.data;
      let changed = false;
      // A phone that dropped must not take the round down with it.
      if (d.holder != null && !ctx.alive().some((p) => p.id === d.holder)) {
        const next = pick(ctx.alive());
        d.holder = next ? next.id : null;
        d.lockUntil = now + LOCK;
        changed = true;
      }
      if (d.flight && !ctx.alive().some((p) => p.id === d.flight.to)) {
        const next = pick(ctx.alive());
        if (next) { d.flight = null; d.holder = next.id; d.lockUntil = now + LOCK; changed = true; }
      }
      if (d.flight && now >= d.flight.arriveAt) {
        const target = ctx.players().find((p) => p.id === d.flight.to && p.alive);
        d.holder = (target || pick(ctx.alive()) || {}).id ?? null;
        d.flight = null; d.lockUntil = now + LOCK; changed = true;
      }
      if (now >= d.fuseAt) {
        const id = d.holder ?? d.flight?.to;
        const loser = ctx.players().find((p) => p.id === id);
        // A brace is a real save, spent the moment it works: you bet on when the fuse ends, and
        // winning that bet throws the bomb back into the room on a short fuse instead of ending
        // the round. Bracing used to only change your background colour, which is not a decision.
        if (loser && d.braced[loser.id] > now) {
          delete d.braced[loser.id];
          const next = pick(ctx.alive().filter((p) => p.id !== loser.id)) || loser;
          d.holder = next.id;
          d.flight = null;
          d.lockUntil = now + LOCK;
          d.startedAt = now;
          d.fuseAt = now + rand(6000, 10000);
          ctx.notice(`${loser.name} braced and took the blast — it is loose again, on a short fuse`);
          return true;
        }
        d.holder = null; d.flight = null; d.fuseAt = Infinity;
        ctx.eliminate(loser, loser ? `${loser.name} was holding it` : "nobody was holding it");
        return true;
      }
      return changed;
    },
    view(ctx, p) {
      const d = ctx.data;
      if (!p.alive) return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in`, tone: 0 };
      // The tone plays on EVERY phone at the same pitch off the shared clock. If only the holder's
      // phone made noise, the whole room could hear who had it and the secret would be worthless.
      const shared = { tone: 1, toneFrom: d.startedAt, toneTo: d.fuseAt };
      if (d.holder === p.id) {
        return {
          ...shared, kind: "text", countdownTo: d.fuseAt, title: "YOU HAVE IT", sub: "swipe toward someone",
          hot: true, pulse: true, ring: ringOf(ctx, p),
        };
      }
      const bracedUntil = d.braced[p.id];
      return {
        ...shared, kind: "text", big: "?", dim: true,
        title: d.flight ? "in the air" : "someone has it",
        sub: bracedUntil ? "braced — it will cost you the bomb, not the round" : "tap to brace",
        braced: bracedUntil > ctx.now(),
      };
    },
    spectate(ctx) {
      const d = ctx.data;
      const holder = ctx.players().find((q) => q.id === d.holder);
      return {
        kind: "text", countdownTo: d.fuseAt,
        title: d.flight ? "IN THE AIR" : (holder?.name || "—"),
        sub: "you can see it. they cannot.",
        map: { holder: d.holder, flight: d.flight, players: ctx.alive().map((q) => ({ id: q.id, name: q.name, angle: q.seat })) },
      };
    },
  },


  // ------------------------------------------- synchronised state (the clock sync, made visible)
  flash: {
    name: "Flash", min: 2,
    blurb: "Every phone lights up on the same millisecond. Slowest is out, early is worse.",
    start(ctx) {
      const d = ctx.data;
      d.flashAt = ctx.now() + rand(2800, 6500);
      d.taps = {};
      d.settled = false;
    },
    act(ctx, p, msg) {
      const d = ctx.data;
      if (msg.a !== "tap" || d.taps[p.id] != null || d.settled) return false;
      d.taps[p.id] = ctx.now() < d.flashAt ? -1 : ctx.now() - d.flashAt;
      return true;
    },
    tick(ctx, now) {
      const d = ctx.data;
      if (d.settled) return false;
      const live = ctx.alive();
      if (!live.length) return false;
      if (!live.every((p) => d.taps[p.id] != null) && now < d.flashAt + 4000) return false;
      d.settled = true;
      const early = live.filter((p) => d.taps[p.id] === -1);
      const asleep = live.filter((p) => d.taps[p.id] == null);
      const slowest = live.filter((p) => d.taps[p.id] > 0).sort((a, b) => d.taps[b.id] - d.taps[a.id])[0];
      const loser = early[0] || asleep[0] || slowest;
      ctx.eliminate(loser, early.length ? `${loser.name} jumped the gun`
        : asleep.length ? `${loser.name} never tapped` : `${loser.name} was slowest`);
      return true;
    },
    view(ctx, p) {
      const d = ctx.data;
      if (!p.alive) return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in` };
      const mine = d.taps[p.id];
      if (mine === -1) return { kind: "text", big: "TOO SOON", bg: "#3a1016", title: "you tapped early" };
      if (mine != null) return { kind: "text", big: `${Math.round(mine)}ms`, title: "your reaction", sub: "waiting on the others" };
      // The phone decides when to light up, off the synced clock. The server sends no frame at all
      // during the wait, which is exactly why this has to be client-side.
      return { kind: "text", flashAt: d.flashAt, waitBig: "•", waitTitle: "WAIT", waitSub: "tap the instant it lights",
        litBig: "TAP", litBg: "#eef4ff", litInk: "#0a0d14" };
    },
    spectate(ctx) {
      const d = ctx.data;
      const rows = ctx.alive().map((p) => {
        const t = d.taps[p.id];
        return `${p.name} ${t == null ? "…" : t === -1 ? "early" : Math.round(t) + "ms"}`;
      });
      return { kind: "text", flashAt: d.flashAt, waitBig: "", waitTitle: "wait for it",
        litBig: "GO", litBg: "#eef4ff", litInk: "#0a0d14", sub: rows.join("   ·   ") };
    },
  },

  // ------------------------------------------------------------------- hidden roles
  impostor: {
    name: "Impostor", min: 3, wedgeMs: 90000,
    blurb: "Everyone sees the same word. One of you sees a different one. Say it out loud, then vote.",
    start(ctx) {
      const pairs = [
        ["COFFEE", "TEA"], ["BEACH", "DESERT"], ["DOCTOR", "DENTIST"], ["PIZZA", "LASAGNE"],
        ["GUITAR", "VIOLIN"], ["WINTER", "AUTUMN"], ["SUBWAY", "BUS"], ["LIBRARY", "MUSEUM"],
        ["FOOTBALL", "RUGBY"], ["MOUNTAIN", "VOLCANO"], ["WEDDING", "FUNERAL"], ["HOSPITAL", "HOTEL"],
      ];
      const [common, odd] = pick(pairs);
      const d = ctx.data;
      d.common = common; d.odd = odd;
      d.impostor = pick(ctx.alive()).id;
      d.votes = {};
      d.talkUntil = ctx.now() + 60000;
    },
    act(ctx, p, msg) {
      const d = ctx.data;
      if (msg.a !== "swipe") return false;
      const target = ctx.towards(p, msg.angle);
      if (!target) return false;
      d.votes[p.id] = target.id;
      return true;
    },
    tick(ctx, now) {
      const d = ctx.data;
      const live = ctx.alive();
      if (!live.length) return false;
      // The impostor's phone leaving is the one drop this mode cannot argue its way out of.
      if (!live.some((p) => p.id === d.impostor)) {
        ctx.finishRound(null, { big: d.odd, title: "the impostor left the room", sub: `the word was "${d.common}"` });
        return true;
      }
      if (!live.every((p) => d.votes[p.id] != null) && now < d.talkUntil) return false;
      const tally = {};
      for (const v of Object.values(d.votes)) tally[v] = (tally[v] || 0) + 1;
      const accusedId = Number(Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0]);
      const impostor = ctx.players().find((p) => p.id === d.impostor);
      const caught = accusedId === d.impostor;
      for (const p of live) if (caught ? p.id !== d.impostor : p.id === d.impostor) ctx.award(p, 1);
      const out = caught ? impostor : ctx.players().find((p) => p.id === accusedId);
      ctx.eliminate(out, caught ? `${impostor?.name} was the impostor` : `wrong — ${impostor?.name} had "${d.odd}"`);
      return true;
    },
    view(ctx, p) {
      const d = ctx.data;
      if (!p.alive) return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in` };
      const voted = d.votes[p.id] != null;
      return {
        kind: "text", big: p.id === d.impostor ? d.odd : d.common,
        title: voted ? "vote cast" : "say your word out loud",
        sub: voted ? "waiting on the others" : "then swipe at whoever is lying",
        countdownTo: voted ? null : d.talkUntil,
        ring: voted ? [] : ringOf(ctx, p),
      };
    },
    spectate(ctx) {
      const d = ctx.data;
      const imp = ctx.players().find((p) => p.id === d.impostor);
      return { kind: "text", title: `the room: ${d.common}`, big: d.odd, sub: `${imp?.name} is lying and doesn't know you know.` };
    },
  },

  // ------------------------------------------------------ co-op: the seating, turned into a game
  // Every other mode eliminates people, and an eliminated stranger at an expo walks away. Relay
  // keeps everyone in and gives the room one number to beat, which is what makes people call their
  // friends over. It is also the mode that proves the seating is real: the token has to travel in
  // seat order, so a ring that does not match the table is immediately, visibly broken.
  relay: {
    name: "Relay", min: 3,
    blurb: "Co-op. Pass the token all the way round the ring, in seat order, against the room's best time.",
    start(ctx) {
      const d = ctx.data;
      // Direction alternates round to round so the room cannot run on muscle memory. It is kept in
      // records under an underscore key, which the server strips before anything reaches a phone.
      const clockwise = !ctx.records._relayClockwise;
      ctx.setRecord("_relayClockwise", clockwise);
      const ring = ctx.alive().slice().sort((a, b) => a.seat - b.seat);
      if (!clockwise) ring.reverse();
      const from = Math.floor(Math.random() * ring.length);
      d.order = ring.slice(from).concat(ring.slice(0, from)).map((p) => p.id);
      d.clockwise = clockwise;
      d.at = 0;
      d.passes = 0;
      d.need = d.order.length;
      d.penalty = 0;
      d.startedAt = ctx.now();
      d.wrong = null;
      d.done = false;
      d.settled = false;
    },
    act(ctx, p, msg) {
      const d = ctx.data;
      if (msg.a !== "swipe" || d.done) return false;
      if (p.id !== d.order[d.at]) return false;                      // not your turn
      const want = ctx.players().find((q) => q.id === d.order[(d.at + 1) % d.order.length]);
      const got = ctx.towards(p, msg.angle);
      if (!want || !got) return false;
      if (got.id !== want.id) {
        d.penalty += RELAY_PENALTY;
        d.wrong = { by: p.id, byName: p.name, to: got.name, at: ctx.now() };
        return true;
      }
      d.at = (d.at + 1) % d.order.length;
      d.passes++;
      d.wrong = null;
      if (d.passes >= d.need) { d.done = true; d.finishedAt = ctx.now(); }
      return true;
    },
    tick(ctx, now) {
      const d = ctx.data;
      if (d.done) {
        if (d.settled) return false;
        d.settled = true;
        const total = d.finishedAt - d.startedAt + d.penalty;
        const best = ctx.records.relay;
        const record = best == null || total < best;
        if (record) ctx.setRecord("relay", total);
        d.total = total;
        ctx.finishRound(null, {
          big: secs(total),
          title: record ? "NEW ROOM RECORD" : `the room's lap · best ${secs(best)}`,
          sub: d.penalty ? `${secs(d.penalty)} of that was wrong passes` : "clean lap, no penalties",
        });
        return true;
      }
      // A phone leaving must not strand the token halfway round the ring. Drop them out of the
      // order and keep going rather than starting the lap again — the room is already running.
      const live = new Set(ctx.alive().map((q) => q.id));
      if (d.order.some((id) => !live.has(id))) {
        const wanted = d.order[d.at];
        const kept = d.order.filter((id) => live.has(id));
        if (kept.length < 2) {
          d.done = true; d.settled = true;
          ctx.finishRound(null, { big: "—", title: "lap abandoned", sub: "not enough phones left to pass to" });
          return true;
        }
        let at = kept.indexOf(wanted);
        if (at < 0) {                                   // the holder is the one who left
          at = 0;
          for (let k = 1; k < d.order.length; k++) {
            const i = kept.indexOf(d.order[(d.at + k) % d.order.length]);
            if (i >= 0) { at = i; break; }
          }
        }
        d.order = kept;
        d.at = at;
        d.need = kept.length;
        ctx.notice("a phone dropped — the lap carries on");
        if (d.passes >= d.need) { d.done = true; d.finishedAt = now; }
        return true;
      }
      if (d.wrong && now - d.wrong.at > 1800) { d.wrong = null; return true; }
      return false;
    },
    view(ctx, p) {
      const d = ctx.data;
      const holderId = d.order[d.at];
      if (holderId === p.id) {
        const next = ctx.players().find((q) => q.id === d.order[(d.at + 1) % d.order.length]);
        return {
          kind: "text", big: "GO", bg: "#0d3320", ink: "#e9fff2", pulse: true,
          title: next ? `PASS TO ${next.name}` : "PASS IT",
          sub: d.wrong?.by === p.id ? `not ${d.wrong.to} — +${secs(RELAY_PENALTY)}` : "swipe toward them",
          ring: next ? [{ name: next.name, angle: next.seat }] : [],
        };
      }
      const holder = ctx.players().find((q) => q.id === holderId);
      return {
        kind: "text", big: `${d.passes}/${d.need}`, dim: true, title: "round the ring",
        sub: d.wrong
          ? `${d.wrong.byName} passed to ${d.wrong.to} — +${secs(RELAY_PENALTY)}`
          : `${holder?.name ?? "—"} has it${d.penalty ? ` · +${secs(d.penalty)}` : ""}`,
      };
    },
    spectate(ctx) {
      const d = ctx.data;
      const name = (id) => ctx.players().find((q) => q.id === id)?.name ?? "—";
      const best = ctx.records.relay;
      return {
        kind: "text", big: `${d.passes}/${d.need}`, countupFrom: d.startedAt,
        title: d.order.map(name).join(" → "),
        sub: [
          `${name(d.order[d.at])} has it`,
          d.penalty ? `+${secs(d.penalty)} penalties` : null,
          best == null ? "no record yet" : `record ${secs(best)}`,
        ].filter(Boolean).join("   ·   "),
        map: { holder: d.order[d.at], players: ctx.alive().map((q) => ({ id: q.id, name: q.name, angle: q.seat })) },
      };
    },
  },

  // --------------------------------------------- per-player truth, as a game you can explain fast
  // The same room state renders as a secret for one person and a bare number for everyone else.
  // Nobody is ever shown the sequence except the person extending it; you learn your own place in
  // it because someone swiped at you, and you learn everyone else's by watching the room. The
  // progress counter is deliberately absent from the recall view — if phones showed the position,
  // knowing your own number would make the game trivial and nobody would look up.
  chain: {
    name: "Chain", min: 3,
    blurb: "A growing order of people. Only the extender sees it. Then the room taps it back from memory.",
    start(ctx) {
      const d = ctx.data;
      d.ring = ctx.alive().slice().sort((a, b) => a.seat - b.seat).map((p) => p.id);
      d.turn = Math.floor(Math.random() * d.ring.length);
      d.seq = [];
      d.phase = "extend";
      d.at = 0;
      d.failed = null;
      d.deadline = ctx.now() + CHAIN_EXTEND;
    },
    act(ctx, p, msg) {
      const d = ctx.data;
      if (d.phase === "extend") {
        if (msg.a !== "swipe" || p.id !== d.ring[d.turn]) return false;
        const target = ctx.towards(p, msg.angle);
        if (!target) return false;
        chainExtend(ctx, d, target.id);
        return true;
      }
      if (d.phase !== "recall" || msg.a !== "tap") return false;
      if (p.id !== d.seq[d.at]) {
        d.phase = "fail";
        d.failed = p.id;
        d.deadline = ctx.now() + 1600;                 // a beat so the room sees what broke it
        return true;
      }
      d.at++;
      d.deadline = ctx.now() + CHAIN_RECALL;
      if (d.at >= d.seq.length) {
        d.phase = "extend";
        d.turn = (d.turn + 1) % d.ring.length;
        d.deadline = ctx.now() + CHAIN_EXTEND;
        ctx.notice(`the room remembered ${d.seq.length}`);
      }
      return true;
    },
    tick(ctx, now) {
      const d = ctx.data;
      // A phone leaving must not put an innocent player out. Rebuild the chain without them and
      // restart the recall, rather than eliminating whoever happened to be next in a dead order.
      const live = new Set(ctx.alive().map((q) => q.id));
      if (d.ring.some((id) => !live.has(id)) || d.seq.some((id) => !live.has(id))) {
        const extender = d.ring[d.turn];
        d.ring = d.ring.filter((id) => live.has(id));
        if (d.ring.length < 2) return false;           // the engine ends or resets the round
        const kept = d.ring.indexOf(extender);
        d.turn = kept >= 0 ? kept : d.turn % d.ring.length;
        d.seq = d.seq.filter((id) => live.has(id));
        d.at = 0;
        d.failed = null;
        d.phase = d.seq.length ? "recall" : "extend";
        d.deadline = now + (d.phase === "extend" ? CHAIN_EXTEND : CHAIN_RECALL);
        ctx.notice(`a phone dropped — the chain is ${d.seq.length} again`);
        return true;
      }
      if (now < d.deadline) return false;
      if (d.phase === "fail") {
        const who = ctx.players().find((q) => q.id === d.failed);
        ctx.eliminate(who, who ? `${who.name} tapped out of turn` : "the chain broke");
        return true;
      }
      if (d.phase === "extend") {
        const who = ctx.players().find((q) => q.id === d.ring[d.turn]);
        const target = pick(ctx.alive());
        if (!target) return false;
        ctx.notice(`${who?.name ?? "nobody"} ran out of time — the chain chose for them`);
        chainExtend(ctx, d, target.id);
        return true;
      }
      const stuck = ctx.players().find((q) => q.id === d.seq[d.at]);
      ctx.eliminate(stuck, stuck ? `${stuck.name} froze` : "the chain broke");
      return true;
    },
    view(ctx, p) {
      const d = ctx.data;
      if (!p.alive) return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in` };
      const name = (id) => ctx.players().find((q) => q.id === id)?.name ?? "—";
      // You are told the places you were swiped into and nothing else. Your own number is useless
      // unless you can count the taps happening around the table, which is the whole game.
      const mine = d.seq.map((id, i) => (id === p.id ? i + 1 : 0)).filter(Boolean);
      const yours = mine.length ? `you are ${mine.map(ord).join(" and ")}` : "you are not in the chain yet";
      if (d.phase === "fail") {
        return { kind: "text", big: "BROKEN", bg: "#3a1016", title: `${name(d.failed)} tapped out of turn` };
      }
      if (d.phase === "extend") {
        if (p.id === d.ring[d.turn]) {
          return {
            kind: "text", big: String(d.seq.length), title: "ADD SOMEONE", pulse: true,
            sub: d.seq.length ? d.seq.map(name).join(" → ") : "swipe at anyone to start the chain",
            countdownTo: d.deadline, ring: ringOf(ctx, p),
          };
        }
        return {
          kind: "text", big: String(d.seq.length), dim: true,
          title: `${name(d.ring[d.turn])} is extending it`, sub: yours,
        };
      }
      return {
        kind: "text", big: String(d.seq.length), title: "TAP IN ORDER",
        sub: `${yours} · watch the room, not your phone`, countdownTo: d.deadline,
      };
    },
    spectate(ctx) {
      const d = ctx.data;
      const name = (id) => ctx.players().find((q) => q.id === id)?.name ?? "—";
      const drawn = d.seq.map((id, i) => (d.phase === "recall" && i < d.at ? `[${name(id)}]` : name(id)));
      return {
        kind: "text", big: String(d.seq.length),
        title: drawn.join(" → ") || "empty chain",
        sub: d.phase === "extend"
          ? `${name(d.ring[d.turn])} is adding someone — only they can see this`
          : "the room is tapping it from memory. you can see it. they cannot.",
        map: { players: ctx.alive().map((q) => ({ id: q.id, name: q.name, angle: q.seat })) },
      };
    },
  },

  // ---------------------------------------------------------------- hidden pairs, in a loud room
  // Everyone gets a word and exactly two people share one. The decoys must all be DISTINCT: with
  // a single shared decoy, two strangers holding it read as the hidden pair to each other and the
  // round resolves on a lie the engine told. The pair are never informed that they are the pair —
  // their view is the same object as everyone else's with a different word in it.
  wiretap: {
    name: "Wiretap", min: 4, wedgeMs: 130000,
    blurb: "Everyone gets a word. Two of you share one. Find your twin before the room finds you.",
    start(ctx) {
      const d = ctx.data;
      const live = ctx.alive();
      const words = shuffle(WIRETAP_WORDS.slice());
      const order = shuffle(live.slice());
      d.shared = words.pop();
      d.word = {};
      for (const p of order) d.word[p.id] = words.pop();
      d.pair = [order[0].id, order[1].id];
      d.word[d.pair[0]] = d.shared;
      d.word[d.pair[1]] = d.shared;
      d.picks = {};
      d.endAt = ctx.now() + TUNING.WIRETAP;
      d.over = false;
    },
    act(ctx, p, msg) {
      const d = ctx.data;
      if (msg.a !== "swipe" || d.over || d.picks[p.id] != null) return false;
      const target = ctx.towards(p, msg.angle);
      if (!target) return false;
      d.picks[p.id] = target.id;                       // one accusation each, and it is final
      const inPair = (id) => d.pair.includes(id);
      if (inPair(p.id) && inPair(target.id) && d.picks[target.id] === p.id) return wiretapEnd(ctx, d, "pair");
      if (!inPair(p.id) && inPair(target.id)) {
        d.caughtBy = p.id;
        d.caught = target.id;
        return wiretapEnd(ctx, d, "room");
      }
      return true;
    },
    tick(ctx, now) {
      const d = ctx.data;
      if (d.over) return false;
      // Half a pair walking off leaves a round that can never resolve, so end it and reveal.
      const live = new Set(ctx.alive().map((q) => q.id));
      if (!d.pair.every((id) => live.has(id))) return wiretapEnd(ctx, d, "gone");
      if (now < d.endAt) return false;
      return wiretapEnd(ctx, d, "timeout");
    },
    view(ctx, p) {
      const d = ctx.data;
      if (!p.alive) return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in` };
      // Chrome and copy are identical for all eight players. The only thing that differs is the
      // word, which is the point — anything else here and the pair are obvious over someone's
      // shoulder.
      const picked = d.picks[p.id] != null;
      return {
        kind: "text", big: d.word[p.id] ?? "—",
        title: picked ? "locked in" : "say your word out loud",
        sub: picked ? "waiting on the room" : "swipe at whoever you think shares it",
        countdownTo: picked ? null : d.endAt,
        ring: picked ? [] : ringOf(ctx, p),
      };
    },
    spectate(ctx) {
      const d = ctx.data;
      const name = (id) => ctx.players().find((q) => q.id === id)?.name ?? "—";
      return {
        kind: "text", big: d.shared, countdownTo: d.endAt,
        title: `${name(d.pair[0])} + ${name(d.pair[1])}`,
        sub: "they share it and neither of them knows it yet",
        map: { players: ctx.alive().map((q) => ({ id: q.id, name: q.name, angle: q.seat })) },
      };
    },
  },

  // ------------------------------------------------------------- the gap between phones as cover
  // Phones lie in a row in seat order. Each player has a ship on their own screen; a bullet
  // leaving your right edge enters your neighbour's left edge at the same height and speed. While
  // it crosses the real physical gap between the two phones it has an `arriveAt` and is filtered
  // out of EVERY view, so it exists on the server and on nobody's screen.
  //
  // The lane index WRAPS. A row has two ends and needs a special case to stop shots falling off
  // them; a table has no ends, so leaving the last phone's right edge enters the first phone's
  // left edge — because those two people are sitting next to each other in real life. The seating
  // of the actual humans is the topology of the world, which is the one claim in this project the
  // prior-art search did not kill. It also means your own shot can come back round and hit you in
  // the back, which is the moment worth demoing.
  //
  // Say the ancestors out loud: Seabaa's DUAL shipped the two-device version over Bluetooth in
  // 2015, and Spatial Revenge on itch.io does the gyroscope and the dead zone between two Android
  // phones. Both are two players in a straight line. Ours is N players in a closed ring at their
  // real seat angles, in a browser, with nothing installed.
  duel: {
    name: "Duel", min: 2,
    blurb: "Ships on every phone. Shoot round the table — a bullet can come back and get you.",
    start(ctx) {
      const d = ctx.data;
      d.order = ctx.alive().slice().sort((a, b) => a.seat - b.seat).map((p) => p.id);
      d.ship = {};
      for (const id of d.order) d.ship[id] = { x: 0.5, y: 0.5, tx: 0, ty: 0, hp: DUEL_HP, nextFire: 0 };
      d.bullets = [];
      d.nextBullet = 1;
      d.last = ctx.now();
      d.over = false;
    },
    act(ctx, p, msg) {
      const d = ctx.data;
      const s = d.ship[p.id];
      if (!s || d.over) return false;
      // THE STICK, not a position. The phone reports how far it is tilted and the server decides
      // where that puts the ship — a client that could declare its own position could declare that
      // it is standing on top of yours, and the whole authority model is the point of this engine.
      if (msg.a === "tilt") {
        const tx = Number(msg.x), ty = Number(msg.y);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
        s.tx = Math.min(1, Math.max(-1, tx));
        s.ty = Math.min(1, Math.max(-1, ty));
        return false;                                // continuous: the tick owns the frame
      }
      if (msg.a === "move") {
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        s.x = Math.min(1, Math.max(0, x));
        s.y = Math.min(1, Math.max(0, y));
        s.tx = 0; s.ty = 0;        // a finger overrides the tilt rather than fighting it
        // Deliberately FALSE. Returning true makes the server broadcast the whole room once per
        // pointermove, and a pointermove arrives 60-120 times a second per finger; six phones
        // dragging is thousands of per-player view() calls a second for frames nobody asked for.
        // A continuous input never owns the broadcast — the 50ms tick does, and this mode ticks
        // true every tick anyway, so the position still leaves at 20Hz.
        return false;
      }
      if (msg.a !== "fire") return false;
      const now = ctx.now();
      if (now < s.nextFire) return false;
      const lane = d.order.indexOf(p.id);
      const dir = Number.isFinite(Number(msg.dir)) ? Number(msg.dir) : 0;
      let vx = Math.cos(dir), vy = Math.sin(dir);
      // There used to be a special case here turning the end players' shots back inward, because
      // a row has two ends and a shot off the end of it goes nowhere. A table has no ends. The
      // lane index wraps now, so every player has a neighbour on both sides and the special case
      // is gone — along with the question of who counts as an end.
      if (Math.abs(vx) < DUEL_MIN_VX) {               // a shot that never leaves your screen is
        vx = (Math.sign(vx) || 1) * DUEL_MIN_VX;      // not this game
      }
      const len = Math.hypot(vx, vy) || 1;
      s.nextFire = now + DUEL_COOL;
      d.bullets.push({
        id: d.nextBullet++, owner: p.id, lane, hops: 0,
        x: s.x + (vx / len) * 0.08, y: s.y + (vy / len) * 0.08,
        vx: (vx / len) * DUEL_SPEED, vy: (vy / len) * DUEL_SPEED,
        arriveAt: 0,
      });
      return true;
    },
    tick(ctx, now) {
      const d = ctx.data;
      if (d.over) return false;
      const dt = Math.min(0.2, Math.max(0, (now - d.last) / 1000));
      d.last = now;
      // A ship whose phone has gone must not win by standing still. ctx.alive() already excludes
      // anyone whose socket is away, which is exactly the presence check this needs.
      const standing = ctx.alive().filter((q) => d.ship[q.id] && d.ship[q.id].hp > 0);
      if (standing.length <= 1) {
        d.over = true;
        ctx.finishRound(standing[0] || null, standing[0] ? null : { big: "—", title: "nobody left standing" });
        return true;
      }
      // Integrate every stick into a position. Ships that are not being tilted have a zero stick
      // and simply do not move, so this costs nothing for a room playing with fingers.
      for (const id of d.order) {
        const sh = d.ship[id];
        if (!sh || sh.hp <= 0 || (!sh.tx && !sh.ty)) continue;
        sh.x = Math.min(1, Math.max(0, sh.x + sh.tx * TILT_SPEED * dt));
        sh.y = Math.min(1, Math.max(0, sh.y + sh.ty * TILT_SPEED * dt));
      }
      const kept = [];
      for (const b of d.bullets) {
        if (b.arriveAt) {
          if (now < b.arriveAt) { kept.push(b); continue; }        // still in the gap: invisible
          b.arriveAt = 0;
          b.x = b.vx > 0 ? 0 : 1;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.y < 0) { b.y = -b.y; b.vy = -b.vy; }
        if (b.y > 1) { b.y = 2 - b.y; b.vy = -b.vy; }
        if (b.x > 1 || b.x < 0) {
          // The ring closes. Leaving the right edge of the last phone enters the left edge of the
          // first, because those two people are sitting next to each other in real life — the
          // seating of four actual humans is the topology of the world.
          const n = d.order.length;
          b.lane = (b.lane + (b.x > 1 ? 1 : -1) + n) % n;
          b.hops++;
          if (b.hops > n) continue;                   // it has been all the way round; let it go
          b.arriveAt = now + GAP;
          kept.push(b);
          continue;
        }
        const occupant = d.order[b.lane];
        // Your own shot can come back and get you, but only after it has crossed a gap — otherwise
        // you would shoot yourself in the face on the frame you fired.
        const canHit = occupant != null && (occupant !== b.owner || b.hops > 0);
        const target = canHit ? ctx.alive().find((q) => q.id === occupant) : null;
        const s = target ? d.ship[occupant] : null;
        if (s && s.hp > 0 && Math.hypot(b.x - s.x, b.y - s.y) < DUEL_HIT) {
          s.hp--;
          if (s.hp <= 0) {
            const shooter = ctx.players().find((q) => q.id === b.owner);
            ctx.eliminate(target, `${shooter?.name ?? "someone"} got ${target.name} across ${Math.abs(b.lane - d.order.indexOf(b.owner))} phone${Math.abs(b.lane - d.order.indexOf(b.owner)) === 1 ? "" : "s"}`);
            d.bullets = kept;
            return true;
          }
          continue;                                                // the bullet is spent
        }
        kept.push(b);
      }
      d.bullets = kept;
      return true;             // an arena needs a frame every tick, unlike every other mode here
    },
    view(ctx, p) {
      const d = ctx.data;
      const lane = d.order.indexOf(p.id);
      const s = d.ship[p.id];
      if (!p.alive || lane < 0 || !s || s.hp <= 0) {
        return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in` };
      }
      const objects = [];
      for (const b of d.bullets) {
        if (b.arriveAt) continue;                    // between two phones: on nobody's screen
        if (b.lane !== lane) continue;               // on someone else's phone
        objects.push({ id: b.id, x: b.x, y: b.y, r: 0.02, c: b.owner === p.id ? "#8ef0b0" : "#ff6b5a", kind: "bullet" });
      }
      const n = d.order.length;
      const at = (i) => ctx.players().find((q) => q.id === d.order[((i % n) + n) % n]);
      const left = n > 1 ? at(lane - 1) : null;
      const right = n > 2 ? at(lane + 1) : null;      // with two phones both edges are each other
      return {
        kind: "arena",
        wantsTilt: true,                            // the phone only powers the sensor when asked
        you: { x: s.x, y: s.y, hp: s.hp },
        objects,
        edge: "both",                               // no ends on a ring
        title: `${"|".repeat(s.hp)} ${s.hp} left`,
        sub: [left && `${left.name} ←`, right && `→ ${right.name}`].filter(Boolean).join("    "),
      };
    },
    /**
     * Every object this mode believes exists right now. The server diffs it against the ids it
     * actually put on the wire, so "on nobody's screen" stops being a claim about the design and
     * becomes a measurement of the frames we really sent.
     */
    census(ctx) { return (ctx.data.bullets || []).map((b) => b.id); },
    /**
     * The room screen gets the whole table: every phone as a rectangle at the seat angle its owner
     * declared, the ships inside them, and — the part no player is allowed — the shots currently
     * crossing the physical gaps between handsets. A hidden-information game gives a bystander
     * nothing to look at, and this is the screen where the hidden part becomes the show.
     *
     * gapMs is the crossing DURATION, not a countdown: the deadline is arriveAt and this screen
     * does its own arithmetic against its own synced clock, same as everything else here.
     */
    spectate(ctx) {
      const d = ctx.data;
      const n = d.order.length;
      const at = (id) => ctx.players().find((q) => q.id === id);
      const inGap = d.bullets.filter((b) => b.arriveAt).length;
      return {
        kind: "ring",
        gapMs: GAP,
        phones: d.order.map((id, lane) => {
          const p = at(id), sh = d.ship[id] || {};
          return {
            id, lane, name: p?.name ?? "—", angle: p?.seat ?? 0,
            hp: Math.max(0, sh.hp ?? 0), x: sh.x ?? 0.5, y: sh.y ?? 0.5,
            gone: !ctx.alive().some((q) => q.id === id),
          };
        }),
        shots: d.bullets.map((b) => ({
          id: b.id, lane: b.lane, x: b.x, y: b.y, owner: b.owner,
          // While arriveAt is set this shot is on the server and on no phone. The lane it LEFT is
          // the one behind it, which is what lets this screen draw it in the empty space.
          arriveAt: b.arriveAt || 0,
          from: b.arriveAt ? ((b.lane - Math.sign(b.vx) % n + n * 2) % n) : b.lane,
        })),
        title: d.order.map((id) => `${at(id)?.name ?? "—"} ${"|".repeat(Math.max(0, d.ship[id]?.hp ?? 0))}`).join("   "),
        sub: inGap
          ? `${inGap} crossing the gaps — on nobody's screen but this one`
          : "the whole table, gaps included",
        map: { players: ctx.alive().map((q) => ({ id: q.id, name: q.name, angle: q.seat })) },
      };
    },
  },
};

// ---- mode helpers -----------------------------------------------------------

function chainExtend(ctx, d, id) {
  d.seq.push(id);
  d.phase = "recall";
  d.at = 0;
  d.failed = null;
  d.deadline = ctx.now() + CHAIN_RECALL;
}

function wiretapEnd(ctx, d, how) {
  d.over = true;
  d.how = how;
  const name = (id) => ctx.players().find((q) => q.id === id)?.name ?? "—";
  const [a, b] = d.pair;
  const reveal = `${name(a)} + ${name(b)}`;
  if (how === "pair") {
    for (const id of d.pair) ctx.award(ctx.players().find((q) => q.id === id), 2);
    ctx.finishRound(null, { big: d.shared, title: reveal, sub: "they found each other and the room never knew" });
  } else if (how === "room") {
    for (const p of ctx.alive()) if (!d.pair.includes(p.id)) ctx.award(p, 1);
    ctx.finishRound(null, { big: d.shared, title: reveal, sub: `${name(d.caughtBy)} pulled ${name(d.caught)} out of the room` });
  } else if (how === "gone") {
    ctx.finishRound(null, { big: d.shared, title: reveal, sub: "half the pair left before anyone found them" });
  } else {
    ctx.finishRound(null, { big: d.shared, title: reveal, sub: "ninety seconds and nobody found anybody" });
  }
  return true;
}

const DUEL_HP = 3;
const DUEL_SPEED = 0.85;        // screens per second
const DUEL_HIT = 0.055;
const DUEL_COOL = 320;
const DUEL_MIN_VX = 0.4;

// Concrete and sayable out loud, which is the only requirement: the whole game is people saying
// their word across a table and listening for an echo.
const WIRETAP_WORDS = [
  "ANCHOR", "BALLOON", "CACTUS", "DENTIST", "ENGINE", "FERRY", "GLACIER", "HAMMER",
  "IGLOO", "JUKEBOX", "KETTLE", "LADDER", "MAGNET", "NOODLE", "OSTRICH", "PIANO",
  "QUARRY", "RADISH", "SADDLE", "TRACTOR", "UMBRELLA", "VIOLIN", "WALNUT", "YOGHURT",
  "ZEBRA", "BUCKET", "COMPASS", "DOMINO", "ELEVATOR", "FOSSIL", "GARLIC", "HARBOUR",
];
