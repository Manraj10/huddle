// The room-screen announcer. ElevenLabs text-to-speech, cached on disk by hash.
//
// Cached because an expo runs hundreds of rounds and most lines repeat ("ALFA is out"), so the
// second time a name is called it costs nothing and plays instantly. Without ELEVENLABS_API_KEY
// this module answers 404 and the room screen simply stays quiet — the game never depends on it.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "data", "say");
const VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const MODEL = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";
const inflight = new Map();

export const enabled = () => !!process.env.ELEVENLABS_API_KEY;

/** MP3 bytes for a line, from cache when we have heard it before. Null when speech is off. */
export async function speak(text) {
  const line = String(text || "").trim().slice(0, 120);
  if (!line || !enabled()) return null;

  const key = createHash("sha1").update(`${VOICE}:${MODEL}:${line}`).digest("hex").slice(0, 16);
  const file = join(DIR, `${key}.mp3`);
  try { return await readFile(file); } catch {}

  // Two eliminations in the same second must not become two API calls.
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: line, model_id: MODEL, voice_settings: { stability: 0.4, similarity_boost: 0.8 } }),
    });
    if (!res.ok) throw new Error(`elevenlabs ${res.status} ${(await res.text()).slice(0, 120)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(DIR, { recursive: true });
    await writeFile(file, buf);
    return buf;
  })().catch((err) => { console.error("say failed:", err.message); return null; })
    .finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}
