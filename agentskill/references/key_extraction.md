# 阶段 2: 密钥提取 (通用, 一次性)

## 概述

- 输入: `$_ts.cd` 字符串
- 输出: `keys[0..44]` (45 组密钥)

## 自定义 Base64 解码 (cd -> bytes)

```javascript
const BASESTR = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';

function mkDecryptKeys() {
    const a = [{},{},{},{},{},{}];
    for (let i = 0; i < BASESTR.length; i++) {
        const c = BASESTR.charCodeAt(i);
        a[0][c] = i << 2;
        a[1][c] = i >> 4;
        a[2][c] = (i & 15) << 4;
        a[3][c] = i >> 2;
        a[4][c] = (i & 3) << 6;
        a[5][c] = i;
    }
    return a;
}

function decodeCd(str) {
    const dk = mkDecryptKeys();
    const a = [];
    for (let i = 0; i < str.length; i += 4) {
        const c = [0,1,2,3].map(j => i+j < str.length ? str.charCodeAt(i+j) : undefined);
        if (c[1] !== undefined) a.push(dk[0][c[0]] | dk[1][c[1]]);
        if (c[2] !== undefined) a.push(dk[2][c[1]] | dk[3][c[2]]);
        if (c[3] !== undefined) a.push(dk[4][c[2]] | dk[5][c[3]]);
    }
    return a;
}
```

## 变长长度解析

```javascript
function readLength(arr, pos) {
    const x = arr[pos++];
    let len;
    if ((x & 128) === 0) len = x;                                    // 0xxxxxxx: 1 字节
    else if ((x & 192) === 128) len = ((x & 63) << 8) | arr[pos++];  // 10xxxxxx: 2 字节
    else if ((x & 224) === 192) len = ((x & 31) << 16) | (arr[pos++] << 8) | arr[pos++]; // 110xxxxx: 3 字节
    else len = x;
    return [len, pos];
}
```

## XOR 偏移推导 + keys 提取

```javascript
function extractKeys(cd) {
    const bytes = decodeCd(cd);
    const codeEnd = (bytes[0] << 8 | bytes[1]) + 2;
    const keysPart = bytes.slice(codeEnd);

    // 已知明文攻击: keys[0]="64"(ASCII 0x36,0x34), keys[1]="64", keys[2]=48B
    const offset = [
        keysPart[0] ^ 45,    // keyCount = 45
        keysPart[1] ^ 2,     // keys[0].length = 2
        keysPart[2] ^ 0x36,  // '6'
        keysPart[3] ^ 0x34,  // '4'
        keysPart[4] ^ 2,     // keys[1].length = 2
        keysPart[5] ^ 0x36,  // '6'
        keysPart[6] ^ 0x34,  // '4'
        keysPart[7] ^ 48     // keys[2].length = 48
    ];

    const decrypted = keysPart.map((b, i) => b ^ offset[i % 8]);
    const keys = []; let pos = 1;
    for (let i = 0; i < decrypted[0]; i++) {
        const [len, newPos] = readLength(decrypted, pos);
        pos = newPos;
        keys.push(decrypted.slice(pos, pos + len));
        pos += len;
    }

    // 自检
    if (keys.length < 45) throw new Error('keys 不足 ' + keys.length + '/45, XOR 偏移可能错误');
    if ([29,30,31,32].some(i => keys[i]?.length !== 4))
        throw new Error('keys[29..32] 结构异常, 需要实现 r2mka runTask');

    return keys;
}
```

## 关键 keys 含义表

| key | 含义 | 用途 |
|-----|------|------|
| keys[2] | 48B KEYS48 | XOR + packet 内嵌 |
| keys[7] | 配置串 (分号分隔) | split(';')[5]+'T' = Cookie 名 |
| keys[16] | 16B KEY2 | 外层 AES 密钥 |
| keys[17] | 16B KEY1 | 内层 AES 密钥 |
| keys[19] | 时间戳串 | type=10[6..9] |
| keys[21] | r2mkaTime 串 | nonce 时间 |
| keys[22] | 加密数据 | type=6 AES 解密 |
| keys[24-26] | 数值串 | type=10 参数 |
| keys[29-32] | 各 4B | type=2 变量名映射 |
| keys[33-34] | 数值串 | codeUid 计算参数 |

## 当自检失败时 (keys[0] != "64")

需要实现 rs-reverse 的 tscd.js: cd code 段 -> parse -> getTaskarr -> runTaskByUid -> 8 字节 XOR 偏移。难度高, 大部分站点不需要。优先用上述简化方法 + 自检。
