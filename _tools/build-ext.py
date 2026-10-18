#!/usr/bin/env python3
"""커뮤 검색 크롬 확장 프로그램 만들기.

auto/search/code.js (즐겨찾기 버전과 같은 코드)로 확장 프로그램 zip을 만든다.
버전은 code.js 의 VER 값을 그대로 써서 즐겨찾기 버전과 확장 버전이 항상 같다.

    python3 _tools/build-ext.py      → auto/search/community-search-ext.zip
"""
import io, json, os, re, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'auto', 'search', 'code.js')
OUT = os.path.join(ROOT, 'auto', 'search', 'community-search-ext.zip')
DIR = 'community-search-ext'  # zip 안 폴더 이름 (크롬에서 이 폴더를 불러옴)

SITES = ['https://www.instiz.net/*', 'https://instiz.net/*', 'https://theqoo.net/*']
HOME = 'https://binaroo-z.github.io/*'  # 새 버전 확인용

BG = r"""// 다른 사이트 글을 대신 가져오는 백그라운드 (인스티즈 화면에서 더쿠 검색 등)
const OK = /^https:\/\/((www\.)?instiz\.net|theqoo\.net|binaroo-z\.github\.io)\//;
chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (!m || !m.csFetch) return;
  if (!OK.test(m.csFetch)) { send({ ok: false, err: '허용 안 된 주소' }); return; }
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 15000);
  const opt = m.post ? { method: 'POST', headers: m.head || {}, body: m.post, credentials: 'include', signal: ac.signal }
                     : { credentials: 'include', signal: ac.signal };
  fetch(m.csFetch, opt)
    .then(async (r) => send({ ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' }))
    .catch((e) => send({ ok: false, err: e.name === 'AbortError' ? '시간초과' : '접속 오류' }))
    .finally(() => clearTimeout(tm));
  return true; // 응답을 비동기로 보냄
});
"""


def main():
    code = open(SRC, encoding='utf-8').read()
    m = re.search(r"const VER = '([\d.]+)'", code)
    if not m:
        sys.exit('code.js 에서 VER 를 찾지 못함')
    ver = m.group(1)
    flag = 'window.__CS_BM=true;\n'  # 즐겨찾기용 표시: 확장에서는 빼야 페이지마다 검색 화면이 자동으로 열리지 않음
    if not code.startswith(flag):
        sys.exit('code.js 첫 줄이 예상과 다름: ' + code[:40])
    cs = code[len(flag):]
    manifest = {
        'manifest_version': 3,
        'name': '커뮤 검색',
        'version': ver,
        'description': '인스티즈·마플·더쿠 케톡·HOT을 한 화면에서 제목·내용·댓글까지 검색',
        'permissions': ['storage'],
        'host_permissions': SITES + [HOME],
        'background': {'service_worker': 'bg.js'},
        'content_scripts': [{'matches': SITES, 'js': ['cs.js'], 'run_at': 'document_idle'}],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in [('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'), ('bg.js', BG), ('cs.js', cs)]:
            info = zipfile.ZipInfo(DIR + '/' + name, date_time=(2026, 1, 1, 0, 0, 0))  # 내용이 같으면 zip도 같게
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    open(OUT, 'wb').write(buf.getvalue())
    print('확장 v' + ver + ' →', os.path.relpath(OUT, ROOT), len(buf.getvalue()), 'bytes')


if __name__ == '__main__':
    main()
