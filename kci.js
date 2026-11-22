// AI WIKI — KCI Open API 중계 (Vercel 서버리스 함수)
// 인증키는 Vercel 환경변수 KCI_KEY에만 보관합니다. 웹페이지에는 노출되지 않습니다.
// 구글 로그인한 사용자만 쓸 수 있습니다. 관리자가 차단한 계정·승인 전 계정은 막습니다(api/_store.js).
const KCI_BASE = process.env.KCI_BASE || "https://open.kci.go.kr/po/openapi/openApiSearch.kci";
const SEARCH_PARAMS = ["title","author","journal","institution","keyword","dateFrom","dateTo","displayCount","page","sortNm","sortDir"];

const dec = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const attrs = s => { const o = {}; String(s || "").replace(/([\w:-]+)="([^"]*)"/g, (m, k, v) => { o[k] = v; }); return o; };
function all(xml, tag) {
  const out = [], re = new RegExp(`<${tag}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${tag}>)`, "g"); let m;
  while ((m = re.exec(xml || ""))) out.push({ attrs: attrs(m[1]), inner: m[2] || "" });
  return out;
}
const one = (xml, tag) => all(xml, tag)[0] || null;
const txt = (xml, tag) => { const e = one(xml, tag); return e ? dec(e.inner) : ""; };

function parseRecord(rec) {
  const j = (one(rec, "journalInfo") || { inner: "", attrs: {} }), a = (one(rec, "articleInfo") || { inner: "", attrs: {} });
  const titles = {}; all((one(a.inner, "title-group") || {}).inner, "article-title").forEach(t => { titles[t.attrs.lang || "original"] = dec(t.inner); });
  const abstracts = {}; [...all((one(a.inner, "abstract-group") || {}).inner, "abstract")].forEach(t => { abstracts[t.attrs.lang || "original"] = dec(t.inner); });
  const authors = all((one(a.inner, "author-group") || {}).inner, "author").map(au => {
    let name = one(au.inner, "name") ? txt(au.inner, "name") : dec(au.inner), inst = txt(au.inner, "institution");
    if (!inst) { const m = name.match(/^(.*?)\((.*)\)$/); if (m) { name = m[1].trim(); inst = m[2].trim(); } }
    return name ? { name, institution: inst, english: au.attrs.english || "" } : null;
  }).filter(Boolean);
  const kws = all((one(a.inner, "keyword-group") || {}).inner, "keyword").map(k => dec(k.inner)).filter(Boolean);
  const cc = one(a.inner, "citation-count");
  return {
    kci_id: a.attrs["article-id"] || "", title: titles.original || titles.english || titles.foreign || "", title_en: titles.english || "",
    authors, journal: txt(j.inner, "journal-name"), publisher: txt(j.inner, "publisher-name"), journal_id: j.attrs["journal-id"] || "",
    issn: txt(j.inner, "issn"), year: txt(j.inner, "pub-year"), month: txt(j.inner, "pub-mon"), volume: txt(j.inner, "volume"), issue: txt(j.inner, "issue"),
    category: txt(a.inner, "article-categories"), abstract: abstracts.original || abstracts.english || "", abstract_en: abstracts.english || "", keywords: kws,
    fpage: txt(a.inner, "fpage"), lpage: txt(a.inner, "lpage"), doi: txt(a.inner, "doi"), uci: txt(a.inner, "uci"), open_yn: txt(a.inner, "orte-open-yn"),
    citations_kci: cc ? (cc.attrs.kci || "") : "", url: txt(a.inner, "url"),
  };
}
class KCIError extends Error { constructor(msg, kind) { super(msg); this.kind = kind || "kci"; } }
function parseKci(xml) {
  const head = xml.slice(0, 400).toLowerCase();
  if (head.includes("<html") || head.includes("<!doctype html")) throw new KCIError("KCI가 HTML 안내 페이지를 돌려줬습니다. 접속이 차단되었거나(등록되지 않은 IP일 수 있음) 서비스 점검 중일 수 있습니다.", "blocked");
  const out = one(xml, "outputData");
  if (!out) throw new KCIError("KCI 오류: " + (dec(xml).slice(0, 300) || "알 수 없는 응답"), "kci");
  const total = txt((one(out.inner, "result") || {}).inner, "total");
  const recs = all(out.inner, "record").map(r => parseRecord(r.inner));
  if (!recs.length && !total) { const msg = dec(out.inner).slice(0, 300); if (msg) throw new KCIError("KCI 오류: " + msg, "kci"); }
  return { total: /^\d+$/.test(total) ? +total : recs.length, records: recs };
}
async function kciCall(params) {
  const key = process.env.KCI_KEY || "";
  if (!key) throw new KCIError("KCI 인증키가 Vercel에 등록되지 않았습니다(환경변수 KCI_KEY).", "nokey");
  const url = KCI_BASE + "?" + new URLSearchParams({ ...params, key }).toString();
  let r;
  try { r = await fetch(url, { headers: { "User-Agent": "AI-WIKI/vercel", Accept: "application/xml,text/xml,*/*" }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new KCIError("KCI에 연결하지 못했습니다: " + (e.message || e), "network"); }
  if (!r.ok) throw new KCIError(`KCI 서버 오류 (HTTP ${r.status})`, "http");
  return parseKci(await r.text());
}
const store = require("./_store");
async function checkUser(req) {
  let info;
  try { info = await store.verify(req); } catch (e) { throw new KCIError(e.message, "auth"); }
  let acc = { ok: true };
  try { acc = await store.access(info.email); } catch (e) { /* 저장소 오류여도 검색은 막지 않음 */ }
  if (!acc.ok) throw new KCIError(acc.reason === "blocked" ? "관리자가 이 계정의 사용을 제한했습니다. 관리자에게 문의하세요." : "관리자 승인 후 KCI 검색을 쓸 수 있습니다. 관리자에게 문의하세요.", "auth");
  return info;
}
async function countUse(info) { if (!store.hasStore() || !info || !info.email) return; try { await store.redis([["HINCRBY", "u:" + info.email, "kci", "1"]]); } catch (e) { } }
function send(res, code, obj) { res.statusCode = code; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(obj)); }

module.exports = async function handler(req, res) {
  const u = new URL(req.url, "http://x"), q = Object.fromEntries(u.searchParams.entries()), route = q.route || "";
  try {
    if (route === "health") {
      const k = process.env.KCI_KEY || "";
      return send(res, 200, { ok: true, version: "vercel", deploy: true, kci_key_set: !!k, kci_key_hint: k ? "Vercel에 등록됨" : "", conf_path: "Vercel 환경변수 KCI_KEY" });
    }
    if (route === "key") return send(res, 400, { ok: false, kind: "deploy", error: "배포 앱에서는 Vercel → 프로젝트 Settings → Environment Variables에 KCI_KEY로 인증키를 등록합니다." });
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "허용되지 않은 요청입니다." });
    if (req.headers["x-aiwiki"] !== "1") return send(res, 403, { ok: false, error: "허용되지 않은 요청입니다." });
    const who = await checkUser(req);
    if (route === "test") { const r = await kciCall({ apiCode: "articleSearch", title: q.title || "베트남", displayCount: "1" }); return send(res, 200, { ok: true, total: r.total }); }
    if (route === "search") {
      const p = {}; SEARCH_PARAMS.forEach(k => { if ((q[k] || "").trim()) p[k] = q[k].trim(); });
      if (!p.title) return send(res, 400, { ok: false, kind: "param", error: "KCI 논문 검색은 제목 검색어가 필수입니다." });
      const r = await kciCall({ ...p, apiCode: "articleSearch" }); await countUse(who); return send(res, 200, { ok: true, ...r });
    }
    if (route === "detail") {
      if (!/^ART\d+$/.test(q.id || "")) return send(res, 400, { ok: false, kind: "param", error: "논문 ID(ART…) 형식이 아닙니다." });
      const r = await kciCall({ apiCode: "articleDetail", id: q.id }); return send(res, 200, { ok: true, record: r.records[0] || null });
    }
    return send(res, 404, { ok: false, error: "없는 기능입니다." });
  } catch (e) {
    const kind = e.kind || "error"; return send(res, kind === "auth" ? 401 : kind === "nokey" ? 400 : 502, { ok: false, kind, error: e.message });
  }
};
module.exports.parseKci = parseKci;
