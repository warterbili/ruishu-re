/**
 * AST: 追踪 Cookie S → 49B session 的完整链路
 * 提取所有相关函数源码，构建完整的解密流程
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
        if (node.id) {
            allFuncs[node.id.name] = {
                start: node.start, end: node.end,
                len: node.end - node.start,
                params: node.params.map(p => p.name || '?')
            };
        }
    }
});

// 提取函数源码
function getSrc(name) {
    const f = allFuncs[name];
    return f ? code.substring(f.start, f.end) : null;
}

// 递归获取调用链
function getCallChain(name, depth, visited) {
    if (depth > 6 || visited.has(name)) return [];
    visited.add(name);
    const src = getSrc(name);
    if (!src) return [];
    const calls = new Set();
    const re = /(_\$\w+)\s*\(/g;
    let m;
    while (m = re.exec(src)) {
        if (allFuncs[m[1]] && m[1] !== name) calls.add(m[1]);
    }
    const result = [{ name, len: src.length, calls: [...calls] }];
    calls.forEach(c => {
        result.push(...getCallChain(c, depth + 1, visited));
    });
    return result;
}

// ============================================================
// 1. 提取 Cookie S 解密完整链路
// ============================================================
console.log('★★★ Cookie S → 49B Session 完整链路 ★★★\n');

// _$fB = Cookie 读取器
// _$hd = AES 主函数
// _$mp = AES S-Box
// _$l3 = AES KeyExpansion
// _$cN = 核心大函数 (19KB)

const keyFuncs = ['_$fB', '_$hd', '_$mp', '_$l3', '_$jq', '_$gI', '_$fE', '_$ds'];
const output = [];

output.push('// ============================================================');
output.push('// Cookie S → 49B Session 完整解密代码');
output.push('// 从 eval_code.js (nsd=81494) 通过 AST 提取');
output.push('// ============================================================\n');

// 从 _$hd (AES 主函数) 开始，提取完整调用链
console.log('=== AES 解密链 (_$hd) ===');
const aesChain = getCallChain('_$hd', 0, new Set());
aesChain.forEach(f => {
    console.log('  ' + f.name + ' (' + f.len + ' chars) → ' + f.calls.join(', '));
});

// 提取所有 AES 相关函数源码
const aesFuncNames = new Set(aesChain.map(f => f.name));
console.log('\nAES 相关函数:', [...aesFuncNames].join(', '));

aesFuncNames.forEach(name => {
    const src = getSrc(name);
    if (src) {
        output.push('// === ' + name + ' (' + src.length + ' chars) ===');
        output.push(src);
        output.push('');
    }
});

// ============================================================
// 2. 提取 Cookie 读取函数
// ============================================================
output.push('// === _$fB (Cookie 读取) ===');
output.push(getSrc('_$fB'));
output.push('');

// ============================================================
// 3. 找 Base64 decode (Cookie S 是 base64 编码的)
// ============================================================
console.log('\n=== Base64 decode 搜索 ===');
// 搜索包含 charCodeAt + 位移 + 64 字符映射表的函数
for (const [name, info] of Object.entries(allFuncs)) {
    const src = code.substring(info.start, info.end);
    if (info.len > 50 && info.len < 1500 && src.includes('charCodeAt')) {
        // 检查是否有 base64 decode 特征
        if ((src.includes('>>4') || src.includes('>> 4') || src.includes('>>2') || src.includes('>> 2')) &&
            (src.includes('&15') || src.includes('& 15') || src.includes('&3') || src.includes('& 3') ||
             src.includes('&0xF') || src.includes('&0x3'))) {
            console.log('Base64 decode candidate: ' + name + ' (' + info.len + ' chars)');
            output.push('// === ' + name + ' (possible Base64 decode) ===');
            output.push(src);
            output.push('');
        }
    }
}

// ============================================================
// 4. 找 Huffman 解码
// ============================================================
console.log('\n=== Huffman 搜索 ===');
for (const [name, info] of Object.entries(allFuncs)) {
    const src = code.substring(info.start, info.end);
    if (info.len > 200 && info.len < 3000) {
        // Huffman 特征: 树遍历 (left/right), 或者 bit 读取
        if ((src.includes('>>') && src.includes('&1')) ||
            (src.includes('_$lO[28]') && src.includes('_$lO[36]'))) { // 45, 6
            // 进一步检查
            if (src.includes('_$lO[28]') || src.includes('_$lO[43]')) { // 45 or 255
                console.log('Huffman candidate: ' + name + ' (' + info.len + ' chars)');
                console.log('  preview: ' + src.substring(0, 200).replace(/\s+/g, ' '));
                output.push('// === ' + name + ' (possible Huffman) ===');
                output.push(src);
                output.push('');
            }
        }
    }
}

// ============================================================
// 5. 找字节写入函数 (_$kC, _$_h, _$_M, _$ho)
// ============================================================
console.log('\n=== 字节写入函数 ===');
// 这些函数在 _$dm (74KB VM主函数) 内部调用
// 从 _$dm 的调用链中找
['_$kC', '_$_h', '_$_M', '_$ho', '_$mr', '_$co', '_$ew'].forEach(name => {
    const src = getSrc(name);
    if (src) {
        console.log(name + ' (' + src.length + ' chars)');
        output.push('// === ' + name + ' (byte writer) ===');
        output.push(src);
        output.push('');
    }
});

// ============================================================
// 6. 找 _$am (byte array helper, 出现在 AES 和 XOR 中)
// ============================================================
['_$am', '_$c4', '_$$o', '_$hl', '_$e6', '_$b0'].forEach(name => {
    const src = getSrc(name);
    if (src) {
        console.log(name + ' (' + src.length + ' chars): ' + src.substring(0, 80).replace(/\s+/g, ' '));
        output.push('// === ' + name + ' (helper) ===');
        output.push(src);
        output.push('');
    }
});

// ============================================================
// 7. 保存完整的解密代码
// ============================================================
fs.writeFileSync('C:/lsd_project/rs_reverse/houzhui/debug_output/session_decrypt_chain.js', output.join('\n'));
console.log('\n★ 完整解密链代码已保存到 session_decrypt_chain.js');
console.log('★ 包含', output.filter(l => l.startsWith('// ===')).length, '个函数');
