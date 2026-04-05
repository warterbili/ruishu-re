/**
 * AST 自动字节码翻译器
 * 把 r2mKa 字节码自动转成可运行 JS
 * 直接翻译 child[59] 的 52 个子函数 → Cookie S 解密器
 */
const fs = require('fs');
const r2mka = JSON.parse(fs.readFileSync('debug_output/r2mka_parsed.json', 'utf-8'));
const stringTables = JSON.parse(fs.readFileSync('debug_output/string_tables.json', 'utf-8'));
const g72 = stringTables.g72;

// push args for rt name lookup
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
const RT_BASE = 56;

// ============================================================
// Bytecode → JS 翻译器
// ============================================================
function translateBytecode(bc, funcName, varCount, childCount, parentGlobalsBase) {
    const lines = [];
    const stack = []; // 模拟栈
    let pc = 0;
    const locals = {};

    function push(expr) { stack.push(expr); }
    function pop() { return stack.length ? stack.pop() : '/*empty*/'; }
    function peek() { return stack.length ? stack[stack.length-1] : '/*empty*/'; }

    function emit(code) { lines.push('    ' + code); }

    while (pc < bc.length) {
        const op = bc[pc];

        switch(op) {
            case 0: { // arg(N)
                const n = bc[++pc]; push('arg' + n); pc++; break;
            }
            case 1: { // eW=G(N)
                const n = bc[++pc]; push('G[' + n + ']'); pc++; break;
            }
            case 2: { // !
                const v = pop(); push('(!' + v + ')'); pc++; break;
            }
            case 3: { // SET
                pc++; break; // SET consumed by next eW=
            }
            case 5: { // SPROP(N)
                const n = bc[++pc]; const val = pop(); const obj = peek();
                emit(obj + '["' + (g72[n]||n) + '"] = ' + val + ';');
                pc++; break;
            }
            case 6: { // .s(N) — string property read
                const n = bc[++pc]; const obj = pop();
                push(obj + '["' + (g72[n]||n) + '"]');
                pc++; break;
            }
            case 7: { // -
                const b = pop(), a = pop(); push('(' + a + ' - ' + b + ')'); pc++; break;
            }
            case 9: { // ETRY
                emit('// ETRY'); pc++; break;
            }
            case 10: { // LP-(N)
                const n = bc[++pc]; emit('// LOOP back ' + n); pc++; break;
            }
            case 11: { // G(N)
                const n = bc[++pc]; push('G[' + n + ']'); pc++; break;
            }
            case 12: { // C(N) — constant/new array
                const n = bc[++pc];
                if (n === 310) push('[]');
                else push('C(' + n + ')');
                pc++; break;
            }
            case 13: { // RET
                const v = stack.length ? pop() : 'undefined';
                emit('return ' + v + ';');
                pc++; break;
            }
            case 14: push('(' + pop() + ' >= ' + pop() + ')'); pc++; break; // >= (reversed)
            case 15: { const b=pop(),a=pop(); push('(' + a + ' > ' + b + ')'); pc++; break; }
            case 19: { // JT+(N)
                const n = bc[++pc]; const cond = pop();
                emit('if (' + cond + ') { /* jump +' + n + ' */ }');
                pc++; break;
            }
            case 20: { // EXT(N) — rt[N]
                const n = bc[++pc];
                const rtIdx = n;
                const name = (rtIdx >= RT_BASE && rtIdx - RT_BASE < pushArgs.length) ? pushArgs[rtIdx - RT_BASE] : 'rt[' + rtIdx + ']';
                push('rt[' + rtIdx + '/*' + name + '*/]');
                pc++; break;
            }
            case 24: { // C0p — call 0 args
                const fn = pop(); push(fn + '()');
                pc++; break;
            }
            case 26: { // op26(N) — closure var read
                const n = bc[++pc]; push('closure[' + n + ']'); pc++; break;
            }
            case 28: { // JF+(N)
                const n = bc[++pc]; const cond = pop();
                emit('if (!(' + cond + ')) { /* jump +' + n + ' */ }');
                pc++; break;
            }
            case 29: push('(' + pop() + ' < ' + pop() + ')'); pc++; break; // < (reversed)
            case 30: { // N(x) — push literal
                const n = bc[++pc]; push('' + n); pc++; break;
            }
            case 31: push('(' + pop() + ' <= ' + pop() + ')'); pc++; break;
            case 32: { // eW=L(N)
                const n = bc[++pc]; const v = pop();
                emit('L' + n + ' = ' + v + ';');
                locals['L' + n] = true;
                pc++; break;
            }
            case 33: { // SPROP2
                const n = bc[++pc]; const val = pop(); const obj = peek();
                emit(obj + '["' + (g72[n]||n) + '"] = ' + val + ';');
                pc++; break;
            }
            case 34: push('{}'); pc++; break; // create object
            case 35: { const b=pop(),a=pop(); push('(' + a + ' + ' + b + ')'); pc++; break; } // +
            case 37: { // op37 — multi-arg operation
                const a = bc[++pc], b = bc[++pc], c = bc[++pc];
                push('op37(' + a + ',' + b + ',' + c + ')');
                pc++; break;
            }
            case 38: { const b=pop(),a=pop(); push('(' + a + ' === ' + b + ')'); pc++; break; }
            case 40: { const b=pop(),a=pop(); push('(' + a + ' && ' + b + ')'); pc++; break; }
            case 41: { // C1p — call 1 arg
                const arg1 = pop(), fn = pop(); push(fn + '(' + arg1 + ')');
                pc++; break;
            }
            case 42: { // C1p2 — method call 1 arg
                const arg1 = pop(); push('/*C1p2*/(' + arg1 + ')');
                pc++; break;
            }
            case 44: { // JF+(long)
                const n = bc[++pc]; const cond = pop();
                emit('if (!(' + cond + ')) { /* long jump +' + n + ' */ }');
                pc++; break;
            }
            case 45: { // J+(N)
                const n = bc[++pc]; emit('/* jump +' + n + ' */'); pc++; break;
            }
            case 47: { const b=pop(),a=pop(); push('(' + a + ' || ' + b + ')'); pc++; break; }
            case 48: { const b=pop(),a=pop(); push('(' + a + ' != ' + b + ')'); pc++; break; }
            case 49: push('0'); pc++; break; // N(0)
            case 50: { // eW=[] — indexed write
                const val = pop(), key = pop(), obj = pop();
                emit(obj + '[' + key + '] = ' + val + ';');
                pc++; break;
            }
            case 51: { // post++
                const v = pop(); push(v + '++'); pc++; break;
            }
            case 52: emit('/* op52 increment */'); pc++; break;
            case 54: { // C2v — void call 2 args
                const a2=pop(), a1=pop(), fn=pop();
                emit(fn + '(' + a1 + ', ' + a2 + '); // void');
                pc++; break;
            }
            case 56: // []p — property access
            case 57: {
                const key = pop(), obj = pop();
                if (typeof key === 'string' && key.match(/^\d+$/) && g72[parseInt(key)]) {
                    push(obj + '.' + g72[parseInt(key)]);
                } else {
                    push(obj + '[' + key + ']');
                }
                pc++; break;
            }
            case 58: { const n = bc[++pc]; emit('/* op58(' + n + ') */'); pc++; break; }
            case 59: { const n = bc[++pc]; emit('/* DEFCHILD(' + n + ') */'); pc++; break; }
            case 60: { // L(N)
                const n = bc[++pc]; push('L' + n); pc++; break;
            }
            case 61: { // APUSH
                const val = pop(), arr = pop(); emit(arr + '.push(' + val + ');');
                push(arr);
                pc++; break;
            }
            case 62: push('[]'); pc++; break; // create array
            case 67: emit('/* op67 */'); pc++; break;
            case 91: { // C2p — call 2 args, push result
                const a2=pop(), a1=pop(), fn=pop();
                push(fn + '(' + a1 + ', ' + a2 + ')');
                pc++; break;
            }
            case 110: emit('/* op110 */'); pc++; break;
            // === 从 opcodes.json 补充的高频 opcodes ===
            case 4: { // 读取环境变量
                push('_env'); pc++; break;
            }
            case 8: { // CALL(N)
                const n = bc[++pc]; emit('/* call child[' + n + '] */'); pc++; break;
            }
            case 16: { // 除法取整
                const b = pop(), a = pop(); push('Math.floor(' + a + ' / ' + b + ')'); pc++; break;
            }
            case 17: { // 字符串常量
                push('"\\r\\n"'); pc++; break;
            }
            case 18: { // split(":")
                const obj = pop(); emit(obj + ' = ' + obj + '.split(":");');
                push(obj); pc++; break;
            }
            case 21: { // ++counter
                emit('_counter++;'); pc++; break;
            }
            case 22: { // writeVarLen
                const val = pop(), arr = pop();
                emit('writeVarLen(' + arr + ', ' + val + ');');
                push(arr); pc++; break;
            }
            case 23: { // try-catch boundary
                emit('// try-catch'); pc++; break;
            }
            case 27: { // property delete or access
                const key = pop(), obj = pop();
                push(obj + '[' + key + ']');
                pc++; break;
            }
            case 36: { // conditional skip
                const n = bc[++pc];
                emit('if (!cond) { /* skip ' + n + ' */ }');
                pc++; break;
            }
            case 39: { // typeof
                const v = pop(); push('typeof ' + v); pc++; break;
            }
            case 43: { // jump conditional
                const n = bc[++pc];
                emit('/* cond jump +' + n + ' */');
                pc++; break;
            }
            case 46: { // Base64/decode call
                const arg1 = pop(); push('base64Decode(' + arg1 + ')');
                pc++; break;
            }
            case 53: { // writeVarLen v2
                const val = pop(), arr = pop();
                emit('writeVarLen(' + arr + ', ' + val + ');');
                push(arr); pc++; break;
            }
            case 55: { // op55 — two-byte constant
                const n = bc[++pc]; push('CONST_' + n); pc++; break;
            }
            case 63: { // array index access
                const key = pop(), obj = pop();
                push(obj + '[' + key + ']');
                pc++; break;
            }
            case 64: { // set to 0
                push('0'); pc++; break;
            }
            case 66: { // conditional skip v2
                const n = bc[++pc];
                emit('if (!cond) { /* skip ' + n + ' */ }');
                pc++; break;
            }
            case 68: { // charCodeAt/encode
                const v = pop(); push('encode(' + v + ')'); pc++; break;
            }
            case 70: { // environment check
                push('envCheck()'); pc++; break;
            }
            case 72: { // increment counter v2
                emit('counter2++;'); pc++; break;
            }
            case 74: { // words to string
                const v = pop();
                push('String.fromCharCode(' + v + '[0],' + v + '[1],' + v + '[2],' + v + '[3])');
                pc++; break;
            }
            case 75: { // access property
                const v = pop(); push(v + '.prop'); pc++; break;
            }
            case 78: { // accumulate
                const v = pop(); emit('accum += ' + v + ';'); pc++; break;
            }
            case 80: { // increment
                emit('idx++;'); pc++; break;
            }
            case 81: { // not undefined check
                const v = pop(); push('(' + v + ' !== undefined)'); pc++; break;
            }
            case 86: { // VM sub-call
                push('vmSubCall()'); pc++; break;
            }
            case 99: { // conditional branch
                const n = bc[++pc];
                emit('if (!cond) { /* branch ' + n + ' */ }');
                pc++; break;
            }
            case 100: { // runtime setup
                emit('/* runtime setup */'); pc++; break;
            }
            case 101: { // increment v3
                emit('counter3++;'); pc++; break;
            }
            case 102: { // return or-empty
                const v = stack.length ? pop() : '""';
                emit('return ' + v + ' || "";');
                pc++; break;
            }
            case 104: { // check > 0
                const v = pop(); push('(' + v + ' > 0)'); pc++; break;
            }
            case 105: { // conditional skip v3
                const n = bc[++pc];
                emit('if (!cond) { /* skip ' + n + ' */ }');
                pc++; break;
            }
            case 107: { // conditional skip v4
                const n = bc[++pc];
                emit('if (!cond) { /* skip ' + n + ' */ }');
                pc++; break;
            }
            case 108: { // check both truthy
                const b = pop(), a = pop(); push('(!' + a + ' || !' + b + ')'); pc++; break;
            }
            case 109: { // writeVarLen v3
                const val = pop(), arr = pop();
                emit('writeVarLen(' + arr + ', ' + val + ');');
                push(arr); pc++; break;
            }
            case 110: { // check coords changed
                push('coordsChanged()'); pc++; break;
            }
            case 111: { // conditional skip v5
                const n = bc[++pc];
                emit('if (!cond) { /* skip ' + n + ' */ }');
                pc++; break;
            }
            case 115: { // conditional skip v6
                const n = bc[++pc];
                emit('if (!cond) { /* skip ' + n + ' */ }');
                pc++; break;
            }
            default:
                // 大数值可能是跳转偏移，不是opcode
                if (op > 200) {
                    emit('/* jump/offset ' + op + ' */');
                } else {
                    emit('/* op' + op + ' */');
                }
                pc++;
        }
    }

    // 组装函数
    const varDecl = Object.keys(locals).length ? '    var ' + Object.keys(locals).join(', ') + ';\n' : '';
    return 'function ' + funcName + '(/* vars=' + varCount + ' */) {\n' + varDecl + lines.join('\n') + '\n}';
}

// ============================================================
// 翻译 child[59] 全部 52 个子函数
// ============================================================
const child59 = r2mka.root.children[59];
const output = [];

output.push('// ============================================================');
output.push('// Cookie S Manager (root.child[59]) — Auto-translated from bytecode');
output.push('// ============================================================\n');

// Main function
output.push('// --- main (vars=' + child59.varCount + ') ---');
output.push(translateBytecode(child59.bytecode, 'cookieS_main', child59.varCount, child59.children.length));
output.push('');

// All 52 children
child59.children.forEach((child, i) => {
    output.push('// --- child[' + i + '] (vars=' + child.varCount + ' bc=' + child.bytecode.length + 'B) ---');
    output.push(translateBytecode(child.bytecode, 'cookieS_child' + i, child.varCount, child.children.length));

    // Sub-children
    if (child.children) {
        child.children.forEach((sub, j) => {
            output.push('// --- child[' + i + '].child[' + j + '] ---');
            output.push(translateBytecode(sub.bytecode, 'cookieS_child' + i + '_sub' + j, sub.varCount, 0));
        });
    }
    output.push('');
});

fs.writeFileSync('debug_output/child59_translated.js', output.join('\n'));
console.log('★ Saved to child59_translated.js');
console.log('Total functions:', child59.children.length + 1);
console.log('Total lines:', output.length);
