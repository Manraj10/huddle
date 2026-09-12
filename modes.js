// Games. Each one is server-side only — the client renders whatever view it is handed, so adding
// a game means adding an entry here and shipping nothing to the phones.
//
// A mode implements:
//   start(ctx)              set up a round
//   act(ctx, player, msg)   handle {a:'swipe',angle} | {a:'tap'} ... return true if state changed
//   tick(ctx, now)          advance time, return true if state changed
//   view(ctx, player)       what THIS player sees — the whole point of the engine
//   spectate(ctx)           what the room screen sees (it may know everything)

const FLIGHT = 700, LOCK = 420;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ringOf = (ctx, me) => ctx.alive().filter((p) => p.id !== me.id).map((p) => ({ name: p.name, angle: p.seat }));

export const MODES = {
  // ---------------------------------------------------------------- hidden state
  blindside: {
    name: "Blindside", min: 2,
    blurb: "Only the holder sees the bomb. Swipe it at someone before it goes off.",
    start(ctx) {
      const d = ctx.data;
      d.holder = pick(ctx.alive()).id;
      d.fuseAt = ctx.now() + rand(14000, 26000);
      d.lockUntil = ctx.now() + LOCK;
      d.flight = null;
    },
    act(ctx, p, msg) {
      const d = ctx.data;
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
      if (d.flight && now >= d.flight.arriveAt) {
        d.holder = d.flight.to; d.flight = null; d.lockUntil = now + LOCK; changed = true;
      }
      if (now >= d.fuseAt) {
        const loser = ctx.players().find((p) => p.id === (d.holder ?? d.flight?.to));
        d.holder = null; d.flight = null; d.fuseAt = Infinity;
        ctx.eliminate(loser, loser ? `${loser.name} blew up` : "it fizzled");
        return true;
      }
      return changed;
    },
    view(ctx, p) {
      const d = ctx.data;
      const left = Math.max(0, d.fuseAt - ctx.now());
      const urgency = Math.min(1, 1 - left / 26000);
      if (!p.alive) return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in` };
      if (d.holder === p.id) {
        return {
          kind: "text", big: (left / 1000).toFixed(1), title: "YOU HAVE IT", sub: "swipe toward someone",
          bg: `rgb(${90 + urgency * 150},${38 - urgency * 28},42)`, pulse: true, tone: 0.2 + urgency * 0.8,
          ring: ringOf(ctx, p),
        };
      }
      return { kind: "text", big: "?", title: d.flight ? "in the air" : "someone has it", dim: true };
    },
    spectate(ctx) {
      const d = ctx.data;
      const holder = ctx.players().find((q) => q.id === d.holder);
      return {
        kind: "text", big: ((Math.max(0, d.fuseAt - ctx.now())) / 1000).toFixed(1),
        title: d.flight ? "IN THE AIR" : (holder?.name || "—"), sub: "the room can see everything. they cannot.",
      };
    },
  },

  // ---------------------------------------------------- synchronised state (the clock-sync proof)
  flash: {
    name: "Flash", min: 2,
    blurb: "Every phone lights up at the same instant. Slowest loses. Early tap loses harder.",
    start(ctx) {
      const d = ctx.data;
      d.flashAt = ctx.now() + rand(2600, 6500);
      d.taps = {};
      d.settled = false;
    },
    act(ctx, p, msg) {
      const d = ctx.data;
      if (msg.a !== "tap" || d.taps[p.id] != null || d.settled) return false;
      const early = ctx.now() < d.flashAt;
      d.taps[p.id] = early ? -1 : ctx.now() - d.flashAt;
      return true;
    },
    tick(ctx, now) {
      const d = ctx.data;
      if (d.settled) return false;
      const live = ctx.alive();
      const done = live.every((p) => d.taps[p.id] != null);
      if (!done && now < d.flashAt + 4000) return false;
      d.settled = true;
      const jumpers = live.filter((p) => d.taps[p.id] === -1);
      const slowest = live.filter((p) => d.taps[p.id] > 0).sort((a, b) => d.taps[b.id] - d.taps[a.id])[0];
      const asleep = live.filter((p) => d.taps[p.id] == null);
      const loser = jumpers[0] || asleep[0] || slowest;
      ctx.eliminate(loser, jumpers.length ? `${loser.name} jumped the gun`
        : asleep.length ? `${loser.name} never tapped` : `${loser.name} was slowest`);
      return true;
    },
    view(ctx, p) {
      const d = ctx.data, lit = ctx.now() >= d.flashAt;
      if (!p.alive) return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in` };
      const mine = d.taps[p.id];
      if (mine === -1) return { kind: "text", big: "TOO SOON", bg: "#3a1016", title: "you tapped early" };
      if (mine != null) return { kind: "text", big: `${Math.round(mine)}ms`, title: "your reaction", sub: "waiting for the others" };
      if (!lit) return { kind: "text", big: "•", title: "WAIT", sub: "tap the moment it lights up", dim: true };
      return { kind: "text", big: "TAP", bg: "#eef4ff", ink: "#0a0d14", flash: true, tap: true };
    },
    spectate(ctx) {
      const d = ctx.data;
      const rows = ctx.alive().map((p) => `${p.name} ${d.taps[p.id] == null ? "…" : d.taps[p.id] === -1 ? "early" : Math.round(d.taps[p.id]) + "ms"}`);
      return { kind: "text", title: ctx.now() >= d.flashAt ? "GO" : "wait for it", sub: rows.join("   ·   "),
        big: ctx.now() >= d.flashAt ? "⚡" : "", flash: ctx.now() >= d.flashAt && ctx.now() < d.flashAt + 300 };
    },
  },

  // ------------------------------------------------------------------- hidden roles
  impostor: {
    name: "Impostor", min: 3,
    blurb: "Everyone gets the same word. One of you gets a different one. Say your word out loud, then vote.",
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
      d.talkUntil = ctx.now() + 45000;
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
      const allVoted = live.every((p) => d.votes[p.id] != null);
      if (!allVoted && now < d.talkUntil) return false;
      const tally = {};
      for (const v of Object.values(d.votes)) tally[v] = (tally[v] || 0) + 1;
      const accusedId = Number(Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0]);
      const impostor = ctx.players().find((p) => p.id === d.impostor);
      const caught = accusedId === d.impostor;
      for (const p of live) if (caught ? p.id !== d.impostor : p.id === d.impostor) ctx.award(p, 1);
      d.revealed = { caught, impostorName: impostor?.name || "?", word: d.odd };
      ctx.eliminate(caught ? impostor : ctx.players().find((p) => p.id === accusedId),
        caught ? `${impostor?.name} was the impostor` : `wrong — ${impostor?.name} had "${d.odd}"`);
      return true;
    },
    view(ctx, p) {
      const d = ctx.data;
      if (!p.alive) return { kind: "text", title: "OUT", sub: `${ctx.alive().length} still in` };
      const voted = d.votes[p.id] != null;
      return {
        kind: "text",
        big: p.id === d.impostor ? d.odd : d.common,
        title: voted ? "vote cast" : "say your word out loud",
        sub: voted ? "waiting for everyone" : "then swipe toward the impostor",
        ring: voted ? [] : ringOf(ctx, p),
      };
    },
    spectate(ctx) {
      const d = ctx.data;
      const imp = ctx.players().find((p) => p.id === d.impostor);
      return { kind: "text", title: `everyone: ${d.common}`, big: d.odd, sub: `${imp?.name} is lying. they don't know you know.` };
    },
  },
};
