// Round ledger for the room-screen ticker and the last beat of the pitch.
//
// Two sinks. The JSON file is always written and is what the ticker reads, so the room screen
// works with no cloud account and no network. MongoDB Atlas is written too when MONGODB_URI is
// set, and that is the copy that survives the laptop.
//
// It uses the official driver rather than an HTTP call because the Atlas Data API and the custom
// HTTPS endpoints were removed on 30 September 2025 — any tutorial telling you to POST JSON at
// Atlas is writing into a hole. Server-side only: nothing here reaches a phone.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Loaded lazily so a machine with no MONGODB_URI never pays for the driver.
let collection = null, mongoTried = false, mongoErr = null;
async function mongo() {
  if (mongoTried) return collection;
  mongoTried = true;
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    collection = client.db(process.env.MONGODB_DB || "huddle").collection(process.env.MONGODB_COLLECTION || "rounds");
    console.log("stats: writing rounds to MongoDB Atlas");
  } catch (err) {
    mongoErr = err.message;
    console.error("stats: Atlas unavailable, file only —", err.message);
  }
  return collection;
}

/** For the pitch: is the Atlas copy actually live right now, or are we file-only? */
export function sinks() {
  return { file: true, atlas: !!collection, atlasError: mongoErr };
}

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

  const col = await mongo();
  if (col) {
    // Never let a slow cloud write stall a round. The file already has it.
    col.insertOne({ ...entry, at: new Date(entry.at) }).catch((err) => console.error("atlas insert failed", err.message));
  }

  const hook = process.env.STATS_WEBHOOK_URL;
  if (!hook) return;
  const headers = { "content-type": "application/json" };
  if (process.env.STATS_WEBHOOK_KEY) headers.apiKey = process.env.STATS_WEBHOOK_KEY;
  await fetch(hook, { method: "POST", headers, body: JSON.stringify(entry) }).catch((err) => {
    console.error("stats webhook failed", err.message);
  });
}
