/**
 * basearr 纯算生成器
 * Phase 1: 简单字段 (type=3, type=10, type=0/9/13)
 * Phase 2: type=6 (keys[22] 加密)
 * Phase 3: type=2 (fixedValue20)
 * Phase 4: type=7 (codeUid)
 *
 * 参考: rs-reverse len157.js + 真实数据对照
 */

// ============================================================
// 工具函数 (来自 rs-reverse parser/common/)
// ============================================================

// CRC32 (= rs-reverse 的 uuid 函数)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1; CRC_TABLE[i] = c; }
function crc32(input) {
    if (typeof input === 'string') input = unescape(encodeURIComponent(input)).split('').map(c => c.charCodeAt(0));
    let val = 0 ^ -1;
    for (let i = 0; i < input.length; i++) val = val >>> 8 ^ CRC_TABLE[(val ^ input[i]) & 255];
    return (val ^ -1) >>> 0;
}

function numToNumarr4(n) {
    if (Array.isArray(n)) return n.flatMap(x => numToNumarr4(x));
    if (typeof n !== 'number') n = 0;
    return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
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

function string2ascii(str) {
    return str.split('').map(c => c.charCodeAt(0));
}

function ascii2string(arr) {
    return String.fromCharCode(...arr);
}

function numarrJoin(...args) {
    return args.reduce((ans, it) => {
        if (it === undefined || it === null) return ans;
        if (ans.length === 0) return Array.isArray(it) ? it : [it];
        if (!Array.isArray(it)) return [...ans, it];
        return [...ans, it.length, ...it];
    }, []);
}

// ============================================================
// Phase 1: 简单字段
// ============================================================

function buildType3(config) {
    // 参考 len157.js, 但我们站点是 73B (比 len157 多 8 字节尾部 padding)
    const uaHash = numToNumarr4(crc32(config.userAgent));
    const pathHash = numToNumarr4(crc32(config.pathname.toUpperCase()));
    const execTime = numToNumarr4(config.execNumberByTime || 1600);
    const randomAvg = config.randomAvg || [50, 8]; // execRandomByNumber(98) 的结果

    return numarrJoin(
        1,                                          // 子类型
        config.maxTouchPoints || 0,                 // maxTouchPoints
        config.evalToStringLength || 33,            // eval.toString().length
        128,                                        // 固定
        ...uaHash,                                  // CRC32(UA)
        string2ascii(config.platform || 'MacIntel'),// platform (数组 → numarrJoin 加长度前缀)
        ...execTime,                                // 循环计数
        ...randomAvg,                               // 随机平均
        0, 0,                                       // 固定
        ...numToNumarr4(16777216),                    // = [1,0,0,0], 同 len157
        ...numToNumarr4(0),
        ...numToNumarr2(config.innerHeight || 938),
        ...numToNumarr2(config.innerWidth || 1680),
        ...numToNumarr2(config.outerHeight || 1025),
        ...numToNumarr2(config.outerWidth || 1680),
        ...numToNumarr8(0),                         // canvas/WebGL (空)
        ...numToNumarr4(0),                         // 我们站点为 0 (len157 为 4)
        ...numToNumarr4(0),
        ...pathHash,                                // CRC32(pathname)
        ...numToNumarr4(0),
        ...numToNumarr4(0),                         // ★ 我们站点额外的 4 字节 padding
        ...numToNumarr4(0),                         // ★ 额外 4 字节
    );
}

function buildType10(config, keys) {
    const r2mkaTime = parseInt(ascii2string(keys[21]));
    const k19val = parseInt(ascii2string(keys[19]));
    const k24val = parseInt(ascii2string(keys[24]));
    const k25val = parseInt(ascii2string(keys[25]));
    const k26val = parseInt(ascii2string(keys[26]));
    const runTime = config.runTime || Math.floor(Date.now() / 1000);
    const startTime = config.startTime || (runTime - 1);
    const currentTime = config.currentTime || Date.now();

    // type=10[10..17] = numToNumarr8(random_20bit * 2^32 + currentTime_32bit)
    const random20 = Math.floor(Math.random() * 1048575);
    const time32 = (currentTime & 0xFFFFFFFF) >>> 0;
    const bigVal = random20 * 4294967296 + time32;

    return numarrJoin(
        3,                                              // 固定
        13,                                             // 固定 (len157 硬编码)
        ...numToNumarr4(r2mkaTime + runTime - startTime), // ★ 有偏移!
        ...numToNumarr4(k19val),                        // keys[19]
        ...numToNumarr8(bigVal),                        // random + time
        k24val,                                         // keys[24]
        string2ascii(config.hostname.substr(0, 20)),    // hostname (数组)
    );
}

function buildType7(config, keys) {
    // type=7[8..9] = 站点特定 flag (我们站点 = 2830, len157 = 3855)
    // type=7[10..11] = codeUid (从 eval 代码函数 CRC32 计算)
    // TODO: 实现 codeUid 计算 (需要 eval 代码 + 函数定位)
    const flag = config.flag || 2830;
    const codeUid = config.codeUid || 0;
    return [
        ...numToNumarr4(16777216),    // [1, 0, 0, 0]
        ...numToNumarr4(0),           // [0, 0, 0, 0]
        ...numToNumarr2(flag),        // 站点 flag
        ...numToNumarr2(codeUid),     // codeUid
    ];
}

function buildType6(config, keys) {
    // Phase 2: keys[22] 解密
    // decrypt(ascii(keys[22])) → 32B (16B_IV + 16B_ciphertext)
    // AES-CBC 解密 (key=keys[16], iv=前16B) → 8B 明文
    // 明文直接作为 type=6 中间数据
    // decode(明文) → parseInt → numToNumarr2 作为尾部
    const crypto = require('crypto');

    // 自定义 Base64 解码 keys[22]
    const k22str = ascii2string(keys[22]);
    const dk = {};
    for (let i = 0; i < 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^'.length; i++) {
        const c = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^'.charCodeAt(i);
        if (!dk[0]) dk[0] = {}; dk[0][c] = i << 2;
        if (!dk[1]) dk[1] = {}; dk[1][c] = i >> 4;
        if (!dk[2]) dk[2] = {}; dk[2][c] = (i & 15) << 4;
        if (!dk[3]) dk[3] = {}; dk[3][c] = i >> 2;
        if (!dk[4]) dk[4] = {}; dk[4][c] = (i & 3) << 6;
        if (!dk[5]) dk[5] = {}; dk[5][c] = i;
    }
    const k22dec = [];
    for (let i = 0; i < k22str.length; i += 4) {
        const c = [0,1,2,3].map(j => i+j < k22str.length ? k22str.charCodeAt(i+j) : undefined);
        if (c[1] !== undefined) k22dec.push(dk[0][c[0]] | dk[1][c[1]]);
        if (c[2] !== undefined) k22dec.push(dk[2][c[1]] | dk[3][c[2]]);
        if (c[3] !== undefined) k22dec.push(dk[4][c[2]] | dk[5][c[3]]);
    }

    // AES-128-CBC 解密
    const iv = Buffer.from(k22dec.slice(0, 16));
    const ct = Buffer.from(k22dec.slice(16));
    const dc = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[16]), iv);
    dc.setAutoPadding(false);
    const plain = Buffer.concat([dc.update(ct), dc.final()]);
    const pad = plain[plain.length - 1];
    const decrypted = [...plain.slice(0, plain.length - pad)];

    // decode (UTF-8) → parseInt → numToNumarr2
    // rs-reverse decode.js: 按 UTF-8 多字节规则解码后取字符串, parseInt
    // 解密结果通常不是合法 UTF-8 文本, parseInt 返回 NaN → 0
    function utf8Decode(arr) {
        const chars = [];
        for (let i = 0; i < arr.length; i++) {
            const b = arr[i];
            if (b < 128) chars.push(b);
            else if (b < 192) chars.push(63); // ?
            else if (b < 224) { chars.push((b & 63) << 6 | arr[++i] & 63); }
            else if (b < 240) { chars.push((b & 15) << 12 | (arr[++i] & 63) << 6 | arr[++i] & 63); }
            else { i += 3; chars.push(63); }
        }
        return String.fromCharCode(...chars);
    }
    const decoded = utf8Decode(decrypted);
    const decodedNum = parseInt(decoded) || 0;

    return [
        1,
        ...numToNumarr2(0),
        ...numToNumarr2(0),
        config.documentHidden ? 0 : 1,
        ...decrypted,                      // AES 解密的 8 字节
        ...numToNumarr2(decodedNum),       // decode + parseInt
    ];
}

function buildType2(config, keys) {
    // 数据驱动 (2026-04-10 重新采集 3 session 验证):
    // cp1 索引 → 值映射: {22:225, 21:203, 30:100, 3:181}
    // 值固定不随 nsd 变, cp1 索引也固定
    const cp1 = config._cp1;
    if (!cp1) return [225, 203, 100, 181];

    const indexToValue = { 22: 225, 21: 203, 30: 100, 3: 181 };

    return [29, 30, 31, 32].map(i => {
        const name = ascii2string(keys[i]);
        const cpIdx = cp1.indexOf(name);
        return indexToValue[cpIdx] || 0;
    });
}

function buildType9(config) {
    // 我们站点: [8, 0] (2B)
    // len157 站点: [oper, level, chargingTime(2B), connIdx] (5B)
    // 站点差异! 我们的只有 2 字节
    return [8, 0];
}

// ============================================================
// 组装 basearr
// ============================================================
function buildBasearr(config, keys) {
    return numarrJoin(
        3, buildType3(config),
        10, buildType10(config, keys),
        7, buildType7(config, keys),
        0, [0],
        6, buildType6(config, keys),
        2, buildType2(config, keys),
        9, buildType9(config),
        13, [0],
    );
}

// ============================================================
// 测试: 对照参考数据
// ============================================================
if (require.main === module) {
    const fs = require('fs');
    const path = require('path');
    const refBasearr = JSON.parse(fs.readFileSync(path.join(__dirname, 'ref_data/basearr.json'), 'utf-8'));
    const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'ref_data/keys_raw.json'), 'utf-8'));

    const config = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        pathname: '/zscq/search/jsp/vBrandSearchIndex.jsp',
        hostname: '202.127.48.145',
        platform: 'MacIntel',
        execNumberByTime: 1600,
        randomAvg: [50, 8],
        innerHeight: 768, innerWidth: 1024,
        outerHeight: 768, outerWidth: 1024,
        runTime: Math.floor(Date.now() / 1000),
        startTime: Math.floor(Date.now() / 1000) - 1,
        currentTime: Date.now(),
        documentHidden: false,
    };

    const generated = buildBasearr(config, keys);
    console.log('生成:', generated.length, 'B');
    console.log('参考:', refBasearr.length, 'B');
    console.log('');

    // 逐字段对比
    let pos1 = 0, pos2 = 0;
    while (pos1 < generated.length && pos2 < refBasearr.length) {
        const t1 = generated[pos1], l1 = generated[pos1 + 1];
        const t2 = refBasearr[pos2], l2 = refBasearr[pos2 + 1];
        if (t1 !== t2) { console.log('type 不匹配:', t1, 'vs', t2); break; }

        const d1 = generated.slice(pos1 + 2, pos1 + 2 + l1);
        const d2 = refBasearr.slice(pos2 + 2, pos2 + 2 + l2);
        const match = d1.length === d2.length && d1.every((b, i) => b === d2[i]);

        let diffCount = 0;
        const minLen = Math.min(d1.length, d2.length);
        for (let i = 0; i < minLen; i++) if (d1[i] !== d2[i]) diffCount++;
        diffCount += Math.abs(d1.length - d2.length);

        console.log('type=' + t1 + ' len=' + l1 + '/' + l2 + ': ' +
            (match ? '✅ 完全匹配' : '❌ ' + diffCount + '/' + Math.max(d1.length, d2.length) + ' 字节不同'));

        pos1 += 2 + l1;
        pos2 += 2 + l2;
    }
}

module.exports = { buildBasearr, buildType3, buildType10, buildType7, buildType6, buildType2, buildType9, crc32, numarrJoin, numToNumarr4, numToNumarr2, numToNumarr8, string2ascii, ascii2string };
