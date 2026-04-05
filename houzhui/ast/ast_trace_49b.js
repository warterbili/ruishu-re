/**
 * AST 追踪 49B session: 从 Cookie S 到 49B 的完整链路
 *
 * 纯 AST 分析，不靠 grep/indexOf
 */
const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');

const code = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');
console.log('Parsing AST...');
const ast = acorn.parse(code, { ecmaVersion: 2020 });

// ============================================================
// 1. 收集所有函数 (name → AST node)
// ============================================================
const allFuncs = {};
walk.simple(ast, {
    FunctionDeclaration(node) {
        if (node.id) {
            allFuncs[node.id.name] = node;
        }
    }
});
console.log('Total functions:', Object.keys(allFuncs).length);

// ============================================================
// 2. 找 push 参数列表，建立 rt[N] → funcName 映射
// ============================================================
let pushArgs = null;
walk.simple(ast, {
    CallExpression(node) {
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'push' &&
            node.callee.object.name === '_$cR' &&
            node.arguments.length > 100) {
            pushArgs = node.arguments;
        }
    }
});
const BASE = 491 - pushArgs.length;
const rtMap = {};
pushArgs.forEach((arg, i) => {
    rtMap[i + BASE] = arg.type === 'Identifier' ? arg.name : code.substring(arg.start, arg.end).substring(0, 50);
});

// ============================================================
// 3. 从 rt[75] (Cookie S reader) 开始追踪
// ============================================================
const rt75 = rtMap[75]; // = "_$aW"
console.log('\n★ rt[75] =', rt75);

// 找 _$aW 的所有赋值
const assignments = {};
walk.ancestor(ast, {
    AssignmentExpression(node, ancestors) {
        if (node.left.type === 'Identifier') {
            if (!assignments[node.left.name]) assignments[node.left.name] = [];
            assignments[node.left.name].push({
                right: code.substring(node.right.start, node.right.end).substring(0, 100),
                offset: node.start,
                rightNode: node.right
            });
        }
    }
});

if (assignments[rt75]) {
    console.log(rt75 + ' assignments:');
    assignments[rt75].forEach(a => console.log('  = ' + a.right + ' (at ' + a.offset + ')'));
}

// ============================================================
// 4. _$aW = _$ar[6] → 追踪 _$ar
//    _$ar 是 while(1) 临时变量，多次赋值
//    需要找到 _$aW=_$ar[6] 所在的 case 块
//    然后分析该 case 块中 _$ar 的值
// ============================================================

// 找到所有 VariableDeclarator — _$ar 的 var 声明
walk.simple(ast, {
    VariableDeclarator(node) {
        if (node.id.name === '_$ar') {
            console.log('\nvar _$ar declared at', node.start);
        }
    }
});

// ============================================================
// 5. 追踪 Cookie 读取函数
// ============================================================
// 从 AST 找到读取 document.cookie 的函数
console.log('\n★ Cookie 读取函数追踪');

// 找所有包含 _$dn[16] 的 MemberExpression (g68[16]="cookie")
const cookieAccess = [];
walk.ancestor(ast, {
    MemberExpression(node, ancestors) {
        if (node.computed &&
            node.property.type === 'Literal' &&
            node.property.value === 16 &&
            node.object.type === 'Identifier' &&
            node.object.name === '_$dn') {
            // 找包含这个表达式的最近函数
            let parentFunc = null;
            for (let i = ancestors.length - 1; i >= 0; i--) {
                if (ancestors[i].type === 'FunctionDeclaration' && ancestors[i].id) {
                    parentFunc = ancestors[i].id.name;
                    break;
                }
            }
            cookieAccess.push({ offset: node.start, func: parentFunc });
        }
    }
});
console.log('_$dn[16] (cookie) accessed in functions:');
cookieAccess.forEach(a => console.log('  ' + (a.func || 'anonymous') + ' at ' + a.offset));

// 对每个 Cookie 访问函数，输出源码
const cookieFuncs = [...new Set(cookieAccess.map(a => a.func).filter(Boolean))];
cookieFuncs.forEach(name => {
    if (allFuncs[name]) {
        const src = code.substring(allFuncs[name].start, allFuncs[name].end);
        console.log('\n--- ' + name + ' (' + src.length + ' chars) ---');
        console.log(src.substring(0, 400));
    }
});

// ============================================================
// 6. 从 Cookie 函数往下追踪调用链
// ============================================================
console.log('\n★ 调用链追踪 (从 Cookie 读取函数开始)');

function getCalledFunctions(funcName) {
    const node = allFuncs[funcName];
    if (!node) return [];
    const called = new Set();
    walk.simple(node, {
        CallExpression(callNode) {
            if (callNode.callee.type === 'Identifier' && allFuncs[callNode.callee.name]) {
                called.add(callNode.callee.name);
            }
        }
    });
    return [...called];
}

function traceChain(funcName, depth, visited) {
    if (depth > 4 || visited.has(funcName)) return;
    visited.add(funcName);
    const called = getCalledFunctions(funcName);
    const info = allFuncs[funcName];
    const len = info ? info.end - info.start : 0;
    console.log('  '.repeat(depth) + funcName + ' (' + len + ' chars) → calls: ' + (called.length ? called.join(', ') : 'none'));
    called.forEach(c => traceChain(c, depth + 1, visited));
}

cookieFuncs.forEach(name => {
    console.log('\nFrom ' + name + ':');
    traceChain(name, 0, new Set());
});

// ============================================================
// 7. 找到 Base64 decode 函数 (Cookie S 是 base64)
// ============================================================
console.log('\n★ Base64 decode 追踪');
// 搜索包含 charCodeAt + 位移操作的函数 (base64 decode 特征)
for (const [name, node] of Object.entries(allFuncs)) {
    const src = code.substring(node.start, node.end);
    const len = src.length;
    if (len > 100 && len < 1000 &&
        src.includes('charCodeAt') &&
        (src.includes('>>') || src.includes('<<')) &&
        (src.includes('&63') || src.includes('& 63') || src.includes('&0x3F') || src.includes('>>2') || src.includes('>>4'))) {
        console.log('Base64 decode candidate: ' + name + ' (' + len + ' chars)');
        console.log(src.substring(0, 300));
        console.log('');
    }
}

// ============================================================
// 8. 找 XTEA 解密 (特征: 32轮循环 + delta)
// ============================================================
console.log('\n★ XTEA 追踪');
// XTEA 在 r2mKa VM 字节码里 (rt[67][87]=2654435769)
// 但 eval code 可能有 JS 版本的 XTEA
// 搜索包含 32 次循环 + 异或 的函数
for (const [name, node] of Object.entries(allFuncs)) {
    const src = code.substring(node.start, node.end);
    const len = src.length;
    if (len > 100 && len < 2000 &&
        (src.includes('^') || src.includes('^=')) &&
        (src.includes('>>>') || src.includes('>> ')) &&
        (src.includes('<<') || src.includes('<< ')) &&
        (src.includes('32') || src.includes('[32]'))) {
        console.log('XTEA candidate: ' + name + ' (' + len + ' chars)');
        console.log(src.substring(0, 400));
        console.log('');
    }
}

// ============================================================
// 9. 输出 rt 映射中可能参与 session 处理的函数
// ============================================================
console.log('\n★ Session 相关 rt 函数');
// 从 hook 知道: rt[75]("fa0-2") → [181,101,103,224]
// "fa0" 前缀 + key → 返回字节数组
// 找 rt[75] 调用的所有函数
console.log('\nrt[75] = ' + rt75 + ' 调用链:');
if (assignments[rt75]) {
    // _$aW = _$ar[6] → _$ar 来自某个数组
    // 这个数组是 Cookie S 管理器对象
    // 对象有方法: [6] = 读取方法
    console.log('_$aW = _$ar[6] (Cookie S manager 的第 6 个方法)');
}

// 保存结果
console.log('\n★ 分析完成');
