/**
 * AST 全面验证: 把 eval code 的所有 rt[N] 映射出来
 * 验证我们之前的分析是否正确
 */
const fs = require('fs');
const code = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');

// ============================================================
// Step 1: 找到大 push，提取所有 440 个 rt 条目
// ============================================================
const pushMatch = code.match(/_\$cR\.push\(/);
const pushStart = pushMatch.index + pushMatch[0].length;

// 按顶层逗号分割 push 参数
let depth = 0, args = [], current = '';
for (let i = pushStart; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break; // push 的闭合 )
        depth--;
    }
    else if (c === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += c;
}
if (current.trim()) args.push(current.trim());

const BASE = 491 - args.length; // rt.length - push.length
console.log('Push args:', args.length);
console.log('RT base:', BASE);
console.log('RT range: rt[' + BASE + '] ~ rt[' + (BASE + args.length - 1) + ']');

// ============================================================
// Step 2: 收集所有函数定义
// ============================================================
const funcDefs = {};
const funcRe = /function\s+(_\$\w+)\s*\(([^)]*)\)\s*\{/g;
let m;
while (m = funcRe.exec(code)) {
    const name = m[1];
    const params = m[2];
    if (!funcDefs[name]) { // 取第一次定义
        funcDefs[name] = { offset: m.index, params: params, len: 0 };
        // 计算函数体长度
        let d = 0, start = m.index + m[0].length - 1;
        for (let i = start; i < code.length; i++) {
            if (code[i] === '{') d++;
            else if (code[i] === '}') { d--; if (d === 0) { funcDefs[name].len = i - m.index + 1; break; } }
        }
    }
}

// ============================================================
// Step 3: 识别 vmCall 包装函数
// ============================================================
const vmCallRe = /function\s+(_\$\w+)\s*\(\)\s*\{\s*var\s+(_\$\w+)\s*=\s*\[(\d+)\]\s*;\s*Array\.prototype\.push\.apply\(\2\s*,\s*arguments\)\s*;\s*return\s+(_\$\w+)\.apply\(this\s*,\s*\2\)/g;
const vmCalls = {};
while (m = vmCallRe.exec(code)) {
    vmCalls[m[1]] = { vmId: parseInt(m[3]), interpreter: m[4] };
}

// ============================================================
// Step 4: 输出关键 rt 映射
// ============================================================
console.log('\n========================================');
console.log('  RT 完整映射 (关键索引)');
console.log('========================================\n');

const keyIndices = [75, 76, 89, 105, 108, 109, 115, 118, 123, 129, 131, 135, 160, 161, 239, 451, 456, 463, 466, 472];

for (const rtIdx of keyIndices) {
    const pushIdx = rtIdx - BASE;
    if (pushIdx < 0 || pushIdx >= args.length) {
        console.log('rt[' + rtIdx + '] = OUT OF RANGE');
        continue;
    }
    const val = args[pushIdx];
    let info = 'rt[' + rtIdx + '] = ';

    if (funcDefs[val]) {
        const fd = funcDefs[val];
        const isVmCall = vmCalls[val];
        info += val + '(' + fd.params + ') [' + fd.len + ' chars]';
        if (isVmCall) info += ' ★ vmCall(' + isVmCall.vmId + ')';

        // 提取函数前 150 字符看特征
        const preview = code.substring(fd.offset, fd.offset + fd.len).replace(/\s+/g, ' ').substring(0, 150);
        info += '\n    preview: ' + preview;
    } else {
        info += val.substring(0, 80);
    }
    console.log(info + '\n');
}

// ============================================================
// Step 5: 验证关键函数
// ============================================================
console.log('\n========================================');
console.log('  验证结论');
console.log('========================================\n');

// rt[115] 应该是 Base64
const rt115name = args[115 - BASE];
if (funcDefs[rt115name]) {
    const src = code.substring(funcDefs[rt115name].offset, funcDefs[rt115name].offset + funcDefs[rt115name].len);
    const hasB64Chars = src.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef') || src.includes('charAt') || src.includes('>>2') || src.includes('&63');
    console.log('rt[115] Base64?', hasB64Chars ? '✅ YES' : '❌ NOT OBVIOUS');
}

// rt[160] 应该是 XOR
const rt160name = args[160 - BASE];
if (funcDefs[rt160name]) {
    const src = code.substring(funcDefs[rt160name].offset, funcDefs[rt160name].offset + funcDefs[rt160name].len);
    const hasXor = src.includes('^=') || src.includes('^ ');
    console.log('rt[160] XOR?', hasXor ? '✅ YES' : '❌ NOT OBVIOUS');
}

// rt[239] 应该是大函数 (15KB)
const rt239name = args[239 - BASE];
if (funcDefs[rt239name]) {
    console.log('rt[239] size:', funcDefs[rt239name].len, 'chars', funcDefs[rt239name].len > 10000 ? '✅ BIG FUNCTION' : '');
}

// rt[108] 应该是 vmCall(221)
const rt108name = args[108 - BASE];
if (vmCalls[rt108name]) {
    console.log('rt[108] vmCall(' + vmCalls[rt108name].vmId + ')?', vmCalls[rt108name].vmId === 221 ? '❌ NOT 221' : '★ vmCall(' + vmCalls[rt108name].vmId + ')');
} else if (funcDefs[rt108name]) {
    console.log('rt[108] =', rt108name, '(' + funcDefs[rt108name].params + ') NOT a vmCall!');
}

// rt[89] 应该是时间戳
const rt89name = args[89 - BASE];
if (vmCalls[rt89name]) {
    console.log('rt[89] = vmCall(' + vmCalls[rt89name].vmId + ')');
} else if (funcDefs[rt89name]) {
    const src89 = code.substring(funcDefs[rt89name].offset, funcDefs[rt89name].offset + funcDefs[rt89name].len);
    const hasTime = src89.includes('getTime') || src89.includes('Date') || src89.includes('1000');
    console.log('rt[89] timestamp?', hasTime ? '✅' : '❌', '(' + rt89name + ')');
}

// ============================================================
// Step 6: 输出全部 440 条 rt 映射摘要
// ============================================================
const summary = [];
for (let i = 0; i < args.length; i++) {
    const rtIdx = i + BASE;
    const val = args[i];
    let type = 'unknown';
    if (funcDefs[val]) {
        type = vmCalls[val] ? 'vmCall(' + vmCalls[val].vmId + ')' : 'func(' + funcDefs[val].params + ')[' + funcDefs[val].len + ']';
    } else if (val.match(/^_\$/)) {
        type = 'ref:' + val;
    } else if (val.match(/^\d/)) {
        type = 'num:' + val;
    } else {
        type = 'val:' + val.substring(0, 30);
    }
    summary.push('rt[' + rtIdx + '] = ' + val + ' → ' + type);
}
fs.writeFileSync('C:/lsd_project/rs_reverse/houzhui/debug_output/rt_full_map.txt', summary.join('\n'));
console.log('\n★ 完整 rt 映射已保存到 rt_full_map.txt (' + summary.length + ' 条)');
