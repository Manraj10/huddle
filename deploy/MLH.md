# MLH integrations — what is wired and what each key unlocks

Every one of these is **off by default and silent without a key**. That is deliberate: nothing in
the demo can fail because a cloud service is slow or a credit ran out.

| Prize | Env var | What happens with it | Without it |
|---|---|---|---|
| **Vultr** | — | The game server runs on the box (`deploy/setup.sh`, systemd, Caddy) | Laptop + tunnel |
| **MongoDB Atlas** | `MONGODB_URI` | Every finished round is inserted into `huddle.rounds` | JSON file only |
| **ElevenLabs** | `ELEVENLABS_API_KEY` | The room screen speaks each result | `/say` 404s, silence |
| **Gemini / Grok** | `GEMINI_API_KEY` or `XAI_API_KEY` | Commentary line written per round, spoken by the above | No line |

Optional: `MONGODB_DB` (default `huddle`), `MONGODB_COLLECTION` (default `rounds`),
`ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `HUDDLE_ROOM_KEY` (pins the room-screen key).

## Setting it up in the morning, in about fifteen minutes

```bash
# Atlas: free M0 cluster, "Connect" -> drivers -> copy the SRV string
export MONGODB_URI='mongodb+srv://user:pass@cluster.xxxx.mongodb.net/?retryWrites=true'
# ElevenLabs: free tier key from the profile menu
export ELEVENLABS_API_KEY='...'
npm start
```

The server prints `stats: writing rounds to MongoDB Atlas` when the cluster is reachable, and
`stats: Atlas unavailable, file only — <reason>` when it is not. Play one round and confirm a
document lands in the collection. Then click the room screen once — browsers block audio until a
page has been clicked, and that click is what unlocks the voice for the night.

## Why the driver and not an HTTP call

MongoDB removed the Atlas Data API and custom HTTPS endpoints on **30 September 2025**. Any guide
telling you to POST JSON at Atlas is writing into a hole. The driver is imported lazily inside
`deploy/stats.js` and only when `MONGODB_URI` is set, so a machine without the variable never loads
it and nothing reaches a player's browser — the phone still downloads one HTML file with no
framework and no build step, which is the claim the pitch actually makes.

## What to say to the MLH rep

Ask which categories are live at this event before writing anything else — the site lists none, and
the roster rotates per event. If Auth0 or Solana come up: we skipped them on purpose. Login friction
kills walk-up play and a token would read as prize-chasing on the exact rubric line that punishes
bolt-ons. That is a taste signal worth saying out loud.
