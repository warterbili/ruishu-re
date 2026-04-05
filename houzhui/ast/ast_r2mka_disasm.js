/**
 * AST 分析 r2mKa 字节码 — 自动反汇编 + 翻译
 *
 * 用 AST 解析 r2mKa 解释器 (_$l2, _$_I, _$gF) 的 opcode 实现
 * 然后用 opcode 表自动反汇编 child[59] 的全部 52 个子函数
 */
const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');

const code = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');
const r2mka = JSON.parse(fs.readFileSync('debug_output/r2mka_parsed.json', 'utf-8'));
const stringTables = JSON.parse(fs.readFileSync('debug_output/string_tables.json', 'utf-8'));

const g72 = stringTables.g72; // VM string table

// rt[67] 常量表
const rt67 = [131072,8,33,65536,33554432,192,-1,7,127,58,65535,27,100,18,25,11,32768,2097151,268435456,34,19,4194304,30,24,2,13,128,10,45,16777216,512,134217727,8192,604800,92,37,6,35,224,240,12,1024,256,255,4294967295,14,5,63,4,17,4294967296,64,32,3,20,200,15,40,8388608,134217728,9,1000,31,16,86,0.01,41,42,90,85,-4,2097152,71,262144,79,48,23,93,40960,16843008,82,51,39,44,-100,56,-0.01,2654435769,122,75,68,36,28,4096,5000,52,65,57,2048,59,248,201,2000,203,283,300,21,268435455,126,102,100000,0,72,46,80,16383,26,180,500,89,97,47,1048576,60,43,257,29,55,30000,1001,0.9,3500,3000,0.6,164,0.35,-7,65537,-90,191,271733878,1732584193,254,1500,16843009,-0.9,1859775393,1048575,-180,2047,15679,1000000,55296,360,0.2,0.8,3285377520,-0.2,0.813264543,2500,-0.26,3337565984,86400000,0.4,112,4023233417,2400959708,1518500249,2562383102,16777215,3145728,99,20000,98,2531011,5089,-2,0.1,536870912,0.26,3395469782,1800,252,56320,10240,3988292384];

// push 参数列表
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
const RT_BASE = 56;

// rt[N] → function name mapping
function rtName(n) {
    const idx = n - RT_BASE;
    if (idx >= 0 && idx < pushArgs.length) return pushArgs[idx];
    return 'rt[' + n + ']';
}

// ============================================================
// Opcode disassembler (from suffix_functions_disasm.txt patterns)
// ============================================================
function disasm(bc, globals_base) {
    const lines = [];
    let pc = 0;
    while (pc < bc.length) {
        const op = bc[pc];
        const startPc = pc;
        let instr = '';

        switch (op) {
            case 0: instr = 'arg(' + bc[++pc] + ')'; pc++; break;
            case 1: instr = 'eW=G(' + bc[++pc] + ')'; pc++; break;
            case 2: instr = '!'; pc++; break;
            case 3: instr = 'SET'; pc++; break;
            case 5: instr = 'SPROP(' + bc[++pc] + ') // .' + (g72[bc[pc]] || '?'); pc++; break;
            case 6: instr = '.s(' + bc[++pc] + ') // .' + (g72[bc[pc]] || '?'); pc++; break;
            case 7: instr = '-'; pc++; break;
            case 8: instr = 'CALL(' + bc[++pc] + ')'; pc++; break;
            case 9: instr = 'ETRY'; pc++; break;
            case 10: instr = 'LP-(' + bc[++pc] + ')'; pc++; break;
            case 11: instr = 'G(' + bc[++pc] + ')'; pc++; break;
            case 12: instr = 'C(' + bc[++pc] + ')'; pc++; break;
            case 13: instr = 'RET'; pc++; break;
            case 14: instr = '>='; pc++; break;
            case 15: instr = '>'; pc++; break;
            case 19: instr = 'JT+(' + bc[++pc] + ')'; pc++; break;
            case 20: instr = 'EXT(' + bc[++pc] + ') // rt[' + bc[pc] + ']=' + rtName(bc[pc]); pc++; break;
            case 24: instr = 'C0p'; pc++; break;
            case 26: instr = 'op26(' + bc[++pc] + ')'; pc++; break;
            case 28: instr = 'JF+(' + bc[++pc] + ')'; pc++; break;
            case 29: instr = '<'; pc++; break;
            case 30: instr = 'N(' + bc[++pc] + ')'; pc++; break;
            case 31: instr = '<='; pc++; break;
            case 32: instr = 'eW=L(' + bc[++pc] + ')'; pc++; break;
            case 33: instr = 'SPROP2(' + bc[++pc] + ')'; pc++; break;
            case 34: instr = '{}'; pc++; break;
            case 35: instr = '+'; pc++; break;
            case 36: instr = 'N(1) // 1'; pc++; break;
            case 37: instr = 'op37(' + bc[++pc] + ')'; if (bc[pc+1] !== undefined) { instr += ',' + bc[++pc]; if (bc[pc+1] !== undefined) instr += ',' + bc[++pc]; } pc++; break;
            case 38: instr = '==='; pc++; break;
            case 39: instr = 'typeof'; pc++; break;
            case 40: instr = '&&'; pc++; break;
            case 41: instr = 'C1p'; pc++; break;
            case 42: instr = 'C1p2'; pc++; break;
            case 44: instr = 'JF+(long:' + bc[++pc] + ')'; pc++; break;
            case 45: instr = 'J+(' + bc[++pc] + ')'; pc++; break;
            case 47: instr = '||'; pc++; break;
            case 48: instr = '!='; pc++; break;
            case 49: instr = 'N(0) // 0'; pc++; break;
            case 50: instr = 'eW=[]'; pc++; break;
            case 51: instr = 'post++'; pc++; break;
            case 52: instr = 'op52'; pc++; break;
            case 54: instr = 'C2v'; pc++; break;
            case 55: instr = 'op55(' + bc[++pc] + ')'; pc++; break;
            case 56: instr = '[]p'; pc++; break;
            case 57: instr = '[]p // prop'; pc++; break;
            case 58: instr = 'op58(' + bc[++pc] + ')'; pc++; break;
            case 59: instr = 'DEFCHILD(' + bc[++pc] + ')'; pc++; break;
            case 60: instr = 'L(' + bc[++pc] + ')'; pc++; break;
            case 61: instr = 'APUSH'; pc++; break;
            case 62: instr = '[]'; pc++; break;
            case 67: instr = 'op67'; pc++; break;
            case 91: instr = 'C2p'; pc++; break;
            case 102: instr = 'APPLY(' + bc[++pc] + ')'; pc++; break;
            case 110: instr = 'op110'; pc++; break;
            default: instr = 'op' + op; pc++; break;
        }
        lines.push(startPc.toString().padStart(4) + ' ' + instr);
    }
    return lines;
}

// ============================================================
// 反汇编 child[59] 的全部 52 个子函数
// ============================================================
const child59 = r2mka.root.children[59];
const output = [];
output.push('// ============================================================');
output.push('// r2mKa root.child[59] — Cookie S 管理器');
output.push('// 52 个子函数的完整反汇编');
output.push('// ============================================================\n');

// 主函数
output.push('// === child[59] main (vars=' + child59.varCount + ' bc=' + child59.bytecode.length + 'B) ===');
disasm(child59.bytecode).forEach(l => output.push(l));
output.push('');

// 52 个子函数
child59.children.forEach((child, i) => {
    output.push('// === child[59].child[' + i + '] (vars=' + child.varCount + ' bc=' + child.bytecode.length + 'B children=' + child.children.length + ') ===');
    const lines = disasm(child.bytecode);
    lines.forEach(l => output.push(l));
    // 子子函数
    if (child.children) {
        child.children.forEach((sub, j) => {
            output.push('  // --- child[59].child[' + i + '].child[' + j + '] (vars=' + sub.varCount + ' bc=' + sub.bytecode.length + 'B) ---');
            disasm(sub.bytecode).forEach(l => output.push('  ' + l));
        });
    }
    output.push('');
});

fs.writeFileSync('debug_output/child59_disasm.txt', output.join('\n'));
console.log('Saved to child59_disasm.txt');
console.log('Total lines:', output.length);
console.log('Key functions:');
console.log('  child[59].child[35] (238B) — calls rt[233]=_$fB (cookie reader)');
console.log('  child[59].child[49] (275B) — calls rt[233]=_$fB (cookie reader)');
console.log('  child[59].child[40] (1031B) — largest child, likely main logic');
console.log('  child[59].child[41] (701B) — second largest');
console.log('  child[59].child[44] (550B) — third largest');
console.log('  child[59].child[36] (484B) — fourth largest');
