# Lane 3 — Room screen and ops

**You own:** `public/room.html`, `deploy/`, anything that keeps the demo alive.
**You never touch:** `modes.js`, `public/index.html`.

Read `tasks/00-read-this-first.md` first.

Your lane decides whether the other three lanes get seen. A demo that drops at 4:20 PM scores zero
regardless of how good the game is.

---

## 3.1 — The room screen, a.k.a. the director view (P0, ~2 h, highest value in this lane)

### Why

Research was blunt: a hidden-information game gives a judge who is not playing **nothing to look
at**. The room screen is where the audience sees the truth the players cannot — and dramatic irony
is what makes bystanders laugh, gather, and vote for us in People's Favourite.

### Do

`public/room.html`, opened on the laptop, connects with:

```js
new WebSocket(`${proto}://${location.host}?spectate`)
```

The server already sends spectators a full-truth view every broadcast, including `view.map` from
Blindside: `{holder, flight, players: [{id, name, angle}]}`.

**On screen, at all times:**

- **A big QR** of the public URL, plus the URL in plain text under it. People join from across the
  room by pointing a camera. Use `qrcode` from cdnjs; do not hand-roll it.
- **The ring**: every player drawn at their real seat angle, with names, sized for a room.
- **The truth**: where the charge is right now, the 700 ms flight arc animating between two players,
  who braced, and the fuse as a shrinking ring.
- **Eliminations** land big and stay for two seconds.
- **A ticker**: rounds played today, people who have played, best reaction time.

Render on a canvas at 60fps, interpolating between server messages so the arc is smooth.

### Done when

Someone standing behind your table, who has never played, can follow a whole round and laugh at the
right moment without touching a phone.

---

## 3.2 — Get off the quick tunnel (P0, ~1 h)

The Cloudflare quick tunnel we are on caps around 200 connections and one blip drops every phone
simultaneously. It is also tied to a laptop that has to survive being carried to three judging rooms.

### Do

1. Cheapest Vultr Ubuntu box (this is also an MLH prize — keep the receipt/screenshot).
2. `apt install nodejs npm caddy`, clone the repo, `npm ci`.
3. Run under systemd so it restarts on crash:
   ```ini
   [Service]
   ExecStart=/usr/bin/node /opt/huddle/server.js
   Environment=PORT=8080
   Restart=always
   ```
4. Caddy in front for TLS. Easiest path with no domain is a Cloudflare tunnel **from the box** (so
   the URL survives your laptop being moved). If you do own a domain, a two-line Caddyfile gets you
   a real certificate.
5. **Keep both URLs on a card at the table.** If the box dies, the laptop tunnel is thirty seconds
   away.

### Done when

You can close your laptop, walk to another room, and a phone on cellular is still playing.

---

## 3.3 — Stats that end the pitch (P1, ~1 h)

MongoDB Atlas free tier. Write one document per finished round: mode, player count, duration,
winner, and for Flash the reaction times.

Then the room screen and the final pitch beat both read from it: **"forty-one people have played
this today, three hundred and twelve rounds."** A number measured on the floor beats any claim.

Also an MLH prize. Keep the integration honest — it stores real data the product uses, which is
exactly what the prize is for.

---

## 3.4 — Phones listen to each other (P2, the swing, ~90 min)

Automatic seating, discovered by sound. **This is a self-contained track: it either produces an
ordering or it doesn't, and manual seats stay as the fallback. It must never block the demo.**

### The approach — and read this before you start

Do **not** do time-of-flight ranging. We do not need centimetres; we need **the order people are
sitting in**. Loudness gets there with none of the timing risk.

1. The server schedules each phone to emit a 300 ms chirp in turn, on the shared clock, at a
   frequency near 19 kHz (near-ultrasonic; most adults will not hear it, and an expo hall has very
   little noise up there).
2. Every other phone records with `getUserMedia`, runs an FFT, and reports the **peak energy in that
   band** during that phone's slot.
3. That gives an N×N loudness matrix. Loudness falls with distance, so the nearest neighbours are
   the loudest — build the ring by repeatedly linking each phone to its loudest unlinked neighbour.
4. Compare the result against the manual seats and show both on the room screen.

If that lands with time to spare, upgrade to round-trip timing for true distances: A chirps, B
replies after a fixed delay, A measures the round trip. Round-trip cancels the clock offset entirely
because each device measures on its own audio clock. Then classical multidimensional scaling on the
distance matrix gives real 2D positions.

### Traps

- iOS needs a user gesture and HTTPS for the microphone; the Join button is your gesture.
- Phone speakers roll off hard above 18 kHz. Test the actual band on the actual phones before
  building anything on top of it.
- Run it **once, in the lobby**, not during a round.

### Done when

Four phones in a room produce a ring order that matches reality, on the room screen, next to the
manual one.
