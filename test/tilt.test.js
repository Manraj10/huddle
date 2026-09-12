// The gyroscope maths, without a gyroscope.
//
// Nobody can run a test on a phone at the table, so every decision the sensor layer makes that
// could feel wrong in the hand is made by a pure function and asserted here instead: calibration,
// the dead zone, the rescale after it, the wrap at ±180, and the axis swap that happens when the
// phone is turned on its side. That last one is the classic silent gyro bug — it works in
// portrait, it is transposed in landscape, and it reads as drift rather than as axes.
import test from "node:test";
import assert from "node:assert/strict";

import { aimAngle, aimDue, smooth, stick, viewportYaw, worthSending, wrapDeg } from "../public/tilt.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const deg2rad = (d) => d * Math.PI / 180;

test("angles wrap to (-180, 180]", () => {
  near(wrapDeg(0), 0);
  near(wrapDeg(190), -170);
  near(wrapDeg(-190), 170);
  near(wrapDeg(540), 180);
  // The reason this exists: calibrating while holding the phone near upside-down puts neutral at
  // 179 and a tiny real tilt at -179. Subtracting gives 358, which is full deflection from a
  // movement of two degrees.
  near(wrapDeg(-179 - 179), 2);
});

test("holding still where you calibrated is dead centre", () => {
  const v = stick(37, -12, { beta: 37, gamma: -12 });
  assert.deepEqual(v, { x: 0, y: 0 });
});

test("you can calibrate flat on a table or up at your chest and both are neutral", () => {
  const flat = stick(4, 0, { beta: 4, gamma: 0 });
  const chest = stick(62, 0, { beta: 62, gamma: 0 });
  assert.deepEqual(flat, chest);
  // And the same real tilt from either produces the same stick.
  near(stick(14, 0, { beta: 4, gamma: 0 }).y, stick(72, 0, { beta: 62, gamma: 0 }).y);
});

test("the dead zone eats the shivers and nothing more", () => {
  const n = { beta: 0, gamma: 0 };
  assert.equal(stick(2.9, 0, n, 0, { dead: 3, range: 28 }).y, 0);
  assert.ok(stick(3.6, 0, n, 0, { dead: 3, range: 28 }).y > 0);
});

test("full tilt still reaches full throw after the dead zone is cut out", () => {
  // A bare subtraction leaves the stick topping out below 1, so the ship can never reach its
  // real speed and the game feels sluggish for a reason nobody can name.
  near(stick(28, 0, { beta: 0, gamma: 0 }, 0, { dead: 3, range: 28 }).y, 1);
  near(stick(-28, 0, { beta: 0, gamma: 0 }, 0, { dead: 3, range: 28 }).y, -1);
});

test("past full tilt clamps instead of running away", () => {
  near(stick(90, 0, { beta: 0, gamma: 0 }).y, 1);
  near(stick(0, -80, { beta: 0, gamma: 0 }).x, -1);
});

test("turning the phone on its side swaps the axes, it does not drift", () => {
  const n = { beta: 0, gamma: 0 };
  // Upright: leaning the phone away from you drives the stick down the screen.
  const portrait = stick(20, 0, n, 0);
  assert.ok(portrait.y > 0 && portrait.x === 0);

  // Rotated 90°: that same physical lean is now across the screen, and by the same amount.
  const landscape = stick(20, 0, n, 90);
  near(landscape.x, portrait.y);
  assert.equal(landscape.y, 0);

  // 270° is the other landscape, and it is the mirror of 90°.
  const other = stick(20, 0, n, 270);
  near(other.x, -portrait.y);

  // 180° inverts both.
  const upside = stick(20, 7, n, 180);
  const up = stick(20, 7, n, 0);
  near(upside.x, -up.x);
  near(upside.y, -up.y);
});

test("every screen rotation preserves the magnitude of the tilt", () => {
  const n = { beta: 0, gamma: 0 };
  const mag = (v) => Math.hypot(v.x, v.y);
  const base = mag(stick(17, -9, n, 0));
  for (const a of [90, 180, 270, 360, -90]) near(mag(stick(17, -9, n, a)), base, 1e-9);
});

test("smoothing converges and never overshoots", () => {
  let v = 0;
  for (let i = 0; i < 200; i++) v = smooth(v, 1, 16, 70);
  assert.ok(v > 0.99 && v <= 1, `settled at ${v}`);
  // One frame of a 60Hz feed moves part of the way, not all of it — that is the whole point.
  assert.ok(smooth(0, 1, 16, 70) < 0.3);
  // A phone delivering half the frame rate covers the same ground per unit of TIME, not per frame.
  near(smooth(0, 1, 32, 70), 1 - Math.pow(1 - smooth(0, 1, 16, 70), 2), 1e-9);
});

test("a phone at rest stops putting packets on the wire", () => {
  const at = { x: 0.4, y: -0.2 };
  assert.equal(worthSending(at, { x: 0.405, y: -0.2 }), false);
  assert.equal(worthSending(at, { x: 0.44, y: -0.2 }), true);
  assert.equal(worthSending(null, at), true, "the first reading always goes");
});

// ---- aiming at a human, not at a direction on a screen -----------------------

test("a swipe means the same person after the phone has been turned", () => {
  // Seated with the phone's top pointing north, a teammate due east reads at screen angle 0.
  const ref = viewportYaw(0, 0);
  near(aimAngle(0, ref, ref), 0);

  // Quarter turn anticlockwise: alpha gains 90 by spec, and that same teammate now falls under a
  // swipe toward the BOTTOM of the screen. Both have to resolve to the same person.
  const turned = viewportYaw(90, 0);
  near(aimAngle(Math.PI / 2, turned, ref), 0);

  // And the reverse turn, the other way round.
  near(aimAngle(-Math.PI / 2, viewportYaw(-90, 0), ref), 0);
});

test("turning the phone right round comes back to the same person", () => {
  const ref = viewportYaw(10, 0);
  for (const alpha of [10, 100, 190, 280, 370]) {
    const world = aimAngle(deg2rad(alpha - 10), viewportYaw(alpha, 0), ref);
    near(world, 0, 1e-9);
  }
});

test("aim survives the wrap at 360 the way a phone actually crosses it", () => {
  // A player seated at alpha 350 who turns twenty degrees is at alpha 10, not at alpha 370.
  // Subtracting raw gives -340 and sends the bomb most of the way round the table.
  const ref = viewportYaw(350, 0);
  const now = viewportYaw(10, 0);
  near(aimAngle(deg2rad(20), now, ref), 0, 1e-9);
});

test("the browser re-orienting the viewport is not the player turning", () => {
  // Someone rotates the phone into landscape. The device yaw changes and the browser rotates the
  // content back, so nothing has moved relative to the room and the aim must not shift.
  // alpha falls by 90 for a clockwise turn; screen.orientation.angle rises by 90 to compensate.
  const seated = viewportYaw(200, 0);
  const landscape = viewportYaw(110, 90);
  assert.equal(seated, landscape, "the two cancel, which is the point");
  near(aimAngle(0.7, landscape, seated), 0.7);
});

test("aim always comes back wrapped, so it can go straight into seat geometry", () => {
  for (const [screen, alpha] of [[3.0, 200], [-3.0, 20], [0.2, 359], [Math.PI, 45]]) {
    const a = aimAngle(screen, viewportYaw(alpha, 0), viewportYaw(0, 0));
    assert.ok(a > -Math.PI - 1e-9 && a <= Math.PI + 1e-9, `${a} out of range`);
  }
});

test("an aim keeps beating while the phone is held perfectly still", () => {
  // The losing version of this only sent on movement. Facing the thrower and holding steady is
  // the correct play in Standoff, and it made the player go silent: the server ages aims out
  // after HUDDLE_AIM_STALE_MS, a stale aim blocks nothing, and the block was lost by doing the
  // right thing.
  const held = 1.0;
  assert.equal(aimDue(held, held, 40), false, "not faster than the rate limit");
  assert.equal(aimDue(held, held, 120), false, "still holding, not due yet");
  assert.equal(aimDue(held, held, 260), true, "held still, and now overdue — send it");
  // Comfortably inside a 1500ms stale window even if a couple of beats are dropped.
  assert.ok(260 * 4 < 1500);
});

test("a turning phone streams rather than waiting for the beat", () => {
  assert.equal(aimDue(1.0, 1.5, 60), true, "moved plenty");
  assert.equal(aimDue(1.0, 1.005, 60), false, "that is sensor noise, not a turn");
  assert.equal(aimDue(null, 1.0, 60), true, "the first aim always goes");
});

test("aim due-ness wraps at the top of the circle", () => {
  // Turning through north is a tiny movement and a huge subtraction.
  const near = Math.PI - 0.005;
  assert.equal(aimDue(near, -near, 60), false, "0.01 radians across the wrap is not a turn");
  assert.equal(aimDue(near, -near, 300), true, "but the heartbeat still fires");
});

test("the invert hatch fixes the bug the offset cannot", () => {
  // Two different failures look similar at a table and only one has a cure in the offset.
  //
  // PHASE: every aim lands on the person OPPOSITE the one you are pointing at. Constant error,
  // HUDDLE_AIM_OFFSET_DEG=180 fixes it.
  //
  // HANDEDNESS: the aim sweeps the wrong way round the ring — point left, hit right. The error is
  // 2*theta from centre, so no single offset converges on it. That is what this flips.
  const ref = viewportYaw(0, 0);
  const turn = (deg) => viewportYaw(deg, 0);

  // Turning 30 degrees one way should move the aim one way; inverted, the other.
  const normal = aimAngle(0, turn(30), ref);
  const flipped = aimAngle(0, turn(30), ref, true);
  near(flipped, -normal, 1e-9);
  assert.notEqual(Math.sign(normal), Math.sign(flipped), "the sweep reverses");

  // The error a handedness bug produces really is 2*theta, which is why a constant cannot fix it.
  for (const deg of [10, 30, 75, 140]) {
    const gap = Math.abs(aimAngle(0, turn(deg), ref) - aimAngle(0, turn(deg), ref, true));
    near(gap, Math.abs(2 * deg * Math.PI / 180), 1e-9);
  }

  // Not turning at all is identical either way — a handedness bug is invisible until you move,
  // which is exactly why it gets misread as "the offset is a bit off".
  near(aimAngle(0.4, ref, ref, true), aimAngle(0.4, ref, ref), 1e-12);
});
