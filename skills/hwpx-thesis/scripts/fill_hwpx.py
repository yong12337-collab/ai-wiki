#!/usr/bin/env python3
"""학교 HWPX 서식에 Markdown 원고를 채운다. 사용: fill_hwpx.py 서식.hwpx 원고.md 결과.hwpx [--toc]"""
import sys, re, zipfile, time
from xml.dom import minidom
from xml.sax.saxutils import escape

def styles(header):
    out=[]
    for m in re.finditer(r'<hh:style\b([^>]*)>', header):
        a=m.group(1); g=lambda k:(re.search(k+r'="([^"]*)"',a) or [None,""])[1]
        out.append(dict(id=g("id"),name=g("name"),eng=g("engName"),para=g("paraPrIDRef"),char=g("charPrIDRef")))
    def find(*ns):
        for s in out:
            if s["name"] in ns or s["eng"].lower() in [n.lower() for n in ns]: return s
        return None
    return out, find("바탕글","Normal"), find("개요 1","Outline 1","제목 1"), find("개요 2","Outline 2","제목 2")

def parse_md(md):
    blocks=[];para=[]
    def flush():
        if para: blocks.append(("p"," ".join(para).strip())); para.clear()
    for ln in md.replace("\r","").split("\n"):
        t=ln.strip()
        if t.startswith("---") and not blocks and not para: continue
        if not t: flush(); continue
        m=re.match(r'^(#{1,3})\s+(.*)',t)
        if m: flush(); blocks.append(("h%d"%len(m.group(1)),m.group(2).strip())); continue
        if t.startswith("- "): flush(); blocks.append(("li",t[2:])); continue
        para.append(t)
    flush()
    # 앞부분 YAML 머리말 제거
    return [b for b in blocks if not re.match(r'^[a-z_]+:\s',b[1]) or b[0]!="p"]

def main():
    args=[a for a in sys.argv[1:] if not a.startswith("--")]; toc="--toc" in sys.argv
    if len(args)!=3: print(__doc__); sys.exit(1)
    tpl,mdf,outf=args
    z=zipfile.ZipFile(tpl); names=z.namelist()
    if "mimetype" not in names or z.read("mimetype").strip()!=b"application/hwp+zip": sys.exit("HWPX 서식이 아닙니다(mimetype 없음). 한글에서 HWPX로 저장한 파일을 쓰세요.")
    if "Contents/section0.xml" not in names: sys.exit("본문(Contents/section0.xml)이 없습니다.")
    header=z.read("Contents/header.xml").decode("utf-8") if "Contents/header.xml" in names else ""
    _,body,h1,h2=styles(header)
    sec=z.read("Contents/section0.xml").decode("utf-8")
    fp=re.search(r'<hp:p\b[\s\S]*?</hp:p>',sec)
    if not fp: sys.exit("서식의 첫 문단을 찾지 못했습니다.")
    if not body:
        body=dict(id=re.search(r'styleIDRef="([^"]*)"',fp.group(0)).group(1),para=re.search(r'paraPrIDRef="([^"]*)"',fp.group(0)).group(1),char=(re.search(r'charPrIDRef="([^"]*)"',fp.group(0)) or [None,"0"])[1],name="(첫 문단)")
    pid=[int(time.time())%1000000000]
    def P(text,st,pb=False):
        pid[0]+=1
        return f'<hp:p id="{pid[0]}" paraPrIDRef="{st["para"]}" styleIDRef="{st["id"]}" pageBreak="{1 if pb else 0}" columnBreak="0" merged="0"><hp:run charPrIDRef="{st["char"]}"><hp:t>{escape(text)}</hp:t></hp:run></hp:p>'
    blocks=parse_md(open(mdf,encoding="utf-8").read())
    out=[];chap=0
    heads=[b for b in blocks if b[0] in("h2","h3")]
    for i,(k,t) in enumerate(blocks):
        if k=="h1":
            out.append(P(t,h1 or body))
            if toc and heads:
                out.append(P("목차",h1 or body,True))
                out+= [P(("    " if hk=="h3" else "")+ht,body) for hk,ht in heads]
        elif k=="h2": chap+=1; out.append(P(t,h1 or body,True))
        elif k=="h3": out.append(P(t,h2 or body))
        elif k=="li": out.append(P(t,body))
        else: out.append(P(t,body))
    first=re.sub(r'<hp:t>[\s\S]*?</hp:t>','<hp:t></hp:t>',fp.group(0))
    end=sec.rfind("</hs:sec>")
    if end<0: sys.exit("서식 구조(hs:sec)를 찾지 못했습니다.")
    new=sec[:fp.start()]+first+"".join(out)+sec[end:]
    try: minidom.parseString(new.encode("utf-8"))
    except Exception as e: sys.exit(f"만든 본문 XML이 올바르지 않아 중단합니다: {e}")
    with zipfile.ZipFile(outf,"w") as o:
        o.writestr(zipfile.ZipInfo("mimetype"),z.read("mimetype"),compress_type=zipfile.ZIP_STORED)
        for n in names:
            if n=="mimetype" or n.endswith("/"): continue
            o.writestr(n, new.encode("utf-8") if n=="Contents/section0.xml" else z.read(n), compress_type=zipfile.ZIP_DEFLATED)
    v=zipfile.ZipFile(outf); ok=v.namelist()[0]=="mimetype" and v.infolist()[0].compress_type==0 and "<hp:secPr" in (v.read("Contents/section0.xml").decode() if "<hp:secPr" in sec else "<hp:secPr")
    print(f"완료: {outf}\n- 장 {chap}개, 문단 {len(out)}개\n- 스타일: 본문 {body['name']} · 장 {h1['name'] if h1 else '없음(본문 사용)'} · 절 {h2['name'] if h2 else '없음(본문 사용)'}\n- 자체 검증: {'통과' if ok else '확인 필요'} (mimetype 첫 항목·무압축, XML 파싱, 용지 설정 유지)\n- 한글에서 열어 글자·문단·쪽 나눔을 꼭 확인하세요.")
if __name__=="__main__": main()
