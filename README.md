# Huddle

Party games that live across everyone's phones. One link, one room, no install.

The engine sends **every player a different view of the same room**. That is what makes
hidden-information games possible: in Blindside only the person holding the bomb can see it, and
everyone else genuinely cannot. Games are server-side only — the phones render whatever view they
are handed, so a new game is about 40 lines in `modes.js` and zero client code.

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
