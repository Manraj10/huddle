# Table card — print this, put it on the table

Phones need a **public HTTPS** URL (secure context: wake lock, audio, later the mic).
The room screen is `/room` on the same host.

```
JOIN     ________________________________
         (Vultr / box tunnel — phones use this)

ROOM     ________________________________/room
         (same host, laptop browser, ?spectate)

FALLBACK ________________________________
         (laptop `cloudflared tunnel --url http://localhost:8080`)
```

If the box dies: start the fallback, rewrite JOIN in 30 seconds, keep playing.
Never demo with only the laptop tunnel as the primary — one blip drops every phone at once.
