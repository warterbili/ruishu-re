# AST 分析方法论: JSVMP 逆向工程

## 为什么 AST 是 JSVMP 逆向的最优方法

### JSVMP 的本质

瑞数的 JS 虚拟机保护 (JSVMP) 架构:

```
Layer 1: mainjs → 解码 cd → 生成 eval 代码    (外层 VM, 已被 Coder 重写)
Layer 2: eval 代码 → 741 个状态码的 while(1)   (外层状态机)
Layer 3: 内层 VM → 407 个函数, 114 个操作码     (字节码解释器)
```

关键洞察: **eval 代码是合法 JS**, 可以被标准 AST 解析器 (acorn/babel) 完整解析。虽然代码高度混淆 (变量名洗牌、二叉搜索 if-else、多层嵌套), 但语法结构完整, AST 可以精确提取每一个语义单元。

### AST 能做什么

1. 从 34KB VM 解释器 `_$_I` 中提取全部 114 个 opcode 的 JS 实现
2. 找到 440+ 个注册到 `rt[]` 的函数, 建立完整映射表
3. 定位特定算法 (SHA-1, Huffman, AES) 的精确函数位置
4. 追踪数据流: 从入口函数到最终输出的完整调用链
5. 自动反汇编字节码 → 可读汇编 → 伪 JS 代码

### AST 不能做什么

1. 不能替代数据驱动: AST 告诉你 "怎么算", 但 basearr 的具体值仍需从真实数据对比获得
2. 不能跨版本通用: 变量名每次洗牌不同, AST 脚本需要适配变量名
3. 不能处理运行时状态: 动态生成的字符串表、运行时决定的分支, AST 无法直接获取

---

## 四步反编译管线

### Step 1: AST 提取 opcode → opcodes.json

**输入**: eval_code.js (296KB, 混淆 JS)
**输出**: opcodes.json (114 个 opcode 的 JS 实现)

核心方法: 找到 VM 解释器函数 `_$_I` (34KB), 遍历其 AST 中所有 `if(varName === N)` 形式的条件分支, 每个分支对应一个 opcode。

```javascript
const acorn = require('acorn');
const walk = require('acorn-walk');

const code = fs.readFileSync('eval_code.js', 'utf-8');
const ast = acorn.parse(code, { ecmaVersion: 2020 });

// 定位 _$_I 函数
let vmInterpreter = null;
walk.simple(ast, {
    FunctionDeclaration(node) {
        if (node.id && node.id.name === '_$_I') vmInterpreter = node;
    }
});

// 提取所有 opcode 分支
const opcodes = {};
walk.simple(vmInterpreter, {
    IfStatement(node) {
        if (node.test.type === 'BinaryExpression' &&
            node.test.operator === '===' &&
            node.test.right.type === 'Literal' &&
            typeof node.test.right.value === 'number') {
            const opNum = node.test.right.value;
            const bodySrc = code.substring(node.consequent.start, node.consequent.end);
            if (!opcodes[opNum]) {
                opcodes[opNum] = bodySrc.replace(/\s+/g, ' ').trim();
            }
        }
    }
});

fs.writeFileSync('opcodes.json', JSON.stringify(opcodes, null, 2));
// 输出: 409 个条目 (含嵌套分支)
```

输出示例:

```json
{
    "0": "{ _$eW = _$cR[_$gH._$hn[++_$bh]]; }",
    "1": "{ _$eW = _$gH._$eR[_$gH._$hn[++_$bh]]; }",
    "2": "{ _$eW = !_$eW; }",
    "6": "{ _$eW = _$eW[_$cR[_$gH._$hn[++_$bh]]]; }",
    "8": "{ var _$fc = _$gH._$hn[++_$bh]; _$eW = _$eW(_$fc ? ... }",
    "12": "{ _$eW = _$c1; _$c1 = []; }",
    "54": "{ _$eW = _$eW.apply(null, ...); }"
}
```

### Step 2: 反汇编字节码 → assembly

**输入**: r2mka_parsed.json (407 个函数的字节码) + opcodes.json
**输出**: disasm_output.txt (6328 行汇编)

将每个函数的字节码数组转化为人类可读的汇编指令:

```javascript
function disasm(bc) {
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
            case 5: instr = 'SPROP(' + bc[++pc] + ')'; pc++; break;
            case 6: instr = '.s(' + bc[++pc] + ')'; pc++; break;
            case 7: instr = '-'; pc++; break;
            case 8: instr = 'CALL(' + bc[++pc] + ')'; pc++; break;
            case 9: instr = 'ETRY'; pc++; break;
            case 10: instr = 'ECATCH'; pc++; break;
            case 11: instr = 'K(' + bc[++pc] + ')'; pc++; break;
            case 12: instr = 'eW=c1; c1=[]'; pc++; break;
            case 13: instr = 'c1.push(eW)'; pc++; break;
            // ... 共 114 个 opcode
        }
        lines.push(pc.toString().padStart(4) + ': ' + instr);
    }
    return lines;
}
```

输出示例 (child[40], Cookie S TLV 解析器):

```
   0: arg(0)
   2: eW=G(0)
   4: .s(18)      // .length
   6: eW=G(0)
   8: K(67)        // rt[67] 常量表
  10: .s(0)        // [0] = 131072
  12: >>>
  14: K(67)
  16: .s(7)        // [7] = 127
  18: &
  20: SET var(0)
```

### Step 3: 栈模拟 → 伪 JS

**输入**: disasm_output.txt + string_tables.json (变量名/字符串映射)
**输出**: pseudo_js.txt (1653 行可读 JS)

模拟 VM 的栈操作, 将汇编指令转化为表达式:

```javascript
function translateBytecode(bc, funcName) {
    const stack = [];
    const lines = [];
    let pc = 0;

    function push(expr) { stack.push(expr); }
    function pop() { return stack.length ? stack.pop() : '/*empty*/'; }
    function emit(code) { lines.push('    ' + code); }

    while (pc < bc.length) {
        const op = bc[pc];
        switch(op) {
            case 0: push('arg' + bc[++pc]); pc++; break;           // 参数引用
            case 1: push('G[' + bc[++pc] + ']'); pc++; break;      // 全局变量
            case 5: {                                                // 属性赋值
                const n = bc[++pc]; const val = pop(); const obj = peek();
                emit(obj + '.' + g72[n] + ' = ' + val + ';');
                pc++; break;
            }
            case 8: {                                                // 函数调用
                const argc = bc[++pc]; const args = [];
                for (let i = 0; i < argc; i++) args.unshift(pop());
                const fn = pop();
                push(fn + '(' + args.join(', ') + ')');
                pc++; break;
            }
            // ...
        }
    }
    return lines;
}
```

输出示例:

```javascript
function child40_tlvParser(cookieS_bytes) {
    var len = (cookieS_bytes.length >>> 0) & 127;
    var pos = 0;
    while (pos < len) {
        var type = sliceRead(cookieS_bytes, pos);
        var blockLen = sliceRead(cookieS_bytes, pos);
        var block = cookieS_bytes.slice(pos, pos + blockLen);
        // ... TLV 解析逻辑
    }
}
```

### Step 4: 手动语义标注

**输入**: pseudo_js.txt + 数据驱动对比结果
**输出**: 完整语义理解 + 算法文档

AST 自动翻译的代码缺乏变量语义。通过以下方式标注:

1. **常量表反查**: `rt[67][28] = 45` → 这是 Huffman 权重中 byte=0 的权重
2. **字符串表反查**: `g72[18] = "length"`, `g72[16] = "cookie"`
3. **函数签名对比**: `rt[129]` 的函数体包含 `0x67452301` → SHA-1 初始化常量
4. **数据流追踪**: 从 Cookie S 输入到 49B session 输出的完整链路

---

## AST vs 运行时追踪: 对比

| 维度 | 运行时追踪 (弯路) | AST 静态分析 (最优) |
|------|-------------------|---------------------|
| 前置条件 | 需要 sdenv/浏览器能运行 eval 代码 | 只需 eval_code.js 文本文件 |
| opcode 来源 | Hook while(1) 循环逐个记录 | AST 一次解析全部提取 |
| 覆盖率 | 只能覆盖当次执行路径 | 覆盖所有分支, 100% opcode |
| 速度 | ~80 字节码/天 (手动追踪) | ~400 字节码/小时 (批量翻译) |
| 可复用性 | 每次运行需要重新 hook | 脚本可复用, 适配变量名即可 |
| 准确性 | 受运行时状态影响, 可能遗漏 | 精确到每个 AST 节点 |
| 效率比 | 基准 (1x) | **约 80x** |

关键结论: 运行时追踪适合发现入口点和验证假设, AST 适合批量提取和系统性分析。两者结合效果最好: 先用运行时追踪 (Step 1-22) 建立整体理解, 再用 AST 系统性提取所有细节。

---

## rt[] 函数注册机制

eval 代码中有一个关键的大 push 语句:

```javascript
Array.prototype.push.apply(_$cR, [func1, func2, func3, ...]);
// _$cR = rt 数组
// 一次注册 440+ 个函数到 rt[56] ~ rt[495]
```

AST 提取方法:

```javascript
// 定位 push.apply 调用
const pushStart = code.indexOf("_$cR.push(") + "_$cR.push(".length;

// 按顶层逗号分割参数
let depth = 0, args = [], current = '';
for (let i = pushStart; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
    }
    else if (c === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
    }
    current += c;
}

const RT_BASE = 56; // rt[0..55] 在 push 之前已填充
// args[0] → rt[56], args[1] → rt[57], ...
// args[N] 是函数名或内联函数
```

每个 `rt[N]` 对应一个具体功能, 例如:

| rt 索引 | 函数名 | 功能 |
|---------|--------|------|
| rt[5] | String.split | 字符串分割 |
| rt[64] | 字符串表 g68 | 属性名映射 |
| rt[67] | 常量表 | 数值常量数组 |
| rt[75] | Cookie 读取器 | 读取 document.cookie |
| rt[113] | sliceRead | 变长字节读取 |
| rt[129] | hashFunc | SHA-1 散列 |
| rt[146] | huffmanDecode | Huffman 解码 |
| rt[157] | xorInPlace | 字节 XOR |
| rt[239] | _$bs | 后缀生成器 (15KB) |

---

## SHA-1 的发现 (非 XTEA/AES)

### 背景

最初假设后缀签名使用 XTEA (因为 eval 代码中存在 XTEA 常量 `0x9E3779B9 = 2654435769`) 或 AES (因为 Cookie 加密使用 AES)。

### AST 定位过程

```javascript
// 搜索 XTEA delta 常量
var xteaPos = code.indexOf("2654435769");
// 找到! 但追踪调用链发现: XTEA 仅用于 Cookie S 解密, 不用于后缀签名

// 搜索 SHA-1 初始化常量
var sha1Constants = ["1732584193", "4023233417", "2562383102", "271733878", "3285377520"];
sha1Constants.forEach(c => {
    var pos = code.indexOf(c);
    // 全部找到! 在 rt[129] 函数中
});
```

### 结论

- **Cookie S 解密**: XTEA (Tea-CBC 模式)
- **Cookie T 加密**: AES-128-CBC
- **后缀签名**: SHA-1 (不是 XTEA, 不是 AES)
- **CRC32**: 用于数据校验和 basearr 字段 (UA, pathname)

这个发现纠正了此前对加密算法的错误假设。

---

## createElement('a') URL 解析追踪

### 问题

后缀生成需要从当前 URL 提取 pathname/search 等组件。VM 不直接使用 `new URL()` 或 `location` 对象, 而是用一种巧妙的方式。

### AST 发现

在 rt[239] (`_$bs`, 后缀生成函数, 15KB) 中找到:

```javascript
// VM 创建 <a> 元素, 设置 href, 然后读取 pathname/search
var a = document.createElement('a');
a.href = targetUrl;
var pathname = a.pathname;   // 自动解析
var search = a.search;       // 自动解析
var hostname = a.hostname;   // 自动解析
```

这是 DOM 标准的 URL 解析技巧: `<a>` 元素的 href 属性被浏览器自动解析为完整 URL 组件。

### 意义

在 sdenv/jsdom 环境中, `document.createElement('a')` 必须正确支持 URL 解析, 否则后缀生成会失败。这解释了为什么某些简化的 DOM mock 无法正确运行后缀逻辑。

---

## 14 个 AST 工具脚本

| 序号 | 脚本 | 功能 | 输入 | 输出 | 耗时 |
|------|------|------|------|------|------|
| 1 | ast_extract_opcodes.js | 从 _$_I 提取 114 个 opcode | eval_code.js | opcodes.json (409 条目) | 2h |
| 2 | ast_verify_all.js | 验证 440 个 rt[] 映射 | eval_code.js | rt_map.json | 1h |
| 3 | ast_deep_bs.js | 深入分析 rt[239] 后缀生成器 | eval_code.js + rt239_source.js | 调用链 + 关键函数 | 3h |
| 4 | ast_trace_rt239.js | 追踪 rt[239] 的完整子函数 | eval_code.js | 函数源码集 | 2h |
| 5 | ast_trace_session49.js | 追踪 Cookie S → 49B session | eval_code.js | 解密调用链 | 2h |
| 6 | ast_find_xtea_huffman.js | 定位 XTEA/Huffman/SHA-1 | eval_code.js | 算法函数定位 | 1h |
| 7 | ast_trace_49b.js | 追踪 49B session 数据流 | eval_code.js | 数据流图 | 2h |
| 8 | ast_session_chain.js | Cookie S 完整解密链路 | eval_code.js | 递归调用链 | 2h |
| 9 | ast_cookie_s_decrypt.js | Cookie S 解密路径 | eval_code.js | AES/XTEA 定位 | 1.5h |
| 10 | ast_cookie_s_complete.js | Cookie S 完整处理 | eval_code.js | 端到端流程 | 2h |
| 11 | ast_r2mka_disasm.js | r2mKa 字节码反汇编 | r2mka_parsed.json | 6328 行汇编 | 3h |
| 12 | ast_bytecode_to_js.js | 字节码 → 伪 JS (栈模拟) | r2mka_parsed.json | 1653 行伪 JS | 4h |
| 13 | ast_translate_child40.js | 翻译 Cookie S TLV 解析器 | r2mka_parsed.json | 可读 JS 函数 | 2h |
| 14 | ast_suffix_structure.js | 后缀 88B/120B 结构分析 | rt239_source.js | URL 编码流程 | 3h |

总计约 30 小时。对比运行时追踪方法需要的时间 (22 个 step 共约 2 周), AST 方法在系统性分析阶段效率显著更高。

---

## AST 适用性边界

### 适合 AST 的场景

- 提取 VM 解释器的全部 opcode 实现
- 建立 rt[] 函数映射表
- 定位特定算法 (通过常量搜索)
- 批量反汇编字节码
- 追踪函数调用链 (静态分析)
- 理解代码结构和控制流

### 不适合 AST 的场景

- basearr 具体值的确定 → 用数据驱动对比
- 运行时动态生成的数据 → 用 Hook 采集
- 需要实际运行验证的逻辑 → 用 sdenv 运行
- 高度动态的分支选择 → 运行时追踪更直接

### 最佳实践

```
1. 先用运行时追踪 (VM Hook) 建立整体理解: 入口、出口、数据管线
2. 再用 AST 系统性提取: opcode 表、函数映射、算法定位
3. 最后用数据驱动填补 AST 无法覆盖的动态部分: basearr 字段值
```

三者互补, 缺一不可。AST 是效率最高的环节, 但不能替代数据驱动的验证。
