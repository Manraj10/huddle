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
    const a = screen.orientation?.angle;
    return typeof a === "number" ? a : (typeof orientation === "number" ? orientation : 0);
  };

  function onEvent(e) {
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

  handle.recalibrate = () => { have = false; sx = sy = null; lastSent = null; };
  handle.stop = () => { clearInterval(timer); removeEventListener("deviceorientation", onEvent); };
  return handle;
}

const round3 = (n) => Math.round(n * 1000) / 1000;
