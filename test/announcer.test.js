// The commentator must be invisible when it is switched off.
//
// It is an optional flourish on the room screen and it sits next to a live demo, so the property
// that matters is not what it says — it is that with no key configured there is NO code path, no
// network call, and no difference to anything. A feature that degrades loudly is worse than one
// that does not exist.
import test from "node:test";
import assert from "node:assert/strict";

const load = async () => {
  const m = await import("../deploy/announcer.js?t=" + Math.random());
  return m;
};

test("with no key configured the announcer is off and calls nothing", async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  const a = await load();
  assert.equal(a.enabled(), false);

  // fetch must never be reached. If it is, this fails loudly rather than silently hitting a network.
  const realFetch = globalThis.fetch;
  let touched = false;
  globalThis.fetch = () => { touched = true; throw new Error("announcer reached the network with no key"); };
  try {
    let got = null;
    a.call({ mode: "duel", names: ["ALFA"], winner: "ALFA" }, (line) => { got = line; });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(touched, false, "no network call");
    assert.equal(got, null, "and nothing was announced");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a key switches it on without changing anything else", async () => {
  process.env.GEMINI_API_KEY = "test-key-not-real";
  const a = await load();
  assert.equal(a.enabled(), true);
  delete process.env.GEMINI_API_KEY;
});
