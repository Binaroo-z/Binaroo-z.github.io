window.__CS_BM=true;
(function () {
  'use strict';
  if (window.top !== window.self) return;
  if (window.__CS3) { if (window.__CS3open) window.__CS3open(); return; }
  window.__CS3 = true;
  const CAN_CROSS = typeof GM_xmlhttpRequest === 'function' || !!(window.chrome && chrome.runtime && chrome.runtime.id);
  const bare = (h) => h.replace(/^www\./, '');

  /* ================= 검색 대상 (여기에 추가하면 사이트가 늘어남) =================
   * key  : 같은 글 판별용 (같은 사이트면 같은 key)
   * tag  : 이 목록에서 찾은 글에 붙일 표시 (예: 마플)
   * ※ 새 사이트를 추가하면 유저스크립트 맨 위 @match/@connect 도 추가하세요.
   * ========================================================================= */
  const MAPL = encodeURIComponent('[마플]');
  const SOURCES = [
    { id: 'instiz', key: 'instiz', site: '인스티즈', name: '연예', on: true, origin: 'https://www.instiz.net', parser: 'instiz',
      url: (p) => '/name_enter?page=' + p + '&category=2' },
    { id: 'mapl', key: 'instiz', site: '인스티즈', name: '마플', tag: '마플', on: true, origin: 'https://www.instiz.net', parser: 'instiz',
      url: (p) => '/name_enter?page=' + p + '&category=2&k=' + MAPL + '&nolisting=1&stype=9' },
    { id: 'ktalk', key: 'theqoo', site: '더쿠', name: '케톡', on: true, origin: 'https://theqoo.net', parser: 'theqoo',
      url: (p) => '/ktalk?page=' + p },
    { id: 'hot', key: 'theqoo', site: '더쿠', name: 'HOT', on: true, origin: 'https://theqoo.net', parser: 'theqoo',
      url: (p) => '/hot?page=' + p },
  ];
  const CAPS = [500, 1500, 3000, 6000];
  const BODIES = [[0, '제목만'], [100, '+내용 100개'], [300, '+내용 300개'], [1000, '+내용 1000개']]; // 게시판당 글 내용을 열어볼 최대 개수
  const TIMEOUT = 15000, CACHE_MS = 3 * 60000, MAX_SHOWN = 1500, DAY = 86400000;
  // 사이트별 속도 (동시에 받는 개수, 요청 사이 쉬는 시간 ms). 인스티즈는 보안확인이 잦아서 예전 속도 유지
  const SPEED = {
    theqoo: { list: 10, gap: [0, 30], body: 8, bodyGap: [0, 40] },
    instiz: { list: 6, gap: [40, 160], body: 3, bodyGap: [120, 320] },
  };
  const pause = (g) => (g[1] > 0 ? sleep(g[0] + Math.random() * (g[1] - g[0])) : Promise.resolve());
  // 사이트가 '요청이 너무 많다(429)'고 하면 잠깐 쉬고 속도를 낮춰서 같은 글을 다시 받음 (건너뛰지 않음)
  const LIM = {};
  async function polite(src, base, fn, alive) {
    const L = LIM[src.parser] || (LIM[src.parser] = { wait: 0, gap: 0, hits: 0, ok: 0, last: 0 });
    for (let tries = 0; ; tries++) {
      if (L.gap && Date.now() - L.last > 60000) { L.gap = 0; L.hits = 0; } // 1분 동안 제한이 없었으면 다시 빠르게
      const w = L.wait - Date.now();
      if (w > 0) await sleep(w);
      await pause([base[0] + L.gap, base[1] + L.gap]);
      if (!alive()) throw new Error('cancel');
      try {
        const v = await fn();
        if (L.gap && ++L.ok % 100 === 0) L.gap = L.gap < 20 ? 0 : Math.round(L.gap * 0.8);
        return v;
      } catch (e) {
        const busy = e.message === 'HTTP 429' || e.message === 'HTTP 503';
        if (e.message === 'CF' || e.message === 'CROSS' || !alive() || tries >= (busy ? 8 : 1)) throw e;
        if (busy) { L.hits++; L.ok = 0; L.last = Date.now(); L.gap = Math.min(Math.max(L.gap * 2, 100), 2000); L.wait = Math.max(L.wait, Date.now() + 1500 + 500 * Math.min(L.hits, 8)); }
        else await sleep(800 + Math.random() * 700); // 일시적인 오류면 잠깐 쉬고 한 번 더
      }
    }
  }
  // 필요한 부분(글 목록·본문)까지만 받고 나머지(광고·댓글·하단)는 받지 않음 → 빠르고 데이터 절약
  const after = (a, b) => (s) => { const i = s.indexOf(a); return i >= 0 && s.indexOf(b, i) >= 0; };
  const STOP = {
    theqoo: {
      list: (s) => after('theqoo_board_table', '</table>')(s) || after('m-list', 'pagination')(s), // PC / 폰
      body: (s) => after('rd_body', '</article>')(s) || after('read-body', '</article>')(s),
    },
  };
  // 목록 해석 전에 글 목록 앞부분(머리말·메뉴)을 잘라내서 폰에서 해석 시간 단축
  const CUT = {
    theqoo: (h) => {
      let i = h.indexOf('theqoo_board_table');
      i = i >= 0 ? h.lastIndexOf('<table', i) : ((i = h.indexOf('m-list')) >= 0 ? h.lastIndexOf('<div', i) : -1);
      return i > 0 ? h.slice(i) : h;
    },
  };

  /* ================= 날짜 ================= */
  function mk(y, mo, d, h, mi, eod) {
    const t = new Date(y, mo - 1, d, eod ? 23 : h, eod ? 59 : mi, eod ? 59 : 0);
    return t.getMonth() === mo - 1 && t.getDate() === d ? t.getTime() : null;
  }
  function parseDate(raw, nowD) {
    const now = nowD || new Date();
    const t = String(raw || '').replace(/\s+/g, ' ').trim();
    let m;
    if ((m = /^(?:(어제|그제|그저께) )?(\d{1,2}):(\d{2})$/.exec(t))) {
      const d = new Date(now); d.setHours(+m[2], +m[3], 0, 0);
      if (m[1]) d.setDate(d.getDate() - (m[1] === '어제' ? 1 : 2));
      else if (d.getTime() > now.getTime() + 3600000) d.setDate(d.getDate() - 1);
      return d.getTime();
    }
    if ((m = /^(\d{4}|\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\.?(?: (\d{1,2}):(\d{2}))?$/.exec(t)))
      return mk(m[1].length === 2 ? 2000 + +m[1] : +m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), m[4] === undefined);
    if ((m = /^(\d{1,2})[.\-\/](\d{1,2})\.?(?: (\d{1,2}):(\d{2}))?$/.exec(t))) {
      const e = m[3] === undefined;
      let v = mk(now.getFullYear(), +m[1], +m[2], +(m[3] || 0), +(m[4] || 0), e);
      if (v !== null && v > now.getTime() + DAY) v = mk(now.getFullYear() - 1, +m[1], +m[2], +(m[3] || 0), +(m[4] || 0), e);
      return v;
    }
    if (/^(방금|지금)( 전)?$/.test(t)) return now.getTime();
    if (t === '어제') return now.getTime() - DAY;
    if ((m = /^(\d+) ?(초|분|시간|일|주|개월|달|년) ?전$/.exec(t)))
      return now.getTime() - +m[1] * { 초: 1e3, 분: 6e4, 시간: 36e5, 일: DAY, 주: 7 * DAY, 개월: 30 * DAY, 달: 30 * DAY, 년: 365 * DAY }[m[2]];
    return null;
  }

  /* ================= 목록 해석 ================= */
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const PARSERS = {
    instiz(doc, src) {
      const out = [];
      doc.querySelectorAll('td.listsubject > a[href*="/name_enter/"]').forEach((a) => {
        const sbj = a.querySelector('.sbj');
        const m = /\/name_enter\/(\d+)/.exec(a.getAttribute('href'));
        if (!sbj || !m) return; // 상단 인기글(green) 상자 제외
        const c = sbj.cloneNode(true);
        c.querySelectorAll('.cmt2,.cmt3,.minitext,i').forEach((x) => x.remove());
        const rd = a.querySelector('.regdate');
        const dateText = rd ? (rd.firstChild ? rd.firstChild.textContent : rd.textContent).split(/\s+l\s+|\|/)[0].trim() : '';
        out.push({ id: m[1], title: txt(c), dateText, url: src.origin + '/name_enter/' + m[1] });
      });
      return out;
    },
    theqoo(doc, src) {
      const out = [];
      doc.querySelectorAll('table.theqoo_board_table tbody tr').forEach((tr) => {
        if (tr.classList.contains('notice') || tr.classList.contains('notice_expand')) return;
        const a = tr.querySelector('td.title a:not(.replyNum)');
        const m = a && /\/(\w+)\/(\d+)/.exec(a.getAttribute('href'));
        if (!m) return;
        out.push({ id: m[2], title: txt(a), dateText: txt(tr.querySelector('td.time')), url: src.origin + '/' + m[1] + '/' + m[2] });
      });
      // 폰에서는 더쿠가 표 대신 모바일 목록(div.m-list)으로 보내줌
      if (!out.length) doc.querySelectorAll('div.m-list ul.list > li').forEach((li) => {
        const a = li.querySelector('a.list-link');
        const m = a && /\/(\w+)\/(\d+)/.exec(a.getAttribute('href'));
        if (!m) return;
        out.push({ id: m[2], title: txt(li.querySelector('.title_span') || li.querySelector('.title')), dateText: txt(li.querySelector('li.date')), url: src.origin + '/' + m[1] + '/' + m[2] });
      });
      return out;
    },
  };
  // 글 본문 위치 (사이트별)
  const BODY = {
    theqoo: (d) => d.querySelector('.rd_body article') || d.querySelector('.read-body .xe_content') || d.querySelector('.xe_content'), // PC / 폰
    instiz: (d) => d.querySelector('#memo_content_1') || d.querySelector('.memo_content') || d.querySelector('[id^="memo_content"]'),
  };
  function parse(html, src) {
    if (/cf-chl|challenge-platform|잠시만 기다리십시오|Just a moment/.test(html.slice(0, 6000))) throw new Error('CF');
    const doc = new DOMParser().parseFromString(CUT[src.parser] ? CUT[src.parser](html) : html, 'text/html');
    return PARSERS[src.parser](doc, src).map((p) => Object.assign(p, { ts: parseDate(p.dateText) }));
  }

  /* ================= 네트워크 ================= */
  function get(url, stop) {
    const same = url.indexOf(location.origin + '/') === 0;
    if (same || (typeof GM_xmlhttpRequest !== 'function' && !(window.chrome && chrome.runtime && chrome.runtime.id))) {
      if (!same) return Promise.reject(new Error('CROSS'));
      const ac = new AbortController();
      const tm = setTimeout(() => ac.abort(), TIMEOUT);
      return fetch(url, { credentials: 'include', signal: ac.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          if (!stop || !r.body || typeof TextDecoder !== 'function') return r.text();
          // 필요한 부분이 다 오면 그 자리에서 받기 중단
          const rd = r.body.getReader(), dec = new TextDecoder();
          let s = '';
          for (;;) {
            const c = await rd.read();
            if (c.done) return s + dec.decode();
            s += dec.decode(c.value, { stream: true });
            if (stop(s)) { rd.cancel().catch(() => {}); return s; }
          }
        })
        .catch((e) => { throw e.name === 'AbortError' ? new Error('시간초과') : e; })
        .finally(() => clearTimeout(tm));
    }
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((res, rej) => {
        const tm = setTimeout(() => rej(new Error('시간초과')), TIMEOUT + 2000); // 응답이 아예 안 오는 경우 대비
        GM_xmlhttpRequest({ method: 'GET', url, timeout: TIMEOUT,
          onload: (r) => { clearTimeout(tm); r.status === 200 ? res(r.responseText) : rej(new Error('HTTP ' + r.status)); },
          onerror: () => { clearTimeout(tm); rej(new Error('접속 오류')); },
          ontimeout: () => { clearTimeout(tm); rej(new Error('시간초과')); } });
      });
    }
    return new Promise((res, rej) => { // 크롬 확장 프로그램: 백그라운드가 대신 가져옴
      const tm = setTimeout(() => rej(new Error('시간초과')), TIMEOUT + 2000);
      chrome.runtime.sendMessage({ csFetch: url }, (r) => {
        clearTimeout(tm);
        if (chrome.runtime.lastError || !r) return rej(new Error('접속 오류'));
        r.ok ? res(r.text) : rej(new Error(r.err || 'HTTP ' + r.status));
      });
    });
  }
  const cache = new Map();
  const bodyCache = new Map();
  function loadBody(src, x) {
    const u = new URL(x.url), url = (bare(u.host) === bare(location.host) ? location.origin : u.origin) + u.pathname;
    if (bodyCache.has(url)) return bodyCache.get(url);
    const v = get(url, STOP[src.parser] && STOP[src.parser].body).then((h) => {
      if (/cf-chl|challenge-platform|잠시만 기다리십시오|Just a moment/.test(h.slice(0, 6000))) throw new Error('CF');
      const el = BODY[src.parser](new DOMParser().parseFromString(h, 'text/html'));
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    bodyCache.set(url, v);
    v.catch(() => bodyCache.delete(url));
    if (bodyCache.size > 3000) bodyCache.delete(bodyCache.keys().next().value);
    return v;
  }
  function loadPage(src, p) {
    const url = (bare(new URL(src.origin).host) === bare(location.host) ? location.origin : src.origin) + src.url(p);
    const c = cache.get(url);
    if (c && Date.now() - c.t < CACHE_MS) return c.v;
    const v = get(url, STOP[src.parser] && STOP[src.parser].list).then((h) => parse(h, src));
    cache.set(url, { t: Date.now(), v });
    v.catch(() => cache.delete(url));
    return v;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const newest = (posts) => { const d = posts.filter((x) => x.ts !== null).map((x) => x.ts); return d.length ? Math.max.apply(null, d) : null; };

  /* ================= 검색 ================= */
  let gen = 0;
  async function crawl(src, o, S, myGen) {
    const alive = () => myGen === gen;
    const R = (S.rep[src.id] = { src, pages: 0, fails: 0, status: '', reach: null });
    const SP = SPEED[src.parser] || SPEED.instiz;
    let start = 1;
    if (o.until < Date.now() - 3600000) { // 과거 기간이면 해당 날짜 페이지로 바로 이동 (이진 탐색)
      let lo = 1, hi = o.cap;
      while (lo < hi && alive()) {
        const mid = (lo + hi) >> 1;
        let n = null;
        try { const ps = await polite(src, SP.gap, () => loadPage(src, mid), alive); n = ps.length ? newest(ps) : -Infinity; } catch (e) { break; }
        if (n === null) break;
        if (n > o.until) lo = mid + 1; else hi = mid;
      }
      start = Math.max(1, lo - 1);
    }
    let next = start, done = 0, old = 0, stop = false, capHit = false, anyDate = false, listDone = false;
    const B = (R.body = { on: o.body > 0, max: o.body, queued: 0, taken: 0, seen: new Set(), checked: 0, hits: 0, fails: 0, reach: null, cf: false, queue: [] });
    async function worker() {
      while (!stop && alive()) {
        const p = next++;
        if (p > o.cap) { capHit = true; return; }
        let ps = null, e = null;
        try { ps = await polite(src, SP.gap, () => loadPage(src, p), alive); } catch (x) { e = x; }
        if (!alive()) return;
        if (e) {
          R.fails++; done++;
          if (e.message === 'CF') { R.status = 'cf'; stop = true; }
          else if (e.message === 'CROSS') { R.status = 'cross'; stop = true; }
          else if (done >= 3 && R.fails === done) { R.status = 'fail'; R.err = e.message; stop = true; }
          S.tick(); continue;
        }
        if (!alive()) return;
        done++; R.pages++; S.pages++;
        if (!ps.length) { if (p === 1) R.status = 'empty'; stop = true; S.tick(); continue; }
        const n = newest(ps);
        if (n !== null) { anyDate = true; if (R.reach === null || n < R.reach) R.reach = n; }
        if (n !== null && n < o.since) { if (++old >= 2) stop = true; }
        if (!anyDate && done >= 5) { R.status = 'nodate'; stop = true; }
        ps.forEach((x, i) => {
          if (x.ts !== null && (x.ts < o.since || x.ts > o.until)) return;
          const k = src.key + ':' + x.id;
          const hit = S.byKey.get(k);
          if (hit) { if (src.tag) hit.tag = src.tag; return; }
          if (x.title.toLowerCase().indexOf(o.q) === -1) {
            if (B.on && B.taken < B.max && !B.cf && !B.seen.has(x.id)) { B.seen.add(x.id); x.ord = p * 1000 + i; B.queued++; B.queue.push(x); } // 제목에 없으면 내용 확인 대기열로
            return;
          }
          const r = Object.assign({}, x, { src, tag: src.tag || (/^마플\s/.test(x.title) ? '마플' : null) });
          S.byKey.set(k, r); S.results.push(r);
        });
        S.tick();
      }
    }
    // 글 내용 확인: 제목에 검색어가 없던 글을 최신 글부터 열어서 본문을 확인 (사이트에 부담 안 가게 천천히)
    async function bodyWorker() {
      while (alive() && !B.cf) {
        if (B.taken >= B.max) return;
        if (!B.queue.length) { if (listDone) return; await sleep(100); continue; }
        // 목록이 동시에 여러 장 도착하므로, 대기열에서 가장 최신 글(앞 페이지)부터 확인
        let k = 0;
        for (let j = 1; j < B.queue.length; j++) if (B.queue[j].ord < B.queue[k].ord) k = j;
        const x = B.queue.splice(k, 1)[0];
        B.taken++;
        let t;
        try { t = await polite(src, SP.bodyGap, () => loadBody(src, x), alive); }
        catch (e) { if (!alive()) return; if (e.message === 'CF') B.cf = true; else B.fails++; S.tick(); continue; }
        if (!alive()) return;
        B.checked++;
        if (x.ts !== null && (B.reach === null || x.ts < B.reach)) B.reach = x.ts;
        const i = t.toLowerCase().indexOf(o.q);
        if (i !== -1) {
          const k = src.key + ':' + x.id;
          if (!S.byKey.has(k)) {
            const a = Math.max(0, i - 40), snip = (a > 0 ? '…' : '') + t.slice(a, i + o.q.length + 60) + (i + o.q.length + 60 < t.length ? '…' : '');
            const r = Object.assign({}, x, { src, tag: src.tag || (/^마플\s/.test(x.title) ? '마플' : null), inBody: true, snip });
            S.byKey.set(k, r); S.results.push(r); B.hits++;
          }
        }
        S.tick();
      }
    }
    const listing = Promise.all(Array.from({ length: SP.list }, worker)).then(() => { listDone = true; });
    await Promise.all([listing].concat(B.on ? Array.from({ length: SP.body }, bodyWorker) : []));
    if (!R.status) R.status = !alive() ? 'cancel' : capHit ? 'cap' : 'done';
  }

  /* ================= 화면 ================= */
  const store = {
    get(k, d) { try { if (typeof GM_getValue === 'function') return GM_getValue(k, d); const v = localStorage.getItem('cs3_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { if (typeof GM_setValue === 'function') GM_setValue(k, v); else localStorage.setItem('cs3_' + k, JSON.stringify(v)); } catch (e) {} },
  };
  const HAS_CS = !!(window.chrome && chrome.storage && chrome.storage.local);
  const kv = {
    get(k) { return new Promise((res) => { try {
      if (typeof GM_getValue === 'function') return res(GM_getValue(k, null));
      if (HAS_CS) return chrome.storage.local.get(k, (o) => res(o && o[k] !== undefined ? o[k] : null));
      const v = localStorage.getItem('cs3_' + k); res(v === null ? null : JSON.parse(v));
    } catch (e) { res(null); } }); },
    set(k, v) { try {
      if (typeof GM_setValue === 'function') return GM_setValue(k, v);
      if (HAS_CS) return chrome.storage.local.set({ [k]: v });
      localStorage.setItem('cs3_' + k, JSON.stringify(v));
    } catch (e) {} },
  };
  const host = document.createElement('div');
  host.id = 'cs3-host'; host.style.cssText = 'all:initial';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
*{box-sizing:border-box;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
.tab{position:fixed;right:0;top:40%;z-index:2147483646;background:#222;color:#fff;border:0;border-radius:10px 0 0 10px;padding:14px 9px;font-size:14px;writing-mode:vertical-rl;cursor:pointer;box-shadow:-2px 2px 8px rgba(0,0,0,.3)}
.page{position:fixed;inset:0;z-index:2147483647;background:#f6f6f8;color:#222;display:none;flex-direction:column}
.page.open{display:flex}
.top{background:#fff;border-bottom:1px solid #e5e5e5;padding:10px 12px}
.wrap{max-width:860px;margin:0 auto;width:100%}
.r1{display:flex;gap:6px;align-items:center}
.r1 b{font-size:16px;white-space:nowrap;margin-right:4px}
input,select{font-size:16px;padding:9px 10px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#222;min-width:0}
#q{flex:1}
button{font-size:15px;padding:9px 14px;border:0;border-radius:8px;cursor:pointer}
#go{background:#222;color:#fff}
#x{background:#eee;color:#222}
.r2{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center;font-size:14px}
.ck{display:inline-flex;align-items:center;gap:3px;padding:4px 8px;border:1px solid #ddd;border-radius:16px;background:#fff}
.ck input{width:16px;height:16px;margin:0}
#cr{display:none;gap:6px;margin-top:6px}
.st{font-size:12px;color:#666;margin-top:6px;line-height:1.5}
.ft{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.ft button{font-size:13px;padding:4px 10px;border:1px solid #ddd;background:#fff;color:#444;border-radius:14px}
.ft button.on{background:#222;color:#fff;border-color:#222}
.body{flex:1;display:flex;overflow:hidden;position:relative}
.main{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px 12px 30px}
aside{width:260px;flex:none;overflow-y:auto;border-left:1px solid #e5e5e5;background:#fff;padding:10px}
aside h3{font-size:14px;margin:2px 0 8px}
.h{border:1px solid #eee;border-radius:8px;padding:8px;margin-bottom:6px;font-size:13px}
.h.cur{border-color:#222}
.h b{display:block;font-size:14px;word-break:break-all}
.h small{color:#888;display:block;margin:2px 0 6px}
.h button{font-size:12px;padding:4px 8px;background:#f1f1f1;color:#222;margin-right:4px}
#hb{background:#eee;color:#222;display:none}
.hc{display:none;gap:6px;overflow-x:auto;margin-top:8px;padding-bottom:2px;-webkit-overflow-scrolling:touch}
.hc span{font-size:12px;color:#888;white-space:nowrap;align-self:center}
.hc button{flex:none;font-size:13px;padding:5px 10px;border-radius:14px;background:#fff3e8;color:#c2410c;border:1px solid #fed7aa}
@media (max-width:700px){aside{display:none;position:absolute;inset:0;width:auto;border:0;z-index:2}aside.show{display:block}#hb{display:inline-block}.hc{display:flex}}
ul{list-style:none;margin:0;padding:0}
li{background:#fff;border:1px solid #eee;border-radius:10px;margin-bottom:6px}
li a{display:block;padding:10px 12px;color:#1a1a1a;text-decoration:none;font-size:15px;line-height:1.45}
li a:visited{color:#7b4bb5}
.m{display:flex;gap:6px;align-items:center;font-size:12px;color:#888;margin-bottom:3px}
.c{padding:1px 7px;border-radius:6px;color:#fff;font-size:11px;background:#666}
.c.instiz{background:#e8590c}.c.theqoo{background:#7048e8}.c.tag{background:#c92a2a}.c.inb{background:#1c7ed6}
.snip{color:#777;font-size:13px;margin-top:3px;line-height:1.45;word-break:break-all}
mark{background:#ffec99;color:inherit;border-radius:2px}
.empty{text-align:center;color:#999;padding:40px 0;font-size:14px}
</style>
<button class="tab" id="tab">🔎 검색</button>
<div class="page" id="pg">
 <div class="top"><div class="wrap">
  <div class="r1"><b>🔎 모아보기</b><input type="search" id="q" placeholder="검색어 (제목·내용)" enterkeyhint="search" autocomplete="off"><button id="go">검색</button><button id="hb">🕘</button><button id="x" title="닫기">✕</button></div>
  <div class="r2"><select id="rg"><option value="1">24시간</option><option value="3">3일</option><option value="7">7일</option><option value="14">14일</option><option value="30">30일</option><option value="c">직접 입력</option></select>
   <span id="srcs"></span><select id="cap" title="게시판당 최대 페이지"></select><select id="bd" title="게시판당 글 내용을 열어볼 최대 개수 (많을수록 느리고 데이터 사용)"></select></div>
  <div class="hc" id="hc"></div>
  <div id="cr"><input type="date" id="fr"> ~ <input type="date" id="to"></div>
  <div class="st" id="st"></div>
  <div class="ft" id="ft"></div>
 </div></div>
 <div class="body"><div class="main"><div class="wrap"><ul id="ls"></ul></div></div><aside id="hs"><h3>🕘 최근 검색</h3><div id="hl"></div></aside></div>
</div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const pg = $('pg'), qEl = $('q'), goEl = $('go'), rg = $('rg'), capEl = $('cap'), st = $('st'), ls = $('ls'), ft = $('ft');

  const pref = store.get('pref', {}) || {};
  CAPS.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = '최대 ' + n + 'p'; capEl.appendChild(o); });
  capEl.value = String(pref.cap || 3000);
  const bdEl = $('bd');
  BODIES.forEach(([n, t]) => { const o = document.createElement('option'); o.value = n; o.textContent = t; bdEl.appendChild(o); });
  bdEl.value = String(pref.body != null ? pref.body : 300);
  rg.value = pref.rg || '1';
  const usable = SOURCES.filter((s) => CAN_CROSS || bare(new URL(s.origin).host) === bare(location.host));
  usable.forEach((s) => {
    const l = document.createElement('label'); l.className = 'ck';
    const c = document.createElement('input'); c.type = 'checkbox'; c.value = s.id;
    c.checked = pref.srcs && usable.some((u) => pref.srcs.indexOf(u.id) !== -1) ? pref.srcs.indexOf(s.id) !== -1 : s.on;
    l.appendChild(c); l.appendChild(document.createTextNode((s.tag ? '' : s.site + ' ') + s.name)); $('srcs').appendChild(l);
  });
  const syncC = () => { $('cr').style.display = rg.value === 'c' ? 'flex' : 'none'; };
  rg.addEventListener('change', syncC); syncC();

  const open = () => { kv.set('open', true); pg.classList.add('open'); document.documentElement.style.overflow = 'hidden'; setTimeout(() => qEl.focus(), 50); };
  const close = () => { kv.set('open', false); pg.classList.remove('open'); document.documentElement.style.overflow = ''; };
  $('tab').addEventListener('click', open);
  $('x').addEventListener('click', close);
  window.__CS3open = open;
  if (location.hash === '#cs' || window.__CS_BM) open();
  restore();

  /* 결과 표시 */
  let S = null, filter = 'all', rt = null;
  // 시간 없이 날짜만 적힌 글(폰 더쿠의 지난 글)은 날짜만 표시
  const fmt = (ts) => { const d = new Date(ts), p = (n) => String(n).padStart(2, '0'); const day = (d.getMonth() + 1) + '.' + p(d.getDate()); return d.getSeconds() === 59 ? day : day + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  function hl(el, s, q) {
    const lo = s.toLowerCase(); let i = 0, j;
    while ((j = lo.indexOf(q, i)) !== -1) {
      if (j > i) el.appendChild(document.createTextNode(s.slice(i, j)));
      const mk2 = document.createElement('mark'); mk2.textContent = s.slice(j, j + q.length); el.appendChild(mk2); i = j + q.length;
    }
    el.appendChild(document.createTextNode(s.slice(i)));
  }
  function pass(r) { return filter === 'all' || (filter === 'mapl' ? r.tag === '마플' : r.src.id === filter || (filter === 'instiz' && r.src.key === 'instiz')); }
  function render() {
    if (!S) return;
    const arr = S.results.filter(pass).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    ls.textContent = '';
    const fr = document.createDocumentFragment();
    arr.slice(0, MAX_SHOWN).forEach((r) => {
      const li = document.createElement('li'), a = document.createElement('a');
      a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
      const m = document.createElement('div'); m.className = 'm';
      const c = document.createElement('span'); c.className = 'c ' + r.src.key; c.textContent = r.src.site + ' ' + (r.src.key === 'instiz' ? '연예' : r.src.name); m.appendChild(c);
      if (r.tag) { const t = document.createElement('span'); t.className = 'c tag'; t.textContent = r.tag; m.appendChild(t); }
      if (r.inBody) { const t = document.createElement('span'); t.className = 'c inb'; t.textContent = '내용'; m.appendChild(t); }
      const d = document.createElement('span'); d.textContent = r.ts ? fmt(r.ts) : r.dateText; m.appendChild(d);
      const ti = document.createElement('div'); hl(ti, r.title, S.q);
      a.appendChild(m); a.appendChild(ti);
      if (r.snip) { const sn = document.createElement('div'); sn.className = 'snip'; hl(sn, r.snip, S.q); a.appendChild(sn); }
      li.appendChild(a); fr.appendChild(li);
    });
    if (!arr.length) { const e = document.createElement('li'); e.className = 'empty'; e.textContent = S.running ? '찾는 중...' : '결과가 없어요'; fr.appendChild(e); }
    else if (arr.length > MAX_SHOWN) { const e = document.createElement('li'); e.className = 'empty'; e.textContent = '최근 ' + MAX_SHOWN + '건만 표시했어요'; fr.appendChild(e); }
    ls.appendChild(fr);
    // 필터 버튼
    const cnt = { all: S.results.length, mapl: S.results.filter((r) => r.tag === '마플').length };
    ['instiz', 'ktalk', 'hot'].forEach((k) => { cnt[k] = S.results.filter((r) => (k === 'instiz' ? r.src.key === 'instiz' : r.src.id === k)).length; });
    ft.textContent = '';
    [['all', '전체'], ['instiz', '인스티즈'], ['mapl', '마플'], ['ktalk', '케톡'], ['hot', 'HOT']].forEach(([k, n]) => {
      const b = document.createElement('button'); b.textContent = n + ' ' + cnt[k]; if (filter === k) b.className = 'on';
      b.addEventListener('click', () => { filter = k; render(); saveLast(); }); ft.appendChild(b);
    });
  }
  function status() {
    const parts = Object.values(S.rep).map((R) => {
      const n = R.src.site + ' ' + R.src.name;
      const reach = R.reach ? ' (~' + fmt(R.reach) + '까지)' : '';
      const B = R.body, bt = B && B.on ? (B.cf ? ' · 내용 확인 중단(보안확인)' : ' · 내용 ' + B.checked + '/' + Math.min(B.queued, B.max) + '개 확인' + (B.reach ? ' (~' + fmt(B.reach) + ')' : '') + (B.hits ? ' 🔵' + B.hits : '')) : '';
      return ({ done: '✔ ', cap: '⚠ ', cf: '✖ ', cross: '✖ ', fail: '✖ ', empty: '✖ ', nodate: '⚠ ', cancel: '■ ' }[R.status] || '… ') + n + ' ' + R.pages + 'p' + reach +
        ({ cap: ' 페이지 상한 도달', cf: ' 보안확인 필요: 이 사이트를 새 탭에서 한 번 열어주세요', cross: ' 다른 사이트 접속 불가', fail: ' 접속 실패(' + R.err + ')', empty: ' 목록 없음', nodate: ' 날짜 인식 실패', cancel: ' 중단' }[R.status] || '') + bt;
    });
    const slow = S.running && Object.values(LIM).some((L) => L.gap > 0);
    st.textContent = (S.running ? '검색 중 · ' : '완료 · ') + '결과 ' + S.results.length + '건' + (slow ? ' · 사이트 요청 제한으로 속도 조절 중' : '') + '\n';
    parts.forEach((p) => { st.appendChild(document.createElement('br')); st.appendChild(document.createTextNode(p)); });
  }
  let st2 = null;
  function saveLast(now) {
    if (!S) return;
    if (now) { clearTimeout(st2); st2 = null; }
    else if (st2) return;
    const doSave = () => { st2 = null; if (!S) return;
      kv.set('last', { q: S.q, at: Date.now(), running: S.running, status: st.innerText, filter,
        items: S.results.slice(0, 3000).map((r) => ({ s: r.src.id, id: r.id, t: r.title, ts: r.ts, d: r.dateText, u: r.url, g: r.tag, b: r.inBody ? 1 : 0, n: r.snip })) });
    };
    if (now) doSave(); else st2 = setTimeout(doSave, 800);
  }
  let hist = [], curAt = 0;
  const hfmt = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '.' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const RGN = { 1: '24시간', 3: '3일', 7: '7일', 14: '14일', 30: '30일' };
  function addHist(E) {
    hist = [E].concat(hist.filter((h) => !(h.q === E.q && h.rg === E.rg && h.fr === E.fr && h.to === E.to && String(h.srcs) === String(E.srcs)))).slice(0, 10);
    curAt = E.at; kv.set('hist', hist); renderHist();
  }
  function showItems(E, label) {
    S = { q: E.q, results: [], byKey: new Map(), rep: {}, pages: 0, running: false, tick: () => {} };
    E.items.forEach((x) => { const src = SOURCES.find((z) => z.id === x.s); if (!src) return;
      const r = { id: x.id, title: x.t, ts: x.ts, dateText: x.d, url: x.u, tag: x.g, inBody: !!x.b, snip: x.n, src };
      S.byKey.set(src.key + ':' + x.id, r); S.results.push(r); });
    qEl.value = E.q; filter = E.filter || 'all'; curAt = E.at; render(); renderHist();
    st.textContent = label + ' (' + hfmt(E.at) + ') · 결과 ' + S.results.length + '건 · 최신 글을 보려면 재검색을 눌러주세요';
  }
  function renderHist() {
    const hc = $('hc'); hc.textContent = '';
    if (hist.length) { const lb = document.createElement('span'); lb.textContent = '최근'; hc.appendChild(lb); }
    hist.forEach((E) => { const c = document.createElement('button'); c.textContent = E.q + ' ' + E.n;
      c.addEventListener('click', () => { if (S && S.running) stopSearch(); showItems(E, '저장된 검색'); }); hc.appendChild(c); });
    const hl = $('hl'); hl.textContent = '';
    if (!hist.length) { hl.textContent = '아직 검색 기록이 없어요'; return; }
    hist.forEach((E, i) => {
      const d = document.createElement('div'); d.className = 'h' + (E.at === curAt ? ' cur' : '');
      const b = document.createElement('b'); b.textContent = E.q; d.appendChild(b);
      const sm = document.createElement('small'); sm.textContent = hfmt(E.at) + ' · ' + (E.rg === 'c' ? (E.fr || '') + '~' + (E.to || '') : RGN[E.rg] || '') + ' · ' + E.n + '건'; d.appendChild(sm);
      [['보기', () => { if (S && S.running) stopSearch(); showItems(E, '저장된 검색'); $('hs').classList.remove('show'); }],
       ['재검색', () => { if (S && S.running) stopSearch(); qEl.value = E.q; rg.value = E.rg; syncC(); $('fr').value = E.fr || ''; $('to').value = E.to || '';
          root.querySelectorAll('#srcs input').forEach((c) => { c.checked = E.srcs.indexOf(c.value) !== -1; }); $('hs').classList.remove('show'); search(); }],
       ['삭제', () => { hist.splice(i, 1); kv.set('hist', hist); renderHist(); }]].forEach(([t, f]) => {
        const bt = document.createElement('button'); bt.textContent = t; bt.addEventListener('click', f); d.appendChild(bt); });
      hl.appendChild(d);
    });
  }
  $('hb').addEventListener('click', () => $('hs').classList.toggle('show'));
  async function restore() {
    hist = (await kv.get('hist')) || []; renderHist();
    const L = await kv.get('last');
    if (L && L.items && !(S && S.running)) {
      S = { q: L.q, results: [], byKey: new Map(), rep: {}, pages: 0, running: false, tick: () => {} };
      L.items.forEach((x) => { const src = SOURCES.find((z) => z.id === x.s); if (!src) return;
        const r = { id: x.id, title: x.t, ts: x.ts, dateText: x.d, url: x.u, tag: x.g, inBody: !!x.b, snip: x.n, src };
        S.byKey.set(src.key + ':' + x.id, r); S.results.push(r); });
      qEl.value = L.q; filter = L.filter || 'all'; render();
      const d = new Date(L.at);
      st.textContent = '지난 검색 (' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ')' +
        (L.running ? ' · 페이지 이동으로 중간에 멈춤' : '') + ' · 결과 ' + S.results.length + '건 · 새로 찾으려면 검색을 눌러주세요';
    }
    if ((await kv.get('open')) === true) open();
  }
  const tick = () => { saveLast(); if (rt) return; rt = setTimeout(() => { rt = null; if (S) { render(); status(); } }, 300); };

  function range() {
    if (rg.value !== 'c') return { since: Date.now() - +rg.value * DAY, until: Date.now() + DAY };
    if (!$('fr').value) return null;
    return { since: new Date($('fr').value + 'T00:00:00').getTime(), until: $('to').value ? new Date($('to').value + 'T23:59:59').getTime() : Date.now() + DAY };
  }
  function finishHist() { if (S && S.meta) addHist(Object.assign({}, S.meta, { at: Date.now(), n: S.results.length, filter,
      items: S.results.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 800).map((r) => ({ s: r.src.id, id: r.id, t: r.title, ts: r.ts, d: r.dateText, u: r.url, g: r.tag, b: r.inBody ? 1 : 0, n: r.snip })) })); }
  function stopSearch() { gen++; if (S && S.running) finishHist(); if (S) { S.running = false; Object.values(S.rep).forEach((R) => { if (!R.status) R.status = 'cancel'; }); render(); status(); saveLast(); } goEl.textContent = '검색'; }

  async function search() {
    if (S && S.running) return stopSearch(); // 진행 중이면 즉시 중단
    const q = qEl.value.trim().toLowerCase();
    if (!q) return qEl.focus();
    const r = range();
    if (!r) { st.textContent = '시작 날짜를 골라주세요'; return; }
    const ids = Array.prototype.map.call(root.querySelectorAll('#srcs input:checked'), (c) => c.value);
    if (!ids.length) { st.textContent = '검색할 곳을 하나 이상 골라주세요'; return; }
    store.set('pref', { cap: +capEl.value, rg: rg.value, srcs: ids, body: +bdEl.value });
    const meta = { q, rg: rg.value, fr: $('fr').value, to: $('to').value, srcs: ids };
    const myGen = ++gen;
    S = { q, results: [], byKey: new Map(), rep: {}, pages: 0, running: true, tick, meta };
    filter = 'all'; goEl.textContent = '중단'; render(); status();
    const o = { q, since: r.since, until: r.until, cap: +capEl.value, body: +bdEl.value };
    const srcs = SOURCES.filter((s) => ids.indexOf(s.id) !== -1).sort((a, b) => (a.tag ? 1 : 0) - (b.tag ? 1 : 0));
    await Promise.all(srcs.map((s) => crawl(s, o, S, myGen).catch((e) => { S.rep[s.id] = S.rep[s.id] || { src: s, pages: 0 }; S.rep[s.id].status = 'fail'; S.rep[s.id].err = e.message; })));
    if (myGen !== gen) return; // 이미 중단/새 검색됨
    S.running = false; goEl.textContent = '검색';
    clearTimeout(rt); rt = null; render(); status(); saveLast(true); finishHist();
  }
  goEl.addEventListener('click', search);
  qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (S && S.running) stopSearch(); search(); } });

  if (window.__CS_TEST) window.__CS3T = { parseDate, parse, SOURCES };
})();
