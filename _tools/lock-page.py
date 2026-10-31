"""개인 자동화 페이지 잠그기 (비밀번호 없이 공개키로).

사용: python3 _tools/lock-page.py <잠글 내용 파일> <잠금 페이지 html>
  - 잠금 페이지 안의 /*ENC*/.../*ENC*/ 부분을 새로 잠근 내용으로 바꿔요.
  - 내용이 JSON 목록이면(auto/index.html 카드 목록) 그대로, html이면 그 페이지 전체가 들어가요.
  - 여는 건 비밀번호가 있어야 해요 (assets/lock.js).
"""
import base64, gzip, json, os, re, sys
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import serialization

WPUB = 'BKw8CjBJ0H7Ca6a1CnN8LxIwicmO0n+JmoDU2CFO3uZCwPuNqsg/gW5FEGGu/QknYntUPyl5/+OzjP5sSKHYj+A='  # 공개키 (비밀 아님)

def lock(data: bytes) -> dict:
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), base64.b64decode(WPUB))
    eph = ec.generate_private_key(ec.SECP256R1())
    key = eph.exchange(ec.ECDH(), pub)  # lock.js: ECDH(개인키, e) 앞 256비트 = AES 키
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, gzip.compress(data), None)
    e = eph.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    b = lambda x: base64.b64encode(x).decode()
    return {'e': b(e), 'i': b(iv), 'c': b(ct), 'z': 1}

if __name__ == '__main__':
    src, page = sys.argv[1], sys.argv[2]
    html = open(page, encoding='utf-8').read()
    enc = json.dumps(lock(open(src, 'rb').read()), separators=(',', ':'))
    new, n = re.subn(r'/\*ENC\*/.*?/\*ENC\*/', lambda m: '/*ENC*/' + enc + '/*ENC*/', html, count=1, flags=re.S)
    assert n == 1, 'ENC 자리를 못 찾았어요'
    open(page, 'w', encoding='utf-8').write(new)
    print('잠금 완료:', page)
