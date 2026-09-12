// Seat geometry, shared by the server and by the phone.
//
// It lives under public/ so the browser can fetch it, and the server imports the same file rather
// than keeping a second copy. That is the whole point: the phone shows you who you are about to
// throw at while your finger is still down, and the server decides who actually catches it. If
// those two ever disagreed the preview would be a lie, and a preview that lies is worse than no
// preview — it teaches the room the wrong aim and then punishes them for learning it.
//
// Nothing secret is in here. Seat angles are already in every broadcast; these are the functions
// that turn one into a person, and they are pure arithmetic.

/** Shortest angle between two seats, wrapping correctly across 0/2π. */
export const apart = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Whoever is sitting closest to `angle`, excluding the person who swiped. */
export function nearest(list, from, angle) {
  const others = list.filter((p) => p.id !== from.id);
  if (!others.length) return null;
  let best = others[0], bestD = Infinity;
  for (const p of others) {
    const d = apart(p.seat, angle);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Two people sitting on top of each other make every swipe ambiguous. */
export const SAME_SEAT = 0.12;

/** Who has not sat down yet. Advisory only — this never stops a round. */
export function seatWaiting(present) {
  const unplaced = present.filter((p) => !p.placed);
  if (!unplaced.length) return null;
  if (unplaced.length === present.length) return "drag your seat to where you are actually sitting";
  return `${unplaced.map((p) => p.name).join(", ")} ${unplaced.length === 1 ? "has" : "have"} not sat down — starting without them`;
}

/**
 * Why a round cannot start yet, or null if it can. Pure, and recomputed on every broadcast —
 * a stored reason goes stale the instant the last person places their seat, and a lobby telling
 * four placed players to go and place themselves is how a demo dies.
 */
export function seatBlocker(present, min = 2) {
  const placed = present.filter((p) => p.placed);
  if (placed.length < min) {
    const missing = min - placed.length;
    return present.length < min
      ? null                                        // not enough phones yet; that is not a seat problem
      : `${missing} more ${missing === 1 ? "phone needs" : "phones need"} to drag a seat onto the ring`;
  }
  // Only PLACED players can block, and only by sitting on top of each other. A phone that joined
  // and wandered off sits the round out instead of holding the whole room hostage.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (apart(placed[i].seat, placed[j].seat) < SAME_SEAT) {
        return `${placed[i].name}, ${placed[j].name} are in the same place — one of you move`;
      }
    }
  }
  return null;
}
