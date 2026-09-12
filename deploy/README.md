# Lane 3 — keep the demo alive

The laptop screen and the box that serves it. A hidden-information game gives a judge who is not
playing nothing to look at; this folder is why they stay.

| Path | What |
|---|---|
| `public/room?key=<ROOM_KEY>.html` | Director view. Open `/room?key=<ROOM_KEY>` on the laptop. |
| `deploy/setup.sh` | One-shot install on a fresh Ubuntu VPS. |
| `deploy/huddle.service` | systemd unit: `node server.js`, restart on crash. |
| `deploy/Caddyfile` | TLS / reverse proxy in front of `:8080`. |
| `deploy/cloudflared.service` | Named tunnel **from the box**, so the URL survives the laptop moving. |
| `deploy/stats.js` | Round ledger. File-backed; optional Atlas webhook. |
| `deploy/TABLE-CARD.md` | Both URLs, printed, on the table. |

## Room screen

```
http://localhost:8080/room?key=<ROOM_KEY>
```

Connects with `?spectate`. The engine already sends a full-truth view every broadcast. Override
the QR / join URL when the public hostname is not the one in the address bar:

```
http://localhost:8080/room?key=<ROOM_KEY>?url=https://your-public-host
```

Done when someone standing behind the table can follow a whole round without touching a phone.

## Get off the quick tunnel (P0-3)

Cloudflare quick tunnels from a laptop cap around 200 connections and one blip drops every phone
at once. Move to a real box before expo.

1. Cheapest Vultr Ubuntu VPS. Screenshot the receipt — Vultr is an MLH prize.
2. SSH in and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/Manraj10/huddle/master/deploy/setup.sh | sudo bash
   ```
   Or, from a clone: `sudo bash deploy/setup.sh`.
3. Put TLS in front:
   - **You have a domain:** uncomment the site block in `Caddyfile`, point DNS at the box.
   - **You do not:** install `cloudflared` on the box (the setup script prints the commands). The
     `*.trycloudflare.com` URL is what phones use. The laptop can close.
4. Write both URLs on `TABLE-CARD.md` and print it. If the box dies, the laptop tunnel is thirty
   seconds away (`cloudflared tunnel --url http://localhost:8080` from the repo root).

Done when you can close the laptop, walk to another room, and a phone on cellular is still playing.

## Stats (P1-4)

Every finished round appends to `data/stats.json` and is exposed at `GET /stats`:

```json
{ "rounds": 41, "people": 12, "bestReactionMs": 187 }
```

The room-screen ticker reads that payload. The last beat of the pitch should be that number,
measured on the floor.

MongoDB Atlas (also an MLH prize) is optional and honest — it stores the same documents the
product already uses. Set:

```
STATS_WEBHOOK_URL=https://data.mongodb-api.com/app/<app>/endpoint/data/v1/action/insertOne
STATS_WEBHOOK_KEY=<atlas data API key>
```

and each round POSTs JSON. No extra npm dependency; the engine stays on `ws` alone.

## Acoustic seating (P2-2)

Not in this PR. It needs a microphone on the phone client (`public/index.html`, Lane 2) and must
never block the demo — manual seats stay as the fallback. When it lands, the room screen already
draws players at `seat` angles, so the discovered ring just appears.

## File ownership

Lane 3 owns `public/room?key=<ROOM_KEY>.html` and `deploy/`. `modes.js` and `public/index.html` are not ours.
`server.js` only gained spectator ping/pong, `/room?key=<ROOM_KEY>`, `/stats`, and a finish-hook for the ticker —
without those the director view cannot sync clocks or survive a reload.


> The room screen needs the room key. The server prints it at startup; pin it across
> restarts with `HUDDLE_ROOM_KEY=...`. Without it the full-truth feed is refused, which is what
> stops a player opening the director view on their own phone and seeing who holds the bomb.
