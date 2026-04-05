/**
 * AST: 追踪 Cookie S → 49B 的完整解密路径
 *
 * 已知:
 *   rt[75] = _$aW = _$ar[6] (Cookie 管理器的读取方法)
 *   _$ar 在 while(1) case 中被设置
 *   Cookie 管理器在 VM 初始化时创建
 *
 * 策略:
 *   1. 找到 _$aW = _$ar[6] 所在的 while(1) case
 *   2. 在同一 case 中找 _$ar 的来源
 *   3. 追踪到 Cookie 管理器的创建函数
 *   4. 分析该函数如何解密 Cookie S
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

// ============================================================
// 1. 找到 _$aW=_$ar[6] 所在的 while(1) case 块
// ============================================================
const assignOffset = code.indexOf('_$aW=_$ar[6]');
console.log('_$aW=_$ar[6] at offset:', assignOffset);

// 往前找这个 case 的编号
// while(1) 里的 case 模式: if(_$_Z===NNN) 或 else if(_$_Z===NNN)
const before = code.substring(Math.max(0, assignOffset - 500), assignOffset);
const caseMatches = before.match(/_\$_Z===(\d+)/g);
if (caseMatches) {
    const lastCase = caseMatches[caseMatches.length - 1];
    const caseNum = lastCase.match(/\d+/)[0];
    console.log('In case:', caseNum);
}

// 找这个 case 块的完整代码
// 模式: }else if(_$_Z===526){ ... }
const caseStart = code.lastIndexOf('}else', assignOffset);
const caseCode = code.substring(caseStart, assignOffset + 200);
console.log('\nCase block:');
console.log(caseCode.substring(0, 300));

// ============================================================
// 2. 找 _$ar 在这个 case 块中的来源
// ============================================================
// _$aW=_$ar[6] — _$ar 是个数组/对象
// 在同一 case 或前面的 case 中, _$ar 被赋值
// 从 offset 239597 附近往前看

console.log('\n=== _$ar 赋值追踪 (offset 239000-239600) ===');
const nearCode = code.substring(239000, 239650);
const arAssigns = nearCode.match(/_\$ar\s*=\s*[^,;\n}]+/g);
if (arAssigns) {
    arAssigns.forEach(a => console.log('  ' + a.substring(0, 80)));
}

// ============================================================
// 3. 找 Cookie 管理器创建函数
// ============================================================
// rt[75] 被调用时: rt[75]("fa0-2") → [181,101,103,224]
// "fa0" 是 Cookie S 的内部标识
// 搜索包含 "fa0" 或类似模式的函数

// 在 eval code 中搜索字符串 "fa"
console.log('\n=== 搜索 "fa" 字符串 ===');
walk.simple(ast, {
    Literal(node) {
        if (typeof node.value === 'string' && node.value.startsWith('fa') && node.value.length < 10) {
            const ctx = code.substring(Math.max(0, node.start - 30), Math.min(code.length, node.end + 30));
            console.log('  "' + node.value + '" at ' + node.start + ': ' + ctx.replace(/\s+/g, ' '));
        }
    }
});

// "pfa0" 也搜索
walk.simple(ast, {
    Literal(node) {
        if (typeof node.value === 'string' && node.value === 'pfa0') {
            const ctx = code.substring(Math.max(0, node.start - 50), Math.min(code.length, node.end + 50));
            console.log('  "pfa0" at ' + node.start + ': ' + ctx.replace(/\s+/g, ' '));
        }
    }
});

// ============================================================
// 4. 搜索 _$cN (19KB 大函数, 之前发现它调用了大量子函数)
// ============================================================
console.log('\n=== _$cN 分析 (19KB) ===');
const cnSrc = getSrc('_$cN');
if (cnSrc) {
    console.log('_$cN length:', cnSrc.length);

    // 找它内部定义的函数
    const innerRe = /function\s+(_\$\w+)\s*\(([^)]*)\)/g;
    const inners = [];
    let m;
    while (m = innerRe.exec(cnSrc)) inners.push(m[1] + '(' + m[2] + ')');
    console.log('Inner functions:', inners.length);
    inners.forEach(f => console.log('  ' + f));

    // 找它是否包含 Cookie 相关操作
    console.log('\nCookie features:');
    console.log('  _$fB (cookie reader):', cnSrc.includes('_$fB'));
    console.log('  _$hd (AES):', cnSrc.includes('_$hd'));
    console.log('  _$dn[16] (cookie):', cnSrc.includes('_$dn[16]'));
    console.log('  split("; "):', cnSrc.includes('"; "'));
    console.log('  _$kH (decode string):', cnSrc.includes('_$kH'));
    console.log('  _$e6 (charCodeAt):', cnSrc.includes('_$e6'));
    console.log('  Huffman:', cnSrc.includes('_$lO[28]') || cnSrc.includes('huffman'));
}

// ============================================================
// 5. 找 _$_I (34KB VM 主循环) 中的 Cookie 管理器创建
// ============================================================
console.log('\n=== _$_I 中的 Cookie 管理 ===');
const iiSrc = getSrc('_$_I');
if (iiSrc) {
    // 搜索 _$fB 调用
    const fbCalls = (iiSrc.match(/_\$fB\(/g) || []).length;
    console.log('_$fB calls in _$_I:', fbCalls);

    // 搜索 _$hd 调用 (AES)
    const hdCalls = (iiSrc.match(/_\$hd\(/g) || []).length;
    console.log('_$hd calls in _$_I:', hdCalls);

    // 搜索 _$kH (string decode)
    const khCalls = (iiSrc.match(/_\$kH\(/g) || []).length;
    console.log('_$kH calls in _$_I:', khCalls);

    // 搜索 _$dg/_$hd/_$fE (加密函数)
    const dgCalls = (iiSrc.match(/_\$dg\(/g) || []).length;
    console.log('_$dg calls in _$_I:', dgCalls);

    // 找到所有可能的 Cookie 管理器创建
    // 模式: 创建对象, 赋值方法 [0]...[6]
    if (iiSrc.includes('[6]')) {
        const idx6 = [];
        let pos = 0;
        while ((pos = iiSrc.indexOf('[6]', pos)) !== -1) {
            const ctx = iiSrc.substring(Math.max(0, pos - 40), Math.min(iiSrc.length, pos + 40));
            idx6.push(ctx.replace(/\s+/g, ' '));
            pos++;
        }
        console.log('\n[6] references in _$_I:', idx6.length);
        idx6.slice(0, 5).forEach(c => console.log('  ' + c.substring(0, 80)));
    }
}

// ============================================================
// 6. 直接搜索 VM while(1) 中 Cookie S 解密相关的 case
// ============================================================
console.log('\n=== VM while(1) 中的关键 case ===');
// _$dm 是 VM 入口 (74KB)
const dmSrc = getSrc('_$dm');
if (dmSrc) {
    // 搜索 _$fB 调用的位置
    let pos = 0;
    const fbPositions = [];
    while ((pos = dmSrc.indexOf('_$fB(', pos)) !== -1) {
        const ctx = dmSrc.substring(Math.max(0, pos - 80), pos + 50);
        // 找 case 编号
        const caseMatch = ctx.match(/_\$_Z===(\d+)/g);
        fbPositions.push({
            case: caseMatch ? caseMatch[caseMatch.length - 1] : '?',
            ctx: ctx.replace(/\s+/g, ' ').substring(0, 120)
        });
        pos++;
    }
    console.log('_$fB() in _$dm:', fbPositions.length, 'calls');
    fbPositions.forEach(p => console.log('  case ' + p.case + ': ' + p.ctx));

    // 搜索 _$hd 调用
    pos = 0;
    const hdPositions = [];
    while ((pos = dmSrc.indexOf('_$hd(', pos)) !== -1) {
        const ctx = dmSrc.substring(Math.max(0, pos - 80), pos + 50);
        const caseMatch = ctx.match(/_\$_Z===(\d+)/g);
        hdPositions.push({
            case: caseMatch ? caseMatch[caseMatch.length - 1] : '?',
            ctx: ctx.replace(/\s+/g, ' ').substring(0, 120)
        });
        pos++;
    }
    console.log('\n_$hd() in _$dm:', hdPositions.length, 'calls');
    hdPositions.forEach(p => console.log('  case ' + p.case + ': ' + p.ctx));
}
