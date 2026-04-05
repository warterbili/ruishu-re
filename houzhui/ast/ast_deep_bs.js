/**
 * AST 深度分析 rt[239] = _$bs (15KB 后缀核心函数)
 *
 * 目标: 找到 32B 签名的生成路径
 * 方法: 拆解 56 个子函数，追踪数据流
 */
const fs = require('fs');
const code = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');
const bsSrc = fs.readFileSync('C:/lsd_project/rs_reverse/houzhui/debug_output/rt239_source.js', 'utf-8');

// ============================================================
// 1. 提取 _$bs 内所有子函数 (名称 + 源码 + 偏移)
// ============================================================
const innerFuncs = [];
const funcRe = /function\s+(_\$\w+)\s*\(([^)]*)\)\s*\{/g;
let m;
while (m = funcRe.exec(bsSrc)) {
    const name = m[1];
    const params = m[2];
    const start = m.index;
    // 找闭合 }
    let d = 0, bodyStart = start + m[0].length - 1;
    for (let i = bodyStart; i < bsSrc.length; i++) {
        if (bsSrc[i] === '{') d++;
        else if (bsSrc[i] === '}') { d--; if (d === 0) {
            innerFuncs.push({ name, params, start, end: i+1, len: i+1-start, src: bsSrc.substring(start, i+1) });
            break;
        }}
    }
}

console.log('=== _$bs 内部子函数 (' + innerFuncs.length + ' 个) ===\n');

// ============================================================
// 2. 分析每个子函数的特征
// ============================================================
const funcMap = {};
for (const f of innerFuncs) {
    const s = f.src;
    const features = [];

    // 检测关键模式
    if (s.includes('push')) features.push('PUSH');
    if (s.includes('slice')) features.push('SLICE');
    if (s.includes('^=') || /\^\s*=/.test(s)) features.push('XOR');
    if (s.includes('>>') || s.includes('<<') || s.includes('>>>')) features.push('BITSHIFT');
    if (s.includes('charCodeAt')) features.push('CHARCODE');
    if (s.includes('fromCharCode')) features.push('FROMCHAR');
    if (s.includes('charAt')) features.push('CHARAT');
    if (s.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef')) features.push('B64_CHARS');
    if (s.includes('split')) features.push('SPLIT');
    if (s.includes('join')) features.push('JOIN');
    if (s.includes('getTime') || s.includes('Date')) features.push('TIME');
    if (s.includes('random')) features.push('RANDOM');
    if (s.includes('cookie')) features.push('COOKIE');
    if (s.includes('createElement')) features.push('DOM');
    if (s.includes('debugger')) features.push('DEBUGGER');
    if (s.includes('_$dm(')) features.push('VMCALL');
    if (s.includes('while') || s.includes('for(') || s.includes('for (')) features.push('LOOP');
    if (/&\s*0x[fF]+/.test(s) || /&\s*255/.test(s) || /&\s*0xFF/.test(s)) features.push('BYTE_MASK');
    if (s.includes('prototype')) features.push('PROTO');
    if (s.includes('toString')) features.push('TOSTRING');
    if (s.includes('XMLHttpRequest') || s.includes('open')) features.push('XHR');
    if (s.includes('href') || s.includes('pathname') || s.includes('search')) features.push('URL');
    if (s.includes('_$hK') || s.includes('addEventListener')) features.push('EVENT');
    if (s.includes('setInterval') || s.includes('setTimeout')) features.push('TIMER');

    // vmCall IDs
    const vmMatches = s.match(/_\$dm\((\d+)\)/g);
    if (vmMatches) features.push('VM:' + vmMatches.map(v => v.match(/\d+/)[0]).join(','));

    funcMap[f.name] = { params: f.params, len: f.len, features, src: f.src };

    const feat = features.length ? ' [' + features.join(', ') + ']' : '';
    console.log(f.name + '(' + f.params + ') ' + f.len + ' chars' + feat);
}

// ============================================================
// 3. 分析 _$bs 主体（非子函数部分）
// ============================================================
console.log('\n=== _$bs 主体初始化 ===\n');

// 提取 _$bs 的初始化部分 (return 之前)
const returnIdx = bsSrc.indexOf('return;function');
const initPart = bsSrc.substring(bsSrc.indexOf('{') + 1, returnIdx + 7);
console.log('Init part (' + initPart.length + ' chars):');
console.log(initPart.replace(/\s+/g, ' ').substring(0, 500));

// ============================================================
// 4. 找到 _$gH._$db 调用 — 这是核心注册
// ============================================================
console.log('\n=== 核心注册 (_$db 调用) ===\n');
const dbMatch = bsSrc.match(/_\$gH\._\$db\(\{([^}]+)\}\)/);
if (dbMatch) {
    console.log('_$gH._$db({' + dbMatch[1] + '})');
    // 解析属性
    const props = dbMatch[1].split(',').map(s => s.trim());
    props.forEach(p => {
        const [key, val] = p.split(':').map(s => s.trim());
        const funcInfo = funcMap[val];
        if (funcInfo) {
            console.log('  ' + key + ' = ' + val + '(' + funcInfo.params + ') ' + funcInfo.len + ' chars [' + funcInfo.features.join(', ') + ']');
        } else {
            console.log('  ' + key + ' = ' + val);
        }
    });
}

// ============================================================
// 5. 找到写入字节的函数 — 特征: push + byte mask
// ============================================================
console.log('\n=== 关键函数分类 ===\n');

console.log('--- 字节操作 (PUSH + BYTE_MASK/BITSHIFT) ---');
for (const [name, info] of Object.entries(funcMap)) {
    if (info.features.includes('PUSH') && (info.features.includes('BYTE_MASK') || info.features.includes('BITSHIFT'))) {
        console.log('  ' + name + '(' + info.params + ') ' + info.len + ' chars [' + info.features.join(', ') + ']');
        // 输出关键代码片段
        const pushLines = info.src.match(/[^\n;]*push[^\n;]*/g);
        if (pushLines) pushLines.slice(0, 3).forEach(l => console.log('    ' + l.trim().substring(0, 100)));
    }
}

console.log('\n--- XOR 操作 ---');
for (const [name, info] of Object.entries(funcMap)) {
    if (info.features.includes('XOR')) {
        console.log('  ' + name + '(' + info.params + ') ' + info.len + ' chars');
        console.log('    ' + info.src.substring(0, 200).replace(/\s+/g, ' '));
    }
}

console.log('\n--- 循环 (LOOP) ---');
for (const [name, info] of Object.entries(funcMap)) {
    if (info.features.includes('LOOP')) {
        console.log('  ' + name + '(' + info.params + ') ' + info.len + ' chars [' + info.features.join(', ') + ']');
    }
}

console.log('\n--- URL/XHR 相关 ---');
for (const [name, info] of Object.entries(funcMap)) {
    if (info.features.includes('URL') || info.features.includes('XHR')) {
        console.log('  ' + name + '(' + info.params + ') ' + info.len + ' chars [' + info.features.join(', ') + ']');
    }
}

console.log('\n--- vmCall 调用 ---');
for (const [name, info] of Object.entries(funcMap)) {
    if (info.features.some(f => f.startsWith('VM:'))) {
        console.log('  ' + name + '(' + info.params + ') ' + info.len + ' chars [' + info.features.join(', ') + ']');
    }
}

console.log('\n--- 时间相关 ---');
for (const [name, info] of Object.entries(funcMap)) {
    if (info.features.includes('TIME') || info.features.includes('TIMER')) {
        console.log('  ' + name + '(' + info.params + ') ' + info.len + ' chars [' + info.features.join(', ') + ']');
    }
}

// ============================================================
// 6. 找最大的子函数 — 可能包含核心逻辑
// ============================================================
console.log('\n=== 按大小排序的子函数 (前 15) ===\n');
const sorted = Object.entries(funcMap).sort((a, b) => b[1].len - a[1].len);
sorted.slice(0, 15).forEach(([name, info]) => {
    console.log(name + '(' + info.params + ') ' + info.len + ' chars [' + info.features.join(', ') + ']');
});

// ============================================================
// 7. 保存完整分析结果
// ============================================================
const output = [];
output.push('// rt[239] = _$bs 完整子函数分析\n');
for (const [name, info] of sorted) {
    output.push('// === ' + name + '(' + info.params + ') ' + info.len + ' chars [' + info.features.join(', ') + '] ===');
    output.push(info.src);
    output.push('');
}
fs.writeFileSync('C:/lsd_project/rs_reverse/houzhui/debug_output/rt239_all_funcs.js', output.join('\n'));
console.log('\n★ 完整子函数源码已保存到 rt239_all_funcs.js');
