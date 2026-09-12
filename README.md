# Huddle

Party games that live across everyone's phones. One link, one room, no install.

Huddle is an engine for social party games where the room itself becomes the mechanic. Every player
gets a different view of the same room, so hidden information is enforced by the authoritative server
instead of leaked by the client. In Blindside, only the person holding the bomb can see it; everyone
else sees a room that looks normal, while the room screen keeps the truth.

## Pitch in 30 seconds

Huddle is a room-native party-game engine built for walk-up play: no install, no account, and no
friction. The product is not "a game on a phone" — it is a shared social space where every player is
seeing a different slice of the same truth. That creates tension, bluffing, reaction timing, and
real physical attention in a way that a generic online game never can.

## Judge-facing docs

- [PITCH.md](./PITCH.md) — the 3-minute demo script, product framing, and judge narrative
- [docs/README.md](./docs/README.md) — the operational runbook for judging, backup, and submission
- [docs/submission-checklist.md](./docs/submission-checklist.md) — the Google Form, MLH questions, and backup-video checklist
- [docs/prizes.md](./docs/prizes.md) — the prize paths that fit the product and the ones to avoid

## Games

| Game | Players | What happens |
|---|---|---|
| **Blindside** | 2+ | A lit fuse sits on one phone and only that person sees it. Swipe toward someone to throw it. For 700 ms it is in the air and nobody has it. Holding it at zero puts you out. |
| **Flash** | 2+ | Every phone lights up at the same instant, to the millisecond, on synced clocks. Slowest tap is out. Tapping early is worse. |
| **Impostor** | 3+ | Everyone is shown the same word. One player is shown a different one. Say your word out loud, then swipe at whoever you think is lying. |

## Run it

```bash
npm install
npm start          # http://localhost:8080
```

Phones need a public HTTPS URL (secure context, so screens can hold a wake lock):

```bash
cloudflared tunnel --url http://localhost:8080
```

## How it works

- **Authoritative server.** Node + `ws`, one room, a 50 ms tick. Clients send intent, never state.
- **Clock sync.** Each phone pings five times and keeps the median offset, so "light up at T" means
  the same instant on every device. Flash is the visible proof of it.
- **Per-player views.** `view(ctx, player)` runs once per player per broadcast. Hidden information
  is a property of the engine, not of any one game.
- **Declarative rendering.** A view is `{big, title, sub, ring, bg, tone, pulse}`. The client knows
  nothing about any game.

## Adding a game

```js
myGame: {
  name: "My Game", min: 2, blurb: "one line for the lobby",
  start(ctx) { ctx.data.x = ctx.now() + 5000 },
  act(ctx, player, msg) { /* {a:'swipe',angle} or {a:'tap'} */ return true },
  tick(ctx, now) { return false },
  view(ctx, player) { return { kind: "text", big: "hello", title: player.name } },
  spectate(ctx) { return { kind: "text", title: "the room screen sees everything" } },
}
```

Built at HackCMU 2026.
