#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI WIKI 로컬 연동 서버 (Python 3.8+, 추가 설치 없음)

하는 일
  1) AI WIKI 앱을 http://localhost:8765 로 열어 줍니다.
     (구글 로그인과 폴더 연결은 http://localhost 주소에서만 동작합니다)
  2) KCI Open API 호출을 대신합니다. 인증키는 이 컴퓨터의
     ~/.aiwiki/config.json(본인만 읽기 가능)에만 저장되고,
     앱 코드·브라우저·옵시디언 볼트·구글 드라이브에는 들어가지 않습니다.

실행: python3 aiwiki_server.py        (종료: Ctrl+C)
"""
import json, os, re, ssl, sys, threading, time, urllib.error, urllib.parse, urllib.request, webbrowser
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "3.0"
HOST = "127.0.0.1"
PORT = int(os.environ.get("AIWIKI_PORT", "8765"))
APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONF_DIR = os.environ.get("AIWIKI_CONF_DIR", os.path.join(os.path.expanduser("~"), ".aiwiki"))
CONF_FILE = os.path.join(CONF_DIR, "config.json")
# 공식 엔드포인트 (KCI Open API 활용가이드)
KCI_BASE = os.environ.get("AIWIKI_KCI_BASE", "https://open.kci.go.kr/po/openapi/openApiSearch.kci")
# KCI는 기본 프로그램 User-Agent를 차단하므로 일반 브라우저 형식으로 보냅니다.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AIWIKI-local/" + VERSION
SEARCH_PARAMS = ["title", "author", "journal", "institution", "affiliation", "keyword", "doi",
                 "dateFrom", "dateTo", "page", "displayCount", "sortNm", "sortDir"]
_lock = threading.Lock()
_last_call = [0.0]

# ---------------- 설정 저장 ----------------
def load_conf():
    try:
        with open(CONF_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_conf(c):
    os.makedirs(CONF_DIR, exist_ok=True)
    try: os.chmod(CONF_DIR, 0o700)
    except Exception: pass
    tmp = CONF_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False, indent=1)
    try: os.chmod(tmp, 0o600)
    except Exception: pass
    os.replace(tmp, CONF_FILE)

# ---------------- KCI 호출·해석 ----------------
class KCIError(Exception):
    def __init__(self, msg, kind="kci"):
        super().__init__(msg); self.kind = kind

def _text(el):
    return "".join(el.itertext()).strip() if el is not None else ""

def _child(el, tag):
    return el.find(tag) if el is not None else None

def parse_record(rec):
    j = rec.find("journalInfo"); a = rec.find("articleInfo")
    titles = {t.get("lang", "original"): _text(t) for t in (a.findall("title-group/article-title") if a is not None else [])}
    abstracts = {t.get("lang", "original"): _text(t) for t in (a.findall("abstract-group/abstract") + a.findall("abstract") if a is not None else [])}
    authors = []
    for au in (a.findall("author-group/author") if a is not None else []):
        name = _text(au.find("name")) if au.find("name") is not None else _text(au)
        inst = _text(au.find("institution"))
        if not inst:
            m = re.match(r"^(.*?)\((.*)\)$", name)
            if m: name, inst = m.group(1).strip(), m.group(2).strip()
        if name: authors.append({"name": name, "institution": inst, "english": au.get("english", "")})
    kws = [_text(k) for k in (a.findall("keyword-group/keyword") if a is not None else []) if _text(k)]
    cc = _child(a, "citation-count")
    return {
        "kci_id": a.get("article-id", "") if a is not None else "",
        "title": titles.get("original") or titles.get("english") or titles.get("foreign") or "",
        "title_en": titles.get("english", ""),
        "authors": authors,
        "journal": _text(_child(j, "journal-name")),
        "publisher": _text(_child(j, "publisher-name")),
        "journal_id": j.get("journal-id", "") if j is not None else "",
        "issn": _text(_child(j, "issn")),
        "year": _text(_child(j, "pub-year")),
        "month": _text(_child(j, "pub-mon")),
        "volume": _text(_child(j, "volume")),
        "issue": _text(_child(j, "issue")),
        "category": _text(_child(a, "article-categories")),
        "abstract": abstracts.get("original") or abstracts.get("english") or "",
        "abstract_en": abstracts.get("english", ""),
        "keywords": kws,
        "fpage": _text(_child(a, "fpage")), "lpage": _text(_child(a, "lpage")),
        "doi": _text(_child(a, "doi")), "uci": _text(_child(a, "uci")),
        "open_yn": _text(_child(a, "orte-open-yn")),
        "citations_kci": cc.get("kci", "") if cc is not None else "",
        "url": _text(_child(a, "url")),
    }

def parse_kci(xml_bytes):
    head = xml_bytes[:400].decode("utf-8", "ignore").lower()
    if "<html" in head or "<!doctype html" in head:
        raise KCIError("KCI가 HTML 안내 페이지를 돌려줬습니다. 접속이 차단되었거나 서비스 점검 중일 수 있습니다.", "blocked")
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        raise KCIError("KCI 응답을 해석하지 못했습니다: " + str(e), "parse")
    out = root.find("outputData")
    if out is None:
        msg = re.sub(r"\s+", " ", _text(root))[:300] or "알 수 없는 응답"
        raise KCIError("KCI 오류: " + msg, "kci")
    total = _text(out.find("result/total"))
    recs = [parse_record(r) for r in out.findall("record")]
    if not recs and not total:
        msg = re.sub(r"\s+", " ", _text(out))[:300]
        if msg: raise KCIError("KCI 오류: " + msg, "kci")
    return {"total": int(total) if total.isdigit() else len(recs), "records": recs}

def kci_call(params):
    key = load_conf().get("kci_key", "")
    if not key:
        raise KCIError("KCI 인증키가 등록되지 않았습니다.", "nokey")
    q = dict(params); q["key"] = key
    url = KCI_BASE + "?" + urllib.parse.urlencode(q)
    with _lock:   # 정중한 호출: 0.5초 간격
        wait = 0.5 - (time.time() - _last_call[0])
        if wait > 0: time.sleep(wait)
        _last_call[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/xml,text/xml,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return parse_kci(r.read())
    except urllib.error.HTTPError as e:
        raise KCIError(f"KCI 서버 오류 (HTTP {e.code})", "http")
    except urllib.error.URLError as e:
        reason = str(getattr(e, "reason", e))
        if "CERTIFICATE" in reason.upper():
            raise KCIError("보안 인증서 확인에 실패했습니다. Mac에서 python.org 설치본을 쓰면 '응용 프로그램/Python 3.x/Install Certificates.command'를 한 번 실행하세요.", "ssl")
        raise KCIError("KCI에 연결하지 못했습니다(인터넷 연결 확인): " + reason, "network")
    except TimeoutError:
        raise KCIError("KCI 응답 시간이 초과되었습니다.", "timeout")

# ---------------- HTTP 처리 ----------------
class Handler(BaseHTTPRequestHandler):
    server_version = "AIWIKI/" + VERSION

    def log_message(self, fmt, *args):
        sys.stderr.write("[AI WIKI] " + (fmt % args) + "\n")

    def _same_origin(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            return False   # DNS 리바인딩 방지
        origin = self.headers.get("Origin")
        if origin and not re.match(r"^http://(127\.0\.0\.1|localhost):%d$" % PORT, origin):
            return False   # 다른 사이트에서의 요청 차단
        return True

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def _api_guard(self):
        if not self._same_origin():
            self._json(403, {"ok": False, "error": "허용되지 않은 요청입니다."}); return False
        if self.command != "GET" and self.headers.get("X-AIWIKI") != "1":
            self._json(403, {"ok": False, "error": "허용되지 않은 요청입니다."}); return False
        return True

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith("/api/"):
            if not self._api_guard(): return
            qs = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            try:
                if u.path == "/api/health":
                    k = load_conf().get("kci_key", "")
                    return self._json(200, {"ok": True, "version": VERSION, "kci_key_set": bool(k),
                                            "kci_key_hint": ("…" + k[-4:]) if len(k) >= 6 else ("설정됨" if k else ""),
                                            "conf_path": CONF_FILE})
                if u.path == "/api/kci/test":
                    r = kci_call({"apiCode": "articleSearch", "title": qs.get("title", "베트남"), "displayCount": "1"})
                    return self._json(200, {"ok": True, "total": r["total"]})
                if u.path == "/api/kci/search":
                    p = {k: qs[k].strip() for k in SEARCH_PARAMS if qs.get(k, "").strip()}
                    if not p.get("title"):
                        return self._json(400, {"ok": False, "kind": "param", "error": "KCI 논문 검색은 제목 검색어가 필수입니다."})
                    p["apiCode"] = "articleSearch"
                    r = kci_call(p); r["ok"] = True
                    return self._json(200, r)
                if u.path == "/api/kci/detail":
                    aid = qs.get("id", "")
                    if not re.match(r"^ART\d+$", aid):
                        return self._json(400, {"ok": False, "kind": "param", "error": "논문 ID(ART…) 형식이 아닙니다."})
                    r = kci_call({"apiCode": "articleDetail", "id": aid})
                    return self._json(200, {"ok": True, "record": (r["records"] or [None])[0]})
                return self._json(404, {"ok": False, "error": "없는 기능입니다."})
            except KCIError as e:
                return self._json(502 if e.kind not in ("nokey",) else 400, {"ok": False, "kind": e.kind, "error": str(e)})
        # ---- 정적 파일 (앱 폴더 안의 파일만) ----
        name = urllib.parse.unquote(u.path.lstrip("/")) or ""
        if name == "":
            for cand in ("AI-WIKI.html", "index.html"):
                if os.path.exists(os.path.join(APP_DIR, cand)): name = cand; break
        full = os.path.realpath(os.path.join(APP_DIR, name))
        if not full.startswith(APP_DIR + os.sep) or not os.path.isfile(full) or os.path.basename(full).startswith("."):
            self.send_error(404); return
        ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
                 ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml"}.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        with open(full, "rb") as f: data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache"); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if not self._api_guard(): return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}
        except Exception:
            return self._json(400, {"ok": False, "error": "요청 형식이 올바르지 않습니다."})
        if u.path == "/api/kci/key":
            key = str(body.get("key", "")).strip()
            if not re.match(r"^[A-Za-z0-9_\-]{6,200}$", key):
                return self._json(400, {"ok": False, "error": "인증키 형식이 올바르지 않습니다(영문·숫자)."})
            c = load_conf(); c["kci_key"] = key; save_conf(c)
            return self._json(200, {"ok": True})
        return self._json(404, {"ok": False, "error": "없는 기능입니다."})

    def do_DELETE(self):
        u = urllib.parse.urlparse(self.path)
        if not self._api_guard(): return
        if u.path == "/api/kci/key":
            c = load_conf(); c.pop("kci_key", None); save_conf(c)
            return self._json(200, {"ok": True})
        return self._json(404, {"ok": False, "error": "없는 기능입니다."})

def main():
    try:
        srv = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"포트 {PORT}를 이미 쓰고 있습니다. AI WIKI 서버가 이미 실행 중이면 브라우저에서 http://localhost:{PORT} 를 여세요.")
        return
    url = f"http://localhost:{PORT}/"
    print("=" * 60)
    print(" AI WIKI 로컬 연동 서버가 실행되었습니다.")
    print(f" 브라우저(Chrome)에서 열기: {url}")
    print(f" KCI 인증키 저장 위치: {CONF_FILE}")
    print(" 종료하려면 이 창에서 Ctrl+C 를 누르세요.")
    print("=" * 60)
    if os.environ.get("AIWIKI_NO_BROWSER") != "1":
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")

if __name__ == "__main__":
    main()
