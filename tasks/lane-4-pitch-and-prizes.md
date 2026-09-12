# Lane 4 — Pitch, prizes, submission

**You own:** `PITCH.md`, `README.md`, `docs/`, the Google Form, the video, every conversation with
an organiser.
**You never touch:** code.

This is not the leftover lane. Three people are building something that gets three minutes in front
of a judge, and this lane owns those three minutes.

---

## 4.1 — The script (P0, ~1 h, then rehearse)

The evidence on hackathon judging is unanimous: **letting judges use the thing beats pitching it.**
Phones in hands inside twenty seconds.

| Time | Beat |
|---|---|
| 0:00 | "Everyone take out your phone and scan this." Hand over the loaner phones already joined |
| 0:20 | **Flash.** Every phone lights up on the same millisecond. Reaction times land on the room screen |
| 0:50 | **Blindside.** They go blind, the room screen does not, they laugh |
| 1:50 | "Spaceteam did private per-phone state in 2012. DUAL put a bullet across two phones in 2014. What nobody has done is make the target of your input **a person, at the angle they are actually sitting**." Show the seats being placed |
| 2:10 | Engineering: per-player views, authoritative server, median clock offset, a phone that drops mid-round and the game carries on |
| 2:30 | The number from the floor: people played, rounds run |
| 2:50 | "One link. No install. On whatever is already in your pocket." |

**Name the prior art yourself, unprompted.** Spaceteam, Jackbox, Chrome Racer, DUAL — and there is an
itch.io game published days ago describing a bullet vanishing "into the dead zone between screens"
in nearly our words. If a judge finds that after your pitch, you look ignorant. If you say it first,
you look like you did your homework, and the delta you claim afterwards is believed.

Rehearse **three times against a timer** and land under 3:00. Run the identical script in all three
judging rooms.

---

## 4.2 — Loaner phones and the run of show (P0, ~30 min)

- Two or three spare phones, **already joined**, face-down on the table, named JUDGE 1 / JUDGE 2 /
  JUDGE 3. Handed over connected, so joining costs zero seconds.
- **Never demo with fewer than four phones.** Recruit a bystander if a judging room is thin. The
  minimum player count is a hard gate, and a three-player Blindside is a bad game.
- QR on the table, large, printed on paper as well as on the room screen. Paper survives a dead
  laptop.
- Know who does what: one person runs the phones and the room screen, one talks. Never both.

---

## 4.3 — The MLH conversation, 10:00 AM (P1)

HackCMU is a confirmed MLH member event, but the event site publishes **no** MLH prize list. Find
the rep and ask, in these words:

1. Which MLH categories are live at HackCMU 2026?
2. Submission here is a Google Form with no MLH field — where do we opt in?
3. Is a demo video required for MLH categories, and how long?
4. Our repo is public and everything was built during the event — is anything else needed?
5. Is the Cursor prize announced at opening real? It is not on the site.

We are chasing **Vultr** (the server genuinely runs there), **MongoDB Atlas** (real stats the
product uses) and **ElevenLabs** (the announcer). We are deliberately skipping Auth0 and Solana —
login friction kills walk-up play and a token would read as prize-chasing on the exact rubric line
that punishes bolt-ons. If asked, say that out loud; it is a taste signal.

---

## 4.4 — Playtest on strangers, 11:00 AM (P0, the most valuable hour of the weekend)

Pull four people who are not on this team into a game. Then **say nothing** and write down:

- Every moment someone hesitates.
- Every question they ask out loud.
- Every time someone looks at their phone when they should be looking at a person.
- How long from "here, take this" to "they are laughing".

That list is the only reliable guide to what to fix before freeze at 1:00 PM. Bring it to the team
at 12:30 and defend it. Everything not on the list is somebody's opinion.

---

## 4.5 — Submission (P0, due 3:30 PM, do not slip)

- **Open the Google Form at 8 AM and screenshot every question.** If it wants something we have not
  made — a video, a specific link, team member Andrew IDs — we need to know at 8, not at 3:45.
- Track: **Multiplayer**. Write the track justification around the blurb's own words: meeting people
  and touching grass. Ours is the only submission that does not work unless the players are in the
  same room.
- Repo stays **public** through and after the event — hard MLH eligibility condition.
- **Record the backup video at 2:00 PM**, 60 seconds, filmed on a phone: four phones on a table,
  one round of Blindside, one round of Flash, the room screen visible. If the network dies during
  judging, this is the demo.
- Submit at **3:30**. Not 3:59.

---

## 4.6 — README and screenshots (P1)

The repo is public and a judge may open it. It should explain the engine in thirty seconds and show
the room screen in one image. Keep the "adding a game is forty lines" snippet near the top — that is
the whole pitch, in code.
