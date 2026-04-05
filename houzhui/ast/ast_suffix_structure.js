/**
 * AST 重新分析后缀 88B/120B 的真实结构
 *
 * 从 rt[239] (_$bs, 15KB) 追踪完整的后缀组装流程
 * 特别关注 URL 数据如何被编码进后缀
 */
const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');

const code = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');
const ast = acorn.parse(code, { ecmaVersion: 2020 });
const bsSrc = fs.readFileSync('debug_output/rt239_source.js', 'utf-8');

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

// push args
const pushStart = code.indexOf("_$cR.push(") + "_$cR.push(".length;
let depth = 0, pushArgs = [], cur = '';
for (let i = pushStart; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if (c === ',' && depth === 0) { pushArgs.push(cur.trim()); cur = ''; continue; }
    cur += c;
}
if (cur.trim()) pushArgs.push(cur.trim());
const BASE = 56;
function rtName(n) { return (n >= BASE && n-BASE < pushArgs.length) ? pushArgs[n-BASE] : 'rt['+n+']'; }

// ============================================================
// 1. 找 _$bs 中的 XHR.open hook — 这是后缀入口
// ============================================================
console.log('=== _$bs 中的关键子函数 ===\n');

// _$bs 内部的 _$ca 函数处理事件
// _$bs 内部的 _$lQ 函数可能是最终发送
// 找所有涉及 URL/pathname/search/href 的函数

const innerFuncs = [];
const funcRe = /function\s+(_\$\w+)\s*\(([^)]*)\)\s*\{/g;
let m;
while (m = funcRe.exec(bsSrc)) {
    const name = m[1], params = m[2], start = m.index;
    let d = 0;
    for (let i = start + m[0].length - 1; i < bsSrc.length; i++) {
        if (bsSrc[i] === '{') d++;
        else if (bsSrc[i] === '}') { d--; if (d === 0) {
            const src = bsSrc.substring(start, i+1);
            // 检查是否包含 URL 相关操作
            const hasURL = src.includes('href') || src.includes('pathname') ||
                          src.includes('search') || src.includes('hostname') ||
                          src.includes('createElement') || src.includes('protocol');
            const hasXHR = src.includes('open') || src.includes('XMLHttpRequest') || src.includes('send');
            const hasSuffix = src.includes('8h6a7FPl') || src.includes('suffix') || src.includes('_$dm(');

            if (hasURL || hasXHR || hasSuffix) {
                innerFuncs.push({ name, params, len: src.length, hasURL, hasXHR, hasSuffix, src });
            }
            break;
        }}
    }
}

console.log('URL/XHR/Suffix 相关函数:');
innerFuncs.forEach(f => {
    const tags = [];
    if (f.hasURL) tags.push('URL');
    if (f.hasXHR) tags.push('XHR');
    if (f.hasSuffix) tags.push('SUFFIX');
    console.log('  ' + f.name + '(' + f.params + ') ' + f.len + ' chars [' + tags.join(', ') + ']');
});

// ============================================================
// 2. 找 createElement('a') 的调用
// ============================================================
console.log('\n=== createElement("a") 搜索 ===');

// 在 eval code 全局搜索
walk.simple(ast, {
    CallExpression(node) {
        if (node.callee.type === 'MemberExpression' &&
            node.arguments.length === 1 &&
            node.arguments[0].type === 'Literal' &&
            node.arguments[0].value === 'a') {
            // 可能是 createElement('a')
            const ctx = code.substring(Math.max(0, node.start - 30), Math.min(code.length, node.end + 50));
            if (ctx.includes('createElement') || ctx.includes('[16]')) {
                console.log('  createElement("a") at ' + node.start);
                console.log('    ' + ctx.replace(/\s+/g, ' ').substring(0, 100));
            }
        }
    }
});

// 也搜索 g72[30] = "a" (通过字符串表访问)
// _$jO[30] = "a"
console.log('\n=== 通过字符串表访问 "a" ===');
// 在 _$bs 内部搜索
const aRefs = bsSrc.match(/_\$jO\[30\]/g);
console.log('_$jO[30] ("a") in _$bs:', aRefs ? aRefs.length : 0, 'times');

// ============================================================
// 3. 找 pathname/search/hostname 访问
// ============================================================
console.log('\n=== URL 属性访问 ===');
// g68[13] = "pathname", g68[85] = "search", g68[32] = "hostname"
// g72[86] = "protocol"
const urlProps = {
    '_$dn[13]': 'pathname',
    '_$dn[85]': 'search',
    '_$dn[32]': 'hostname',
    '_$jO[86]': 'protocol',
    '_$jO[59]': 'href',
    '_$jO[85]': 'search',
};

Object.entries(urlProps).forEach(([pattern, name]) => {
    const re = new RegExp(pattern.replace(/[[\]$]/g, '\\$&'), 'g');
    const count = (bsSrc.match(re) || []).length;
    if (count > 0) console.log('  ' + pattern + ' (' + name + '): ' + count + 'x in _$bs');
});

// 也在 eval code 全局搜索
console.log('\n=== eval code 全局 URL 属性 ===');
Object.entries(urlProps).forEach(([pattern, name]) => {
    const re = new RegExp(pattern.replace(/[[\]$]/g, '\\$&'), 'g');
    const count = (code.match(re) || []).length;
    console.log('  ' + pattern + ' (' + name + '): ' + count + 'x');
});

// ============================================================
// 4. 找 XHR.open 的 hook 函数
// ============================================================
console.log('\n=== XHR.open hook ===');
// 搜索 _$jO[31] = "open" 的重写
walk.simple(ast, {
    AssignmentExpression(node) {
        if (node.left.type === 'MemberExpression' &&
            node.left.computed) {
            const leftSrc = code.substring(node.left.start, node.left.end);
            if (leftSrc.includes('[31]') || leftSrc.includes('open')) {
                const rightSrc = code.substring(node.right.start, node.right.end);
                if (rightSrc.includes('function') && rightSrc.length < 200) {
                    console.log('  possible XHR.open hook at ' + node.start);
                    console.log('    ' + leftSrc + ' = ' + rightSrc.substring(0, 100));
                }
            }
        }
    }
});

// ============================================================
// 5. 从 r2mKa child[22].child[16] 分析后缀中 URL 数据的位置
// ============================================================
console.log('\n=== child[22].child[16] URL 数据分析 ===');
const r2mka = JSON.parse(fs.readFileSync('debug_output/r2mka_parsed.json', 'utf-8'));
const c22_16 = r2mka.root.children[22].children[16];

// 搜索所有 EXT 引用
const extRefs = [];
c22_16.bytecode.forEach((b, i) => {
    if (b === 20) extRefs.push({ pc: i, rt: c22_16.bytecode[i+1] });
});

console.log('rt 引用:');
extRefs.forEach(r => {
    console.log('  pc' + r.pc + ': rt[' + r.rt + '] = ' + rtName(r.rt));
});

// 搜索 g72 字符串属性访问
const propRefs = [];
c22_16.bytecode.forEach((b, i) => {
    if (b === 57 && i > 0) { // GET_PROP ([]p)
        // 前面的 PUSH(N) 是属性索引
        for (let j = i-1; j >= Math.max(0, i-3); j--) {
            if (c22_16.bytecode[j] === 30) { // PUSH(N)
                const propIdx = c22_16.bytecode[j+1];
                if (g72[propIdx]) {
                    propRefs.push({ pc: i, prop: g72[propIdx], idx: propIdx });
                }
                break;
            }
        }
    }
});

console.log('\n属性访问:');
[...new Set(propRefs.map(p => p.prop))].forEach(prop => {
    const count = propRefs.filter(p => p.prop === prop).length;
    console.log('  .' + prop + ': ' + count + 'x');
});

// ============================================================
// 6. 分析真实 88B 后缀样本 — URL 数据在哪
// ============================================================
console.log('\n=== 真实样本分析 ===');
// 从 hook 数据: XOR before array 24B (88B suffix)
// [11,22,0,16, 0,49,0,1, 1,130,153,246, 0,4,123,64, 94,43,245,108, 207,247,245,250]
// 前 12B 固定，后 12B 变化

// 从 hook: XOR before array 54B (120B suffix)
// 前 24B 同上, 后 30B = "ns=1775401433440&code=Country"
// 30B ASCII = URL query string!

console.log('88B suffix XOR data (24B):');
console.log('  [0-11]: 固定头部');
console.log('  [12-15]: 时间/计数相关 (变化)');
console.log('  [16-23]: pathname 相关数据');
console.log('');
console.log('120B suffix XOR data (54B):');
console.log('  [0-23]: 同 88B');
console.log('  [24-53]: URL query string ASCII 明文');
console.log('');
console.log('★ URL 数据通过 XOR 编码到后缀中');
console.log('★ 服务器用 XOR 解码后验证 URL 是否匹配');
