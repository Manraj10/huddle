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
| **Relay** | 3+ | Co-op. A token has to travel the ring in seat order, and the room's lap time is the score. A pass to the wrong neighbour costs two seconds. Nobody is eliminated. |
| **Chain** | 3+ | A growing order of people, shown only to whoever is extending it. Then the room taps it back from memory. You are told your own place and nothing else, so the only way to know whose turn it is is to watch the table. |
| **Wiretap** | 4+ | Everyone gets a word and exactly two people share one. The pair have to find each other and swipe at each other without the rest of the room working out who they are. |
| **Duel** | 2+ | Ships on every phone, in a row. A bullet leaving your right edge enters your neighbour's left edge — and while it crosses the real gap between the two phones it is on nobody's screen. |

## Seats

Join order decides nothing about where anyone sits. Each phone places itself by dragging its dot
around the table in the lobby, which sends `{t:'seat', angle}`, and a round refuses to start until
every phone present has done it. That is what makes "swipe left and it reaches the person on your
left" true rather than a coincidence.

## Run it

```bash
npm install
npm start          # http://localhost:8080
npm test           # mode rules, no sockets
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
- **Declarative rendering.** A view is `{big, title, sub, ring, bg, tone, pulse}`, or
  `{kind:"arena", you, objects, edge}` for Duel. The client knows nothing about any game.
- **Rounds survive a phone leaving.** Every mode reconciles against `ctx.alive()` before it does
  anything else. Screens lock and batteries die, and a round that wedges is a round the room
  watches die.

## Tuning

Every timing that decides how a game feels is an environment variable, so the room can be retuned
between playtests without a redeploy.

| Variable | Default | What it changes |
|---|---|---|
| `HUDDLE_FLIGHT_MS` | `700` | How long the bomb is in the air in Blindside, and so how long nobody has it |
| `HUDDLE_LOCK_MS` | `420` | How long after catching it before you can throw it on |
| `HUDDLE_BRACE_MS` | `2200` | How long a brace stays armed |
| `HUDDLE_FUSE_MIN_MS` | `11000` | Shortest fuse |
| `HUDDLE_FUSE_MAX_MS` | `20000` | Longest fuse |
| `HUDDLE_GAP_MS` | `250` | Flight time across the physical gap between two phones in Duel |
| `HUDDLE_RELAY_PENALTY_MS` | `2000` | What a pass to the wrong neighbour costs the room |
| `HUDDLE_CHAIN_EXTEND_MS` | `12000` | How long you get to extend the chain (recall gets half of it, per tap) |
| `HUDDLE_WIRETAP_MS` | `90000` | How long the room has to find the pair |

```bash
HUDDLE_FUSE_MAX_MS=14000 HUDDLE_GAP_MS=180 npm start
```

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
