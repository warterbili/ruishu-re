/**
 * AST 分析: 追踪 rt[239] 到 32B 签名的完整调用链
 *
 * 步骤:
 * 1. 解析 eval code AST
 * 2. 找到 Array.prototype.push.apply 大调用
 * 3. 定位 rt[239] 对应的函数
 * 4. 递归追踪该函数调用的所有子函数
 * 5. 输出完整调用链 + 每个函数的源码
 */

const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');

const evalCode = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');
console.log('Parsing eval code (' + evalCode.length + ' chars)...');

let ast;
try {
    ast = acorn.parse(evalCode, { ecmaVersion: 2020, sourceType: 'script' });
} catch(e) {
    console.log('Parse error:', e.message);
    process.exit(1);
}
console.log('AST parsed successfully');

// ============================================================
// Step 1: 收集所有函数定义 (name → {node, source})
// ============================================================
const functions = {};
walk.simple(ast, {
    FunctionDeclaration(node) {
        if (node.id && node.id.name) {
            functions[node.id.name] = {
                node: node,
                params: node.params.map(p => p.name),
                start: node.start,
                end: node.end,
                source: evalCode.substring(node.start, Math.min(node.end, node.start + 2000))
            };
        }
    }
});
console.log('Found', Object.keys(functions).length, 'named functions');

// ============================================================
// Step 2: 找到大 push 调用, 确定 rt 数组的构成
// ============================================================
// 模式: Array.prototype.push.apply(someArray, arguments)
// 这是 vmCall 包装函数: function _$XX(){var arr=[N];Array.prototype.push.apply(arr,arguments);return interpreter.apply(this,arr);}
// 但也有主 push: 把 400+ 个函数/值推入 rt 数组

// 找所有 vmCall 包装函数 (pattern: var arr=[N]; Array.prototype.push.apply)
const vmCalls = {};
for (const [name, info] of Object.entries(functions)) {
    const src = info.source;
    const match = src.match(/var\s+\w+=\[(\d+)\];Array\.prototype\.push\.apply/);
    if (match) {
        vmCalls[name] = parseInt(match[1]);
    }
}
console.log('Found', Object.keys(vmCalls).length, 'vmCall wrappers');

// ============================================================
// Step 3: 找主 push 调用 (推入 400+ 项到 rt 数组)
// ============================================================
// 在 AST 中找 while(1) 循环之前的代码块
// 实际上, 我们知道 eval code 的结构:
// (function(_$iS, _$cF) {
//     var _$fv=0;
//     function _$c2(){...} // vmCall wrappers
//     function _$..(){...} // other functions
//     ... 大量函数定义 ...
//     var ...; // 变量声明
//     while(1){...} // VM 主循环
// })($_ts.scj, $_ts.aebi);

// 找外层 IIFE 的 body
const iife = ast.body[0].expression; // ExpressionStatement
const outerFunc = iife.callee || iife; // 可能是 CallExpression
let funcBody;
if (iife.type === 'CallExpression') {
    funcBody = iife.callee.body.body; // IIFE 的函数体
} else if (iife.type === 'SequenceExpression') {
    // 可能是逗号表达式
    funcBody = null;
}

if (!funcBody) {
    // 备用方案: 直接搜索 push.apply 调用
    console.log('Searching for push.apply calls...');
}

// 找到所有 push.apply 调用, 取参数最多的那个
let bigPushArgs = null;
let bigPushCount = 0;

walk.simple(ast, {
    CallExpression(node) {
        // 匹配 Array.prototype.push.apply(target, [arg1, arg2, ...])
        // 或者 _$XX.push.apply(_$XX, [...])
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'apply' &&
            node.arguments.length === 2 &&
            node.arguments[1].type === 'ArrayExpression') {

            const args = node.arguments[1].elements;
            if (args.length > bigPushCount) {
                bigPushCount = args.length;
                bigPushArgs = args;
                console.log('Found push.apply with', args.length, 'args at offset', node.start);
            }
        }
    }
});

if (!bigPushArgs) {
    console.log('ERROR: Could not find big push.apply call');
    process.exit(1);
}

console.log('\n★ Big push: ' + bigPushCount + ' items pushed to rt array');

// ============================================================
// Step 4: 定位 rt[239]
// ============================================================
// push base = 55 (rt[0-54] 已有数据)
// rt[239] = push 的第 (239-55) = 184 个参数
const RT_BASE = 55;
const TARGET_RT = 239;
const pushIndex = TARGET_RT - RT_BASE;

if (pushIndex >= bigPushArgs.length) {
    console.log('ERROR: rt[' + TARGET_RT + '] index ' + pushIndex + ' exceeds push args count ' + bigPushArgs.length);
    // 试其他 base
    for (let base = 0; base < 100; base++) {
        if (TARGET_RT - base < bigPushArgs.length && TARGET_RT - base >= 0) {
            console.log('  Possible base=' + base + ' → index ' + (TARGET_RT-base));
        }
    }
    process.exit(1);
}

const rt239Node = bigPushArgs[pushIndex];
console.log('\n★ rt[' + TARGET_RT + '] = push arg #' + pushIndex);
console.log('  Node type:', rt239Node.type);

if (rt239Node.type === 'Identifier') {
    const funcName = rt239Node.name;
    console.log('  Function name:', funcName);

    if (functions[funcName]) {
        console.log('  Params:', functions[funcName].params.join(', '));
        console.log('  Source (' + (functions[funcName].end - functions[funcName].start) + ' chars):');
        console.log('  ', functions[funcName].source.substring(0, 500));

        // ============================================================
        // Step 5: 递归追踪调用链
        // ============================================================
        console.log('\n★ === 调用链分析 ===');
        traceCallChain(funcName, 0, new Set());
    }
} else {
    console.log('  Value:', evalCode.substring(rt239Node.start, rt239Node.end).substring(0, 200));
}

// 同时输出附近的 rt 函数
console.log('\n★ === rt[235-245] 附近函数 ===');
for (let i = TARGET_RT - 4; i <= TARGET_RT + 4; i++) {
    const idx = i - RT_BASE;
    if (idx >= 0 && idx < bigPushArgs.length) {
        const node = bigPushArgs[idx];
        const val = node.type === 'Identifier' ? node.name :
                    node.type === 'Literal' ? String(node.value) :
                    evalCode.substring(node.start, node.end).substring(0, 50);
        console.log('  rt[' + i + '] = ' + val);
    }
}

// ============================================================
// 递归追踪函数调用链
// ============================================================
function traceCallChain(funcName, depth, visited) {
    if (visited.has(funcName) || depth > 5) return;
    visited.add(funcName);

    const info = functions[funcName];
    if (!info) {
        const indent = '  '.repeat(depth);
        // 检查是否是 vmCall
        if (vmCalls[funcName] !== undefined) {
            console.log(indent + '→ ' + funcName + ' = vmCall(' + vmCalls[funcName] + ')');
        } else {
            console.log(indent + '→ ' + funcName + ' (not found)');
        }
        return;
    }

    const indent = '  '.repeat(depth);
    const isVmCall = vmCalls[funcName] !== undefined;
    console.log(indent + '→ ' + funcName + '(' + info.params.join(',') + ')' +
                (isVmCall ? ' [vmCall(' + vmCalls[funcName] + ')]' : '') +
                ' [' + (info.end - info.start) + ' chars]');

    // 找这个函数内部调用的所有函数
    const calledFuncs = new Set();
    walk.simple(info.node, {
        CallExpression(node) {
            if (node.callee.type === 'Identifier' && functions[node.callee.name]) {
                calledFuncs.add(node.callee.name);
            }
        }
    });

    for (const called of calledFuncs) {
        traceCallChain(called, depth + 1, visited);
    }
}

// ============================================================
// 额外: 输出 rt[239] 的完整源码到文件
// ============================================================
if (rt239Node.type === 'Identifier' && functions[rt239Node.name]) {
    const funcInfo = functions[rt239Node.name];
    const fullSource = evalCode.substring(funcInfo.start, funcInfo.end);
    fs.writeFileSync('C:/lsd_project/rs_reverse/houzhui/debug_output/rt239_source.js',
        '// rt[239] = ' + rt239Node.name + '\n// Params: ' + funcInfo.params.join(', ') + '\n\n' + fullSource);
    console.log('\n★ rt[239] 完整源码已保存到 debug_output/rt239_source.js');
}
