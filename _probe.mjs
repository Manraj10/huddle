import { WebSocket } from "ws";
const URL_ = "ws://127.0.0.1:8137";
const t0 = Date.now();
const log = (...a) => console.log(`[t=${((Date.now()-t0)/1000).toFixed(1)}s]`, ...a);
const socks = [];
function join(name, seat) {
  return new Promise((res) => {
    const ws = new WebSocket(URL_);
    ws.on("open", () => { ws.send(JSON.stringify({t:"join", name, token:name})); ws.send(JSON.stringify({t:"seat", angle:seat})); res(ws); });
    ws.on("message", (b) => { const m = JSON.parse(b); if (m.t !== "view") return; ws.last = m; });
    socks.push(ws);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const words = () => socks.map(s => s.last?.view?.big).join("/");
const phase = () => socks[0].last?.phase;

const LOBBY_WAIT = Number(process.argv[2] || 0);
for (const [i,n] of ["A","B","C","D"].entries()) await join(n, i * Math.PI/2);
await sleep(300);
if (LOBBY_WAIT) { log("sitting in lobby", LOBBY_WAIT/1000, "s before start"); await sleep(LOBBY_WAIT); }
socks[0].send(JSON.stringify({t:"start", mode:"wiretap"}));
await sleep(500);
log("phase", phase(), "words", words(), "notice=", JSON.stringify(socks[0].last.notice), "players=", socks[0].last.players.length, "seatNotice=", JSON.stringify(socks[0].last.view?.seatNotice));
for (let i=0;i<12;i++){ await sleep(5000); log("phase", phase(), "words", words(), "notice=", JSON.stringify(socks[0].last.notice), "players=", socks[0].last.players.length, "seatNotice=", JSON.stringify(socks[0].last.view?.seatNotice)); }
process.exit(0);
