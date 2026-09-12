# Table card — print this, put it on the table

Phones need a **public HTTPS** URL (secure context: wake lock, audio, later the mic).
The room screen is `/room?key=<ROOM_KEY>` on the same host.

```
JOIN     ________________________________
         (Vultr / box tunnel — phones use this)

ROOM     ________________________________/room?key=<ROOM_KEY>
         (same host, laptop browser, ?spectate)

FALLBACK ________________________________
         (laptop `cloudflared tunnel --url http://localhost:8080`)
```

If the box dies: start the fallback, rewrite JOIN in 30 seconds, keep playing.
Never demo with only the laptop tunnel as the primary — one blip drops every phone at once.


> The room screen needs the room key. The server prints it at startup; pin it across
> restarts with `HUDDLE_ROOM_KEY=...`. Without it the full-truth feed is refused, which is what
> stops a player opening the director view on their own phone and seeing who holds the bomb.
