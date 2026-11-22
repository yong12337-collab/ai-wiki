// AI WIKI — 로그인 기록 · 관리자 기능 (Vercel 서버리스 함수)
// 관리자는 Vercel 환경변수 ADMIN_EMAILS에 적은 구글 계정입니다. 연구 자료(논문·원고)는 이 서버에 오지 않습니다.
const { AppError, hasStore, redis, toObj, verify, isAdmin, access, logEvent, send, readBody, list } = require("./_store");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (s, n) => String(s || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

module.exports = async function handler(req, res) {
  const u = new URL(req.url, "http://x"), route = u.searchParams.get("route") || "";
  try {
    if (req.headers["x-aiwiki"] !== "1") return send(res, 403, { ok: false, error: "허용되지 않은 요청입니다." });
    const me = await verify(req), email = me.email, admin = isAdmin(email);

    // 로그인할 때마다: 사용자 기록 + 접근 확인 + 공지
    if (route === "ping") {
      if (req.method !== "POST") return send(res, 405, { ok: false, error: "허용되지 않은 요청입니다." });
      const b = await readBody(req), acc = await access(email);
      let notice = null;
      if (hasStore()) {
        const nowIso = new Date().toISOString(), key = "u:" + email;
        const [last] = await redis([["HGET", key, "last"]]);
        const fresh = !last || (Date.now() - Date.parse(last)) > 30 * 60 * 1000;
        const cmds = [["SADD", "users", email], ["HSETNX", key, "first", nowIso], ["HSET", key, "email", email, "name", clip(b.name, 60), "picture", clip(b.picture, 300), "last", nowIso, "status", acc.ok ? "ok" : acc.reason]];
        if (fresh) cmds.push(["HINCRBY", key, "logins", "1"]);
        cmds.push(["HGETALL", "cfg"]);
        const out = await redis(cmds); const cfg = toObj(out[out.length - 1]);
        if (cfg.notice) notice = { text: cfg.notice, level: cfg.notice_level || "info", at: cfg.notice_at || "" };
        if (!last) await logEvent("가입", email, email, acc.ok ? "" : "승인 대기");
      }
      return send(res, 200, { ok: true, email, admin, access: acc, notice, store: hasStore() });
    }

    if (!admin) return send(res, 403, { ok: false, kind: "auth", error: "관리자 계정이 아닙니다." });

    if (route === "status") {
      let store = { set: hasStore(), ok: false, error: "" }, users = 0;
      if (store.set) { try { const [p, n] = await redis([["PING"], ["SCARD", "users"]]); store.ok = p === "PONG"; users = n || 0; } catch (e) { store.error = e.message; } }
      return send(res, 200, { ok: true, me: email, env: {
        KCI_KEY: !!process.env.KCI_KEY, GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
        ADMIN_EMAILS: list(process.env.ADMIN_EMAILS).length, ALLOWED_EMAILS: list(process.env.ALLOWED_EMAILS).length },
        store, users, region: process.env.VERCEL_REGION || "", commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) });
    }
    if (!hasStore()) throw new AppError("사용자 기록 저장소가 연결되지 않았습니다. Vercel → Storage에서 Upstash Redis를 이 프로젝트에 연결하고 Redeploy 하세요.", "nostore");

    if (route === "users") {
      const [emails, allow, cfg] = await redis([["SMEMBERS", "users"], ["SMEMBERS", "allow"], ["HGETALL", "cfg"]]);
      const em = (emails || []).slice(0, 1000), rows = em.length ? await redis(em.map(e => ["HGETALL", "u:" + e])) : [];
      const al = new Set(allow || []), envAllow = new Set(list(process.env.ALLOWED_EMAILS));
      const users = rows.map((r, i) => { const o = toObj(r); o.email = o.email || em[i]; o.admin = isAdmin(o.email); o.allowed = al.has(o.email) || envAllow.has(o.email); o.logins = +o.logins || 0; o.kci = +o.kci || 0; return o; })
        .sort((a, b) => String(b.last || "").localeCompare(String(a.last || "")));
      const c = toObj(cfg);
      return send(res, 200, { ok: true, users, allow: [...al], mode: c.mode || "open", notice: { text: c.notice || "", level: c.notice_level || "info", at: c.notice_at || "" } });
    }
    if (route === "log") { const [l] = await redis([["LRANGE", "log", "0", "149"]]); return send(res, 200, { ok: true, log: (l || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean) }); }

    if (req.method !== "POST") return send(res, 405, { ok: false, error: "허용되지 않은 요청입니다." });
    const b = await readBody(req);

    if (route === "user") {
      const t = String(b.email || "").trim().toLowerCase(), a = String(b.action || "");
      if (!EMAIL_RE.test(t)) return send(res, 400, { ok: false, error: "이메일 형식이 아닙니다." });
      if (isAdmin(t) && (a === "block" || a === "remove")) return send(res, 400, { ok: false, error: "관리자 계정은 차단하거나 지울 수 없습니다." });
      const key = "u:" + t, cmds = {
        block: [["HSET", key, "blocked", "1", "email", t], ["SADD", "users", t], ["SREM", "allow", t]],
        unblock: [["HDEL", key, "blocked"]],
        allow: [["SADD", "allow", t], ["HDEL", key, "blocked"], ["SADD", "users", t], ["HSET", key, "email", t]],
        disallow: [["SREM", "allow", t]],
        note: [["HSET", key, "note", clip(b.note, 200)]],
        remove: [["DEL", key], ["SREM", "users", t], ["SREM", "allow", t]],
      }[a];
      if (!cmds) return send(res, 400, { ok: false, error: "없는 작업입니다." });
      await redis(cmds); await logEvent({ block: "차단", unblock: "차단 해제", allow: "허용", disallow: "허용 취소", note: "메모", remove: "기록 삭제" }[a], email, t, a === "note" ? clip(b.note, 80) : "");
      return send(res, 200, { ok: true });
    }
    if (route === "notice") {
      const text = clip(b.text, 300), level = ["info", "warn"].includes(b.level) ? b.level : "info";
      if (text) await redis([["HSET", "cfg", "notice", text, "notice_level", level, "notice_at", new Date().toISOString()]]);
      else await redis([["HDEL", "cfg", "notice", "notice_level", "notice_at"]]);
      await logEvent(text ? "공지 등록" : "공지 내림", email, "", text.slice(0, 80));
      return send(res, 200, { ok: true });
    }
    if (route === "settings") {
      const mode = b.mode === "allow" ? "allow" : "open";
      await redis([["HSET", "cfg", "mode", mode]]); await logEvent("접근 방식", email, "", mode === "allow" ? "허용한 계정만" : "누구나");
      return send(res, 200, { ok: true, mode });
    }
    return send(res, 404, { ok: false, error: "없는 기능입니다." });
  } catch (e) {
    const kind = e.kind || "error";
    return send(res, kind === "auth" ? 401 : kind === "nostore" ? 400 : 502, { ok: false, kind, error: e.message || String(e) });
  }
};
