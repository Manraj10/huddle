// Games. Server-side only — phones render whatever view they are handed, so a new game is an
// entry here and nothing ships to the clients.
//
// RULE LEARNED THE HARD WAY: never send a pre-rendered number. Send the DEADLINE
// (`countdownTo`, `flashAt`) and let each phone do the arithmetic against its own synced clock.
// Sending "23.4" meant the number froze between broadcasts, and it meant Flash never lit up at
// all, because a waiting game produces no state changes and therefore no broadcasts.

const FLIGHT = 700, LOCK = 420, BRACE = 1500;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ringOf = (ctx, me) => ctx.alive().filter((p) => p.id !== me.id).map((p) => ({ name: p.name, angle: p.seat }));

export const MODES = {
  // ------------------------------------------------------------------ hidden state
  blindside: {
    name: "Blindside", min: 2,
    blurb: "Only the holder sees the fuse. Swipe it at someone before it burns down.",
    start(ctx) {
      const d = ctx.data;
      d.holder = pick(ctx.alive()).id;
      d.fuseAt = ctx.now() + rand(14000, 26000);
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
      if (d.flight && now >= d.flight.arriveAt) {
        const target = ctx.players().find((p) => p.id === d.flight.to && p.alive);
        d.holder = (target || pick(ctx.alive()) || {}).id ?? null;
        d.flight = null; d.lockUntil = now + LOCK; changed = true;
      }
      if (now >= d.fuseAt) {
        const id = d.holder ?? d.flight?.to;
        const loser = ctx.players().find((p) => p.id === id);
        d.holder = null; d.flight = null; d.fuseAt = Infinity;
        // Bracing costs you the round if you were wrong about the timing.
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
        sub: bracedUntil ? "braced" : "tap to brace",
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
    name: "Impostor", min: 3,
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
};
