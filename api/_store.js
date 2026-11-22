// AI WIKI — 로그인 확인 · 사용자 기록 저장소(Upstash Redis REST) 공용 코드
// 파일 이름이 _로 시작하므로 Vercel은 이 파일을 주소로 열지 않습니다.
// 저장소 연결 시 붙인 이름(접두어)이 무엇이든 *_REST_API_URL / *_REST_API_TOKEN 짝을 찾습니다.
function findEnv(suffix) { const E = process.env; if (E["KV" + suffix]) return E["KV" + suffix]; const k = Object.keys(E).find(k => k.endsWith(suffix) && !/READ_ONLY/.test(k) && E[k]); return k ? E[k] : ""; }
const RURL = (findEnv("_REST_API_URL") || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const RTOK = findEnv("_REST_API_TOKEN") || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const tokCache = new Map();
const list = s => String(s || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);

class AppError extends Error { constructor(msg, kind) { super(msg); this.kind = kind || "error"; } }
const hasStore = () => !!(RURL && RTOK);

async function redis(cmds) {
  if (!hasStore()) throw new AppError("사용자 기록 저장소가 연결되지 않았습니다(Vercel → Storage → Upstash Redis).", "nostore");
  let r;
  try { r = await fetch(RURL + "/pipeline", { method: "POST", headers: { Authorization: "Bearer " + RTOK, "Content-Type": "application/json" }, body: JSON.stringify(cmds), signal: AbortSignal.timeout(8000) }); }
  catch (e) { throw new AppError("저장소에 연결하지 못했습니다: " + (e.message || e), "store"); }
  const d = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(d)) throw new AppError("저장소 오류 (HTTP " + r.status + ")", "store");
  return d.map(x => (x && x.error) ? null : x.result);
}
const toObj = a => { const o = {}; if (Array.isArray(a)) for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1]; else if (a && typeof a === "object") Object.assign(o, a); return o; };

// 구글 로그인 확인: 액세스 토큰(Bearer) 또는 ID 토큰(X-Id-Token)
async function verify(req) {
  const h = req.headers.authorization || "", at = h.startsWith("Bearer ") ? h.slice(7) : "", it = req.headers["x-id-token"] || "";
  const tok = at || it; if (!tok) throw new AppError("구글 로그인 후 사용할 수 있습니다.", "auth");
  const c = tokCache.get(tok); if (c && c.until > Date.now()) return c.info;
  let info;
  try { const r = await fetch("https://oauth2.googleapis.com/tokeninfo?" + (at ? "access_token=" : "id_token=") + encodeURIComponent(tok)); info = await r.json(); if (!r.ok || info.error || info.error_description) throw 0; }
  catch (e) { throw new AppError("구글 로그인이 만료되었습니다. 다시 로그인하세요.", "auth"); }
  const cid = process.env.GOOGLE_CLIENT_ID || "";
  if (cid && info.aud !== cid && info.azp !== cid) throw new AppError("이 앱에서 발급한 로그인이 아닙니다.", "auth");
  if (!info.email) throw new AppError("구글 계정 이메일을 확인하지 못했습니다.", "auth");
  info.email = String(info.email).toLowerCase();
  tokCache.set(tok, { info, until: Date.now() + 5 * 60 * 1000 });
  return info;
}
const isAdmin = email => list(process.env.ADMIN_EMAILS).includes(String(email || "").toLowerCase());

// 접근 확인: 관리자 > 차단 > 허용 목록 모드
async function access(email) {
  email = String(email || "").toLowerCase();
  if (isAdmin(email)) return { ok: true, admin: true };
  const envAllow = list(process.env.ALLOWED_EMAILS);
  if (!hasStore()) return envAllow.length && !envAllow.includes(email) ? { ok: false, reason: "pending" } : { ok: true };
  const [u, mode, inAllow] = await redis([["HGETALL", "u:" + email], ["HGET", "cfg", "mode"], ["SISMEMBER", "allow", email]]);
  const user = toObj(u);
  if (user.blocked === "1") return { ok: false, reason: "blocked" };
  if (envAllow.includes(email) || inAllow === 1) return { ok: true };
  if (mode === "allow" || envAllow.length) return { ok: false, reason: "pending" };
  return { ok: true };
}
async function logEvent(type, by, target, detail) {
  if (!hasStore()) return;
  try { await redis([["LPUSH", "log", JSON.stringify({ at: new Date().toISOString(), type, by, target: target || "", detail: detail || "" })], ["LTRIM", "log", "0", "299"]]); } catch (e) { }
}
function send(res, code, obj) { res.statusCode = code; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c); try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { return {}; }
}
module.exports = { AppError, hasStore, redis, toObj, verify, isAdmin, access, logEvent, send, readBody, list };
