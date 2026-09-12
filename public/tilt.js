// The gyroscope, as a module, because the fiddly part is arithmetic and arithmetic can be tested
// without a phone. Nobody on this team can run a unit test on an iPhone at 2am; everybody can run
// one on the maths that decides whether the iPhone feels right.
//
// `deviceorientation` gives beta (front-back, -180..180) and gamma (left-right, -90..90). It fires
// at about 60Hz on a real handset — this team measured 58.8Hz, so ignore old posts claiming 1Hz.
//
// Three things make tilt feel like a hand on the object rather than a bug:
//   1. CALIBRATION. Whatever you were holding when the round started is neutral. Without this,
//      half a room is fighting an offset and concludes the game is broken. Flat on a table and
//      held at your chest are both legitimate and they are 60 degrees apart.
//   2. A DEAD ZONE. A few degrees of nothing around neutral, or the ship jitters forever and no
//      one can hold still. Rescaled after the cut so the live range still reaches 1.0 — a bare
//      subtraction leaves the stick unable to travel its full throw.
//   3. SCREEN ROTATION. beta and gamma swap meaning when the phone turns. This is the classic
//      silent gyro bug: it works perfectly in portrait and is transposed in landscape, and it
//      looks like drift rather than like axes.

/** Wrap to (-180, 180]. Calibrating near ±180 otherwise produces a 359-degree "small" tilt. */
export function wrapDeg(d) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

/**
 * Raw beta/gamma into a stick vector in [-1,1], relative to `neutral`.
 * `range` is the tilt in degrees that reaches full deflection; `dead` is the degrees ignored
 * around neutral. x is left/right, y is forward/back, screen-relative.
 */
export function stick(beta, gamma, neutral = { beta: 0, gamma: 0 }, angle = 0, opts = {}) {
  const range = opts.range ?? 28;
  const dead = opts.dead ?? 3;
  const db = wrapDeg(beta - neutral.beta);
  const dg = wrapDeg(gamma - neutral.gamma);

  // Screen-relative axes. At 0 the phone is upright: gamma is across, beta is up the screen.
  // At 90 the phone has been turned onto its side and the two have traded places.
  const a = ((angle % 360) + 360) % 360;
  let x, y;
  if (a === 90) { x = db; y = -dg; }
  else if (a === 180) { x = -dg; y = -db; }
  else if (a === 270) { x = -db; y = dg; }
  else { x = dg; y = db; }

  return { x: axis(x, dead, range), y: axis(y, dead, range) };
}

/** One axis: cut the dead zone out, then rescale so the remaining throw still reaches 1. */
function axis(deg, dead, range) {
  const mag = Math.abs(deg);
  if (mag <= dead) return 0;
  const span = Math.max(1e-6, range - dead);
  return Math.sign(deg) * Math.min(1, (mag - dead) / span);
}

/**
 * A first-order low pass. Sensor noise reads as a shiver on a ship that should be still, and a
 * raw feed looks cheap next to a smoothed one. `tau` is the time constant in ms; framed off real
 * elapsed time so a phone delivering 30Hz feels the same as one delivering 60Hz.
 */
export function smooth(prev, next, dtMs, tau = 70) {
  if (prev == null) return next;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tau));
  return prev + (next - prev) * k;
}

/** True when the stick moved enough to be worth a packet. Keeps N phones off the wire at rest. */
export function worthSending(last, now, epsilon = 0.02) {
  if (!last) return true;
  return Math.abs(last.x - now.x) >= epsilon || Math.abs(last.y - now.y) >= epsilon;
}

/**
 * iOS requires DeviceOrientationEvent.requestPermission() from a real user gesture over HTTPS.
 * Android needs no permission and still needs HTTPS. Over plain http a phone silently delivers no
 * events at all, which looks exactly like a bug in our code, so that case is reported as its own
 * reason rather than as a denial.
 *
 * Returns "granted" | "denied" | "unsupported" | "insecure".
 */
export async function askForTilt() {
  if (typeof DeviceOrientationEvent === "undefined") return "unsupported";
  if (!globalThis.isSecureContext) return "insecure";
  const req = DeviceOrientationEvent.requestPermission;
  if (typeof req !== "function") return "granted";          // Android, and desktop Safari
  try { return (await req()) === "granted" ? "granted" : "denied"; }
  catch { return "denied"; }
}

/**
 * Attach the sensor and drive `onStick(x, y)` at up to `hz`. Returns a handle with
 * `recalibrate()`, `stop()`, and a `live` flag that stays false until real events arrive — a
 * phone that grants permission and then delivers nothing is indistinguishable from one that
 * refused, unless someone checks.
 */
export function attachTilt({ onStick, hz = 30, range = 28, dead = 3, tau = 70 } = {}) {
  const minGap = 1000 / hz;
  const neutral = { beta: 0, gamma: 0 };
  let have = false, sx = null, sy = null, lastAt = 0, lastSent = null, pending = null;
  const handle = { live: false, reason: null };

  const screenAngle = () => {
    // globalThis, not a bare `screen`: a page that happens to declare its own `screen`
    // shadows the global one and this silently reads a string's .orientation instead.
    const a = globalThis.screen?.orientation?.angle;
    return typeof a === "number" ? a : (typeof globalThis.orientation === "number" ? globalThis.orientation : 0);
  };

  let alpha = null;
  function onEvent(e) {
    // alpha arrives on phones that give nothing else useful, and aiming only needs alpha, so it
    // is taken before the beta/gamma guard rather than after it.
    if (e.alpha != null) alpha = e.alpha;
    if (e.beta == null || e.gamma == null) return;
    handle.live = true;
    if (!have) { neutral.beta = e.beta; neutral.gamma = e.gamma; have = true; }
    pending = e;
  }

  function frame() {
    if (!pending) return;
    const now = Date.now();
    const dt = lastAt ? now - lastAt : minGap;
    if (dt < minGap) return;
    lastAt = now;
    const raw = stick(pending.beta, pending.gamma, neutral, screenAngle(), { range, dead });
    sx = smooth(sx, raw.x, dt, tau);
    sy = smooth(sy, raw.y, dt, tau);
    const v = { x: round3(sx), y: round3(sy) };
    if (!worthSending(lastSent, v)) return;
    lastSent = v;
    onStick(v.x, v.y);
  }

  const timer = setInterval(frame, minGap / 2);
  addEventListener("deviceorientation", onEvent);

  /** Where the VIEWPORT is pointing, or null if this phone has no yaw to give. Aiming reads deltas
   *  of this, never the value, so it never needs to mean north. */
  handle.yaw = () => (alpha == null ? null : viewportYaw(alpha, screenAngle()));
  handle.recalibrate = () => { have = false; sx = sy = null; lastSent = null; };
  handle.stop = () => { clearInterval(timer); removeEventListener("deviceorientation", onEvent); };
  return handle;
}

const round3 = (n) => Math.round(n * 1000) / 1000;

// ---- aiming at a human ------------------------------------------------------
// The seat ring and a swipe are both measured in the phone's own screen frame, and that is only
// the same frame the room is in for as long as the phone keeps the yaw it was seated at. Turn the
// phone ninety degrees on the table and every throw silently goes to the wrong person — the claim
// this whole project rests on, quietly false, with nothing on screen to say so.
//
// The fix is to measure the swipe against the world instead. We do NOT need a compass for this,
// which is the whole trick: absolute heading means webkitCompassHeading on iOS and plain alpha on
// Android, it drifts, it needs a figure-of-eight calibration, and a laptop or a metal table leg
// bends it. We only need how far the phone has TURNED since you placed your seat, and a relative
// yaw is the one thing alpha reports the same way on both platforms.
//
// Derivation, because the sign is the whole game and it is easy to get backwards:
//   Phone flat, top pointing north. Someone due east is at screen angle 0 (screen +x is east,
//   and screen y runs DOWN, which is why the ring uses atan2(dy, dx) at all).
//   Now turn the phone a quarter turn anticlockwise seen from above — alpha increases by 90 by
//   spec. The top now points west, so screen +x points north and screen +y points east. That
//   same person due east now reads at atan2(1, 0) = +pi/2.
//   So a fixed direction in the room gains screen angle as alpha gains: screen = world + dAlpha,
//   and therefore world = screen - dAlpha.

/** Yaw of the VIEWPORT, not the device. A phone the browser re-orients has not turned relative to
 *  the room at all: alpha moves one way, screen.orientation.angle moves the other, and the two
 *  cancel here so a player who rotates into landscape mid-round does not lose their aim. */
export const viewportYaw = (alpha, screenAngle = 0) => wrapDeg((alpha || 0) + (screenAngle || 0));

/**
 * A swipe in screen space, re-expressed in the frame the player was sitting in when they placed
 * their seat. `yawNow`/`yawRef` are viewportYaw values in degrees. Returns radians, wrapped, so
 * it drops straight into ctx.towards().
 */
export function aimAngle(screenAngle, yawNow, yawRef, invert = false) {
  // `invert` exists because there are TWO ways this can be wrong at a table and they need two
  // different fixes.
  //
  // A PHASE error — every aim lands on the person opposite the one you are pointing at — is a
  // constant, and HUDDLE_AIM_OFFSET_DEG=180 cures it.
  //
  // A HANDEDNESS error is not. If the sense of the turn is backwards, pointing left hits the
  // person on your right, and the error is 2*theta from centre rather than constant — no single
  // offset can correct it, and at the table it reads as "the offset is slightly off", so you can
  // burn twenty minutes turning a dial that was never going to converge. This flips the sense.
  //
  // The sign of the alpha term is solid: the DeviceOrientation frame is right-handed with +z out
  // of the screen, so alpha increases anticlockwise seen from above, which is what the derivation
  // above assumes. The uncertain one is screen.orientation.angle's sign RELATIVE to alpha, and
  // the two only disagree when somebody plays in landscape.
  const turned = wrapDeg(yawNow - yawRef) * Math.PI / 180 * (invert ? -1 : 1);
  const a = screenAngle - turned;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Should this aim go on the wire now?
 *
 * Two jobs at once, and getting only the first one right is how a game breaks. A phone that is
 * TURNING should stream, so the name under your thumb keeps up with your body. A phone that is
 * HELD STILL must still speak, because the server ages aims out and a stale aim blocks nothing —
 * so the player who turns to face the person who threw it and then holds the phone dead steady,
 * which is exactly the right thing to do, would otherwise go silent, age out, and lose.
 *
 * `sinceMs` is the time since the last message actually sent.
 */
export function aimDue(last, angle, sinceMs, { minGap = 50, beat = 250, epsilon = 0.02 } = {}) {
  if (sinceMs < minGap) return false;                  // never faster than this, however fast you turn
  if (last == null) return true;
  const moved = Math.abs(Math.atan2(Math.sin(angle - last), Math.cos(angle - last)));
  return moved >= epsilon || sinceMs >= beat;
}
