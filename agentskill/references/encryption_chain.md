# 阶段 1: 加密链逆向 (通用, 一次性)

## Overview

- **Input**: sdenv-generated Cookie T + keys
- **Output**: `generateCookie(basearr, keys) -> Cookie T`
- **Verification**: sdenv basearr + generateCookie -> HTTP GET -> 200

---

## 加密管线 (7 steps)

```
basearr (154-166B)
  -> Huffman 编码 (~118B)
  -> 前 16 字节 XOR keys[2][0:15]
  -> AES-128-CBC (key=keys[17], IV=全零, PKCS7) -> ~128B
  -> 拼 packet: [2, 8, r2mkaTime(4B), now(4B), 48, keys48(48B), lenEnc, cipher]
  -> CRC32 -> [crc(4B), packet] -> ~193B
  -> AES-128-CBC (key=keys[16], IV=随机16B, PKCS7) -> ~224B
  -> 自定义 Base64 -> "0" + 299 字符
```

---

## 各组件完整实现

### Huffman encoding

权重: byte=0 -> 45, byte=255 -> 6, others -> 1 (所有版本通用)

```javascript
let huffCfg;
function huffInit() {
    let a = [];
    for (let i = 1; i < 255; i++) a.push({t:1, i});
    a.push({t:6, i:255}, {t:45, i:0});
    function ins(x) {
        for (let i = 0; i < a.length; i++) {
            if (x.t <= a[i].t) { a.splice(i, 0, x); return; }
        }
        a.push(x);
    }
    while (a.length > 1) {
        const [x, y] = a.splice(0, 2);
        ins({t: x.t + y.t, f: x, s: y});
    }
    const cfg = [];
    function walk(n, k=0, v=0) {
        if (n.i !== undefined) cfg[n.i] = {k, v};
        else { walk(n.f, k<<1, v+1); walk(n.s, (k<<1)+1, v+1); }
    }
    walk(a[0]);
    let topKey;
    for (let i in cfg) if (cfg[i].v >= 8) { topKey = cfg[i].k >> (cfg[i].v - 8); break; }
    huffCfg = [cfg, topKey];
}
function huffEncode(arr) {
    if (!huffCfg) huffInit();
    const ans = []; let one = 0, two = 0;
    for (let i = 0; i < arr.length; i++) {
        const c = huffCfg[0][arr[i]];
        one = one << c.v | c.k;
        two += c.v;
        while (two >= 8) { ans.push(one >> (two-8)); one &= ~(255 << (two-8)); two -= 8; }
    }
    if (two > 0) ans.push(one << (8-two) | huffCfg[1] >> two);
    return ans;
}
```

### Huffman decode

```javascript
function huffDecode(data) {
    if (!huffCfg) huffInit();
    const root = { f: null, s: null };
    for (let i = 0; i < 256; i++) {
        if (!huffCfg[0][i]) continue;
        const { k, v } = huffCfg[0][i];
        let node = root;
        for (let bit = v - 1; bit >= 0; bit--) {
            const b = (k >> bit) & 1;
            if (b === 0) { if (!node.f) node.f = {}; node = node.f; }
            else { if (!node.s) node.s = {}; node = node.s; }
        }
        node.i = i;
    }
    const result = [];
    let node = root;
    for (const byte of data) {
        for (let bit = 7; bit >= 0; bit--) {
            node = ((byte >> bit) & 1) ? node.s : node.f;
            if (node && node.i !== undefined) { result.push(node.i); node = root; }
            if (!node) break;
        }
    }
    return result;
}
```

### AES-128-CBC

```javascript
const crypto = require('crypto');
function aesCBC(data, key, iv) {
    const p = 16 - (data.length % 16);
    const padded = Buffer.alloc(data.length + p, p);
    Buffer.from(data).copy(padded);
    const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), iv || Buffer.alloc(16, 0));
    c.setAutoPadding(false);
    return iv
        ? [...iv, ...Buffer.concat([c.update(padded), c.final()])]
        : [...Buffer.concat([c.update(padded), c.final()])];
}
```

### CRC32

```javascript
const CRC_T = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_T[i] = c;
}
function crc32(d) {
    if (typeof d === 'string') d = unescape(encodeURIComponent(d)).split('').map(c => c.charCodeAt(0));
    let c = ~0;
    for (let i = 0; i < d.length; i++) c = (c >>> 8) ^ CRC_T[(c ^ d[i]) & 0xFF];
    return (~c) >>> 0;
}
```

### 自定义 Base64 (encode + decode)

Alphabet: `qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d`

```javascript
const B64 = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d';
function b64Enc(data) {
    const r = []; let i = 0; const l = data.length - 2;
    while (i < l) {
        const a = data[i++], b = data[i++], c = data[i++];
        r.push(B64[a>>2], B64[((a&3)<<4)|(b>>4)], B64[((b&15)<<2)|(c>>6)], B64[c&63]);
    }
    if (i < data.length) {
        const a = data[i], b = data[++i];
        r.push(B64[a>>2], B64[((a&3)<<4)|(b>>4)]);
        if (b !== undefined) r.push(B64[(b&15)<<2]);
    }
    return r.join('');
}
function b64Dec(s) {
    const rev = {};
    for (let i = 0; i < B64.length; i++) rev[B64[i]] = i;
    const r = []; let i = 0;
    while (i < s.length) {
        const a = rev[s[i++]] || 0, b = rev[s[i++]] || 0;
        const c = i < s.length ? rev[s[i++]] : undefined;
        const d = i < s.length ? rev[s[i++]] : undefined;
        r.push((a << 2) | (b >> 4));
        if (c !== undefined) r.push(((b & 15) << 4) | (c >> 2));
        if (d !== undefined) r.push(((c & 3) << 6) | d);
    }
    return r;
}
```

### Helper functions

```javascript
function n4(n) { return [(n>>24)&255, (n>>16)&255, (n>>8)&255, n&255]; }
function numToNumarr4(n) {
    if (Array.isArray(n)) return n.flatMap(x => numToNumarr4(x));
    if (typeof n !== 'number') n = 0;
    return [(n>>24)&255, (n>>16)&255, (n>>8)&255, n&255];
}
function numToNumarr2(n) {
    if (typeof n !== 'number' || n < 0) n = 0;
    if (n > 65535) n = 65535;
    return [n >> 8, n & 255];
}
function numToNumarr8(num) {
    if (typeof num !== 'number' || num < 0) num = 0;
    const high = Math.floor(num / 4294967296);
    const low = num % 4294967296;
    return [...numToNumarr4(high), ...numToNumarr4(low)];
}
function string2ascii(str) { return str.split('').map(c => c.charCodeAt(0)); }
function ascii2string(arr) { return String.fromCharCode(...arr); }
function toAscii(str) { return [str.length, ...string2ascii(str)]; }
```

### generateCookie 组装

```javascript
function generateCookie(basearr, keys) {
    const K1 = keys[17], K2 = keys[16], K48 = keys[2];
    const r2t = parseInt(String.fromCharCode(...keys[21]));
    const now = Math.floor(Date.now() / 1000);

    const enc = huffEncode(basearr);
    const xored = enc.slice();
    for (let i = 0; i < 16 && i < xored.length; i++) xored[i] ^= K48[i];
    const cipher = aesCBC(xored, K1);

    const cLen = cipher.length;
    const lenE = cLen < 128 ? [cLen] : [0x80 | (cLen >> 8), cLen & 0xFF];
    const pkt = [2, 8, ...n4(r2t), ...n4(now), 48, ...K48, ...lenE, ...cipher];

    const crcVal = crc32(pkt);
    const full = [...n4(crcVal), ...pkt];
    const iv = crypto.randomBytes(16);
    return '0' + b64Enc(aesCBC(full, K2, iv));
}
```

### Cookie T 完整解密流程 (for hybrid verification)

```javascript
function decryptCookieT(cookieT, keys) {
    const bytes = b64Dec(cookieT.substring(1));
    const iv = Buffer.from(bytes.slice(0, 16));
    const ct = Buffer.from(bytes.slice(16));
    const dec1 = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[16]), iv);
    let outer = [...Buffer.concat([dec1.update(ct), dec1.final()])];
    outer = outer.slice(0, outer.length - outer[outer.length - 1]);
    const packet = outer.slice(4);
    let p = 2 + 8 + 1 + 48;
    const cipherLen = packet[p] < 128 ? packet[p++] : ((packet[p++] & 0x7F) << 8) | packet[p++];
    const cipher = packet.slice(p, p + cipherLen);
    const dec2 = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[17]), Buffer.alloc(16, 0));
    let inner = [...Buffer.concat([dec2.update(Buffer.from(cipher)), dec2.final()])];
    inner = inner.slice(0, inner.length - inner[inner.length - 1]);
    for (let i = 0; i < 16 && i < inner.length; i++) inner[i] ^= keys[2][i];
    return huffDecode(inner);
}
```

---

## 常见坑

- AES 密钥直接用 `keys[17]`/`keys[16]` 原始 16 字节, 不需要包装
- nonce = `[r2mkaTime(4B), currentTime(4B)]`
- 密文长度编码: <128 用 1 字节, >=128 用 2 字节 `[0x80|hi, lo]`
- HTTP 下载 mainjs 必须用 Buffer 拼接 + `toString('utf-8')`, 不能用 string 拼接 (破坏多字节字符)
