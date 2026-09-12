> **RESOLVED in 524b8e9 — do not re-fix.** The cause was not overlap: #lobby declared three grid
> rows for four children, so the fourth landed in an implicit row, and with content overflowing
> there was no free space left for the 1fr ring track. It collapsed to about 20px while the ring
> still painted ~300px tall, so everything after it laid out under the collapsed track rather than
> under the visible circle. The lobby is now four named grid areas and scrollHeight is exactly 812
> at 375x812. Kept for the record, and because the conditions-of-use section below still applies to
> any new screen.

# UI brief: the game is unreadable on a phone

Paste this whole file into a fresh session. Fix the layout first. Do not start with colour.

You own **`public/index.html`** and nothing else. Do not touch `modes.js` or `server.js` — the game
logic is fine, the problem is entirely what the player sees.

## This is not a taste problem. It is measured.

Rendered at 375×812 (iPhone-class, DPR 2), on the real running server:

```
LOBBY
  .seatpad   y =  98 → 396     the ring you MUST drag yourself onto to play
  #modes     y = 182 → 1024    starts INSIDE the seat pad, ends 212px BELOW the screen
```

The mode list is painted **on top of the seat picker** and then runs off the bottom of the phone.
The one control a player is required to use is buried under eight game cards, and the list below it
is unreachable. That is why a player says "I can't see anything" — they are not exaggerating, the
screen is broken.

```
PLAY (Standoff, mid-round)
  "SOMEONE HAS IT / point at people"  ~8px effective, jammed into the top-left quarter
  bottom ~60% of the screen           completely empty
```

Everything is in a narrow left-hand column with enormous dead space underneath. On a phone held at
arm's length in a loud room, none of it reads.

**Verify both of these yourself before changing anything**, so you know when you've fixed them:

```js
for (const s of ["#app","#lobby",".seatpad","#modes","#hero"]) {
  const e = document.querySelector(s); if (!e) { console.log(s, "MISSING"); continue; }
  const r = e.getBoundingClientRect();
  console.log(s, "y", Math.round(r.y), "→", Math.round(r.y + r.height), "w", Math.round(r.width));
}
```

**Done means:** on every screen, at 375×812, nothing overlaps anything else, nothing sits below
812px, and the main thing fills the middle of the screen.

## The conditions this is read in

Not a desktop. Not by you. The player is:

- holding the phone at arm's length, **looking at other people**, because Standoff is a game about
  pointing your phone at a human being;
- in a loud room, standing up, possibly drunk-adjacent, definitely not reading;
- someone who has never seen this before and got no instructions;
- glancing for under a second at a time.

So: **one thing per screen, enormous.** If two things compete for attention, both are ignored. Words
are a fallback, not the interface — the screen should still work with the text removed.

## Fix in this order

### 1. Layout (do this first, it is most of the problem)

- `#app` and every `.screen` fill the viewport: `position: fixed; inset: 0;` with the content
  centred by grid or flex, not stacked from the top-left.
- Use `100dvh`, never `100vh` — on iOS Safari the address bar makes `vh` too tall and pushes your
  content under the browser chrome.
- Respect the notch: `padding: env(safe-area-inset-top) env(safe-area-inset-right) ...`.
- **Nothing scrolls during play.** A player will not discover content below the fold in a game that
  lasts 20 seconds.
- The lobby needs the seat ring and the mode list to be two separate regions that cannot overlap.
  Simplest fix: the ring gets the top 60% of the screen, the game choice lives below it — and see
  the next point, because eight games is itself the problem.

### 2. The lobby is doing too much

Eight mode cards on a phone is a wall. **Standoff is the hero game.** Open on it, with its name
large and its one-line rule under it, and put the rest behind a single "other games" control that
expands. A stranger should be able to place their seat and start playing without ever reading a
list.

The instruction "Put yourself where you're actually sitting" should be the biggest text on the
lobby, because placing your seat is the mechanic the whole game rests on. The ring should be large,
the dots should be finger-sized (44px minimum touch target), and your own dot should be obviously
different from everyone else's.

### 3. Type and scale

- The hero element — the countdown, the target's name, the state word — should be roughly **a
  quarter of the screen height**. `clamp(64px, 22vw, 160px)` territory. Right now it is around 8px.
- Nothing else above about 20px except the game name.
- `font-variant-numeric: tabular-nums` on anything counting, or digits jitter and it reads as broken.
- Two faces maximum, and not Inter or Space Grotesk. A display face with actual personality for the
  hero, a neutral one for everything else.

### 4. Colour as the signal, not decoration

The whole screen is one state, full bleed:

| State | Reads as |
|---|---|
| you have it | hot, and it heats further as the fuse burns |
| someone else has it | cold, dark, clearly inert |
| aiming at a person | their name enormous, in the accent |
| hit / out | one hard cut to a dead grey |
| win | the single celebratory colour in the system |

A player across the table should read someone else's state off the colour bouncing onto their face.
Never rely on colour alone though — each state also needs a shape or a word, for colourblind players
and for anyone who glances at the wrong moment.

### 5. What Standoff actually needs on screen

This is the game we are shipping. Its screens matter more than anything else:

- **When you hold it:** the fuse, huge. And the name of **whoever you are currently pointing at**,
  huge, updating live as you turn — that is the feedback loop that makes tilt feel like a hand on an
  object rather than a message being sent somewhere. Without it the player cannot tell whether
  aiming works at all.
- **When you don't:** you still have a job — you are being aimed at by someone and you don't know
  who. Show tension, not a "?" and a wait. The fuse tone is shared across every phone; the visual
  should be too.
- **On a hit:** one frame of white, a hard cut, no easing. Bad news should feel like bad news.

## Rules you cannot break

- **Do not rename element ids without checking `render()`.** `renderLobby` hard-depends on several
  ids; rename one and `render()` throws, the lobby never paints, and the Start button ships dead.
  After any markup change, load the lobby in a browser and confirm it still paints.
- **Never send a rendered number from the server** — the client computes countdowns from
  `countdownTo` / `flashAt` against its synced clock. Do not move that logic server-side.
- **No framework, no build step, no bundler.** Plain HTML, CSS, ES modules.
- Keep the tilt fallback: a swipe aims and fires in one gesture for laptops and for phones whose
  owner denied motion access. It is not a degraded mode and must stay usable.

## How to check your work

1. Browser DevTools device mode at **375×812**, and run the measuring snippet above on every screen.
2. Then a **real phone over the HTTPS tunnel** — `http://<lan-ip>` gives you no gyroscope at all on
   iOS and everything will feel broken for a reason that is not your CSS.
3. Screenshot each screen and look at it from two metres away. If you cannot tell what state it is
   in from there, it is not done.

The bar: hand the phone to someone who has never seen it, say nothing, and watch. If they hesitate
about what to do, the screen is still wrong.
