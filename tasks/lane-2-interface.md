# Lane 2 — Interface

**You own:** `public/index.html` (the whole thing: markup, CSS, the renderer).
**You never touch:** `modes.js`, `server.js`, `public/room.html`.

Read `tasks/00-read-this-first.md` first, especially the view protocol table — that is your API.

**Best Design is its own prize at this event and nobody will seriously contest it.** This lane is
not decoration; it is a prize with one competitor.

---

## The design problem, stated properly

The person holding this phone is **not looking at it**. They are looking at the other people in the
room, because the game is about those people. The screen is read in glances, at arm's length,
in a loud room, by someone who has never seen it before and got no instructions.

That means:

- **Colour is the primary signal, not decoration.** The whole screen is one state. A player across
  the table should be able to read someone else's state from the colour bouncing off their face.
- **One thing is enormous. Everything else is small.** If two elements compete, both are ignored.
- **Words are a fallback, not the interface.** The screen should work with the text removed.

---

## 2.1 — Design system (P0, do first, ~90 min)

### Do

Define tokens at the top of the stylesheet and use nothing outside them.

**Colour.** One palette per state, full-screen:

| State | Direction |
|---|---|
| idle / waiting | deep neutral, slightly cool, almost black but not black |
| holding the bomb | hot, and it *heats* as the fuse burns (the `hot` + `toneFrom/toneTo` fields give you the ramp) |
| braced | cool green, clearly "safe for now" |
| flash lit | near-white, full brightness, instant |
| out | desaturated grey, obviously inert |
| win | the one celebratory colour in the whole system, used exactly here |

Pick a neutral with a slight hue bias toward the accent — a pure grey reads as unconsidered.

**Type.** Two faces:
- A display face with real personality for the big number and the game name. **Not Inter, not Space
  Grotesk** — those are the defaults everyone reaches for. Consider a condensed grotesque, a
  mono with character, or something with unusual digits. Google Fonts is fine; load exactly two
  weights.
- A neutral face for everything else.
- The countdown **must** use `font-variant-numeric: tabular-nums`, or it jitters as digits change
  and looks broken.

**Scale.** The big number should be the largest thing that fits without wrapping on a small phone
(`clamp()` from about 56px to 150px). Nothing else is above 20px except the game name.

### Done when

You can screenshot six states side by side and tell them apart with the text blurred out.

---

## 2.2 — Seat picker (P0, ~45 min, blocks Lane 1's headline claim)

Lane 1 is making seats real. The lobby view will send:

```js
{ lobby: true, seatPicker: true, seats: [{id, name, angle}] }
```

Build: a circle on the lobby screen showing everyone at their angle. **Your own dot is draggable.**
Dragging it sends `{t:'seat', angle}` (angle in radians, 0 = right, increasing clockwise, matching
`Math.atan2(dy, dx)` which the swipe handler already uses).

Make it feel physical: the dot should follow the finger around the circle, snap nowhere, and the
other players' dots should move live as they place themselves.

Copy on that screen: **"Put yourself where you're actually sitting."** That instruction is the whole
mechanic; it deserves to be the biggest text on the lobby screen.

### Done when

Four windows, four dots placed to match how the windows sit on screen, and Lane 1's swipe test
reaches the right person.

---

## 2.3 — Motion (P1, ~60 min)

Motion earns its place by carrying information:

- **The pulse rate tracks the fuse.** It already pulses; make the rate a function of urgency so a
  glance tells you how much time is left without reading the number.
- **The throw needs a direction.** When you swipe, a trail or a card-flick in that direction, then
  the screen goes dark. Right now the bomb vanishes with no acknowledgement, which reads as a bug.
- **Arrival is a hit, not a fade.** When the bomb lands on you, the screen should arrive hard —
  scale punch, one frame of white, then the hot colour.
- **Elimination is a cut.** No easing. It is bad news and it should feel like it.
- Respect `prefers-reduced-motion` — replace movement with colour and weight changes.

Keep the total under four distinct animations. More reads as noise and as AI-generated design.

---

## 2.4 — Accessibility, and it is a scoring line (P1, ~30 min)

- Every state must be readable **without colour**: shape, text and layout carry it too.
- Every state must be readable **without audio**: the fuse tension must be visible, since a deaf
  player gets nothing from the rising tone. The pulse rate is doing that job — make sure it is
  strong enough to work alone.
- **Do not claim haptics as the accessibility answer.** iOS Safari has no vibration and a judge
  with an iPhone will catch it.
- One-handed: nothing important in the top corners except RESET; the swipe works anywhere.
- Test at the smallest phone size you can find, and with the browser's largest text setting.

---

## 2.5 — Join screen is the poster (P1, ~30 min)

It is the first thing a stranger sees at the expo, usually over someone's shoulder. Name, one line
of what this is, and a button. Make the one line good: it is the only marketing in the product.

Current copy is *"party games that live across everyone's phones"* — improve on it if you can.

---

## 2.6 — Arena renderer for Duel (P2, only if Lane 1 gets there)

Lane 1 will send `{kind:"arena", you:{x,y}, objects:[{x,y,r,c,kind}]}` with coordinates normalised
0–1 inside your own screen. Render on a canvas, 60fps, interpolating object positions between
server messages so it looks smooth on a slow network. Drag moves `you`, tap fires.

---

## Testing your work

Open three or four **separate browser windows** side by side, not tabs — a background tab gets
throttled and everything looks broken when it is not. Better: your own phone against the tunnel URL,
because font rendering, colour and touch all differ from desktop.

Hard-refresh after every change; the server sends `cache-control: no-store` but Safari still lies.
