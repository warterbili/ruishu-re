/**
 * AST: 从 VM 解释器 _$_I 中提取 opcode 实现
 * 找到每个 opcode 对应的 JS 代码
 */
const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');

const code = fs.readFileSync('C:/lsd_project/learn_js/reverse/captured/eval_code.js', 'utf-8');
const ast = acorn.parse(code, { ecmaVersion: 2020 });

// 找 _$_I 函数
let iiNode = null;
walk.simple(ast, {
    FunctionDeclaration(node) {
        if (node.id && node.id.name === '_$_I') iiNode = node;
    }
});

const iiSrc = code.substring(iiNode.start, iiNode.end);
console.log('_$_I length:', iiSrc.length);

// _$_I 内部有 while(1) 循环，里面有巨大的 if-else 链
// 每个 if 分支对应一个 opcode
// 模式: if(_$$b===N){...} 或 if(_$$b<N){...}

// 找出所有 opcode case
const opcodeRe = /if\(\$\$b===(\d+)\)\{([^}]+)\}/g;
// 更好的方式: 用 AST 找所有 _$$b===N 比较

const opcodes = {};
walk.simple(iiNode, {
    IfStatement(node) {
        // 找 _$$b===N 形式的条件
        if (node.test.type === 'BinaryExpression' &&
            node.test.operator === '===' &&
            node.test.left.type === 'Identifier' &&
            node.test.right.type === 'Literal' &&
            typeof node.test.right.value === 'number') {

            const varName = node.test.left.name;
            const opNum = node.test.right.value;

            // 只关心 opcode 变量 (通常叫 _$$b 或类似)
            if (opNum < 1000) {
                const bodySrc = code.substring(node.consequent.start, node.consequent.end);
                if (bodySrc.length < 500) { // 只取简短的实现
                    if (!opcodes[opNum]) {
                        opcodes[opNum] = {
                            var: varName,
                            body: bodySrc.replace(/\s+/g, ' ').trim().substring(0, 200)
                        };
                    }
                }
            }
        }
    }
});

// 输出关键缺失 opcodes
const missing = [4, 8, 16, 17, 18, 21, 22, 23, 27, 36, 39, 43, 46, 53, 55, 63, 64, 66, 68, 70, 72, 74, 75, 78, 80, 81, 86, 99, 100, 101, 102, 104, 105, 107, 108, 109, 111, 115];

console.log('\n=== Missing Opcodes Implementation ===\n');
missing.forEach(op => {
    if (opcodes[op]) {
        console.log('op' + op + ' (' + opcodes[op].var + '): ' + opcodes[op].body);
    }
});

// 也找 _$gF (另一个 VM 循环, 8774 chars)
let gfNode = null;
walk.simple(ast, {
    FunctionDeclaration(node) {
        if (node.id && node.id.name === '_$gF') gfNode = node;
    }
});

if (gfNode) {
    console.log('\n=== _$gF opcodes ===\n');
    walk.simple(gfNode, {
        IfStatement(node) {
            if (node.test.type === 'BinaryExpression' &&
                node.test.operator === '===' &&
                node.test.left.type === 'Identifier' &&
                node.test.right.type === 'Literal' &&
                typeof node.test.right.value === 'number') {
                const opNum = node.test.right.value;
                if (missing.includes(opNum)) {
                    const bodySrc = code.substring(node.consequent.start, node.consequent.end);
                    if (bodySrc.length < 500) {
                        console.log('op' + opNum + ': ' + bodySrc.replace(/\s+/g, ' ').trim().substring(0, 200));
                    }
                }
            }
        }
    });
}

// 输出完整的 opcode 表
console.log('\n=== All found opcodes ===\n');
const sorted = Object.keys(opcodes).map(Number).sort((a,b) => a-b);
sorted.forEach(op => {
    console.log('op' + op + ': ' + opcodes[op].body.substring(0, 150));
});

// 保存
const output = {};
sorted.forEach(op => { output[op] = opcodes[op].body; });
fs.writeFileSync('debug_output/opcodes.json', JSON.stringify(output, null, 2));
console.log('\n★ Saved ' + sorted.length + ' opcodes to opcodes.json');
