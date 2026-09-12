# Prize strategy

## Core framing

Huddle is deliberately not a product with a login flow, a wallet, or a token-based economy. The more friction we add, the less it feels like a walk-up room game. We are aiming for prize paths that reward the product as it is actually experienced: social, physical, and immediate.

Priority awards:

- Multiplayer track
- People's Favourite
- Best Design
- MLH Vultr
- MLH MongoDB Atlas
- MLH ElevenLabs

## Why these fit

- Multiplayer: the game only works when players are physically in the same room
- People's Favourite: the room-level energy is obvious within seconds and the audience feels the reaction immediately
- Best Design: the phone interface and room screen are designed to be legible from across a table, without reading tiny text
- Vultr: the game server genuinely runs there. WebSockets need a real box, so this one is earned.
- MongoDB Atlas: WIRED, needs a key. `deploy/stats.js` writes every finished round to Atlas when
  `MONGODB_URI` is set, using the official driver imported lazily — the Atlas Data API and the
  custom HTTPS endpoints were removed on 30 September 2025, so any fetch-based tutorial writes into
  a hole. The JSON file is still written and is what the room ticker reads, so no key means no cloud
  and no breakage. Create a free cluster, set the env var, play one round, show the document.
- ElevenLabs: WIRED, needs a key. The room screen speaks each round's result through `/say`, cached
  on disk by line so a repeated name is instant and free. No `ELEVENLABS_API_KEY` means a 404 and
  silence; the game never depends on it. Phones stay quiet — only the room screen talks.

## Why the product is not a startup gimmick

The strongest version of Huddle does not ask the player to create an account, connect a wallet, or learn a new identity layer. It asks them to look up from their phone, laugh, point, and react. That is the difference between a fun demo and a real social product.

## What we intentionally do not chase

- Auth0: login friction kills walk-up play
- Solana: a token reads as a bolt-on and distracts from the reason the game feels good

The judges should leave the room feeling that Huddle is a social experience built around shared attention, not a product trying to impress a rubric with unrelated infrastructure.
