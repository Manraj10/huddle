// Lane 3 — round ledger for the room-screen ticker and the last beat of the pitch.
// File-backed so the engine keeps its one npm dependency (`ws`). Optional STATS_WEBHOOK_URL
// can point at MongoDB Atlas Data API (or anything that accepts JSON) for the MLH prize.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "data");
const FILE = join(DIR, "stats.json");

const empty = () => ({
  rounds: 0,
  people: [],
  bestReactionMs: null,
  history: [],
});

let state = empty();
let writing = Promise.resolve();

export function ticker() {
  return {
    rounds: state.rounds,
    people: state.people.length,
    bestReactionMs: state.bestReactionMs,
  };
}

export async function load() {
  try {
    state = { ...empty(), ...JSON.parse(await readFile(FILE, "utf8")) };
    if (!Array.isArray(state.people)) state.people = [];
    if (!Array.isArray(state.history)) state.history = [];
  } catch {
    state = empty();
  }
  return ticker();
}

export function recordRound({ mode, playerCount, durationMs, winner, names = [], reactions = [] }) {
  const seen = new Set(state.people.map((n) => n.toLowerCase()));
  for (const name of names) {
    const n = String(name || "").trim();
    if (n && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      state.people.push(n);
    }
  }
  state.rounds += 1;
  for (const ms of reactions) {
    if (typeof ms !== "number" || !(ms > 0)) continue;
    if (state.bestReactionMs == null || ms < state.bestReactionMs) state.bestReactionMs = Math.round(ms);
  }
  const entry = {
    at: new Date().toISOString(),
    mode,
    playerCount,
    durationMs,
    winner: winner || null,
    bestReactionMs: reactions.filter((n) => n > 0).sort((a, b) => a - b)[0] ?? null,
  };
  state.history.push(entry);
  if (state.history.length > 500) state.history.splice(0, state.history.length - 500);
  writing = writing.then(() => persist(entry)).catch((err) => console.error("stats persist failed", err));
}

async function persist(entry) {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(state, null, 2));
  const hook = process.env.STATS_WEBHOOK_URL;
  if (!hook) return;
  const headers = { "content-type": "application/json" };
  if (process.env.STATS_WEBHOOK_KEY) headers.apiKey = process.env.STATS_WEBHOOK_KEY;
  await fetch(hook, { method: "POST", headers, body: JSON.stringify(entry) }).catch((err) => {
    console.error("stats webhook failed", err.message);
  });
}
