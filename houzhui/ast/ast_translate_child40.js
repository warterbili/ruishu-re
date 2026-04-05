/**
 * AST 自动翻译 child[59].child[40] (Cookie S TLV 解析器)
 * 从反汇编直接生成可读 JS
 */
const fs = require('fs');
const r2mka = JSON.parse(fs.readFileSync('debug_output/r2mka_parsed.json', 'utf-8'));
const stringTables = JSON.parse(fs.readFileSync('debug_output/string_tables.json', 'utf-8'));
const g72 = stringTables.g72;

const code = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');
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

// rt 函数名查找
function rtName(n) {
    if (n >= BASE && n - BASE < pushArgs.length) return pushArgs[n - BASE];
    return 'rt_' + n;
}

// rt 函数的实际功能 (从之前 AST 分析)
const rtDesc = {
    11: 'rt_preInit',
    64: 'stringTable_g68',
    113: 'sliceRead',        // _$c8: 变长读取
    129: 'hashFunc',         // _$j2: hash
    146: 'huffmanDecode',    // _$$p: Huffman
    157: 'xorInPlace',       // _$i1: XOR
    167: 'dataVar',
    204: 'getFlag_bA',       // 返回字符串
    206: 'getStr_cV',
    207: 'getNum_ke',
    209: 'vmCall_732',       // vmCall
    210: 'getStr_aC',
    211: 'getStr_iX',
    212: 'getStr_dl',
    213: 'getStr_fj',
    214: 'getNum_ez',
    215: 'getStr_cv',
    371: 'vmCall_25',
    379: 'key_ss',  380: 'key_cP',  381: 'key_k1',  382: 'key_gf',
    383: 'key_li',  384: 'key_ge',  385: 'key_d1',  386: 'key_il',
    387: 'key_dT',  388: 'key_fb',  389: 'key_h9',  390: 'key_it',
    391: 'key_Q',   392: 'key_a3',  393: 'key_F',   394: 'key_eD',
    395: 'key_1',   396: 'key_d3',  397: 'key_a9',  398: 'key_kL',
    399: 'key_X',   400: 'key_aT',  401: 'key_eP',  402: 'key_a7',
    403: 'key_c_',  404: 'key_gX',  405: 'vmCall_307', 406: 'key_dp',
    407: 'key_a',   408: 'key_kJ',  409: 'vmCall_563', 410: 'key_ll',
    411: 'key_hZ',
};

// 字节码
const bc = r2mka.root.children[59].children[40].bytecode;

// 翻译
const output = [];
output.push('/**');
output.push(' * Cookie S TLV 解析器 (child[59].child[40])');
output.push(' * 自动翻译自 1031B r2mKa 字节码');
output.push(' *');
output.push(' * 输入: Cookie S 解密后的字节流');
output.push(' * 输出: 按子键存储的 session 数据');
output.push(' */');
output.push('');
output.push('function parseCookieS(data, xorKey, globals) {');
output.push('    // 初始化');
output.push('    var result = {};');
output.push('    var reader = createReader(data);');
output.push('    var strTable = globals.stringTable;');
output.push('');

// 按 CALL_2V 位置分段翻译
// 每个 CALL_2V 之前是: 生成子键名 → 读取数据 → 写入
let pc = 0;
let sectionNum = 0;

// 从反汇编提取每个 section
const disasm = fs.readFileSync('debug_output/child59_child40_disasm.txt', 'utf-8').split('\n');

// 提取所有 CALL_2V 和它们对应的 rt 函数
const sections = [];
let currentSection = { startPc: 0, lines: [], writeRt: null };

disasm.forEach((line, idx) => {
    currentSection.lines.push(line);
    if (line.includes('CALL_2V')) {
        // 往前找 PUSH_RT
        for (let j = idx - 1; j >= Math.max(0, idx - 8); j--) {
            const m = disasm[j].match(/PUSH_RT\((\d+)\)/);
            if (m) {
                currentSection.writeRt = parseInt(m[1]);
                break;
            }
        }
        sections.push(currentSection);
        currentSection = { startPc: 0, lines: [], writeRt: null };
    }
});
if (currentSection.lines.length > 0) sections.push(currentSection);

// 翻译每个 section
output.push('    // === TLV 解析循环 ===');
output.push('    // Cookie S 包含 ' + sections.length + ' 个数据段');
output.push('');

let fieldIdx = 0;
sections.forEach((section, i) => {
    if (!section.writeRt) return;
    const keyFunc = rtDesc[section.writeRt] || 'rt_' + section.writeRt;

    // 分析 section 中引用的 rt 函数
    const rtRefs = [];
    section.lines.forEach(l => {
        const m = l.match(/PUSH_RT\((\d+)\)/);
        if (m) rtRefs.push(parseInt(m[1]));
    });

    // 判断读取类型
    const hasSlice = rtRefs.includes(113);    // _$c8 = slice read
    const hasHash = rtRefs.includes(129);     // _$j2 = hash
    const hasHuffman = rtRefs.includes(146);  // _$$p = Huffman
    const hasXOR = rtRefs.includes(157);      // _$i1 = XOR
    const hasVmCall = rtRefs.some(r => [209, 371, 405, 409].includes(r));

    const readType = hasHash ? 'hash' : hasHuffman ? 'huffman' : hasSlice ? 'slice' : hasVmCall ? 'vmCall' : 'direct';

    output.push('    // field ' + fieldIdx + ': ' + keyFunc + ' (read: ' + readType + ')');
    output.push('    result["' + keyFunc + '"] = read_' + readType + '(reader);');
    fieldIdx++;
});

output.push('');
output.push('    return result;');
output.push('}');

// 读取器
output.push('');
output.push('// === 读取器 ===');
output.push('function createReader(data) {');
output.push('    return { data: data, pos: 0,');
output.push('        readByte: function() { return this.data[this.pos++]; },');
output.push('        readVarLen: function() {');
output.push('            var x = this.data[this.pos++];');
output.push('            if ((x & 128) === 0) return x;');
output.push('            if ((x & 192) === 128) return ((x & 63) << 8) | this.data[this.pos++];');
output.push('            if ((x & 224) === 192) return ((x & 31) << 16) | (this.data[this.pos++] << 8) | this.data[this.pos++];');
output.push('            return x;');
output.push('        },');
output.push('        readSlice: function(len) {');
output.push('            var r = this.data.slice(this.pos, this.pos + len);');
output.push('            this.pos += len;');
output.push('            return r;');
output.push('        },');
output.push('        readField: function() {');
output.push('            var len = this.readVarLen();');
output.push('            return this.readSlice(len);');
output.push('        }');
output.push('    };');
output.push('}');
output.push('');
output.push('function read_slice(reader) { return reader.readField(); }');
output.push('function read_hash(reader) { return reader.readField(); /* then hash */ }');
output.push('function read_huffman(reader) { return reader.readField(); /* then huffman decode */ }');
output.push('function read_vmCall(reader) { return reader.readField(); }');
output.push('function read_direct(reader) { return reader.readField(); }');

fs.writeFileSync('debug_output/cookie_s_parser.js', output.join('\n'));
console.log('★ Saved to cookie_s_parser.js');
console.log('Total sections:', sections.filter(s => s.writeRt).length);
console.log('Fields:');
sections.filter(s => s.writeRt).forEach((s, i) => {
    const name = rtDesc[s.writeRt] || 'rt_' + s.writeRt;
    console.log('  [' + i + '] rt[' + s.writeRt + '] = ' + name);
});
