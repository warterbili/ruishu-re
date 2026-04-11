/**
 * basearr 纯算生成器
 * 验证: HTTP 200
 *
 * 适配新站点时主要修改:
 *   - buildType3  (字段结构 -- 环境指纹)
 *   - buildType7  (flag -- 站点标识)
 *   - buildType9  (2B/5B -- 站点特定)
 *   - buildType2  (映射表 -- 数据驱动采集)
 */
const crypto = require('crypto');

// ================================================================
// CRC32
// ================================================================
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[i] = c;
}

function crc32(input) {
    // 字符串先转 UTF-8 字节数组
    if (typeof input === 'string') {
        input = unescape(encodeURIComponent(input))
            .split('')
            .map(c => c.charCodeAt(0));
    }
    let val = 0 ^ -1;
    for (let i = 0; i < input.length; i++) {
        val = (val >>> 8) ^ CRC_TABLE[(val ^ input[i]) & 255];
    }
    return (val ^ -1) >>> 0;
}

// ================================================================
// 数值转换工具
// ================================================================

// 32 位整数 -> 4 字节大端数组
function numToNumarr4(n) {
    if (Array.isArray(n)) return n.flatMap(x => numToNumarr4(x));
    if (typeof n !== 'number') n = 0;
    return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 16 位整数 -> 2 字节大端数组
function numToNumarr2(n) {
    if (typeof n !== 'number' || n < 0) n = 0;
    if (n > 65535) n = 65535;
    return [n >> 8, n & 255];
}

// 64 位整数 -> 8 字节大端数组 (JS 用 high/low 拆分)
function numToNumarr8(num) {
    if (typeof num !== 'number' || num < 0) num = 0;
    const high = Math.floor(num / 4294967296);
    const low = num % 4294967296;
    return [...numToNumarr4(high), ...numToNumarr4(low)];
}

// 字符串 <-> ASCII 字节数组
function string2ascii(str) {
    return str.split('').map(c => c.charCodeAt(0));
}

function ascii2string(arr) {
    return String.fromCharCode(...arr);
}

// ================================================================
// numarrJoin: 拼接 TLV 结构
// 规则: 数组自动加 length 前缀, 标量直接追加
// ================================================================
function numarrJoin(...args) {
    return args.reduce((ans, it) => {
        if (it === undefined || it === null) return ans;
        if (ans.length === 0) return Array.isArray(it) ? it : [it];
        if (!Array.isArray(it)) return [...ans, it];
        return [...ans, it.length, ...it];
    }, []);
}

// ================================================================
// type=3: 环境指纹
// 包含 UA hash, 窗口尺寸, 触摸点, URL path hash 等
// ================================================================
function buildType3(config) {
    return numarrJoin(
        1,                                                      // 子类型
        config.maxTouchPoints || 0,                             // 触摸点 (桌面=0)
        config.evalToStringLength || 33,                        // eval.toString().length
        128,                                                    // 固定值
        ...numToNumarr4(crc32(config.userAgent)),               // UA CRC32 hash
        string2ascii(config.platform || 'MacIntel'),            // navigator.platform
        ...numToNumarr4(config.execNumberByTime || 1600),       // 循环性能计数
        ...(config.randomAvg || [50, 8]),                       // Math.random 均值/方差
        0, 0,                                                   // 保留
        ...numToNumarr4(16777216),                              // 固定值 0x1000000
        ...numToNumarr4(0),
        ...numToNumarr2(config.innerHeight || 938),             // window.innerHeight
        ...numToNumarr2(config.innerWidth || 1680),             // window.innerWidth
        ...numToNumarr2(config.outerHeight || 1025),            // window.outerHeight
        ...numToNumarr2(config.outerWidth || 1680),             // window.outerWidth
        ...numToNumarr8(0),                                     // canvas/WebGL 指纹 (此处置 0)
        ...numToNumarr4(0),
        ...numToNumarr4(0),
        ...numToNumarr4(crc32(config.pathname.toUpperCase())),  // URL path CRC32
        ...numToNumarr4(0),
        ...numToNumarr4(0),
        ...numToNumarr4(0),
    );
}

// ================================================================
// type=10: 时间 + 网络
// 用 keys[21], keys[19], keys[24] 计算时间偏移
// ================================================================
function buildType10(config, keys) {
    const r2t = parseInt(ascii2string(keys[21]));               // 服务器下发的参考时间
    const k19 = parseInt(ascii2string(keys[19]));
    const rt = config.runTime || Math.floor(Date.now() / 1000); // 当前秒级时间戳
    const st = config.startTime || (rt - 1);                    // 页面加载时间
    const ct = config.currentTime || Date.now();                // 当前毫秒时间戳
    const r20 = Math.floor(Math.random() * 1048575);            // 20 位随机数
    const hostname = config.hostname.substr(0, 20);             // 截取前 20 字符

    return numarrJoin(
        3, 13,
        ...numToNumarr4(r2t + rt - st),                        // 修正后的时间差
        ...numToNumarr4(k19),
        ...numToNumarr8(r20 * 4294967296 + ((ct & 0xFFFFFFFF) >>> 0)),  // 随机高位 + 时间低位
        parseInt(ascii2string(keys[24])) || 4,                  // 标志字节
        string2ascii(hostname),                                 // hostname ASCII
    );
}

// ================================================================
// type=7: 站点标识
// flag 和 codeUid 是站点特定值
// ================================================================
function buildType7(config) {
    return [
        ...numToNumarr4(16777216),                              // 固定值 0x1000000
        ...numToNumarr4(0),
        ...numToNumarr2(config.flag || 2830),                   // 站点特定 flag (需适配)
        ...numToNumarr2(config.codeUid || 0),                   // codeUid
    ];
}

// ================================================================
// type=6: keys[22] AES 解密
// 从 keys[22] 中解出加密内容, 用 keys[16] 作为 AES-128-CBC 密钥
// ================================================================
function buildType6(config, keys) {
    const k22 = ascii2string(keys[22]);

    // ---- BASESTR 自定义 base 编码解码 ----
    const BS = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';

    // 构建 6 组解码查找表
    const dk = [{}, {}, {}, {}, {}, {}];
    for (let i = 0; i < BS.length; i++) {
        const c = BS.charCodeAt(i);
        dk[0][c] = i << 2;
        dk[1][c] = i >> 4;
        dk[2][c] = (i & 15) << 4;
        dk[3][c] = i >> 2;
        dk[4][c] = (i & 3) << 6;
        dk[5][c] = i;
    }

    // 每 4 字符解码为 3 字节
    const dec = [];
    for (let i = 0; i < k22.length; i += 4) {
        const c = [0, 1, 2, 3].map(j =>
            i + j < k22.length ? k22.charCodeAt(i + j) : undefined
        );
        if (c[1] !== undefined) dec.push(dk[0][c[0]] | dk[1][c[1]]);
        if (c[2] !== undefined) dec.push(dk[2][c[1]] | dk[3][c[2]]);
        if (c[3] !== undefined) dec.push(dk[4][c[2]] | dk[5][c[3]]);
    }

    // ---- AES-128-CBC 解密 (前 16 字节 = IV, 其余 = 密文) ----
    const iv = Buffer.from(dec.slice(0, 16));
    const ct = Buffer.from(dec.slice(16));
    const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[16]), iv);
    d.setAutoPadding(false);
    const plain = Buffer.concat([d.update(ct), d.final()]);

    // 手动去 PKCS7 padding
    const pad = plain[plain.length - 1];
    const decrypted = [...plain.slice(0, plain.length - pad)];

    // ---- UTF-8 字节数组 -> 字符串 ----
    function utf8Dec(a) {
        const c = [];
        for (let i = 0; i < a.length; i++) {
            const b = a[i];
            if (b < 128) {
                c.push(b);
            } else if (b < 192) {
                c.push(63); // '?'
            } else if (b < 224) {
                c.push((b & 63) << 6 | a[++i] & 63);
            } else if (b < 240) {
                c.push((b & 15) << 12 | (a[++i] & 63) << 6 | a[++i] & 63);
            } else {
                i += 3;
                c.push(63); // '?'
            }
        }
        return String.fromCharCode(...c);
    }

    const val = parseInt(utf8Dec(decrypted)) || 0;

    return [
        1,
        ...numToNumarr2(0),
        ...numToNumarr2(0),
        config.documentHidden ? 0 : 1,                         // document.hidden 状态
        ...decrypted,
        ...numToNumarr2(val),
    ];
}

// ================================================================
// type=2: 会话映射 (数据驱动)
// 映射表需要通过 5+ session 采集反推, 以下是示例值
// ================================================================
function buildType2(config, keys) {
    const cp1 = config._cp1;
    if (!cp1) return [103, 101, 224, 181]; // fallback 默认值

    // 固定值查找表 (从数据驱动采集获得, 20 项循环)
    const VALUES = [
        103,   0, 102, 203, 224, 181, 108, 240, 101, 126,
        103,  11, 102, 203, 225, 181, 208, 180, 100, 127,
    ];

    return [29, 30, 31, 32].map(i => {
        const n = ascii2string(keys[i]);
        const idx = cp1.indexOf(n);
        return idx >= 0 && idx < VALUES.length ? VALUES[idx] : 0;
    });
}

// ================================================================
// 最终组装: 按 type 顺序拼接所有段
// ================================================================
function buildBasearr(config, keys) {
    return numarrJoin(
        3,  buildType3(config),             // 环境指纹
        10, buildType10(config, keys),      // 时间 + 网络
        7,  buildType7(config),             // 站点标识
        0,  [0],                            // type=0: 固定占位
        6,  buildType6(config, keys),       // AES 解密段
        2,  buildType2(config, keys),       // 会话映射
        9,  [8, 0],                         // type=9: 站点特定 (有的站 5B)
        13, [0],                            // type=13: 固定占位
    );
}

module.exports = {
    buildBasearr,
    buildType3,
    buildType10,
    buildType7,
    buildType6,
    buildType2,
    crc32,
    numarrJoin,
    numToNumarr4,
    numToNumarr2,
    numToNumarr8,
    string2ascii,
    ascii2string,
};
