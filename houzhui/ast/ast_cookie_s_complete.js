/**
 * AST 完整追踪: Cookie S → 49B session
 * 提取所有相关函数，自动翻译，生成可运行代码
 */
const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');

const code = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');
const ast = acorn.parse(code, { ecmaVersion: 2020 });

// 收集所有函数
const allFuncs = {};
walk.simple(ast, {
    FunctionDeclaration(node) {
        if (node.id) allFuncs[node.id.name] = node;
    }
});

function getSrc(name) {
    const n = allFuncs[name];
    return n ? code.substring(n.start, n.end) : null;
}

function getParams(name) {
    const n = allFuncs[name];
    return n ? n.params.map(p => p.name) : [];
}

// Push args
const pushStart = code.indexOf("_$cR.push(") + "_$cR.push(".length;
let depth = 0, pushArgs = [], current = '';
for (let i = pushStart; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if (c === ',' && depth === 0) { pushArgs.push(current.trim()); current = ''; continue; }
    current += c;
}
if (current.trim()) pushArgs.push(current.trim());
const BASE = 56;
function rtName(n) { return pushArgs[n - BASE] || 'rt[' + n + ']'; }

// ============================================================
// 1. 提取 Cookie S 处理链的所有函数
// ============================================================
const chainFuncs = {
    233: '_$fB',   // Cookie reader
    235: '_$_0',   // Array index: rt[34][N]
    453: '_$lh',   // uint32 → 4 bytes
    157: '_$i1',   // XOR in-place
    447: '_$$H',   // String concat
    215: '_$cv',   // String concat
    204: '_$bA',   // String concat
};

console.log('=== Cookie S 处理链函数 ===\n');
const translated = [];

// _$fB — Cookie reader
translated.push(`
// Cookie reader: reads cookie value by name prefix
function readCookie(name, cookieStr) {
    name = name + "=";
    const parts = cookieStr.split("; ");
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].substring(0, name.length) === name) {
            return parts[i].substring(name.length);
        }
    }
    return undefined;
}
`);
console.log('✓ readCookie (from _$fB)');

// _$_0 — rt[34] lookup
// rt[34] 是什么？
const rt34name = pushArgs[34 - BASE];
console.log('rt[34] =', rt34name || '(pre-push, index < 56)');
// rt[34] < 56, 所以是预填充的。在 while(1) 中被赋值
// 之前 AST 找到: _$cR[34] 没有在预填充中
// 它可能是一个字符串表/数据数组
translated.push(`
// Data lookup: returns rt[34][index]
// rt[34] is a pre-populated data array set during VM init
function dataLookup(index, dataTable) {
    return dataTable[index];
}
`);
console.log('✓ dataLookup (from _$_0)');

// _$lh — uint32 to 4 bytes
const lhSrc = getSrc('_$lh');
console.log('\n_$lh source:', lhSrc);
translated.push(`
// Convert uint32 to 4-byte array [b3, b2, b1, b0]
function uint32ToBytes(val) {
    return [
        (val >>> 24) & 0xFF,
        (val >>> 16) & 0xFF,
        (val >>> 8) & 0xFF,
        val & 0xFF
    ];
}
`);
console.log('✓ uint32ToBytes (from _$lh)');

// _$i1 — XOR in-place
const i1Src = getSrc('_$i1');
console.log('\n_$i1 source:', i1Src);
translated.push(`
// XOR in-place: a[i] ^= b[i] for i=0..len-1
function xorInPlace(a, b, len) {
    for (let i = 0; i < len; i++) a[i] ^= b[i];
}
`);
console.log('✓ xorInPlace (from _$i1)');

// ============================================================
// 2. 找 Base64 解码函数 (Cookie S 值是 base64)
// ============================================================
console.log('\n=== Base64 解码 ===');
// Cookie S 用自定义 Base64 编码 (和 Cookie T 相同的 86 字符表)
// 搜索包含 86 字符映射表的函数
for (const [name, node] of Object.entries(allFuncs)) {
    const src = code.substring(node.start, node.end);
    if (src.length > 50 && src.length < 500 && src.includes('charCodeAt') && src.includes('>>4')) {
        console.log('Base64 decode candidate:', name, '(' + src.length + ' chars)');
        console.log(src.substring(0, 200));
        console.log('');
    }
}

// ============================================================
// 3. 找 _$kH (string decoder) — 解码 Cookie 名称
// ============================================================
console.log('\n=== _$kH string decoder ===');
const khSrc = getSrc('_$kH');
if (khSrc) {
    console.log(khSrc);
    translated.push(`
// String decoder (Caesar-like cipher)
function decodeString(encoded) {
    const len = encoded.length;
    const result = new Array(len - 1);
    const shift = encoded.charCodeAt(0) - 97;
    let outIdx = 0;
    for (let i = 1; i < len; i++) {
        let ch = encoded.charCodeAt(i);
        if (ch >= 40 && ch < 92) { ch += shift; if (ch >= 92) ch -= 52; }
        else if (ch >= 97 && ch < 127) { ch += shift; if (ch >= 127) ch -= 30; }
        result[outIdx++] = ch;
    }
    return String.fromCharCode.apply(null, result);
}
`);
    console.log('✓ decodeString (from _$kH)');
}

// ============================================================
// 4. 找 Cookie S 的 Base64 解码入口
// ============================================================
console.log('\n=== Cookie S Base64 解码 ===');
// _$cR[34] 是通过 _$_0 访问的数据表
// 但 Cookie S 值首先需要 base64 解码
// 搜索 atob 或自定义 base64 decode

// 在 _$dm 中搜索对 Cookie S 值的处理
// 关键: rt[233]=_$fB 返回 cookie 值字符串
// 这个字符串被传给什么函数?

// 从 child[59].child[49] 字节码:
// pc24-29: [] C0p EXT(233) []p → 调用 rt[233](_$fB) 读取 cookie
// 然后后续处理

// 从 child[59].child[35] 字节码:
// [37,233,233,233,13,...] — op37 带参数 233,233,233 然后 RET
// op37 可能是字符串构建: "fa" + "0" + "-" + 数字

console.log('child[59].child[35] 构建 Cookie 子键名称:');
console.log('  op37(233,233,233) → 可能构建 "fa0-N" 格式的子键');
console.log('  后续 G(75)... → 读取子键数据');

// ============================================================
// 5. 分析 child[59].child[40] (1031B, 最大子函数)
// ============================================================
console.log('\n=== child[59].child[40] 分析 (1031B, 核心解密逻辑) ===');
const r2mka = JSON.parse(fs.readFileSync('debug_output/r2mka_parsed.json', 'utf-8'));
const c40 = r2mka.root.children[59].children[40];
const c40bc = c40.bytecode;

// 搜索 c40 中引用的 rt 函数
const extRefs = [];
for (let i = 0; i < c40bc.length; i++) {
    if (c40bc[i] === 20) { // EXT opcode
        extRefs.push({ pc: i, rtIdx: c40bc[i+1], name: rtName(c40bc[i+1]) });
    }
}
console.log('External (rt) references in child[40]:');
extRefs.forEach(r => console.log('  pc' + r.pc + ': rt[' + r.rtIdx + '] = ' + r.name));

// ============================================================
// 6. 找 Huffman decode 和其他解密函数
// ============================================================
console.log('\n=== 搜索 Huffman/解密相关 rt 函数 ===');
const uniqueRt = [...new Set(extRefs.map(r => r.rtIdx))].sort((a,b) => a-b);
uniqueRt.forEach(idx => {
    const name = rtName(idx);
    const src = getSrc(name);
    if (src) {
        const features = [];
        if (src.includes('>>')) features.push('SHIFT');
        if (src.includes('^')) features.push('XOR');
        if (src.includes('charCodeAt')) features.push('CHARCODE');
        if (src.includes('push')) features.push('PUSH');
        if (src.includes('for')) features.push('LOOP');
        console.log('  rt[' + idx + '] = ' + name + ' (' + src.length + ' chars) [' + features.join(',') + ']');
        if (src.length < 200) console.log('    ' + src.replace(/\s+/g, ' ').substring(0, 150));
    } else {
        console.log('  rt[' + idx + '] = ' + name + ' (variable/closure)');
    }
});

// ============================================================
// 7. 输出翻译结果
// ============================================================
fs.writeFileSync('debug_output/cookie_s_translated.js', translated.join('\n'));
console.log('\n★ 翻译结果保存到 cookie_s_translated.js');
