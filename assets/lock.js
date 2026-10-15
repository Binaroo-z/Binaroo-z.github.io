// 개인 자동화 잠금 (모든 개인 페이지 공용)
// 비밀번호 → PBKDF2-SHA256(SALT, N) → AES-256-GCM 키. 각 페이지 내용은 이 키로 암호화된 {i, c} (z: 1이면 gzip 압축 후 암호화).
// 한 번 열면 키를 기기에 기억해서 다른 개인 페이지도 바로 열림.
(function () {
  var SALT = 'BiKvdd0vdpOtEHJRT+QcOQ==', N = 600000, STORE = 'binaroo.auto.key';
  function b64d(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function b64e(b) { return btoa(String.fromCharCode.apply(null, new Uint8Array(b))); }
  async function derive(pw) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(SALT), iterations: N, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  // 공개키 방식(e가 있는 페이지): 비밀번호 키로 감싼 개인키를 풀고, 페이지마다 붙은 공개키와 합쳐 내용 키를 만듦.
  // 덕분에 새 페이지는 비밀번호 없이 공개키만으로 잠글 수 있음. 비밀번호와 기억된 기기는 그대로.
  var WPRIV = { i: 'cYEUogS6W2Ql9P4t', c: 'pw6yK+pRf0zGZTR/KYwOtIz2KfDrYteRwkKClWXNSOcGc0kJFBxZK1NGRPtUsuC+vtPSCpfpuE2bWZdsdWCvHuXmbMYQ93pCrBjvpvOvTooOaBNVvkaiDMxNp4/8hTfTqhYTDVMTIzCbvLMnePO09i1BwofUnss38qDUgvhxuKpjTU6tuu7z3k9wly52VDFN/zOzh3+XwO1sqQ==' };
  async function pageKey(key, enc) {
    if (!enc.e) return key;
    var pk8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(WPRIV.i) }, key, b64d(WPRIV.c));
    var priv = await crypto.subtle.importKey('pkcs8', pk8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    var epub = await crypto.subtle.importKey('raw', b64d(enc.e), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return crypto.subtle.deriveKey({ name: 'ECDH', public: epub }, priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function dec(key, enc) {
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(enc.i) }, await pageKey(key, enc), b64d(enc.c));
    // z: 내용이 gzip으로 압축돼 있으면 풀기 (큰 페이지용)
    if (enc.z) pt = await new Response(new Blob([pt]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return new TextDecoder().decode(pt);
  }
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  window.BinLock = {
    forget: function () { try { localStorage.removeItem(STORE); } catch (e) {} },
    mount: async function (el, enc, onOpen) {
      try {
        var raw = localStorage.getItem(STORE);
        if (raw) {
          var k0 = await crypto.subtle.importKey('raw', b64d(raw), 'AES-GCM', true, ['decrypt']);
          onOpen(await dec(k0, enc)); return;
        }
      } catch (e) { this.forget(); }
      el.innerHTML = '<form class="lock"><div class="ico">' + ICON + '</div>' +
        '<p>나만 볼 수 있는 공간이에요.</p>' +
        '<input type="password" placeholder="비밀번호" autocomplete="current-password" required>' +
        '<label><input type="checkbox" checked> 이 기기에서 기억하기</label>' +
        '<button class="btn">열기</button><p class="err" hidden>비밀번호가 맞지 않아요.</p></form>';
      var f = el.querySelector('form'), pw = f.querySelector('input[type=password]'),
          rem = f.querySelector('input[type=checkbox]'), btn = f.querySelector('button'), err = f.querySelector('.err');
      f.addEventListener('submit', async function (e) {
        e.preventDefault(); btn.disabled = true; err.hidden = true;
        try {
          var k = await derive(pw.value), txt = await dec(k, enc);
          if (rem.checked) { try { localStorage.setItem(STORE, b64e(await crypto.subtle.exportKey('raw', k))); } catch (x) {} }
          el.innerHTML = ''; onOpen(txt);
        } catch (x) { err.hidden = false; pw.select(); }
        finally { btn.disabled = false; }
      });
    }
  };
})();
