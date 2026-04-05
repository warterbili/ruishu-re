/**
 * AST 追踪 Cookie S → 49B session 数据
 *
 * 策略:
 * 1. AST 解析整个 eval code
 * 2. 找到 rt[75] 的函数定义
 * 3. 递归追踪它引用的所有函数
 * 4. 找到读取 Cookie / 解密 Cookie S 的完整链路
 */
const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');

const code = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');
console.log('Parsing...');
const ast = acorn.parse(code, { ecmaVersion: 2020 });
console.log('Parsed.');

// ============================================================
// 1. 收集所有函数声明
// ============================================================
const funcs = {};
walk.simple(ast, {
    FunctionDeclaration(node) {
        if (node.id) {
            funcs[node.id.name] = {
                start: node.start,
                end: node.end,
                params: node.params.map(p => p.name || '?'),
                len: node.end - node.start
            };
        }
    }
});
console.log('Functions:', Object.keys(funcs).length);

// ============================================================
// 2. 找 rt[75] — 从 push args 定位
// ============================================================
// 找 _$cR.push( 的 AST 节点
let pushCallNode = null;
walk.simple(ast, {
    CallExpression(node) {
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'push' &&
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === '_$cR' &&
            node.arguments.length > 100) {
            pushCallNode = node;
        }
    }
});

if (!pushCallNode) {
    console.log('ERROR: _$cR.push not found');
    process.exit(1);
}

const pushArgs = pushCallNode.arguments;
const BASE = 491 - pushArgs.length;
console.log('Push args:', pushArgs.length, 'Base:', BASE);

// rt[75] = push arg #(75-BASE)
const rt75idx = 75 - BASE;
const rt75node = pushArgs[rt75idx];
const rt75name = rt75node.type === 'Identifier' ? rt75node.name : code.substring(rt75node.start, rt75node.end);
console.log('\nrt[75] =', rt75name, '(type:', rt75node.type + ')');

// ============================================================
// 3. 追踪 rt[75] 的来源 — AST 数据流分析
// ============================================================
// rt[75] = _$aW，_$aW 是个变量
// 找所有对 _$aW 的赋值 (AssignmentExpression where left = _$aW)
console.log('\n=== _$aW 赋值追踪 ===');
walk.simple(ast, {
    AssignmentExpression(node) {
        if (node.left.type === 'Identifier' && node.left.name === rt75name) {
            const rightSrc = code.substring(node.right.start, node.right.end);
            console.log('  ' + rt75name + ' = ' + rightSrc.substring(0, 100) + ' (at offset ' + node.start + ')');
        }
    }
});

// ============================================================
// 4. _$aW = _$ar[6] — 找 _$ar[6] 是什么
// 这发生在 while(1) 循环中，_$ar 是临时变量
// 需要找到赋值 _$aW=_$ar[6] 之前 _$ar 的值
// AST 方法: 找到包含 _$aW=_$ar[6] 的代码块，
// 往前找最近的 _$ar 赋值
// ============================================================
console.log('\n=== 追踪 _$ar[6] 的来源 ===');

// 找 _$aW=_$ar[6] 所在的 while case
// 在 while(1) 中，每个 case 是一个 if-else 分支
// 找包含 _$aW=_$ar[6] 的那个分支
const assignOffset = code.indexOf('_$aW=_$ar[6]');
console.log('_$aW=_$ar[6] at offset:', assignOffset);

// 往前找 _$ar 的赋值 (在同一个 case 块中)
const blockStart = Math.max(0, assignOffset - 2000);
const blockCode = code.substring(blockStart, assignOffset);

// 找这个块中最后一个 _$ar= 赋值
const arAssigns = [];
const arRe = /_\$ar\s*=\s*[^,;\n]+/g;
let m;
while (m = arRe.exec(blockCode)) {
    arAssigns.push({ offset: blockStart + m.index, src: m[0] });
}
console.log('_$ar assignments before _$aW=_$ar[6]:');
arAssigns.slice(-5).forEach(a => {
    console.log('  at ' + a.offset + ': ' + a.src.substring(0, 100));
});

// ============================================================
// 5. 找 Cookie S 读取 — 搜索 cookie 关键词
// ============================================================
console.log('\n=== Cookie 读取相关 ===');

// 搜索访问 document.cookie 的 AST 节点
walk.simple(ast, {
    MemberExpression(node) {
        if (node.property.name === 'cookie' || node.property.value === 'cookie') {
            const ctx = code.substring(Math.max(0, node.start - 20), Math.min(code.length, node.end + 50));
            console.log('  cookie access at ' + node.start + ': ' + ctx.replace(/\s+/g, ' ').substring(0, 100));
        }
    }
});

// 搜索字符串 "cookie" (可能通过字符串表访问)
// g68[16] = "cookie"
console.log('\n=== 通过字符串表访问 cookie ===');
// _$dn[16] 或类似模式 (g68[16]="cookie")
walk.simple(ast, {
    MemberExpression(node) {
        if (node.computed && node.property.type === 'Literal' && node.property.value === 16) {
            if (node.object.type === 'Identifier') {
                const parent = code.substring(node.start, Math.min(code.length, node.start + 80));
                // 只看那些可能是 _$dn[16] (字符串表) 的
                if (parent.includes('[16]')) {
                    // 检查是否在赋值或属性访问中
                    const ctx = code.substring(Math.max(0, node.start - 30), Math.min(code.length, node.end + 50));
                    if (ctx.includes('cookie') || ctx.includes('_$dn')) {
                        console.log('  ' + ctx.replace(/\s+/g, ' ').substring(0, 120));
                    }
                }
            }
        }
    }
});

// ============================================================
// 6. 找 Huffman 解码 + XTEA 解密 (Cookie S 的解密链)
// ============================================================
console.log('\n=== 加密/解密函数特征搜索 ===');

// XTEA 特征: 0x9E3779B9 或 2654435769
walk.simple(ast, {
    Literal(node) {
        if (node.value === 2654435769 || node.value === 0x9E3779B9) {
            const ctx = code.substring(Math.max(0, node.start - 50), Math.min(code.length, node.end + 50));
            console.log('  XTEA DELTA at ' + node.start + ': ' + ctx.replace(/\s+/g, ' ').substring(0, 120));
        }
    }
});

// Huffman 特征: 权重 45 和 6
// 搜索同时出现 45 和 6 的函数
for (const [name, info] of Object.entries(funcs)) {
    const src = code.substring(info.start, info.end);
    if (src.includes('45') && src.includes('weight') || (src.includes('=45') && src.includes('=6') && src.includes('=1'))) {
        console.log('  Possible Huffman: ' + name + ' (' + info.len + ' chars)');
    }
}

// ============================================================
// 7. 直接找 "fa0" 字符串 — Cookie S 的 key 前缀
// ============================================================
console.log('\n=== "fa0" 字符串搜索 ===');
walk.simple(ast, {
    Literal(node) {
        if (typeof node.value === 'string' && node.value.includes('fa0')) {
            const ctx = code.substring(Math.max(0, node.start - 30), Math.min(code.length, node.end + 30));
            console.log('  "' + node.value + '" at ' + node.start + ': ' + ctx.replace(/\s+/g, ' '));
        }
    }
});

// 也搜索 "pfa0"
walk.simple(ast, {
    Literal(node) {
        if (typeof node.value === 'string' && node.value === 'pfa0') {
            const ctx = code.substring(Math.max(0, node.start - 30), Math.min(code.length, node.end + 30));
            console.log('  "pfa0" at ' + node.start + ': ' + ctx.replace(/\s+/g, ' '));
        }
    }
});

// ============================================================
// 8. 找 session 数据写入后缀的函数
// ============================================================
// 从 child[29] 翻译知道: G[135](L4, suffixArray) 写入 session
// G[135] = rt[135] = _$cx (1042 chars)
const rt135name = pushArgs[135 - BASE];
const rt135id = rt135name.type === 'Identifier' ? rt135name.name : '?';
console.log('\n=== rt[135] (data concat) =', rt135id, '===');
if (funcs[rt135id]) {
    const src = code.substring(funcs[rt135id].start, funcs[rt135id].end);
    console.log('Length:', src.length);
    console.log('Preview:', src.substring(0, 300).replace(/\s+/g, ' '));

    // 找它调用的函数
    const called = new Set();
    const callRe = /(_\$\w+)\s*\(/g;
    while (m = callRe.exec(src)) called.add(m[1]);
    console.log('Calls:', [...called].join(', '));
}

console.log('\n★ 分析完成。保存结果...');
