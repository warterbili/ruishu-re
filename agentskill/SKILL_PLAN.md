# 瑞数 (Ruishu) 反爬完整逆向 Skill

> 目标: 任何 Claude 实例读完本文档, 都能独立完成瑞数保护站点的 Cookie T 纯算生成 + URL 后缀处理。
> 验证: 已在 1 个站点验证 HTTP 200, rs-reverse 在 9+ 站点验证通过。

---

## 瑞数防护原理

### 瑞数是什么
瑞数信息 (Rivers Security) 是国内主流的 Web 反爬/反 Bot 防护系统, 通过在服务端注入动态 JS, 在客户端生成加密 Cookie 和 URL 后缀来验证请求是否来自真实浏览器。

### 整体流程
```
浏览器首次访问目标 URL
    ↓
服务器返回 HTTP 412 + HTML 页面
    ├── Set-Cookie: xxxS=... (Cookie S, HttpOnly, 服务端标识)
    ├── <meta id="xxx" content="加密内容">
    ├── <script> $_ts.nsd=81494; $_ts.cd="qx2x..." </script>
    │     ├── nsd: 伪随机数种子 (每次请求不同)
    │     └── cd: ~1700 字符加密数据 (含 45 组密钥 + VM 字节码)
    └── <script src="mainjs.js"> (205KB 混淆 JS)
    ↓
mainjs 在浏览器中执行:
    1. 解码 $_ts.cd → 提取 45 组 keys + VM 字节码
    2. 用 nsd 作为种子生成 918 个随机变量名
    3. 动态生成 296KB eval 代码 (每次变量名不同, 但逻辑相同)
    4. eval() 执行 → 启动三层嵌套 VM
    ↓
VM 在浏览器中执行:
    1. 收集浏览器环境指纹 (UA, screen, canvas, WebGL, platform...)
    2. 组装 basearr (154-166 字节 TLV 结构)
    3. basearr → Huffman编码 → XOR → AES-CBC → CRC32 → AES-CBC → Base64
    4. 设置 Cookie T = "0" + Base64 结果 (300 字符)
    5. 劫持 XMLHttpRequest.prototype.open (给 POST 请求加 URL 后缀)
    6. location.replace → 刷新页面
    ↓
浏览器第二次访问 (带 Cookie S + Cookie T) → 200 正常页面
后续 AJAX 请求 (XHR 被劫持, 自动加 URL 后缀) → 正常数据
```

### 三层 VM 架构
```
Layer 1: mainjs 的字节码解释器
  ├── 字节码: $_ts.cd 解密后的数据
  ├── 指令集: ~100 个操作码, 读 _$$J[1]
  └── 功能: 解析配置, 生成 eval 代码, 调用 eval()

Layer 2: eval 代码的外层 VM
  ├── 字节码: aebi[1] (1014 项状态号)
  ├── 指令集: 741 个状态码 (二叉搜索树 switch-case)
  └── 功能: Cookie T 生成, XHR 劫持, DOM 遍历, 事件监听

Layer 3: 内层 VM (黑盒, 不要碰)
  ├── 字节码: 407 个函数, 共 43925B
  ├── 指令集: 114 个操作码 (栈操作/算术/控制流/函数调用)
  └── 功能: AES 加密, CRC32, Huffman 编码, Base64, 环境指纹收集
```

### 我们需要纯算替代的部分
```
浏览器做的事:                          我们的纯算替代:
  mainjs → eval 代码                    Coder 重写 (阶段 3)
  VM 收集指纹 → basearr                 数据驱动适配 (阶段 4)
  basearr → 加密 → Cookie T             generateCookie (阶段 1)
  cd → 提取 keys                        extractKeys (阶段 2)
  XHR 劫持 → URL 后缀                   sdenv VM 内 XHR (阶段 6)
```

### Cookie 结构
```
Cookie S (HttpOnly, 服务端生成):
  AV7KYchI7HHaS=60Yrfi...     ← Set-Cookie 直接返回

Cookie T (JS 生成, 纯算目标):
  AV7KYchI7HHaT=08fuQ5GV...   ← "0" + Base64(AES(CRC32(AES(XOR(Huffman(basearr))))))
  
Cookie 名前缀从 keys[7] 动态提取: keys[7].split(';')[5] + 'T'
```

### URL 后缀结构 (POST 请求需要)
```
原始: /api/action.do
实际: /api/action.do?8h6a7FPl=0R5Hmral...
                      ^^^^^^^^ ^^^^^^^^^^
                      参数名    "0" + URL-safe Base64(加密数据)

参数名从 keys[7].split(';')[1] 提取
GET 请求不需要后缀, 只需 Cookie S + Cookie T
```

### $_ts 配置结构
```javascript
$_ts = {
    nsd: 84277,              // 伪随机数种子 (每次请求不同)
    cd:  "qJzx...",          // ~1700 字符加密数据 (keys + VM 字节码)
    cp: [
        "yruigzout...",      // cp[0]: Caesar+6 编码的 1498 个字符串 (DOM API 名)
        ["_$k8","_$cH",...], // cp[1]: 918 个变量名 (nsd 种子洗牌)
        "qX[`...",           // cp[2]: 243 项数值常量
        208883,              // cp[3]: mainjs 校验和
        7, 7, ""             // cp[4-6]: 版本配置
    ],
    aebi: [                  // 字节码数组 (6 层)
        [492项],             // aebi[0]: 初始化 VM
        [1014项],            // aebi[1]: 主逻辑 VM (741 状态)
        [739项],             // aebi[2-5]: 排列映射表
        [181项], [40项], [7项]
    ]
}
```

---

## !!!!! 最重要的方法论: 数据驱动逆向 + AST 分析 !!!!!

> **Cookie T / basearr 逆向: 数据驱动。**
> 多采几组真实数据, 对比找规律。不要去读内层 VM 代码 (740 个 state, 三层嵌套 — 这是陷阱)。
>
> **URL 后缀 / eval code 逆向: AST 分析。**
> eval code 是真正的 JS 函数, AST 能精确定位、追踪调用链、提取源码。
> 这是突破 JSVMP 保护的关键武器 — 几小时完成手工需要数周的工作。

### 方法论一: 数据驱动 (Cookie T / basearr)

**数据驱动 = 用 sdenv 采集 3-5 组真实数据 → 逐字节对比 → 找到每个字节的来源**

这个方法论贯穿 Cookie T 相关的所有阶段:
- 阶段 1: 用 sdenv 的真实 Cookie T 验证加密链 (混合验证)
- 阶段 4: 用多 session 数据反推 basearr 每个字段的来源
- 阶段 4 type=2: rs-reverse 的公式不通用 → 数据驱动 5 session 采集 → 10 分钟解决
- 调试: 任何字节不匹配 → 先看真实数据是什么, 再找来源

**真实经验**: 我们花了 2 天试图读内层 VM 代码理解 basearr — 完全浪费。
转向数据驱动后, 1 天内解决了所有问题。rs-reverse 也是同样的方法论。

### 方法论二: AST 分析 (URL 后缀 / eval code 函数)

**AST = 用 acorn 解析 eval code → 建立 rt[N] 函数映射 → 递归追踪调用链 → 提取核心算法**

当目标函数在 eval code 的 JS 层面 (而非 r2mKa VM 字节码) 时, AST 是最强大的分析工具。

#### 为什么 AST 对 JSVMP 逆向至关重要

瑞数的防护结构是: mainjs → eval() → 296KB 混淆 JS 代码。这段 eval code 虽然变量名被混淆, 但**它是合法的 JS 代码**, 能被 AST 解析器完整解析。

关键洞察: **eval code 内有 440+ 个函数, 通过 `Array.prototype.push.apply` 注册到 rt[] 数组。** 手工在 296KB 代码中找函数关系 = 大海捞针。但 AST 能在几秒内完成:

```javascript
// 1. 解析 eval code
const ast = acorn.parse(evalCode, { ecmaVersion: 2020 });

// 2. 收集所有函数定义
const functions = {};
walk.simple(ast, {
    FunctionDeclaration(node) {
        if (node.id) functions[node.id.name] = node;
    }
});

// 3. 找到大 push 调用, 建立 rt[N] → 函数名映射
// push base = 55~56, 440 个参数
walk.simple(ast, {
    CallExpression(node) {
        // 匹配 Array.prototype.push.apply(rt, [func1, func2, ...])
        if (node.arguments[1]?.elements?.length > 100) {
            bigPushArgs = node.arguments[1].elements;
        }
    }
});

// 4. 递归追踪调用链
function traceCallChain(funcName, depth, visited) {
    if (visited.has(funcName) || depth > 5) return;
    visited.add(funcName);
    walk.simple(functions[funcName].node, {
        CallExpression(n) {
            if (n.callee.type === 'Identifier' && functions[n.callee.name])
                traceCallChain(n.callee.name, depth+1, visited);
        }
    });
}

// 5. 按特征搜索 (XOR, charCodeAt, SHA-1 常量, createElement 等)
// 6. 提取关键函数源码
```

#### AST 在后缀逆向中的实战成果

| AST 工具 (houzhui/ast/) | 成果 | ��时 |
|---|---|---|
| ast_trace_rt239.js | 定位 rt[239]=_$bs (15KB 后缀核心), 完整调用链 | ~1h |
| ast_deep_bs.js | 拆解 _$bs 56 个子函数, 分类: URL/XHR/XOR/BYTE/TIMER/VM | ~2h |
| ast_suffix_structure.js | 追踪 createElement('a') URL 解析, 确认 XOR 编码 URL 数据 | ~1h |
| ast_verify_all.js | 映射全部 440 个 rt[N] 函数 (名称/参数/vmCall ID) | ~1h |
| ast_find_xtea_huffman.js | 定位 XTEA (0x9E3779B9) + Huffman 函数 | ~30m |
| ast_session_chain.js | 提取 AES 解密链 (6 函数) + Cookie S 管理器 | ~2h |
| ast_cookie_s_decrypt.js | 完整 Cookie S → 49B 解密路径 | ~1h |
| ast_extract_opcodes.js | 从 _$_I (34KB) 和 _$gF (8KB) 提取 409 个 VM opcodes | ~2h |
| ast_r2mka_disasm.js | 自动反汇编 child[59] 全部 52 个子函数 (6328 行) | ~2h |
| ast_bytecode_to_js.js | 栈操作翻译引擎, 50+ opcode handler, 输出可读 JS | ~3h |
| ast_cookie_s_complete.js | Cookie S 7 个核心函数翻译: readCookie/uint32ToBytes/xorInPlace 等 | ~1h |
| ast_translate_child40.js | child[40] TLV 解析器翻译 (14 数据段, hash/huffman/slice/vmCall) | ~2h |
| ast_trace_session49.js | Cookie S → 49B 数据流追踪 (Huffman+XTEA 路径) | ~1h |
| ast_trace_49b.js | 纯 AST (无 grep) 完整 49B 路径, 7 个关键函数 | ~1h |

**总计**: 14 个 AST 工具, ~20h 工作量, 完成了手工分析可能需要数周的逆向量。

#### AST vs 其他方法对比 (后缀/eval code 场景)

| 方法 | ��果 | 说明 |
|------|------|------|
| **AST 分析** | ★★★★★ | 几小时定位核心函数, 精确追踪调用链, 自动分类 |
| Hook rt 函数 | ★★★ | 能看到外部调用和参数, 但 VM 内部是黑盒 |
| 字节码手动翻译 | ★★ | 耗时, 常量表对不上, 容易出错 |
| 本地跑 eval code | ★ | 环境差异导致崩溃 (document.all 等) |
| RPC/补环境 | ★★★ | 能用但不是纯算, 依赖浏览器实例 |

#### 关键发现: SHA-1 签名 (不是 XTEA/AES)

通过 AST 搜索 rt[67] 常量表, 发现后缀签名使用 **SHA-1**, 不是 XTEA 或 AES:
```
rt[67] 中的 SHA-1 常量:
  H0-H4: 1732584193, 271733878, ... (初始哈希值)
  K0-K3: 1518500249, 1859775393, 3337565984, 3395469782 (轮常数)

关键函数 (AST 定位):
  _$kw() (L1222): SHA-1 core (constructor/update/finalize/transform)
  _$fJ() (L2968): SHA-1 instance (重置 H 值)
  _$gA(...args) (L2972): SHA-1 hash 截断为 16B
  _$id(data) (L2979): 完整 20B SHA-1

后缀算法 = 结构化头部 + SHA-1(session_secret + request_data)
```

这个发现推翻了之前 XTEA-CBC / AES-CBC 解密的假设 — 那些加密只用于 Cookie S/T, 不用于后缀。

#### createElement('a') URL 解析 (AST 追踪)

后缀生成的关键步骤: 用 `createElement('a')` 解析 URL, 提取 pathname/search:
```
rt[239] (_$bs, 15KB) 中:
  1. document.createElement('a') 创建锚点元素
  2. a.href = 请求 URL
  3. 读取 a.pathname, a.search, a.hostname, a.protocol
  4. pathname + search 数据通过 XOR 编码进后缀

字符串表索引 (AST 提取):
  _$dn[13] = "pathname"   在 _$bs 中多次出现
  _$dn[85] = "search"     在 _$bs 中多次出现
  _$dn[32] = "hostname"
  _$jO[86] = "protocol"
  _$jO[59] = "href"
```

**服务器验证**: 解码后缀中的 XOR 数据, 与请求的实际 URL 对比, 不匹配则 400。

#### AST 的适用边界

```
AST 能做的 (eval code JS 层面):          AST 做不到的 (r2mKa VM 字节码层面):
  440 个 rt[] 函数的映射                   49B session 的计算 (VM 字节码内部)
  函数调用链递归追踪                       child[37] + G[89] + G[108] 变换
  特征搜索 (SHA-1/XOR/Base64)             Cookie S → 49B 的完整解密 (VM 初始化)
  56 个子函数自动分类                      VM 字节码精确语义 (需反汇编器)
  32B 签名 = 行为统计 (破解)
  AES/Huffman/XTEA/SHA-1 函数定位
  createElement('a') URL 解析追踪
  Cookie S 管理器完整提取 (52 子函数)
```

**结论**: AST 分析 eval code 中的 JS 函数, 反汇编器处理 r2mKa VM 字节码, 数据驱动处理 basearr。**三者互补, 不矛盾** — 针对不同层面选择最有效的方法。

#### 从看不懂的字节码到可读伪��码: 完整反编译链路

r2mKa VM 的字节码是一串纯数字 (如 `[30, 5, 20, 233, 24, 32, 1, ...]`), 直接看完全无法理解。
我们通过 **4 步流水线** 把它变成可读的伪 JS 代码:

```
原始字节码 (二进制数组)
    ↓ Step 1: AST 提取 opcode 表
opcode 语义映射 (409 条)
    ↓ Step 2: 反汇编 (bytecode → 汇编��令)
汇编代码 (6328 行)
    ↓ Step 3: 栈模拟翻译 (汇编 → 伪 JS)
可读伪代码 (1653 行)
    ↓ Step 4: 人工标注语义
带注释的可执行代���
```

##### Step 1: AST 提取 opcode 实现 (ast_extract_opcodes.js)

r2mKa VM 解释器 `_$_I` (34KB) 和 `_$gF` (8KB) 在 eval code 中。
它们的结构是一个 `while(1)` 循环里的巨大 `if-else` 链, 每个分支 = 一个 opcode:

```javascript
// _$_I 内部结构 (简化):
function _$_I(bytecode, ...) {
    while (1) {
        var op = bytecode[pc++];
        if (op === 0)  { /* arg(N): 读取第N个参数 */ }
        if (op === 7)  { /* -: 栈顶两个值相减 */ }
        if (op === 13) { /* RET: 返回栈顶值 */ }
        if (op === 20) { /* EXT(N): 调用 rt[N] 外部函数 */ }
        if (op === 35) { /* +: 栈顶两个值相加 */ }
        // ... 共 409 个分支
    }
}
```

**用 AST 自动提取**: 遍历 `_$_I` 的 AST, 找所有 `if(op === N)` 分支, 提取每个分支的实现代码:

```javascript
// ast_extract_opcodes.js 核心逻辑:
walk.simple(iiNode, {
    IfStatement(node) {
        // 找 _$$b===N 形式的条件
        if (node.test.operator === '===' &&
            typeof node.test.right.value === 'number') {
            const opNum = node.test.right.value;
            const body = code.substring(node.consequent.start, node.consequent.end);
            opcodes[opNum] = body;  // opcode 号 → JS 实现
        }
    }
});
// → 输出 opcodes.json (409 条 opcode 语义)
```

**两个 VM 解释器互补**: `_$_I` 包含大部分 opcode, `_$gF` 补充缺失的 38 个。

提取结果 (关键 opcodes 示例):
```
op0:  arg(N)         读取函数第N个参数, push 到栈
op5:  SPROP(N)       设置对象属性: obj[g72[N]] = value
op6:  .s(N)          读取对象属性: push obj[g72[N]]
op7:  -              pop a,b → push (a-b)
op8:  CALL(N)        调用第N个子函数
op11: G(N)           读取全局变量 G[N]
op13: RET            return pop()
op20: EXT(N)         调用外部函数 rt[N] (eval code 中的 JS 函数)
op28: JF+(N)         条件跳转: if (!pop()) pc += N
op30: N(x)           push 字面量 x
op32: eW=L(N)        写入局部变量: L[N] = pop()
op35: +              pop a,b → push (a+b)
op38: ===            pop a,b → push (a===b)
op41: C1p            call(1 arg): fn = pop(), arg1 = pop() → push fn(arg1)
op56: []p            数组/对象索引: key = pop(), obj = pop() → push obj[key]
op59: DEFCHILD(N)    定义子函数 N
op60: L(N)           读取局部变量: push L[N]
op61: APUSH          数组 push: val = pop(), arr = pop() → arr.push(val)
op91: C2p            call(2 args): push fn(arg1, arg2)
op102: APPLY(N)      call with apply
```

##### Step 2: 反汇编 — 字节码 → 汇编指令 (ast_r2mka_disasm.js)

有了 opcode 表, 就可以把二进制字节码逐条翻译成可读的汇编指令:

```javascript
// 反汇编器核心:
function disasm(bytecode) {
    let pc = 0;
    while (pc < bytecode.length) {
        const op = bytecode[pc];
        switch (op) {
            case 0:  emit('arg(' + bytecode[++pc] + ')'); break;
            case 5:  emit('SPROP(' + bytecode[++pc] + ') // .' + g72[bytecode[pc]]); break;
            case 6:  emit('.s(' + bytecode[++pc] + ') // .' + g72[bytecode[pc]]); break;
            case 20: emit('EXT(' + bytecode[++pc] + ') // rt[N]=' + rtName(N)); break;
            // ... 所有 opcode
        }
        pc++;
    }
}
```

**输入**: child[59] 的字节码 (Cookie S 管理器, 52 个子函数, 共 ~8000B)

**输出**: 6328 行汇编代码, 示例:
```
原始字节码: [30, 5, 20, 233, 24, 32, 1, 60, 1, 6, 16, ...]
                ↓ 反汇编
   0 N(5)                    // push 5
   2 EXT(233) // rt[233]=_$fB  // push rt[233] (Cookie 读取函数)
   4 C0p                     // call: _$fB()
   5 eW=L(1)                 // L1 = result (Cookie 值)
   7 L(1)                    // push L1
   8 .s(16) // .cookie       // push L1.cookie (通过字符串表 g72[16]="cookie")
```

**关键技巧**: 字符串表 g72 (96 个) 让属性访问变得可读:
```
g72[16] = "cookie"        → .s(16) 显示为 .cookie
g72[13] = "pathname"      → .s(13) 显示为 .pathname
g72[30] = "a"             → 用于 createElement('a')
g72[85] = "search"        → .s(85) 显示为 .search
```

**外部函数名映射**: 通过 push args 建立 rt[N] → 函数名:
```
rt[233] = _$fB  (Cookie 读取器)   → EXT(233) 显示为 _$fB
rt[129] = _$j2  (hash 函数)       → EXT(129) 显示为 _$j2
rt[146] = _$$p  (Huffman 解码)    → EXT(146) 显示为 _$$p
rt[157] = _$i1  (XOR in-place)   → EXT(157) 显示为 _$i1
```

##### Step 3: 栈模拟翻译 — 汇编 → 伪 JS (ast_bytecode_to_js.js)

r2mKa VM 是**栈式虚拟机**: 所有操作通过 push/pop 栈完成。
翻译器维护一个模拟栈, 逐条处理汇编指令, 将栈操作还原为表达式:

```javascript
// 栈模拟翻译器核心:
function translateBytecode(bytecode) {
    const stack = [];      // 模拟 VM 栈
    const lines = [];      // 输出的 JS 代码行

    while (pc < bytecode.length) {
        const op = bytecode[pc];
        switch(op) {
            case 30: // N(x) — push 字面量
                stack.push('' + bytecode[++pc]);
                break;

            case 20: // EXT(N) — push 外部函数引用
                stack.push('rt[' + N + '/*' + rtName(N) + '*/]');
                break;

            case 24: // C0p — 无参调用
                var fn = stack.pop();
                stack.push(fn + '()');
                break;

            case 41: // C1p — 单参调用
                var arg1 = stack.pop(), fn = stack.pop();
                stack.push(fn + '(' + arg1 + ')');
                break;

            case 32: // eW=L(N) — 写局部变量
                lines.push('L' + N + ' = ' + stack.pop() + ';');
                break;

            case 6: // .s(N) — 属性读取
                var obj = stack.pop();
                stack.push(obj + '["' + g72[N] + '"]');
                break;

            case 13: // RET
                lines.push('return ' + stack.pop() + ';');
                break;
        }
    }
}
```

**翻译效果** — 从汇编到伪 JS:
```
汇编 (Step 2 输出):              伪 JS (Step 3 输出):
   0 N(5)                         L1 = rt[233/*_$fB*/]();
   2 EXT(233)                     L2 = L1["cookie"];
   4 C0p                          if (L2 === 0) { return; }
   5 eW=L(1)                      L3 = rt[146/*_$$p*/](L2);
   7 L(1)                         result["session"] = rt[157/*_$i1*/](L3, key);
   8 .s(16) // .cookie            return result;
  10 eW=L(2)
  12 L(2)
  13 N(0)
  15 ===
  16 JT+(8)
  18 L(2)
  19 EXT(146)
  21 C1p
  22 eW=L(3)
  ...
```

**翻译覆盖**: 50+ 个 opcode handler, 覆盖所有常见操作:
- 算术/逻辑: `+`, `-`, `===`, `!=`, `>`, `<`, `&&`, `||`, `!`
- 函数调用: `C0p` (0参), `C1p` (1参), `C2p` (2参), `C2v` (void), `APPLY`
- 变量: `G[N]` (全局), `L[N]` (局部), `closure[N]` (闭包), `arg[N]` (参数)
- 属性: `.s(N)` (字符串表读取), `SPROP(N)` (设置), `[]p` (索引)
- 控制流: `JT+` (真跳), `JF+` (假跳), `J+` (无条件跳), `RET`
- 对象: `{}` (创建), `[]` (创建数组), `APUSH` (push), `DEFCHILD` (子函数)

##### Step 4: 人工语义标注 (ast_translate_child40.js)

自动翻译的伪代码虽然可读, 但变量名是 L0/L1/G[5] 这种。
通过对照 rt[N] 的已知功能, 人工标注语义:

```javascript
// 自动翻译:
L1 = rt[233/*_$fB*/]();
L2 = rt[113/*_$c8*/](L1, L0);
rt[157/*_$i1*/](L2, L3, 16);
result[rt[379/*key_ss*/]] = L2;

// 人工标注后:
cookieValue = readCookie(cookieName);           // rt[233] = Cookie 读取
rawData = sliceRead(cookieValue, offset);        // rt[113] = 变长切片
xorInPlace(rawData, xorKey, 16);                 // rt[157] = XOR 解密
result["session_secret"] = rawData;              // rt[379] = 键名
```

**child[40] TLV 解析器的标注**: 用 AST 分析每个 section 引用了哪些 rt 函数, 自动判断读取类型:
```javascript
// ast_translate_child40.js 自动分类:
const hasHash    = rtRefs.includes(129);  // hash 读取
const hasHuffman = rtRefs.includes(146);  // Huffman 解码读取
const hasSlice   = rtRefs.includes(113);  // 原始切片读取
const hasXOR     = rtRefs.includes(157);  // XOR 解密

// → 输出: 14 个数据段, 每段标注读取方式
//   field 0: key_ss    (read: hash)
//   field 1: key_cP    (read: huffman)
//   field 2: key_k1    (read: slice)
//   field 3: key_gf    (read: vmCall)
//   ...
```

##### 完整实例: child[59].child[40] (1031B → 可读 TLV 解析器)

```
输入: [30,5,20,233,24,32,1,60,1,11,2,6,85,41,32,2,30,14,
       60,2,20,113,91,32,3,60,3,20,157,60,4,30,16,54,60,
       3,20,129,91,32,5,...] (1031 bytes)

Step 2 反汇编 → ~400 行汇编
Step 3 栈翻译 → ~200 行伪 JS
Step 4 语义标注 → 完整 Cookie S TLV 解析器:

function parseCookieS(data, xorKey) {
    var result = {};
    var reader = createReader(data);

    // field 0: session_secret (read: hash)
    result["session"] = read_hash(reader);

    // field 1: huffman_data (read: huffman)
    result["huff"] = read_huffman(reader);

    // field 2: raw_slice (read: slice)
    result["raw"] = read_slice(reader);

    // ... 共 14 个 field
    return result;
}
```

##### 工具链总结

| 步骤 | 工具 | 输入 | 输出 | 作用 |
|------|------|------|------|------|
| 1. 提取 opcode | ast_extract_opcodes.js | eval_code.js (296KB) | opcodes.json (409 条) | 从 VM 解释器 AST 提取每个 opcode 的 JS 实现 |
| 2. 反汇编 | ast_r2mka_disasm.js | r2mka_parsed.json + opcodes | child59_disasm.txt (6328 行) | 字节码数组 → 可读汇编指令 |
| 3. 栈翻译 | ast_bytecode_to_js.js | r2mka_parsed.json + g72 + rt映射 | child59_translated.js (1653 行) | 汇编指令 → 伪 JS (栈模拟) |
| 4. 语义标注 | ast_translate_child40.js | 反汇编 + rt功能表 | cookie_s_parser.js | 伪 JS → 带语义注释的可执行代码 |

**关键依赖**: 步骤 1 是整条链路的基石 — 没有 AST 从 eval code 提取 opcode 实现, 后面的反汇编/翻译都无法进行。这就是为什么 AST 对 JSVMP 逆向至关重要。

#### 两种反编译方法的对比: 运行时追踪 vs AST 静态分析

我们在项目中实际走过两条反编译路线, 结果证明 AST 是最优解。

##### 方法 A: 运行时栈追踪 (learn_js/reverse/ — 弯路)

**思路**: 让代码真正跑起来, 在 VM 解释器内部注入 Hook, 记录每一步执行的 pc/opcode/栈状态, 从日志中反推 opcode 语义。

```
流程:
  sdenv 启动 → VM 真实执行
      ↓ Hook _$_I 的 while(1) 循环
  每步记录: {pc: 86, op: 52, stack: [desc, 22, 48]}
      ↓ 导出到 fn161_full_stack.json
  人工逐条对照栈变化 → 推导 opcode 含义
      ↓ 手写 disasm_fn161.js
  输出伪代码
```

**具体做法**:
1. 用 sdenv 真实运行 eval code, 拦截 `_$_I` (34KB VM 解释器)
2. 每次循环记录 `{pc, op, 栈顶值, 栈深度}` → 得到完整执行日志
3. 从执行日志反推每个 opcode 做了什么:
   - op=30 后栈多了一个值 → 是 PUSH
   - op=57 后栈少了两个值、多了一个 → 是 obj[key] 属性访问
   - op=45 后 pc 跳到远处 → 是条件跳转
4. 手工编写反汇编器, 逐条翻译字节码

**问题**:
```
❌ 依赖 sdenv 环境能跑起来 (document.all 等环境问题)
❌ 只能看到一次执行的路径 (if-else 的另一个分支看不到)
❌ opcode 语义靠猜 — 栈行为可能有多种解释
❌ 常量表对不上 (aebi[2] 排列映射, 每次 nsd 不同变量名不同)
❌ 极其耗时 — fn=161 仅 161 字节码花了 2 天, 还没完全搞清
❌ 不可复用 — 换个函数/换个站点要重新跑、重新推
❌ 最终被证明对 basearr 逆向毫无帮助 (数据驱动 10 分钟解决)
```

**产出**: fn=161 (161B) 的伪代码, 花了 2 天

##### 方法 B: AST 静态分析 (rs_reverse/houzhui/ast/ — 最优解)

**思路**: eval code 是合法 JS, VM 解释器 `_$_I` 的源码就在里面。不需要跑, 直接用 AST 解析器读源码, 从 if-else 分支中提取每个 opcode 的完整实现。

```
流程:
  eval_code.js (296KB 静态文件)
      ↓ acorn.parse() → AST
  遍历 _$_I 函数的 AST 节点
      ↓ 找所有 if(op === N){...} 分支
  直接读取每个分支的 JS 实现代码
      ↓ 输出 opcodes.json (409 条)
  用 opcode 表自动反汇编任意字节码
      ↓ 栈模拟翻译器自动生成伪 JS
  输出可读伪代码
```

**具体做法**:
1. `acorn.parse(eval_code)` 解析 296KB JS → 完整 AST
2. `walk.simple(ast, { IfStatement })` 遍历 _$_I 内所有 if 分支
3. 每个 `if(op === N)` 分支的 body 就是 opcode N 的完整实现 — **不需要猜**
4. 导出 opcodes.json → 反汇编器 + 栈模拟翻译器全自动运行

**优势**:
```
✅ 不需要运行环境 (纯静态分析, 只要有 eval_code.js 文件)
✅ 看到所有代码路径 (if-else 两个分支都能读)
✅ opcode 语义精确 — 直接读 JS 源码, 不需要猜
✅ 一次提取所有 409 个 opcode (不是一个一个推)
✅ 完全自动化 — 换函数/换站点只需重跑脚本
✅ 速度极快 — 全部 14 个 AST 工具 ~20h, 产出 6328 行反汇编 + 1653 行伪代码
✅ 可以追踪到函数名 (通过 push args 建立 rt[N] 映射)
✅ 可以解析字符串表 (g72/g68, 让属性访问变成 .cookie/.pathname)
```

**产出**: child[59] 全部 52 个子函数 (总计 ~8000B 字节码) 的完整反汇编 + 伪代码, 约 20h

##### 核心差异一览

| 维度 | 运行时追踪 (弯路) | AST 静态分析 (最优解) |
|------|-------------------|----------------------|
| **前提条件** | 需要 sdenv 环境能跑起来 | 只需 eval_code.js 静态文件 |
| **opcode 来源** | 从执行栈行为反推 (猜) | 从 VM 解释器源码直接读 (精确) |
| **覆盖范围** | 只看到一次执行路径 | 看到所有 409 个 opcode 的所有分支 |
| **字节码来源** | 运行时 Hook 导出 | r2mka_parsed.json 静态解析 |
| **翻译方式** | 手工逐条推导 | 自动栈模拟翻译器 |
| **可复用性** | 换函数/站点要重来 | 换函数只需改输入, 工具链不变 |
| **速度** | 2 天 → 161B 一个函数 | 20h → 52 个函数共 ~8000B |
| **效率比** | ~80B/天 | ~400B/小时 (约 **80 倍**) |
| **准确性** | opcode 可能猜错 | 100% 精确 (读的是原始 JS 实现) |
| **最终结果** | 对 basearr 无帮助, 弯路 | 后缀逆向大幅推进 |

##### 为什么 AST 是最优解

**根本原因**: 瑞数的 VM 解释器 `_$_I` 本身就是 JS 代码, 写在 eval code 里。
```
eval code 中的 _$_I 函数 (34KB):
  while(1) {
      var op = bytecode[pc++];
      if (op === 0) { /* 完整的 JS 实现 */ }    ← AST 直接读这里
      if (op === 7) { /* 完整的 JS 实现 */ }    ← AST 直接读这里
      if (op === 13) { /* 完整的 JS 实现 */ }   ← AST 直接读这里
      // ... 409 个分支, 每个都是 JS
  }
```

你已经有了答案 (opcode 的 JS 实现), 为什么还要跑 VM 去猜答案是什么?

运行时追踪相当于: 给一个黑盒喂输入, 观察输出, 推测内部逻辑。
AST 分析相当于: 直接打开黑盒读电路图。

**当你能打开黑盒时, 永远不要从外面猜。**

##### 唯一需要运行时追踪的场景

AST 不是万能的 — 当目标不在 eval code JS 层面, 而是在更深的字节码层面时:
```
场景                    最佳方法
eval code 的 JS 函数     → AST (最优)
r2mKa VM 字节码         → AST 提取 opcode + 自动反汇编 (最优)
basearr 数据结构        → 数据驱动 (最优, AST 不适用)
运行时动态值 (时间戳等)  → 运行时追踪 / sdenv 采集 (唯一方法)
```

即使对 r2mKa 字节码, AST 也是链路的起点 (提取 opcode 表), 运行时追踪只是辅助验证。

---

## 核心原则

1. **数据驱动** — **(Cookie T/basearr 最重要!)** 先用 sdenv 拿到正确答案, 再逐字节找来源。遇到不懂的字节, 多采几组数据对比, 而不是读 VM 代码
2. **AST 分析** — **(后缀/eval code 最重要!)** eval code 是合法 JS, 用 acorn 解析后精确定位函数、追踪调用链、提取算法。几小时完成手工数周的工作量
3. **禁止瞎猜** — 每个字节必须有确切出处, 用数据验证或 AST 追踪
4. **不碰内层 VM** — 740 个 state 的黑盒, 只看输入输出。读 VM 代码是陷阱 (basearr 场景)
5. **逐步验证** — 每步对照参考数据验证后才进入下一步
6. **先跑通再纯算** — sdenv 方案先保底, 纯算逐步替代

---

## 阶段 0: 侦察与数据采集

### 输入
目标 URL

### 输出
- 412 HTML (含 `$_ts.nsd`, `$_ts.cd`)
- mainjs 源码 (~200KB)
- Cookie S (Set-Cookie, HttpOnly)
- sdenv 参考数据 (真实 Cookie T + basearr)

### 步骤

**0.1 识别瑞数防护**
```javascript
const http = require('http');
// GET 目标 URL, 检查是否返回 412 + $_ts
http.get(url, res => {
    // res.statusCode === 412
    // body 包含: $_ts.nsd=数字; $_ts.cd="长字符串"
    // body 包含: <script src="xxx.js"> 指向 mainjs
});
```

**0.2 提取原始数据**
```javascript
const nsd = parseInt(body.match(/\$_ts\.nsd=(\d+)/)[1]);
const cd = body.match(/\$_ts\.cd="([^"]+)"/)[1];
const mainjsUrl = body.match(/src="([^"]+\.js)"/)[1];
const cookieS = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
// GET mainjsUrl → mainjs 源码
```

**0.3 用 sdenv 获取参考答案**
```javascript
const { jsdomFromUrl } = require('sdenv');
const dom = await jsdomFromUrl(targetUrl, {
    userAgent: 'Mozilla/5.0 ...',
    consoleConfig: { error: () => {} },
});
await new Promise(r => {
    dom.window.addEventListener('sdenv:exit', r);
    setTimeout(r, 8000);
});
const cookies = dom.cookieJar.getCookieStringSync(baseUrl);
// cookies 包含 Cookie S + Cookie T → 用于 GET 验证
// POST 请求通过 dom.window.XMLHttpRequest 发送 (自动加后缀)
```

**0.4 验证**: sdenv Cookie → HTTP GET → 200

**0.5 采集一份配套数据 (极其重要!)**

> **瑞数的变量名每次加载都不同!** nsd 不同 → grenKeys(918, nsd) 洗牌不同 → eval 代码中所有变量名变化。
> 因此必须在**同一个 session** 中采集全套配套数据, 后续所有分析都基于这一份。
> 如果分开采集 (比如先拿 412, 再拿 mainjs), nsd 已经变了, 数据对不上!

```javascript
/**
 * 一次性配套数据采集脚本
 * 在同一个 sdenv session 中采集: 412 HTML + cd + nsd + mainjs + eval 代码 + Cookie T + basearr + keys
 */
const vm = require('vm');
const fs = require('fs');
const crypto = require('crypto');
const { jsdomFromUrl } = require('sdenv');

const URL = 'http://TARGET_HOST/TARGET_PATH';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...';

let captured = { cd: null, nsd: null, evalCode: null };

// Hook vm.runInContext — 在 sdenv 执行前设置
const origRun = vm.runInContext;
vm.runInContext = function(code, ctx, opts) {
    if (typeof code === 'string') {
        // 捕获 $_ts 初始化脚本 (含 cd 和 nsd)
        if (code.includes('$_ts.cd=') && code.length < 5000) {
            const cdM = code.match(/cd="([^"]+)"/);
            const nsdM = code.match(/nsd=(\d+)/);
            if (cdM) captured.cd = cdM[1];
            if (nsdM) captured.nsd = parseInt(nsdM[1]);
            fs.writeFileSync('captured/ts_init.js', code);
        }
        // 捕获 eval 代码 (>100KB)
        if (code.length > 100000 && !captured.evalCode) {
            captured.evalCode = code;
            fs.writeFileSync('captured/eval_code.js', code);
        }
    }
    return origRun.call(this, code, ctx, opts);
};

async function collectAll() {
    // 1. 先单独 GET 一次拿 412 HTML (用于分析, 不用于 session)
    //    注意: 这个 412 和 sdenv 的不是同一个 session
    //    但 mainjs URL 是固定的, 可以从这里提取

    // 2. sdenv 运行 — 这才是配套 session
    const dom = await jsdomFromUrl(URL, { userAgent: UA, consoleConfig: { error: () => {} } });
    await new Promise(r => { dom.window.addEventListener('sdenv:exit', r); setTimeout(r, 10000); });

    // 3. 提取 Cookie T
    const cookies = dom.cookieJar.getCookieStringSync(URL);
    const cookieT = cookies.match(/T=([^;]+)/)?.[1];
    captured.cookieS = cookies.match(/S=([^;]+)/)?.[1];
    captured.cookieT = cookieT;

    // 4. 提取 keys (纯算, 从 cd)
    const keys = extractKeys(captured.cd); // 用阶段 2 的 extractKeys
    captured.keys = keys;

    // 5. 解密 Cookie T → basearr (用阶段 1 的 decryptCookieT)
    if (cookieT) {
        captured.basearr = decryptCookieT(cookieT, keys);
    }

    dom.window.close();

    // 6. 保存全套配套数据
    fs.mkdirSync('captured', { recursive: true });
    fs.writeFileSync('captured/session.json', JSON.stringify({
        nsd: captured.nsd,
        cd: captured.cd,
        cookieS: captured.cookieS,
        cookieT: captured.cookieT,
        basearr: captured.basearr ? Array.from(captured.basearr) : null,
        timestamp: new Date().toISOString(),
    }, null, 2));
    fs.writeFileSync('captured/keys_raw.json', JSON.stringify(
        keys.map((k, i) => ({ index: i, length: k.length, data: Array.from(k) })),
    null, 2));

    console.log('配套数据采集完成:');
    console.log('  nsd:', captured.nsd);
    console.log('  cd:', captured.cd?.length, 'chars');
    console.log('  eval:', captured.evalCode?.length, 'chars');
    console.log('  keys:', keys.length, '组');
    console.log('  basearr:', captured.basearr?.length, 'B');
    console.log('  Cookie T:', cookieT?.length, 'chars');

    // 7. 解析 basearr TLV 结构
    if (captured.basearr) {
        console.log('\nbasearr TLV:');
        let pos = 0;
        while (pos < captured.basearr.length) {
            const type = captured.basearr[pos], len = captured.basearr[pos+1];
            const payload = captured.basearr.slice(pos+2, pos+2+len);
            console.log('  type=' + type + ' len=' + len +
                ' data=[' + payload.slice(0,15).join(',') + (len > 15 ? '...' : '') + ']');
            pos += 2 + len;
        }
    }

    return captured;
}

collectAll().catch(console.error);
```

**产出文件** (同一 session 配套):
```
captured/
├── session.json       nsd + cd + Cookie S/T + basearr + 时间戳
├── keys_raw.json      45 组密钥 (index + length + data)
├── ts_init.js         $_ts 初始化脚本 (含 cd)
├── eval_code.js       296KB eval 代码 (配套变量名)
└── mainjs.js          mainjs 源码 (可从 412 HTML 提取 URL 后单独下载, 这个是静态的)
```

> **为什么要配套?**
> - `session.json` 中的 nsd/cd/Cookie T/basearr 是同一次请求的产物
> - `eval_code.js` 中的变量名和 nsd 对应 — 换一个 nsd, 变量名全部不同
> - 后续调试 Coder 时, 用 `eval_code.js` 做逐字节对比参考
> - 后续适配 basearr 时, 用 `session.json` 中的 basearr + keys 做数据驱动分析

### 关于变量名变化 — 重要!

> **瑞数的变量名不是固定的!** 这是逆向中最容易踩的坑。

```
Session 1 (nsd=84277): _$eX, _$hR, _$cR, _$bO, _$hr ...
Session 2 (nsd=91234): _$f3, _$gT, _$aK, _$dP, _$kN ...
Session 3 (nsd=76521): _$_p, _$b7, _$eL, _$cN, _$jW ...
```

**同一个逻辑角色** (比如"加密入口函数") 在不同 session 中有**不同的变量名**。

**影响**:
- **VM 注入 hook 时不能用变量名定位!** 比如 `function _$hr()` 下次可能叫 `function _$kN()`
- 必须用**结构特征**定位:
  - 代码长度: `code.length > 250000` (eval 代码)
  - 常量值: 搜索 `15679`, `2531011` (PRNG), `55295` (getLine 乘数)
  - 函数模式: `var _$xx=[324];Array.prototype.push.apply` (State 324 入口)
  - 正则匹配: `/function\s+(_\$\w+)\(\)\{var\s+(_\$\w+)=\[324\]/` (按结构不按名字)
- **配套数据中的变量名只在该 session 内有效**
- **Coder 不受影响**: Coder 重写的是 mainjs 的逻辑, 不依赖 eval 代码中的变量名

**hook 定位的正确方式**:
```javascript
// ❌ 错误: 用变量名 (下次就变了)
const target = 'function _$hr(){var _$jZ=[324];';

// ✅ 正确: 用结构特征 (永远不变)
const statePattern = /function\s+(_\$\w+)\(\)\{var\s+(_\$\w+)=\[324\]/;
const match = code.match(statePattern);
if (match) {
    const funcName = match[1]; // 动态获取当前 session 的函数名
    // 用 funcName 做后续注入
}

// ✅ 正确: 用代码长度
if (code.length > 250000) { /* 这是 eval 代码 */ }

// ✅ 正确: 用常量特征
if (code.includes('15679') && code.includes('2531011')) { /* 找到 PRNG */ }
```

### sdenv 安装注意
```bash
# npm 11.x + Node 24 有依赖解析死循环 bug, 必须用 pnpm
npx pnpm add sdenv
# 编译原生模块 (需要 VS Build Tools / gcc)
# 如果 pnpm 跳过了编译:
cd node_modules/.pnpm/sdenv@*/node_modules/sdenv && npx node-gyp rebuild
```

---

## 阶段 1: 加密链逆向 (通用, 一次性)

### 输入
sdenv 生成的 Cookie T + 密钥

### 输出
`generateCookie(basearr, keys) → Cookie T`

### 加密管线 (7 步)
```
basearr (154-166B)
  → Huffman 编码 (~118B)
  → 前 16 字节 XOR keys[2][0:15]
  → AES-128-CBC (key=keys[17], IV=全零, PKCS7) → ~128B
  → 拼 packet: [2, 8, r2mkaTime(4B), now(4B), 48, keys48(48B), lenEnc, cipher]
  → CRC32 → [crc(4B), packet] → ~193B
  → AES-128-CBC (key=keys[16], IV=随机16B, PKCS7) → ~224B
  → 自定义 Base64 → "0" + 299 字符
```

### 完整实现

#### Huffman 编码
```javascript
// 权重: byte=0 → 45, byte=255 → 6, 其余 → 1 (所有版本通用)
let huffCfg;
function huffInit() {
    let a = [];
    for (let i = 1; i < 255; i++) a.push({t:1, i});
    a.push({t:6, i:255}, {t:45, i:0});
    function ins(x) {
        for (let i = 0; i < a.length; i++) {
            if (x.t <= a[i].t) { a.splice(i, 0, x); return; }
        }
        a.push(x);
    }
    while (a.length > 1) {
        const [x, y] = a.splice(0, 2);
        ins({t: x.t + y.t, f: x, s: y});
    }
    const cfg = [];
    function walk(n, k=0, v=0) {
        if (n.i !== undefined) cfg[n.i] = {k, v};
        else { walk(n.f, k<<1, v+1); walk(n.s, (k<<1)+1, v+1); }
    }
    walk(a[0]);
    let topKey;
    for (let i in cfg) if (cfg[i].v >= 8) { topKey = cfg[i].k >> (cfg[i].v - 8); break; }
    huffCfg = [cfg, topKey];
}
function huffEncode(arr) {
    if (!huffCfg) huffInit();
    const ans = []; let one = 0, two = 0;
    for (let i = 0; i < arr.length; i++) {
        const c = huffCfg[0][arr[i]];
        one = one << c.v | c.k;
        two += c.v;
        while (two >= 8) { ans.push(one >> (two-8)); one &= ~(255 << (two-8)); two -= 8; }
    }
    if (two > 0) ans.push(one << (8-two) | huffCfg[1] >> two);
    return ans;
}
```

#### AES-128-CBC
```javascript
const crypto = require('crypto');
function aesCBC(data, key, iv) {
    const p = 16 - (data.length % 16);
    const padded = Buffer.alloc(data.length + p, p);
    Buffer.from(data).copy(padded);
    const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), iv || Buffer.alloc(16, 0));
    c.setAutoPadding(false);
    return iv
        ? [...iv, ...Buffer.concat([c.update(padded), c.final()])]
        : [...Buffer.concat([c.update(padded), c.final()])];
}
```

#### CRC32
```javascript
const CRC_T = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_T[i] = c;
}
function crc32(d) {
    if (typeof d === 'string') d = unescape(encodeURIComponent(d)).split('').map(c => c.charCodeAt(0));
    let c = ~0;
    for (let i = 0; i < d.length; i++) c = (c >>> 8) ^ CRC_T[(c ^ d[i]) & 0xFF];
    return (~c) >>> 0;
}
```

#### 自定义 Base64
```javascript
// 字母表 (所有瑞数版本通用)
const B64 = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d';
function b64Enc(data) {
    const r = []; let i = 0; const l = data.length - 2;
    while (i < l) {
        const a = data[i++], b = data[i++], c = data[i++];
        r.push(B64[a>>2], B64[((a&3)<<4)|(b>>4)], B64[((b&15)<<2)|(c>>6)], B64[c&63]);
    }
    if (i < data.length) {
        const a = data[i], b = data[++i];
        r.push(B64[a>>2], B64[((a&3)<<4)|(b>>4)]);
        if (b !== undefined) r.push(B64[(b&15)<<2]);
    }
    return r.join('');
}
```

#### 组装 generateCookie
```javascript
function n4(n) { return [(n>>24)&255, (n>>16)&255, (n>>8)&255, n&255]; }

function generateCookie(basearr, keys) {
    const K1 = keys[17], K2 = keys[16], K48 = keys[2];
    const r2t = parseInt(String.fromCharCode(...keys[21]));
    const now = Math.floor(Date.now() / 1000);

    const enc = huffEncode(basearr);
    const xored = enc.slice();
    for (let i = 0; i < 16 && i < xored.length; i++) xored[i] ^= K48[i];
    const cipher = aesCBC(xored, K1);

    const cLen = cipher.length;
    const lenE = cLen < 128 ? [cLen] : [0x80 | (cLen >> 8), cLen & 0xFF];
    const pkt = [2, 8, ...n4(r2t), ...n4(now), 48, ...K48, ...lenE, ...cipher];

    const crcVal = crc32(pkt);
    const full = [...n4(crcVal), ...pkt];
    const iv = crypto.randomBytes(16);
    return '0' + b64Enc(aesCBC(full, K2, iv));
}
```

### 验证方法
用 sdenv 解密真实 Cookie T 提取 basearr, 然后用纯算 generateCookie 重新加密:
```
sdenv basearr + generateCookie → 新 Cookie T → HTTP GET → 200
```
**这一步必须通过, 才能进入下一阶段。**

### 通用辅助函数 (后续阶段都会用到)

```javascript
function n4(n) { return [(n>>24)&255, (n>>16)&255, (n>>8)&255, n&255]; }
function numToNumarr4(n) {
    if (Array.isArray(n)) return n.flatMap(x => numToNumarr4(x));
    if (typeof n !== 'number') n = 0;
    return [(n>>24)&255, (n>>16)&255, (n>>8)&255, n&255];
}
function numToNumarr2(n) {
    if (typeof n !== 'number' || n < 0) n = 0;
    if (n > 65535) n = 65535;
    return [n >> 8, n & 255];
}
function numToNumarr8(num) {
    if (typeof num !== 'number' || num < 0) num = 0;
    const high = Math.floor(num / 4294967296);
    const low = num % 4294967296;
    return [...numToNumarr4(high), ...numToNumarr4(low)];
}
function string2ascii(str) { return str.split('').map(c => c.charCodeAt(0)); }
function ascii2string(arr) { return String.fromCharCode(...arr); }
function toAscii(str) { return [str.length, ...string2ascii(str)]; }
```

### Base64 解码 (解密 Cookie T 必须)

```javascript
function b64Dec(s) {
    const B64 = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d';
    const rev = {};
    for (let i = 0; i < B64.length; i++) rev[B64[i]] = i;
    const r = []; let i = 0;
    while (i < s.length) {
        const a = rev[s[i++]] || 0, b = rev[s[i++]] || 0;
        const c = i < s.length ? rev[s[i++]] : undefined;
        const d = i < s.length ? rev[s[i++]] : undefined;
        r.push((a << 2) | (b >> 4));
        if (c !== undefined) r.push(((b & 15) << 4) | (c >> 2));
        if (d !== undefined) r.push(((c & 3) << 6) | d);
    }
    return r;
}
```

### Huffman 解码 (从 Cookie T 提取真实 basearr 必须)

```javascript
function huffDecode(data) {
    // 重建 Huffman 树 (和编码用同一个)
    if (!huffCfg) huffInit();
    // 从 cfg 重建树
    const root = { f: null, s: null };
    for (let i = 0; i < 256; i++) {
        if (!huffCfg[0][i]) continue;
        const { k, v } = huffCfg[0][i]; // k=code bits, v=bit length
        let node = root;
        for (let bit = v - 1; bit >= 0; bit--) {
            const b = (k >> bit) & 1;
            if (b === 0) { if (!node.f) node.f = {}; node = node.f; }
            else { if (!node.s) node.s = {}; node = node.s; }
        }
        node.i = i;
    }
    // 逐 bit 解码
    const result = [];
    let node = root;
    for (const byte of data) {
        for (let bit = 7; bit >= 0; bit--) {
            node = ((byte >> bit) & 1) ? node.s : node.f;
            if (node && node.i !== undefined) { result.push(node.i); node = root; }
            if (!node) break; // padding bits
        }
    }
    return result;
}
```

### Cookie T 完整解密流程 (混合验证必须)

```javascript
function decryptCookieT(cookieT, keys) {
    // 1. 去前缀 "0", Base64 解码
    const bytes = b64Dec(cookieT.substring(1));
    // 2. 外层 AES-CBC 解密 (前 16B = IV)
    const iv = Buffer.from(bytes.slice(0, 16));
    const ct = Buffer.from(bytes.slice(16));
    const dec1 = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[16]), iv);
    let outer = [...Buffer.concat([dec1.update(ct), dec1.final()])];
    // 3. 去 PKCS7 padding
    outer = outer.slice(0, outer.length - outer[outer.length - 1]);
    // 4. 分离 CRC(4B) + packet
    const packet = outer.slice(4);
    // 5. 解析 packet: [2, 8, nonce(8B), 48, keys48(48B), lenEnc, cipher]
    let p = 2 + 8 + 1 + 48; // 跳过 header
    const cipherLen = packet[p] < 128 ? packet[p++] : ((packet[p++] & 0x7F) << 8) | packet[p++];
    const cipher = packet.slice(p, p + cipherLen);
    // 6. 内层 AES-CBC 解密 (IV=0)
    const dec2 = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[17]), Buffer.alloc(16, 0));
    let inner = [...Buffer.concat([dec2.update(Buffer.from(cipher)), dec2.final()])];
    inner = inner.slice(0, inner.length - inner[inner.length - 1]); // 去 padding
    // 7. XOR 还原前 16 字节
    for (let i = 0; i < 16 && i < inner.length; i++) inner[i] ^= keys[2][i];
    // 8. Huffman 解码 → basearr
    return huffDecode(inner);
}
```

### 常见坑
- AES 密钥直接用 keys[17]/keys[16] 原始 16 字节, 不需要 numarrAddTime 包装
- nonce = [r2mkaTime(4B), currentTime(4B)]
- 密文长度编码: <128 用 1 字节, >=128 用 2 字节 [0x80|hi, lo]
- **HTTP 下载 mainjs 必须用 Buffer 拼接 + toString('utf-8')**, 不能用 `b += chunk` (会按 latin1 解码, 破坏多字节字符如 ā=U+0101, 导致 Coder 解析失败)

```javascript
// ❌ 错误: 破坏 UTF-8 多字节字符
let b = ''; res.on('data', d => b += d);

// ✅ 正确: Buffer 拼接后统一 UTF-8 解码
const chunks = []; res.on('data', d => chunks.push(d));
res.on('end', () => Buffer.concat(chunks).toString('utf-8'));
```

---

## 阶段 2: 密钥提取 (通用, 一次性)

### 输入
`$_ts.cd` 字符串

### 输出
keys[0..44] (45 组密钥)

### 完整实现

#### 自定义 Base64 解码
```javascript
const BASESTR = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';

function mkDecryptKeys() {
    const a = [{},{},{},{},{},{}];
    for (let i = 0; i < BASESTR.length; i++) {
        const c = BASESTR.charCodeAt(i);
        a[0][c] = i << 2;
        a[1][c] = i >> 4;
        a[2][c] = (i & 15) << 4;
        a[3][c] = i >> 2;
        a[4][c] = (i & 3) << 6;
        a[5][c] = i;
    }
    return a;
}

function decodeCd(str) {
    const dk = mkDecryptKeys();
    const a = [];
    for (let i = 0; i < str.length; i += 4) {
        const c = [0,1,2,3].map(j => i+j < str.length ? str.charCodeAt(i+j) : undefined);
        if (c[1] !== undefined) a.push(dk[0][c[0]] | dk[1][c[1]]);
        if (c[2] !== undefined) a.push(dk[2][c[1]] | dk[3][c[2]]);
        if (c[3] !== undefined) a.push(dk[4][c[2]] | dk[5][c[3]]);
    }
    return a;
}
```

#### 变长长度解析
```javascript
function readLength(arr, pos) {
    const x = arr[pos++];
    let len;
    if ((x & 128) === 0) len = x;                                    // 0xxxxxxx: 1 字节
    else if ((x & 192) === 128) len = ((x & 63) << 8) | arr[pos++];  // 10xxxxxx: 2 字节
    else if ((x & 224) === 192) len = ((x & 31) << 16) | (arr[pos++] << 8) | arr[pos++]; // 110xxxxx: 3 字节
    else len = x;
    return [len, pos];
}
```

#### XOR 偏移推导 + keys 提取
```javascript
function extractKeys(cd) {
    const bytes = decodeCd(cd);
    const codeEnd = (bytes[0] << 8 | bytes[1]) + 2;
    const keysPart = bytes.slice(codeEnd);

    // 已知明文攻击: keys[0]="64"(ASCII 0x36,0x34), keys[1]="64", keys[2]=48B
    const offset = [
        keysPart[0] ^ 45,    // keyCount = 45
        keysPart[1] ^ 2,     // keys[0].length = 2
        keysPart[2] ^ 0x36,  // '6'
        keysPart[3] ^ 0x34,  // '4'
        keysPart[4] ^ 2,     // keys[1].length = 2
        keysPart[5] ^ 0x36,  // '6'
        keysPart[6] ^ 0x34,  // '4'
        keysPart[7] ^ 48     // keys[2].length = 48
    ];

    const decrypted = keysPart.map((b, i) => b ^ offset[i % 8]);
    const keys = []; let pos = 1;
    for (let i = 0; i < decrypted[0]; i++) {
        const [len, newPos] = readLength(decrypted, pos);
        pos = newPos;
        keys.push(decrypted.slice(pos, pos + len));
        pos += len;
    }

    // 自检
    if (keys.length < 45) throw new Error('keys 不足 ' + keys.length + '/45, XOR 偏移可能错误');
    if ([29,30,31,32].some(i => keys[i]?.length !== 4))
        throw new Error('keys[29..32] 结构异常, 需要实现 r2mka runTask');

    return keys;
}
```

### 关键 keys 含义

| key | 含义 | 用途 |
|-----|------|------|
| keys[2] | 48B KEYS48 | XOR + packet 内嵌 |
| keys[7] | 配置串 (分号分隔) | `split(';')[5]+'T'` = Cookie 名 |
| keys[16] | 16B KEY2 | 外层 AES 密钥 |
| keys[17] | 16B KEY1 | 内层 AES 密钥 |
| keys[19] | 时间戳串 | type=10[6..9] |
| keys[21] | r2mkaTime 串 | nonce 时间 |
| keys[22] | 加密数据 | type=6 AES 解密 |
| keys[24-26] | 数值串 | type=10 参数 |
| keys[29-32] | 各 4B | type=2 变量名映射 |
| keys[33-34] | 数值串 | codeUid 计算参数 |

### 当自检失败时 (keys[0] ≠ "64")
需要实现 rs-reverse 的 tscd.js: cd code 段 → parse → getTaskarr → runTaskByUid → 8 字节 XOR 偏移。难度高, 大部分站点不需要。优先用上述简化方法 + 自检。

---

## 阶段 3: 外层 VM 重写 (通用, 一次性)

### 核心思想
**不运行 VM, 重写 VM。** mainjs 是确定性的代码生成器, 只依赖 3 个输入 (nsd, cd, globalText1)。理解它的算法后用纯 JS 重写, 就能获取所有中间数据。

### 输入
mainjs 源码 + nsd + cd

### 输出
- eval 代码 (100% 字节一致)
- functionsNameSort (codeUid 用)
- mainFunctionIdx (codeUid 用)
- keynameNum (type=2 用)

### 逆向方法: 如何从 200KB 混淆 mainjs 到 Coder 实现

> 真实经验: 不是从零逆向 mainjs, 而是**参照 rs-reverse 的 Coder.js 源码**, 建立模块映射后重写。
> rs-reverse 是开源项目 (GitHub), 先读他们的 Coder.js (335行) 理解架构。

#### 第 1 步: 读 rs-reverse 源码, 建立模块映射表

先读 rs-reverse 的模块, 理解它重写了 mainjs 的哪些函数:

| rs-reverse 模块 | 对应 mainjs 函数 | 功能 |
|----------------|-----------------|------|
| getScd.js | _$ad() (通常 line 12) | PRNG 伪随机数: `15679 * (seed & 0xFFFF) + 2531011` |
| globaltext.js | _$$1() + _$kx (line 77) | 从编码字符串读 charCode, 游标自增 |
| arraySwap.js | _$lT() (line 21) | Fisher-Yates 洗牌 (从尾到头) |
| grenKeys.js | 内部变量名生成 | 918 个 `_$xx` 格式变量名 |
| Coder.js | _$cj() (line 70) | 核心代码生成器 (75 opcode) |
| Coder.gren() | _$g6() (line 371) | 代码段生成 (55 opcode) |

**注意**: 函数名每次加载都不同 (混淆), 但结构特征固定:
- PRNG: 搜索常量 `15679` 和 `2531011`
- 洗牌: PRNG 下面的 while + 交换
- 游标: `charCodeAt(cursor++)` 模式
- 两层 VM: 两个嵌套 `while(1)` + if/else opcode 分发

#### 第 2 步: 格式化 mainjs, 建立变量表

```bash
npx js-beautify mainjs.js -o mainjs_fmt.js
```

格式化后先建立 mainjs 内部变量表 (变量名每次不同, 但角色固定):

| mainjs 变量 | 含义 | rs-reverse 对应 |
|-------------|------|----------------|
| _$kx | globalText 编码字符串 | immucfg.globalText1 |
| _$jL | 游标位置 | optext cursor |
| _$cN | keycodes 数组 | this.keycodes |
| _$aB | keynames 变量名表 (918) | this.keynames / cp[1] |
| _$ft | 代码片段数组 | codeArr |
| _$_1 | nsd 值 | $_ts.nsd |
| _$df | PRNG 函数 | this.scd |
| _$eL | aebi 数组 | $_ts.aebi |
| _$bV | _$$J[1] 字节码数组 | 主循环字节码 |
| _$$5 | PC 程序计数器 | 读取 _$bV 的位置 |
| _$eO | 当前 opcode | switch 分发 |

#### 第 3 步: 提取第一层 VM 全部 75 个 opcode

从 mainjs_fmt.js line 95-370, 分发变量 _$eO:

```
op 0:  _$_n.cp = _$bj                              设置 $_ts.cp
op 1:  !_$dt ? _$$5 += 39 : 0                     条件跳转
op 4:  _$dt = !_$jl                                条件判断
op 8:  _$$x = _$$1()                               读一个 charCode
op 9:  _$cN = _$kx.substr(_$jL, len).split(chr(257)) ★ 生成 keycodes
op 20: _$_1 = _$_n.nsd                             ★ 读 nsd
op 21: _$bj[idx] = "_$" + chars[a] + chars[b]      ★ 生成变量名
op 28: _$bj = []                                   初始化数组
op 30: for(i=0;i<code.length;i+=100)...             cp[3] hash 计算
op 34: _$eL = _$_n.aebi = []                       ★ 初始化 aebi
op 41: _$jL = 0                                    ★ 重置游标
op 46: _$lT(_$bj, _$lm)                            ★ 洗牌变量名
op 49: _$kx = "ȪŬΔΕŬྷ..."                         ★ 设置 globalText1
op 53: _$iB = "_$abc...0123456789".split('')        ★ 变量名字符集
op 66: _$g6(36, _$ft)                              代码段生成循环
op 74: _$bj[1] = _$aB                              cp[1] = 变量名表
op 75: _$aB = _$cj(0, 918, _$ad(_$_1 & 0xffff))   ★ 生成 918 变量名
op 76: _$cH = _$ft.join('')                         ★ 拼 eval 代码
op 84: _$_D = '\n\n\n\n\n'                         换行模板
op 85: _$iB = _$bj.call(_$gL, _$ba)                eval.call(window, code)
op 88: _$cN.push(_$g6(34, _$$1()*55295+_$$1()))    ★ push 到 keycodes
op 92: _$bj = _$gL.eval                            获取 eval 函数
op 93: _$g6(48, _$hf, _$ft)                        代码段生成
op 95: _$_n.scj = []                               初始化 scj
```

**★ 关键发现: op 88**
```javascript
_$cN.push(_$g6(34, _$$1() * 55295 + _$$1()))
```
- `_$$1() * 55295 + _$$1()` = 从 globalText 读 2 个 charCode 计算长度
- `_$g6(34, length)` = 调用第二层 VM 的 opcode 34 读取指定长度文本
- push 到 keycodes 数组
- **r2mka 文本就是 keycodes 中通过这个 op 88 生成的元素**

#### 第 4 步: 提取第二层 VM 全部 55 个 opcode

mainjs_fmt.js line 371-700, 分发变量 _$j5, 读 _$$J[2]:

```
op 1:  _$iT(0, len, output)        生成 if/else 结构
op 18: while(1){...}               循环头
op 20: function 定义头
op 25: _$$1()                       读 charCode
op 34: _$gP[i] = _$g6(0)           递归读子列表 (= getList)
op 36: _$cN = _$g6(34, _$$1())     读行 (= getLine)
op 41: _$fr(6, hf, R)              调用另一层
op 48: charCode 读取
op 57: charCode 读取
op 60: _$lT(arr, scd)              洗牌
op 62: charCode 读取
op 64: _$cN.split(chr(257))        keycodes 分割
```

#### 第 5 步: 理解两层 VM 的调用层级

```
_$cj(56)           读 _$$J[1] 从位置 56   → 主初始化
  ├── _$cj(110)      读 _$$J[1] 从 110      → 子流程
  ├── _$cj(0, 918, prng)                     → 变量名生成
  ├── _$g6(36, ...)  读 _$$J[2]            → 代码段生成
  │   ├── _$g6(34, len)                      → getLine
  │   └── _$g6(48, ...)                      → 代码段循环
  └── eval(code)                             → 执行生成代码
```

rs-reverse Coder.js 把这 130 个 opcode 的效果重写成:
- `parseGlobalText1()` — _$cj 主流程
- `parseGlobalText2()` — _$cj 子流程
- `_gren()` — _$g6 代码段生成
- `_ifElse()` — _$g6 if/else 结构
- `_functionsSort()` — _$g6 函数排序

#### 第 6 步: 实现 5 个核心模块

按 rs-reverse 模块结构分别实现:
1. PRNG (createScd) — 3 行
2. Fisher-Yates 洗牌 (arrayShuffle) — 5 行
3. 游标读取器 (textReader) — 10 行
4. 变量名生成 (grenKeys) — 6 行
5. 字符串提取 (extractImmucfg) — 10 行

#### 第 7 步: 实现 Coder 类, 第一版测试

按 rs-reverse Coder.js 结构实现:
- `parseGlobalText1()` — 读 6 opmate + keycodes + r2mka + 代码段循环
- `_gren()` — 8 opmate + 3 list + wrapper + 函数 + while + if/else
- `parseGlobalText2()` — 第二段代码

#### 第 8 步: 逐字节对比调试 (关键!)

**这是最耗时的步骤**, 实际经历了 3 个版本:

**v1**: 初步实现 → 差 42K 字符 (253561 vs 296097), 变量名第一个就不对

**v2**: 修了 3 个 bug → 前 51% 匹配 (151543 chars)
- Bug 1: 多余 getCode (5 setMate+1 无名=6, 不是 7)
- Bug 2: gren(0) 用全局 opmate, 不是局部
- Bug 3: var 声明用 m.s6 (index 1), 不是 m.bs (index 2)

**v3**: 又修 3 个 bug → 差距缩到 180 字符
- Bug 4: while 循环用全局 G_$kv
- Bug 5: _ifElse 缺少 `)` 和用错变量名
- Bug 6: _ifElse 递归分支精确对齐 rs-reverse grenIfelse

**debugger 对齐**: 差 20 个 debugger × 9 字符 ≈ 180 字符差距
- 根因: debugger PRNG 每个 gren 段重建 (seed=nsd), posis 数组跨段累积
- 精确对齐 rs-reverse 的 getDebuggerScd 初始化时序 → **100% 匹配**

**调试方法**: 每次修 bug 后逐字节对比:
```javascript
for (let i = 0; i < Math.min(generated.length, ref.length); i++) {
    if (generated[i] !== ref[i]) {
        console.log('差异 @' + i + ':', JSON.stringify(generated.substring(i, i+60)));
        console.log('参考:', JSON.stringify(ref.substring(i, i+60)));
        break;
    }
}
```

#### 第 9 步: 提取中间数据
Coder 匹配后, 自动获得:
- `functionsNameSort` (55 个函数) → 算 codeUid
- `mainFunctionIdx` → 算 codeUid
- `r2mkaText` (43925 chars) → 可选, 用于 type=2 通用计算
- `keynameNum` (918) → 生成 cp1

#### 调试中发现的 6 个坑 (真实经验)
1. **opmate 数量**: 全局 opmate 是 5 个命名 + 1 个无名 = 6 个 getCode, 不是 7 个
2. **gren(0) 的参数**: 用**全局** G_$dK/G_$kv, 不是局部 opmate
3. **var 声明变量**: 用 `_$$6` (opmate index 1), 不是 `_$b$` (index 2)
4. **while(1) 循环**: `_$aw = G_$kv[current]` 也用全局 opmate
5. **_ifElse 递归**: start 变量在 for 循环中被修改, else 分支用修改后的 start
6. **debugger PRNG**: 每个 gren 段重建 (seed=nsd), posis 数组跨段累积

### 核心算法

#### PRNG (所有瑞数版本通用)
```javascript
function createPRNG(seed) {
    let s = seed;
    return function() {
        s = 15679 * (s & 0xFFFF) + 2531011;
        return s;
    };
}
```

#### Fisher-Yates 洗牌
```javascript
function shuffle(arr, prng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = (prng() & 0x7FFFFFFF) % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
```

#### 变量名生成
```javascript
function grenKeys(num, nsd) {
    const chars = '_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const names = [];
    for (let a of chars) for (let b of chars) names.push('_$' + a + b);
    return shuffle(names.slice(0, num), createPRNG(nsd));
}
```

#### 从 mainjs 提取静态数据
```javascript
// 找 mainjs 中所有引号字符串, 取 4 个最长的, 按长度排序:
// globalText1 (最长) → 主编码数据
// cp0 → Caesar+6 编码字符串表
// cp2 → 数值常量表
// globalText2 → 第二段编码数据
```

#### 文本读取器
```javascript
function textReader(text) {
    let cursor = 0;
    return {
        getCode: () => text.charCodeAt(cursor++),
        getLine: (n) => { const s = text.substring(cursor, cursor + n); cursor += n; return s; },
        getList: () => {
            const len = text.charCodeAt(cursor++);
            const arr = [];
            for (let i = 0; i < len; i++) arr.push(text.charCodeAt(cursor++));
            return arr;
        },
    };
}
```

#### parseGlobalText1 核心序列
```
6 × getCode()                           → opmate 标志 (6个数字)
getLine(getCode()*55295 + getCode())     → keycodes 字符串
1 × getCode()                           → 分隔
getLine(getCode()*55295 + getCode())     → r2mkaText
1 × getCode()                           → 代码段数量 codeNum
for (i = 0; i < codeNum; i++) → _gren(i) → 生成代码段
```

#### _gren 代码段生成 (完整细节)

```javascript
function _gren(reader, current, codeArr, scd, keynames, keycodes) {
    // 1. 读 8 个 opmate (每个有特定含义)
    const m = {};
    for (const k of ['ku','s6','bs','sq','jw','sg','cu','aw'])
        m[k] = reader.getCode();
    // ku: 代码段标识符索引
    // s6: var 声明用的变量名索引
    // bs: 判断条件变量 (if _$bs ===)
    // sq: wrapper 函数的参数数组名
    // jw: while(1) 循环条件变量
    // sg: wrapper 函数的 apply 目标
    // cu: 当前代码段名索引
    // aw: 全局 opmate 用的变量名

    // 2. 读 3 个 list
    const listK = reader.getList(); // 函数参数
    const listH = reader.getList(); // 变量声明
    const listC = reader.getList(); // wrapper 函数配对

    // 3. listC 配对后洗牌
    const pairs = [];
    for (let i = 0; i < listC.length; i += 2)
        pairs.push([listC[i], listC[i+1]]);
    const shuffledPairs = arrayShuffle(pairs, scd);

    // 4. 生成 wrapper 函数
    shuffledPairs.forEach(([k1, k2]) => {
        codeArr.push(
            'function ', keynames[k1], '(){var ', keynames[m.sq],
            '=[', k2, '];Array.prototype.push.apply(', keynames[m.sq],
            ',arguments);return ', keynames[m.sg], '.apply(this,', keynames[m.sq], ');}'
        );
    });

    // 5. 读 opcode 范围
    const bf = reader.getCode();

    // 6. 读 aebi
    const aebi = reader.getList();

    // 7. 读函数代码段
    const funcCount = reader.getCode();
    const functions = [];
    for (let i = 0; i < funcCount; i++) functions.push(reader.getList());
    const shuffledFuncs = arrayShuffle(functions, scd);

    // 8. 读 opcode 实现
    const opcCount = reader.getCode();
    const opcImpls = [];
    for (let i = 0; i < opcCount; i++) opcImpls.push(reader.getList());

    // 9. 拼接代码段
    // IIFE 头 (current=0) 或函数头 (current>0)
    if (current === 0) {
        // IIFE: (function(全局 opmate 参数){
        codeArr.push('(function(', /* 全局 opmate 变量 */ '){');
    } else {
        // 命名函数
        codeArr.push('function ', keynames[m.cu], '(', /* 参数 */ '){');
    }

    // 变量声明: var _$s6;
    codeArr.push('var ', keynames[m.s6], ';');
    for (const h of listH) codeArr.push('var ', keynames[h], ';');

    // while(1) 循环 + debugger 插入
    codeArr.push('while(1){', keynames[m.jw], '=', /* 全局 opmate */, '[', /* current */, '];');

    // if/else 二叉分发
    _ifElse(0, bf, codeArr, opcImpls, keycodes, keynames, m.bs);

    codeArr.push('}'); // while
    codeArr.push('}'); // function
}
```

#### _ifElse 二叉搜索分发 (关键算法)

```javascript
// 步长表 (所有版本通用)
const STEPS = [4, 16, 64, 256, 1024, 4096, 16384, 65536];

function _ifElse(start, end, out, impls, keycodes, keynames, condVar) {
    const range = end - start;
    if (range <= 0) return;
    if (range <= 4) {
        // 小范围: 线性 if/else
        for (let i = start; i < end; i++) {
            out.push(i === start ? 'if(' : 'else if(');
            out.push(keynames[condVar], '===', i, '){');
            if (impls[i]) _appendImpl(i, out, impls, keycodes, keynames);
            out.push('}');
        }
        return;
    }
    // 大范围: 找最接近的 step 二分
    let step = STEPS[0];
    for (const s of STEPS) { if (s < range) step = s; else break; }
    const mid = start + step;
    out.push('if(', keynames[condVar], '<', mid, '){');
    _ifElse(start, mid, out, impls, keycodes, keynames, condVar);
    out.push('}else{');
    _ifElse(mid, end, out, impls, keycodes, keynames, condVar);
    out.push('}');
}
```

#### parseGlobalText2 (不可省略)

```javascript
// globalText2 生成第二段代码 (通常是收尾/调用段)
parseGlobalText2() {
    const r = textReader(this.globalText2);
    r.getCode(); // 1 个 opmate
    const kcStr = r.getLine(r.getCode()); // keycodes 字符串
    const kc2 = kcStr.split(String.fromCharCode(257)); // 分割符 = charCode 257
    const list = r.getList();
    const out = [];
    // 交替拼接: kc2[偶数] + keynames[奇数]
    for (let i = 0; i < list.length - 1; i += 2) {
        out.push(kc2[list[i]]);
        out.push(this.keynames[list[i+1]]);
    }
    out.push(kc2[list[list.length - 1]]); // 最后一个 keycodes
    return out.join('');
}
```

#### extractImmucfg 转义处理 (关键细节)

```javascript
function extractImmucfg(code) {
    // 找所有引号字符串的位置
    const quotes = [];
    for (let i = 0; i < code.length; i++) {
        if (code[i] === '"' && (i === 0 || code[i-1] !== '\\')) quotes.push(i);
    }
    // 提取配对内容
    const strs = [];
    for (let i = 0; i < quotes.length - 1; i += 2) {
        const raw = code.substring(quotes[i] + 1, quotes[i+1]);
        // 关键: 转义序列处理, 用 Function 构造器而非 JSON.parse
        try { strs.push(JSON.parse('"' + raw + '"')); }
        catch(e) {
            try { strs.push(new Function('return "' + raw + '"')()); }
            catch(e2) { strs.push(raw); }
        }
    }
    // 按长度排序, 取 4 个最长
    strs.sort((a, b) => b.length - a.length);
    return {
        globalText1: strs[0],
        cp0: strs[1],
        cp2: strs[2],
        globalText2: strs[3],
    };
}
```

#### keynameNum 动态提取

```javascript
// 从 mainjs 正则提取变量名数量 (不同站点不同, 常见 918)
const m = mainjs.match(/_\$[\$_A-Za-z0-9]{2}=_\$[\$_A-Za-z0-9]{2}\(0,([0-9]+),/);
const keynameNum = m ? parseInt(m[1]) : 918; // 默认 918
```

#### Cookie 名后缀判断 ('T' 或 'P')

```javascript
// 从 keys[7] 提取 Cookie 前缀
const k7parts = ascii2string(keys[7]).split(';');
const cookiePrefix = k7parts[5]; // 如 "AV7KYchI7HHa"
// 后缀通常是 'T', 少数站点是 'P'
// 判断方法: 看 412 响应的 Set-Cookie 头
// Set-Cookie: xxxS=... → Cookie S 用 'S', Cookie T 就用 'T'
// Set-Cookie: xxxP=... → 对应 'P' (罕见)
const lastWord = 'T'; // 绝大多数站点
const cookieName = cookiePrefix + lastWord;
```

#### flag 值从参考 basearr 提取

```javascript
// 解析参考 basearr 的 TLV, 找 type=7 的 payload
function extractFlag(refBasearr) {
    let pos = 0;
    while (pos < refBasearr.length) {
        const type = refBasearr[pos], len = refBasearr[pos + 1];
        if (type === 7) {
            const payload = refBasearr.slice(pos + 2, pos + 2 + len);
            // flag 在 type=7 payload 的 [8..9] 位置
            return (payload[8] << 8) | payload[9];
        }
        pos += 2 + len;
    }
    return 2830; // 默认
}
```

#### codeUid 计算
```javascript
function computeCodeUid(coder, keys) {
    const funcIdx = parseInt(String.fromCharCode(...keys[33]));
    const sliceMul = parseInt(String.fromCharCode(...keys[34]));
    const func = coder.functionsNameSort[funcIdx];
    if (!func) return 0;
    const mainCode = coder.code.slice(...coder.mainFunctionIdx);
    const one = crc32(func.code);
    const len = Math.floor(mainCode.length / 100);
    const two = crc32(mainCode.substr(len * sliceMul, len));
    return (one ^ two) & 65535;
}
```

### 关键踩坑
1. **gren(0) 的 IIFE 参数**: 用**全局 opmate**, 不是局部 opmate
2. **while(1) 中的 _$aw**: 也用全局 opmate
3. **var 声明**: 用 mate index 1, 不是 mate index 2
4. **hasDebug**: 每个 gren 段重建 debugger PRNG (seed=nsd), posis 累积
5. **_ifElse 递归**: start 变量在 for 中被修改, else 分支用修改后的 start
6. **escape 序列**: 用 `new Function('return "' + str + '"')()` 而非 JSON.parse

### 验证标准
`Coder 输出 eval 代码` === `vm.runInContext(mainjs) 的 eval 输出`, 逐字节一致

---

## 阶段 4: basearr 站点适配 (每站点, ~1小时)

### 输入
sdenv 参考 basearr + keys + codeUid + 环境参数

### 输出
`buildBasearr(config, keys) → basearr`

### 核心方法论: 数据驱动逆向

> **这是整个逆向中最重要的方法论**: 不试图理解内层 VM 的代码逻辑, 而是通过多次采集真实数据, 对比找规律。
> 内层 VM 有 740 个 state, 三层嵌套, 读代码是浪费时间。读数据才是正确方法。

#### 数据驱动三步法

**第 1 步: 采集参考数据**
用 sdenv 运行目标站点, 通过 VM 注入解密 Cookie T, 提取真实 basearr:
```
sdenv 运行 → 捕获 Cookie T → 纯算解密 (decryptCookieT) → 真实 basearr (159B)
```
每次运行都采集: basearr + keys[0..44] + nsd + cd

**第 2 步: 多 session 对比**
采集 3-5 个 session, 把每个 TLV 字段拆开, 逐字节标注:
- **固定** = 所有 session 相同的字节 → 直接硬编码
- **来自 keys** = 和某个 keys[N] 的 parseInt 值匹配 → 动态提取
- **时间相关** = 随时间变化但有规律 → 找公式
- **随机** = 每次都不同且无规律 → 用 Math.random
- **未知** = 不匹配以上任何来源 → 需要更深入分析

**第 3 步: 逐字段实现并验证**
每实现一个字段, 就和参考 basearr 对比, 确认匹配后再做下一个:
```javascript
// 逐字段对比工具
let pos1 = 0, pos2 = 0;
while (pos1 < generated.length && pos2 < refBasearr.length) {
    const t1 = generated[pos1], l1 = generated[pos1+1];
    const t2 = refBasearr[pos2], l2 = refBasearr[pos2+1];
    const d1 = generated.slice(pos1+2, pos1+2+l1);
    const d2 = refBasearr.slice(pos2+2, pos2+2+l2);
    let diffCount = 0;
    for (let i = 0; i < Math.min(d1.length, d2.length); i++) if (d1[i] !== d2[i]) diffCount++;
    console.log('type=' + t1 + ': ' + (diffCount === 0 ? '✅' : '❌ ' + diffCount + ' bytes differ'));
    pos1 += 2 + l1; pos2 += 2 + l2;
}
```

#### 真实案例: type=2 的数据驱动破解过程

这是数据驱动方法论的完美案例 — 从完全不理解到完全解决:

**第 1 步: 发现问题**
- basearr 中 type=2 是 4 字节: `[103, 181, 101, 224]`
- 看起来像常量, 但换 session 后变成 `[181, 101, 103, 224]`
- 总是 {101, 103, 181, 224} 的某种排列, 但规则不明

**第 2 步: 尝试 rs-reverse 的公式 (失败)**
rs-reverse 用 `idx * 7 + 6` 公式从 r2mka 任务树计算:
```
task = r2mka("U250200532")[0]
mapping: cp[1][task.taskori[idx*7+6]] → values[idx]
```
我们实现了 r2mka 解析器, 但暴力搜索 407 个节点中 93 个候选, **0 个能匹配**。
原因: `idx*7+6` 是 rs-reverse 特定 mainjs 版本的步长, 不同版本步长不同。

**第 3 步: 反思方法论**
rs-reverse 怎么找到 `idx*7+6` 的? 不是静态分析 — 是**运行时观察** VM 实际访问了 task 的哪些位置。他们的公式是经验总结, 不是通用算法。

**第 4 步: 转向数据驱动**
既然 type=2 只有 4 字节, 20 个候选值, 换个思路:
1. 用 sdenv 采集 5 个 session
2. 每个 session 记录: type=2 值 + keys[29..32] 变量名 + nsd

**第 5 步: 采集数据**
```
Session 1: type=2=[181,224,103,101] keys[29..32]=[_$b7,_$$F,_$f3,_$gt] nsd=84277
Session 2: type=2=[181,224,103,101] keys[29..32]=[_$$i,_$bs,_$et,_$_c] nsd=91234
Session 3: type=2=[181,224,103,101] keys[29..32]=[_$_p,_$f3,_$eh,_$fN] nsd=76521
```

**第 6 步: 发现规律**
- type=2 值**完全固定**: 始终是 [181, 224, 103, 101]
- keys[29..32] 变量名每次不同 (因为 nsd 不同 → grenKeys 洗牌不同)
- 但变量名在 cp1=grenKeys(918, nsd) 中的**索引是固定的**: [11, 5, 23, 8]

**第 7 步: 建立映射**
```
cp1[11] → 103
cp1[5]  → 101
cp1[23] → 224
cp1[8]  → 181
```
不管 nsd 怎么变, 这个索引→值的映射不变 (对同一 mainjs 版本)。

**第 8 步: 实现**
```javascript
function buildType2(config, keys) {
    const cp1 = config._cp1; // grenKeys(keynameNum, nsd)
    const map = {11: 103, 5: 101, 23: 224, 8: 181};
    return [29, 30, 31, 32].map(i => {
        const name = ascii2string(keys[i]);
        const idx = cp1.indexOf(name);
        return map[idx] || 0;
    });
}
```

**第 9 步: 验证 → 200 ✅**

**教训**:
- rs-reverse 的公式不通用, 不要照搬
- 数据驱动比代码分析更可靠: 5 session 采集 → 10 分钟解决, 而 r2mka 解析 → 花了 1 天还失败
- 当你不知道算法但知道输入输出时, 多采几组数据找规律

#### basearr 中每个字段的数据驱动分析模式

对所有 TLV 字段都可以用同样的方法:

| 字段 | 固定字节 | keys 相关 | 时间相关 | 随机 | 需要计算 |
|------|---------|----------|---------|------|---------|
| type=3 (73B) | [0..7] UA hash, [57..60] path hash, 大部分固定 | 无 | [19..21] elapsed | [22..23] randomAvg | CRC32(UA), CRC32(path) |
| type=10 | [0]=3, [1]=13 | [2..5] keys[21], [6..9] keys[19], [18] keys[24] | [10..17] random+time | 高20位随机 | numToNumarr8 |
| type=7 (12B) | [0..7] 固定 | 无 | 无 | 无 | [8..9] flag (从 ref 读), [10..11] codeUid |
| type=0 | 全固定 | — | — | — | — |
| type=6 (16B) | [0..4] 固定 | [6+] keys[22] AES 解密 | 无 | 无 | AES-CBC 解密 |
| type=2 (4B) | 无 | keys[29..32] → cp1 索引 | 无 | 无 | 映射查表 |
| type=9 | 全固定 | — | — | — | — |
| type=13 | 全固定 | — | — | — | — |

### TLV 格式
```
[type, length, ...payload, type, length, ...payload, ...]
```

### 通用字段实现

#### type=3: 环境指纹
```javascript
function buildType3(config) {
    return [
        1,                                              // 子类型
        config.maxTouchPoints || 0,                     // 触摸点 (桌面=0)
        33,                                             // eval.toString().length
        128,                                            // 固定
        ...numToNumarr4(crc32(config.userAgent)),       // UA hash
        config.platform.length, ...toAscii(config.platform), // platform
        ...numToNumarr4(config.execNumberByTime || 1600),    // 循环计数
        ...(config.randomAvg || [50, 8]),                    // 随机均值/方差
        0, 0,                                           // 固定
        ...numToNumarr4(16777216),                      // 固定值
        ...numToNumarr4(0),
        ...numToNumarr2(config.innerHeight || 768),
        ...numToNumarr2(config.innerWidth || 1024),
        ...numToNumarr2(config.outerHeight || 768),
        ...numToNumarr2(config.outerWidth || 1024),
        ...new Array(8).fill(0),                        // canvas/WebGL (无检测=0)
        ...numToNumarr4(4),                             // 固定
        ...numToNumarr4(0),
        ...numToNumarr4(crc32(config.pathname.toUpperCase())), // URL hash
        ...numToNumarr4(0),
    ];
}
```

#### type=10: 时间+网络
```javascript
function buildType10(config, keys) {
    const ascii = a => String.fromCharCode(...a);
    const r2t = parseInt(ascii(keys[21]));
    const k19 = parseInt(ascii(keys[19]));
    const hostname = config.hostname.substring(0, 20);
    const random20 = Math.floor(Math.random() * 1048575);
    const currentTime = (config.currentTime || Date.now()) & 0xFFFFFFFF;
    return [
        3, 13,                                      // 标志
        ...numToNumarr4(r2t + (config.runTime - config.startTime)), // 修正时间
        ...numToNumarr4(k19),                       // keys[19]
        ...numToNumarr8(random20 * 4294967296 + (currentTime >>> 0)), // 随机+时间
        parseInt(ascii(keys[24])) || 4,             // 标志
        hostname.length, ...toAscii(hostname),      // hostname
    ];
}
```

#### type=7: 标识
```javascript
function buildType7(config) {
    return [
        1, 0, 0, 0,  0, 0, 0, 0,            // 固定
        ...numToNumarr2(config.flag || 2830), // 站点特定 flag (从 ref basearr 读取)
        ...numToNumarr2(config.codeUid || 0), // codeUid
    ];
}
```

#### type=6: keys[22] AES 解密
```javascript
function buildType6(config, keys) {
    const ascii = a => String.fromCharCode(...a);
    const decoded = decodeCd(ascii(keys[22])); // 用 BASESTR 解码
    const iv = Buffer.from(decoded.slice(0, 16));
    const ct = Buffer.from(decoded.slice(16));
    const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[16]), iv);
    let plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    const bytes = [...plain];
    // UTF-8 解码
    let str = ''; let i = 0;
    while (i < bytes.length) {
        if (bytes[i] < 128) str += String.fromCharCode(bytes[i++]);
        else if (bytes[i] < 224) { str += String.fromCharCode(((bytes[i++]&31)<<6)|(bytes[i++]&63)); }
        else { str += String.fromCharCode(((bytes[i++]&15)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63)); }
    }
    const val = parseInt(str) || 0;
    return [
        1, 0, 0, 0, 0,
        config.documentHidden ? 0 : 1,
        ...bytes,
        ...numToNumarr2(val),
    ];
}
```

#### type=2: 会话映射 (数据驱动)
```javascript
function buildType2(config, keys) {
    // 固定值查找表 (从 rs-reverse 提取, 20 项循环)
    const VALUES = [103,0,102,203,224,181,108,240,101,126,103,11,102,203,225,181,208,180,100,127];
    const cp1 = config._cp1; // grenKeys(keynameNum, nsd) 的结果
    if (!cp1) return [103, 101, 224, 181]; // 无 cp1 时的 fallback

    const ascii = a => String.fromCharCode(...a);
    const result = [];
    for (const keyIdx of [29, 30, 31, 32]) {
        const varName = ascii(keys[keyIdx]);
        const cp1Idx = cp1.indexOf(varName);
        result.push(cp1Idx >= 0 && cp1Idx < VALUES.length ? VALUES[cp1Idx] : 0);
    }
    return result;
}
```

**type=2 适配新站点**: 用 sdenv 采集 5+ session, 记录 keys[29..32] 变量名和 type=2 值, 建立 cp1 索引→值的映射表。

#### 最终组装
```javascript
function buildBasearr(config, keys) {
    const t3 = buildType3(config);
    const t10 = buildType10(config, keys);
    const t7 = buildType7(config);
    const t6 = buildType6(config, keys);
    const t2 = buildType2(config, keys);
    return [
        3, t3.length, ...t3,
        10, t10.length, ...t10,
        7, t7.length, ...t7,
        0, 1, 0,           // type=0
        6, t6.length, ...t6,
        2, t2.length, ...t2,
        9, 2, 8, 0,        // type=9 (站点特定, 有的是 5B)
        13, 1, 0,          // type=13
    ];
}
```

### 适配新站点的步骤
1. 用 sdenv 获取参考 basearr, 解析 TLV 结构
2. 逐字段对照: 哪些是固定值? 哪些来自 keys? 哪些是时间/随机?
3. 从参考 basearr 读取: flag (type=7[8..9]), type=9 格式
4. 对照 type=3 结构 (长度/字段数因站点而异)
5. 采集 5 session 反推 type=2 映射
6. 验证 → 200

**预计工时: ~1 小时**

---

## 阶段 5: 端到端验证

### 完整流程
```javascript
// 1. HTTP GET → 412 + cd + nsd + Cookie S
// 2. HTTP GET mainjs URL → mainjs 源码
// 3. extractKeys(cd) → keys
// 4. new Coder(nsd, cd, mainjs).run() → eval 代码 + codeUid
// 5. buildBasearr(config, keys) → basearr
// 6. generateCookie(basearr, keys) → Cookie T
// 7. HTTP GET with Cookie S + Cookie T → 200
```

### 验证标准
连续运行 3+ 次, 全部 200

### mainjs 版本变化处理
- Coder 通常不需要改 (opcode 结构不变)
- basearr 可能需要重新适配 (字段数量/顺序可能变)
- type=2 映射可能变 (需要重新采集)
- codeUid 自动重新计算

---

## 阶段 6: URL 后缀 (POST 请求) — AST 深度逆向已完成

### 现状
- **POST 请求不需要后缀** (商标站点 202.127.48.145:8888, 验证通过)
- **99% 的瑞数站点 POST 不需要后缀**, 只需 Cookie S + Cookie T
- **GET 请求 80% 不需要后缀**
- 需要后缀的站点 (如药监局 nmpa.gov.cn), JsRpc 方案已通杀
- 纯算后缀的 AST 逆向已大幅推进, 卡在 VM 字节码层面的 49B session

### 后缀结构 (AST 验证: 88B / 120B)
```
原始: /api/action.do
实际: /api/action.do?8h6a7FPl=0R5Hmral...
                      ^^^^^^^^ ^^^^^^^^^^
                      参数名    "0" + URL-safe Base64

88B (无 search):
[0-3]   4B nonce        随机 (Math.random × 4)
[4]     1B flag = 1     固定
[5]     1B = 0x6a       站点标记 (匹配参数名 "8h6a7FPl" 中的 "6a")
[6-54]  49B session     Cookie S 解密 (VM 字节码内部计算, 同 session 固定)
[55]    1B marker       0x20(无search) / 0x40(有search)
[56-87] 32B sig32       行为统计数据编码 (鼠标/键盘)

120B (有 search):
[0-87]  同上 88B
[88-119] 32B searchSig  search 部分的 SHA-1 签名

编码: "0" + URLSafeBase64(bytes)
      URL-safe: + → .   / → _   无 padding
```

参数名来自 `keys[7].split(';')[1]`

### 后缀生成流程 (AST 追踪确认)

```
1. XHR.open 被瑞数 hook 拦截
2. createElement('a') 解析 URL → pathname, search
     └─ AST 追踪: _$bs 内部通过字符串表访问
        _$dn[13]="pathname", _$dn[85]="search", _$dn[32]="hostname"
        _$jO[86]="protocol", _$jO[59]="href"
3. r2mKa VM 字节码执行 child[29] (后缀总装函数):
   a. 构建 result = [flag]
   b. 拼入 session 49B (VM 初始化时从 Cookie S 解密并缓存)
   c. 获取 marker + 32B 行为统计签名
   d. XOR 编码 URL pathname 数据
   e. 经过 child[37] 字节变换 + G[89]/G[108] 数据重组
   f. Base64 编码
4. 后缀追加到 URL: ?paramName=0xxx...
5. 调用原始 XHR.open
```

### 32B 签名 = 行为统计数据 (AST 破解)

AST 分析确认 32B 不是加密/哈希, 而是鼠标/键盘行为数据的变长编码:
```
writeU8(flags)              1B      事件标志
writeVarLen(mouseX) × 11    11-22B  鼠标位移/速度/方向
writeU16(avgKeyInterval)    2B      平均键盘间隔
writeU32(xOffset/yOffset/distance) × 3  12B  偏移和距离
```

### SHA-1 签名 (AST 关键发现)

通过 AST 搜索 rt[67] 常量表, 确认后缀签名使用 SHA-1 (不是 XTEA/AES):
```
SHA-1 常量 (rt[67] 中全部 9 个):
  H0-H4: 1732584193, 271733878, ... (初始哈希值)
  K0-K3: 1518500249, 1859775393, 3337565984, 3395469782 (轮常数)

SHA-1 函数 (AST 定位):
  _$kw() (L1222): SHA-1 core (constructor/update/finalize/transform)
  _$fJ() (L2968): SHA-1 instance (重置 H 值)
  _$gA(...args) (L2972): SHA-1 hash 截断为 16B
  _$id(data) (L2979): 完整 20B SHA-1
```

### AST 逆向已完成的成果

| 成果 | 说明 | AST 工具 |
|------|------|----------|
| 后缀结构 88B/120B | 100% 确认, 多次 hook 验证 | ast_suffix_structure.js |
| rt[239] = _$bs (15KB) | 后缀核心函数, 56 个子函数完整拆解 | ast_trace_rt239.js + ast_deep_bs.js |
| 32B 签名 = 行为统计 | 鼠标位移/速度/方向/键盘事件编码 | ast_deep_bs.js |
| SHA-1 签名函数 | 4 个 SHA-1 函数精确定位 | ast_find_xtea_huffman.js |
| createElement('a') URL 解析 | pathname/search 通过字符串表访问 | ast_suffix_structure.js |
| 440 个 rt[N] 完整映射 | 函数名/参数/vmCall ID | ast_verify_all.js |
| 409 个 VM opcodes | 从 _$_I (34KB) + _$gF (8KB) 提取 | ast_extract_opcodes.js |
| Cookie S 管理器 | child[59] 52 个子函数自动翻译 1653 行 | ast_r2mka_disasm.js + ast_bytecode_to_js.js |
| Cookie S 解密链 | AES 解密 6 函数 + 7 核心函数翻译 | ast_session_chain.js + ast_cookie_s_complete.js |
| child[40] TLV 解析器 | 14 数据段 (hash/huffman/slice/vmCall) | ast_translate_child40.js |
| child[59] 反汇编 | 6328 行完整反汇编 | ast_r2mka_disasm.js |
| 49B session 追踪 | Cookie S → Huffman → XTEA → 49B 路径 | ast_trace_session49.js + ast_trace_49b.js |

### 卡在的地方 (VM 字节码层面, AST 无法触及)

| 问题 | 原因 |
|------|------|
| **49B session** | 在 r2mKa VM 字节码内部计算, 不经过 eval code JS 函数 |
| **后缀中间变换** | child[37] + G[89] + G[108] 三步变换在 VM 内部 |
| **Cookie S → 49B** | Cookie S 是 HttpOnly, 解密在 VM 初始化时完成 |

**根本原因**: 后缀的核心计算在 r2mKa VM 字节码中执行, 不调用任何外部 JS 函数。AST 能分析 eval code 的 JS 函数, 但 VM 字节码是在 JS 层面之下的另一层抽象。

### 当前可用方案

#### 方案 1: JsRpc (通杀, 推荐)
```javascript
// jsrpc/ — 已验证通杀商标站点 + 药监局
// 浏览器注入 inject.js → WebSocket → server.js 中转 → client.js 调用
```

#### 方案 2: sdenv VM 内 XHR
```javascript
// POST 请求通过 VM 内的 XHR 发送, 后缀自动加
const xhr = new dom.window.XMLHttpRequest();
xhr.open('POST', path, true);
xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
xhr.send('key=value');
// → URL 自动带后缀, 服务器返回 200
```
**限制**: 单个 sdenv 实例只能发一次 POST (Math.random 变 undefined), 每次 POST 需重新 init()

#### 方案 3: 纯算客户端 (不需要后缀的站点)
```javascript
// revers/scripts/client.js — 已验证完美工作
const { RuishuPureClient } = require('./revers/scripts/client.js');
const client = new RuishuPureClient();
await client.init();
const result = await client.post('/searchAction!getVRecordListPage.do', data);
```

### 纯算后缀的后续方向 (如果需要完成)
1. **构建 mini r2mKa VM 解释器** — 用 opcodes.json (409个) + r2mka_parsed.json 直接执行字节码
2. **mock 最小浏览器环境** — 只需 document.cookie, location, createElement('a')
3. **目标**: 执行 child[59] → 49B, 执行 child[29] → 后缀
4. **已有基础**: 反汇编器 + 翻译引擎 + 52 子函数翻译 + TLV 解析器

---

## 弯路警告 (来自真实经验)

### ❌ 不要反编译内层 VM (浪费 2 天的教训)
740 个 state、三层嵌套、排列映射。我们花了 2 天试图理解它 — **完全浪费时间**。
basearr 的每个字节都可以通过数据对比找到来源, 不需要读 VM 代码。
rs-reverse 也从不碰内层 VM — 他们用数据驱动方法。

**反面教材**: 我们追踪了 fn=161 (Huffman) 的 161 条字节码, fn=206 (Base64) 的 206 条字节码, 实现了 114 个操作码反汇编器, 产出 5037 行反汇编代码。完全理解了架构, 但对解决 basearr **毫无帮助**。

**正确做法**: 用 sdenv 采集 5 组真实 basearr → 逐字节对比 → 10 分钟找到每个字节的来源。

### ❌ 不要补环境跑 eval 代码
`document.all` 需要 C++ V8 Addon (MarkAsUndetectable), 纯 JS 做不到。不完整环境产出不完整 basearr (84B vs 159B)。

### ❌ 不要硬编码 type=2
type=2 和 nsd 相关 (cp1 洗牌), 每个 session 的 keys[29..32] 变量名不同。
**但**: cp1 索引是固定的! 用数据驱动采集 5 session 就能发现。

### ❌ 不要假设 rs-reverse 的公式通用
`idx*7+6`, `flag: 4114` 等是特定版本/站点参数。
我们实现了 r2mka 解析器, 暴力搜索 407 个节点中 93 个候选 — **0 个匹配**。
花了 1 天实现的解析器完全白费。
**转向数据驱动后 10 分钟解决。**

### ❌ 不要跳过混合验证
先证明加密链正确 (sdenv basearr + 纯算加密 = 200), 再做 basearr。
否则 400 了不知道是加密错还是 basearr 错 — 浪费大量调试时间。

### ✅ 正确的逆向顺序
```
1. sdenv 跑通 (保底)
2. 混合验证加密链 (sdenv basearr + 纯算加密 = 200, 证明加密正确)
3. 密钥纯算提取 (从 cd 提取 keys, 和 sdenv 提取的对比验证)
4. Coder 重写 (参照 rs-reverse, 逐字节对比调试)
5. basearr 数据驱动适配 (采集 5 session, 逐字段匹配来源)
6. 端到端验证 (纯算全链路 → 200)
```

### ✅ AST 是分析 eval code / 后缀的正确方法 (节省数周的经验)

**正面教材**: 后缀逆向中, 我们用 14 个 AST 工具在 ~20h 内完成了以下成果:
- 从 296KB 混淆代码中定位 rt[239] (15KB 后缀核心), 拆解 56 个子函数
- 发现后缀签名用 SHA-1 (推翻了 XTEA/AES 的错误假设)
- 破解 32B 签名 = 行为统计数据编码 (不是加密)
- 提取 Cookie S 管理器 52 个子函数, 自动翻译 1653 行
- 追踪 createElement('a') → pathname/search → XOR 编码的完整数据流

**如果没有 AST, 手工在 296KB 混淆代码中找这些 = 不可能完成的任务。**

eval code 虽然变量名被混淆, 但它是合法的 JS — AST 解析器能完整理解其结构。这是 JSVMP 保护中唯一可以被自动化分析的层面。

**适用场景判断**:
```
目标在 eval code JS 层面 → 用 AST (函数追踪/特征搜索/调用链分析)
目标在 basearr 数据层面  → 用数据驱动 (多 session 对比)
目标在 r2mKa VM 字节码   → 用反汇编器 (AST 提取的 opcodes)
```

### ✅ 遇到任何不理解的字节时
```
basearr/Cookie T 场景:
  不要: 读 VM 代码 → 理解算法 → 实现 (耗时且可能走错方向)
  要:   采集 5 组数据 → 逐字节对比 → 找规律 → 实现 (快速且可靠)

后缀/eval code 场景:
  不要: 手工搜索 296KB 混淆代码 (大海捞针)
  要:   AST 解析 → rt[N] 映射 → 调用链追踪 → 特征搜索 (精确高效)
```

---

## 通用 vs 站点适配

### 通用 (所有站点自动适配)
- PRNG: 15679 / 2531011
- Huffman: 0→45, 255→6, 其余→1
- AES-128-CBC, CRC32 (0xEDB88320)
- Base64 字母表, getLine 乘数 55295
- keys 提取 (假设 keys[0]="64" + 自检)
- Coder 外层 VM 重写
- codeUid 算法
- Cookie 名: `keys[7].split(';')[5] + 'T'`

### 站点适配 (每站点 ~1 小时)
| 项 | 适配方法 |
|---|---------|
| HOST/PORT/PATH | 改目标 URL |
| flag (type=7[8..9]) | 从 sdenv 参考 basearr 读取 |
| type=2 映射 | 5+ session sdenv 采集反推 |
| type=9 格式 (2B 或 5B) | 从 sdenv 参考 basearr 读取 |
| type=3 内部结构 | 从 sdenv 参考 basearr 对照 |
| hasDebug | 观察 eval 代码是否有 debugger |
| lastWord (T 或 P) | 从浏览器 cookie 名观察 |

### 有隐患但目前可用
| 项 | 隐患 | 通用方案 |
|---|------|---------|
| keys XOR 偏移 | 某些站点 keys[0]≠"64" | r2mka runTask (难度高) |
| type=2 映射 | mainjs 更新后可能变 | r2mka fixedValue20 (需 runTask) |

---

## 工具依赖

| 工具 | 用途 | 阶段 |
|------|------|------|
| sdenv | 参考数据 + POST 后缀 | 0, 4, 6 |
| Node.js crypto | AES 加解密 | 1 |
| js-beautify | 格式化 mainjs (可选) | 3 |

**最终纯算脚本只依赖 Node.js crypto + http, 无第三方库。**

---

## 附录 A: VM 底层注入技术手册

> 以下是在逆向过程中验证有效的 7 种 VM 注入技术。用于阶段 1 追踪加密管线、阶段 4 采集参考数据。

### A.1 vm.runInContext 拦截 — 捕获/修改 eval 代码

**最基础的 hook, 所有其他注入的入口点。**

```javascript
const vm = require('vm');
const origRunInContext = vm.runInContext;
vm.runInContext = function(code, context, options) {
    if (typeof code === 'string') {
        // 小代码块: $_ts 初始化脚本 (含 cd)
        if (code.includes('$_ts.cd=') && code.length < 5000) {
            const m = code.match(/\$_ts\.cd="([^"]+)"/);
            if (m) console.log('[captured] cd:', m[1].length, 'chars');
        }
        // 大代码块: eval 代码 (>250KB), 可以注入 hook
        if (code.length > 250000) {
            console.log('[captured] eval code:', code.length, 'chars');
            code = injectHooks(code); // 在执行前修改代码
        }
    }
    return origRunInContext.call(this, code, context, options);
};
```

**用途**: 捕获 eval 代码, 提取 cd/nsd, 在 eval 代码中注入追踪代码
**时机**: 在调用 sdenv 的 jsdomFromUrl 之前设置

### A.2 Object.defineProperty Cookie 劫持 — 捕获 Cookie 写入

**劫持 document.cookie 的 setter, 精确捕获 Cookie T 生成时刻。**

```javascript
// 注入到 eval 代码最前面
const COOKIE_HOOK = `
(function(){
    var _desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (!_desc) return;
    Object.defineProperty(Document.prototype, 'cookie', {
        get: function() { return _desc.get.call(this); },
        set: function(val) {
            if (val.indexOf('T=0') > -1) {
                // 捕获到 Cookie T!
                console.log('__CT__' + val.split('=')[1].split(';')[0]);
            }
            return _desc.set.call(this, val);
        },
        configurable: true
    });
})();
`;
```

**用途**: 捕获 Cookie T 最终值, 触发后续数据导出
**注意**: 只捕获包含 'T=0' 的写入, 避免噪音

### A.3 逗号表达式注入 — 零侵入式函数监控

**在不改变代码结构和返回值的前提下, 在表达式中间插入监控代码。**

```javascript
// 原代码:
//   _$gW(_$d0, 0, _$d0._$hn.length, _$_l)
// 注入后:
//   (console.log('gW fn=' + _$d0._$hn.length), _$gW(_$d0, 0, _$d0._$hn.length, _$_l))

// 原代码:
//   return _$cR[506](_$ar)
// 注入后:
//   return (console.log('l506 in=' + _$ar.length), _$cR[506](_$ar))

// 实现: 字符串替换
code = code.replace(
    '_$gW(_$d0,0,_$d0._$hn.length,_$_l)',
    '(console.log("gW fn="+_$d0._$hn.length),_$gW(_$d0,0,_$d0._$hn.length,_$_l))'
);
```

**优点**: 不改变控制流和返回值, 最安全的注入方式
**用途**: 追踪内层 VM 函数调用, 记录函数 ID 和参数

### A.4 函数体替换 — 包装已知签名的函数

**找到精确的函数定义, 替换为带监控的版本。**

```javascript
// 找到 State 324 入口函数
const target = 'function _$hr(){var _$jZ=[324];';
const pos = code.indexOf(target);
if (pos > -1) {
    // 找到函数体结尾
    const retPos = code.indexOf('return _$dm.apply(this,_$jZ);', pos);
    const endPos = code.indexOf('}', retPos) + 1;
    
    // 替换为带监控版本
    code = code.substring(0, pos) + `function _$hr(){
        // 捕获输入 (basearr)
        if (arguments[0] && arguments[0].length > 10) {
            console.log('__BASEARR__' + JSON.stringify(Array.from(arguments[0])));
        }
        __phase = '324'; // 设置阶段标记
        var _$jZ = [324];
        Array.prototype.push.apply(_$jZ, arguments);
        var _r = _$dm.apply(this, _$jZ);
        __phase = 'idle';
        return _r;
    }` + code.substring(endPos);
}
```

**用途**: 追踪加密入口 (State 324), 捕获 basearr 输入
**注意**: 函数名每次加载会变 (混淆), 需要通过特征模式定位

### A.5 阶段标记 (Phase Marker) — 区分执行上下文

**用全局变量标记当前执行阶段, 让其他 hook 只在关键阶段采集数据。**

```javascript
// 在 eval 代码开头声明
var __phase = 'idle';
var __captured = { basearr: null, huffman: null, cipher: null, cookie: null };

// 在 State 324 入口设置
__phase = '324';

// 在 Huffman 函数中检查
// (通过逗号表达式或函数替换)
if (__phase === '324' && !__captured.huffman) {
    __captured.huffman = Array.from(result);
}

// 在 Cookie 写入时导出全部数据
if (val.indexOf('T=0') > -1) {
    __captured.cookie = val;
    console.log('__CAPTURED__' + JSON.stringify(__captured));
    __phase = 'idle';
}
```

**用途**: 避免在非关键阶段 (初始化等) 产生大量噪音日志
**原理**: 加密只在 State 324 执行, 标记后只在这个阶段采集

### A.6 console.log 侧信道导出 — 从 VM 内部提取数据

**sdenv 支持 consoleConfig 回调, 可以通过 console.log 传递结构化数据。**

```javascript
// VM 内注入的代码 (通过 A.1 注入):
console.log('__K__17__' + JSON.stringify(Array.from(keys[17])));
console.log('__BASEARR__' + JSON.stringify(Array.from(basearr)));
console.log('__CT__' + cookieValue);

// sdenv 外部接收:
const captured = {};
const dom = await jsdomFromUrl(url, {
    userAgent: UA,
    consoleConfig: {
        log: function() {
            const msg = Array.from(arguments).join(' ');
            if (msg.startsWith('__K__')) {
                const parts = msg.split('__');
                captured['key_' + parts[2]] = JSON.parse(parts[3]);
            }
            if (msg.startsWith('__BASEARR__')) {
                captured.basearr = JSON.parse(msg.substring(11));
            }
            if (msg.startsWith('__CT__')) {
                captured.cookieT = msg.substring(6);
            }
        },
        error: () => {} // 屏蔽错误输出
    }
});
```

**用途**: 从 sdenv VM 内部提取密钥、basearr、Cookie T 等数据
**优点**: 不需要 window 对象, 纯粹通过 console 通道

### A.7 正则批量函数发现与包装

**当函数名被混淆时, 用正则模式匹配结构特征。**

```javascript
// 发现 CRC32 函数 (通过结构特征)
const crcPattern = /function\s+(_\$\w+)\((\w+)\)\{var\s+\w+,\w+;\s*typeof\s+\2/;
const m = code.match(crcPattern);
if (m) {
    const funcName = m[1];
    // 找到完整函数体
    const start = code.indexOf('function ' + funcName + '(');
    let depth = 0, end = start;
    for (let i = code.indexOf('{', start); i < code.length; i++) {
        if (code[i] === '{') depth++;
        if (code[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const origBody = code.substring(start, end);
    // 包装: 保留原逻辑, 加上输入输出捕获
    code = code.substring(0, start) +
        `function ${funcName}(__arg) {
            if (__phase==='324') console.log('__CRC_IN__'+JSON.stringify(Array.isArray(__arg)?__arg.slice(0,20):__arg));
            var __r = (${origBody})(__arg);
            if (__phase==='324') console.log('__CRC_OUT__'+__r);
            return __r;
        }` + code.substring(end);
}
```

**用途**: 在不知道确切函数名的情况下, 通过代码结构特征定位并包装目标函数

---

## 附录 B: 完整代码模板

### B.1 sdenv 客户端模板 (Cookie + 后缀)

```javascript
/**
 * 瑞数 sdenv 客户端 — Cookie + URL 后缀自动生成
 * 用法: node sdenv_client.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const { jsdomFromUrl } = require('sdenv');
const http = require('http');

const CONFIG = {
    host: 'TARGET_HOST',
    port: 80,
    entryPath: '/TARGET_PATH',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
};

class RuishuClient {
    constructor(config = {}) {
        this.config = { ...CONFIG, ...config };
        this.dom = null;
        this.cookies = '';
        this.ready = false;
    }
    get baseUrl() { return `http://${this.config.host}:${this.config.port}`; }

    async init() {
        const url = `${this.baseUrl}${this.config.entryPath}`;
        this.dom = await jsdomFromUrl(url, {
            userAgent: this.config.userAgent,
            consoleConfig: { error: () => {} },
        });
        await new Promise(resolve => {
            this.dom.window.addEventListener('sdenv:exit', () => resolve());
            setTimeout(resolve, 8000);
        });
        this.cookies = this.dom.cookieJar.getCookieStringSync(this.baseUrl);
        this.ready = true;
        return this;
    }

    // GET: 只需 Cookie (不需要后缀)
    async get(path) {
        if (!this.ready) throw new Error('先调用 init()');
        return new Promise((resolve, reject) => {
            http.request({
                hostname: this.config.host, port: this.config.port,
                path, method: 'GET',
                headers: { 'User-Agent': this.config.userAgent, 'Cookie': this.cookies },
            }, res => {
                let body = ''; res.on('data', c => body += c);
                res.on('end', () => resolve({ status: res.statusCode, body }));
            }).on('error', reject).end();
        });
    }

    // POST: 通过 VM 内 XHR 发送 (自动加后缀)
    async post(path, data) {
        if (!this.ready) throw new Error('先调用 init()');
        const w = this.dom.window;
        return new Promise((resolve, reject) => {
            const xhr = new w.XMLHttpRequest();
            xhr.open('POST', path, true);
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) resolve({ status: xhr.status, body: xhr.responseText });
            };
            xhr.onerror = () => reject(new Error('XHR error'));
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            if (typeof data === 'object') {
                xhr.send(Object.entries(data).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'));
            } else {
                xhr.send(data || '');
            }
            setTimeout(() => { if (xhr.readyState !== 4) reject(new Error('超时')); }, 30000);
        });
    }

    close() {
        if (this.dom) { this.dom.window.close(); this.dom = null; this.ready = false; }
    }
}

// 注意: 单个 sdenv 实例只能发一次 POST, 每次 POST 后需要 close() + init()
module.exports = { RuishuClient, CONFIG };
```

### B.2 参考数据采集模板 (sdenv + VM 注入)

```javascript
/**
 * 参考数据采集: sdenv 运行 + VM 注入 → 提取 basearr + keys
 * 用于阶段 0 和阶段 4 的数据驱动适配
 */
const vm = require('vm');
const crypto = require('crypto');
const { jsdomFromUrl } = require('sdenv');

const URL = 'http://TARGET_HOST/TARGET_PATH';
const UA = 'Mozilla/5.0 ...';
const BASESTR = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';

// --- decodeCd, extractKeys 函数 (见阶段 2) ---

let capturedCd = null;

// Hook vm.runInContext 捕获 cd
const origRun = vm.runInContext;
vm.runInContext = function(code, ctx, opts) {
    if (typeof code === 'string' && code.includes('$_ts.cd=') && code.length < 5000) {
        const m = code.match(/\$_ts\.cd="([^"]+)"/);
        if (m) capturedCd = m[1];
    }
    return origRun.call(this, code, ctx, opts);
};

async function collect() {
    const dom = await jsdomFromUrl(URL, { userAgent: UA, consoleConfig: { error: () => {} } });
    await new Promise(r => { dom.window.addEventListener('sdenv:exit', r); setTimeout(r, 8000); });

    // 提取 Cookie T
    const cookies = dom.cookieJar.getCookieStringSync(URL);
    const cookieT = cookies.match(/T=([^;]+)/)?.[1];

    // 提取 keys
    const keys = extractKeys(capturedCd);

    // 解密 Cookie T → basearr
    const basearr = decryptCookieT(cookieT, keys);

    // 解析 TLV
    let pos = 0;
    while (pos < basearr.length) {
        const type = basearr[pos], len = basearr[pos+1];
        const payload = basearr.slice(pos+2, pos+2+len);
        console.log(`type=${type}, len=${len}, payload=[${payload.slice(0,20).join(',')}${len>20?'...':''}]`);
        pos += 2 + len;
    }

    dom.window.close();
    return { cd: capturedCd, keys, basearr, cookies };
}

// Cookie T 解密函数
function decryptCookieT(cookieT, keys) {
    // 1. 去前缀 "0", Base64 解码
    const encoded = cookieT.substring(1);
    const bytes = b64Dec(encoded);
    // 2. 分离 IV + 密文, AES 外层解密
    const iv = Buffer.from(bytes.slice(0, 16));
    const ct = Buffer.from(bytes.slice(16));
    const dec1 = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[16]), iv);
    const outer = [...Buffer.concat([dec1.update(ct), dec1.final()])];
    // 3. 去 PKCS7 padding
    const pad = outer[outer.length - 1];
    const unpadded = outer.slice(0, outer.length - pad);
    // 4. 提取 CRC + packet
    const packet = unpadded.slice(4); // 前 4 字节是 CRC
    // 5. 提取 cipher (跳过 header: 2+8+48+lenEnc)
    let p = 2 + 8 + 1 + 48; // [2, 8, nonce(8B), 48, keys48(48B)]
    const cipherLen = packet[p] < 128 ? packet[p++] : ((packet[p++] & 0x7F) << 8) | packet[p++];
    const cipher = packet.slice(p, p + cipherLen);
    // 6. AES 内层解密
    const dec2 = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[17]), Buffer.alloc(16, 0));
    const inner = [...Buffer.concat([dec2.update(Buffer.from(cipher)), dec2.final()])];
    const pad2 = inner[inner.length - 1];
    const huffman = inner.slice(0, inner.length - pad2);
    // 7. XOR 还原
    for (let i = 0; i < 16 && i < huffman.length; i++) huffman[i] ^= keys[2][i];
    // 8. Huffman 解码 → basearr
    return huffDecode(huffman);
}

collect().then(data => {
    const fs = require('fs');
    fs.writeFileSync('ref_session.json', JSON.stringify(data, null, 2));
    console.log('采集完成');
});
```

### B.3 纯算全流程模板 (零依赖)

```javascript
/**
 * 瑞数 Cookie T 纯算生成 — 全动态, 零本地依赖
 * 用法: node pure_run.js
 */
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = 'TARGET_HOST', PORT = 80;
const PATH = '/TARGET_PATH';
const UA = 'Mozilla/5.0 ...';

// --- 以下函数从阶段 1-4 的实现中复制 ---
// extractKeys(cd)       → 阶段 2
// generateCookie(ba, k) → 阶段 1
// Coder class           → 阶段 3
// buildBasearr(cfg, k)  → 阶段 4

function httpGet(p, cookie) {
    return new Promise((resolve, reject) => {
        const h = { 'User-Agent': UA, 'Host': `${HOST}:${PORT}` };
        if (cookie) h['Cookie'] = cookie;
        http.request({ hostname: HOST, port: PORT, path: p, headers: h }, res => {
            let b = ''; res.on('data', d => b += d);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
        }).on('error', reject).end();
    });
}

async function main() {
    // Step 1: GET → 412
    const r1 = await httpGet(PATH);
    const cd = r1.body.match(/\$_ts\.cd="([^"]+)"/)[1];
    const nsd = parseInt(r1.body.match(/\$_ts\.nsd=(\d+)/)[1]);
    const cookieS = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    // Step 2: 下载 mainjs (缓存)
    const jsUrl = r1.body.match(/src="([^"]+\.js)"/)[1];
    const cache = path.join(__dirname, 'mainjs_cache.js');
    let mainjs;
    if (fs.existsSync(cache)) { mainjs = fs.readFileSync(cache, 'utf-8'); }
    else { mainjs = (await httpGet(jsUrl)).body; fs.writeFileSync(cache, mainjs); }

    // Step 3: 提取 keys
    const keys = extractKeys(cd);
    const cookieName = String.fromCharCode(...keys[7]).split(';')[5] + 'T';

    // Step 4: Coder → codeUid
    const coder = new Coder(nsd, cd, mainjs);
    coder.run();
    const codeUid = computeCodeUid(coder, keys);

    // Step 5: basearr
    const cp1 = grenKeys(coder.keynameNum, nsd);
    const basearr = buildBasearr({
        userAgent: UA, pathname: PATH, hostname: HOST,
        platform: 'Win32', flag: 2830, codeUid,
        execNumberByTime: 1600, randomAvg: [50, 8],
        innerHeight: 768, innerWidth: 1024,
        outerHeight: 768, outerWidth: 1024,
        documentHidden: false, _cp1: cp1,
        runTime: Math.floor(Date.now()/1000),
        startTime: Math.floor(Date.now()/1000) - 1,
        currentTime: Date.now(),
    }, keys);

    // Step 6: 加密
    const cookieT = generateCookie(basearr, keys);

    // Step 7: 验证
    const r2 = await httpGet(PATH, [cookieS, cookieName + '=' + cookieT].join('; '));
    console.log(r2.status === 200 ? '验证通过' : '失败: ' + r2.status);
}

main().catch(console.error);
```

### B.4 混合验证模板 (证明加密链正确)

```javascript
/**
 * 混合验证: sdenv basearr + 纯算加密 = 200
 * 阶段 1 的必过验证, 证明加密链独立于 basearr 正确性
 */
async function hybridVerify() {
    // 1. sdenv 获取真实 Cookie T
    const dom = await jsdomFromUrl(URL, { userAgent: UA });
    // ... 等待完成, 提取 cookies

    // 2. 纯算解密 Cookie T → 提取 basearr
    const realBasearr = decryptCookieT(cookieT, keys);

    // 3. 用真实 basearr + 纯算 generateCookie
    const newCookieT = generateCookie(realBasearr, keys);

    // 4. 验证: 新 Cookie T 也能 200
    const r = await httpGet(PATH, cookieS + '; ' + cookieName + '=' + newCookieT);
    console.log(r.status === 200 ? '加密链验证通过!' : '加密链有误: ' + r.status);

    // 如果通过: 加密链 100% 正确, 可以进入 basearr 适配
    // 如果失败: 加密实现有 bug, 不要继续, 先修加密
}
```

### B.5 type=2 多 Session 采集模板

```javascript
/**
 * 采集 5 session, 反推 type=2 映射规则
 * 用于阶段 4 的站点适配
 */
async function collectType2(sessions = 5) {
    const results = [];
    for (let i = 0; i < sessions; i++) {
        console.log(`Session ${i+1}/${sessions}`);
        const data = await collect(); // 用 B.2 的采集函数
        
        // 解析 type=2
        let pos = 0, type2 = null;
        while (pos < data.basearr.length) {
            const type = data.basearr[pos], len = data.basearr[pos+1];
            if (type === 2) type2 = data.basearr.slice(pos+2, pos+2+len);
            pos += 2 + len;
        }

        // 提取 keys[29..32] 变量名
        const ascii = a => String.fromCharCode(...a);
        const varNames = [29,30,31,32].map(i => ascii(data.keys[i]));
        
        // 在 cp1 中查找索引
        const nsd = parseInt(ascii(data.keys[42]));
        const cp1 = grenKeys(918, nsd); // 或从 mainjs 提取 keynameNum
        const indices = varNames.map(v => cp1.indexOf(v));

        results.push({ nsd, type2, varNames, cp1Indices: indices });
        console.log(`  type=2: [${type2}], cp1 indices: [${indices}]`);

        await new Promise(r => setTimeout(r, 2000)); // 间隔
    }

    // 分析: cp1 索引是否跨 session 固定?
    const allIndices = results.map(r => r.cp1Indices.join(','));
    const unique = [...new Set(allIndices)];
    console.log(unique.length === 1
        ? `cp1 索引固定: [${unique[0]}], 可以建映射表`
        : `cp1 索引变化: ${JSON.stringify(unique)}, 需要更复杂的方法`
    );

    return results;
}
```

---

## 附录 C: 完整参考实现源码

> 以下是已验证通过 (HTTP 200) 的完整源码。新 Claude 实现 Coder 或 basearr 时，应以此为参考，而非从零编写。
> 针对新站点适配时，修改 config 参数和站点特定字段即可。

### C.1 coder.js — 外层 VM 重写器 (362 行, 验证: eval 代码 100% 字节一致)

```javascript
/**
 * 外层 VM 重写 — 基于阅读 mainjs 的 _$cj(75 opcode) + _$g6(55 opcode) 理解后实现
 *
 * 输入: mainjs 源码 + nsd + cd
 * 输出: eval 代码 + r2mkaText + keycodes + keynames + aebi + functionsNameSort + cp3
 */
const fs = require('fs');
const path = require('path');

// === PRNG (mainjs _$ad, line 12) ===
function createScd(seed) {
    let s = seed;
    return () => { s = 15679 * (s & 0xFFFF) + 2531011; return s; };
}

// === Fisher-Yates 洗牌 (mainjs _$lT, line 21) ===
function arrayShuffle(arr, scd) {
    const a = [...arr];
    let len = a.length;
    while (len > 1) { len--; const i = scd() % len; [a[len], a[i]] = [a[i], a[len]]; }
    return a;
}

// === 从 mainjs 提取 4 个最长引号字符串 ===
function extractImmucfg(code) {
    const q = [];
    for (let i = 0; i < code.length; i++) if (code[i] === '"' && (i === 0 || code[i-1] !== '\\')) q.push(i);
    const strs = [];
    for (let i = 0; i < q.length - 1; i += 2) {
        const raw = code.slice(q[i]+1, q[i+1]);
        try { strs.push(JSON.parse('"'+raw+'"')); } catch(e) { try { strs.push(eval('("'+raw+'")')); } catch(e2) { strs.push(raw); } }
    }
    strs.sort((a,b) => b.length - a.length);
    return { globalText1: strs[0], cp0: strs[1], cp2: strs[2], globalText2: strs[3] };
}

// === 变量名生成 (mainjs op 53+21+46) ===
function grenKeys(num, nsd) {
    const chars = '_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const names = [];
    for (let i = 0; i < chars.length && names.length < num; i++)
        for (let j = 0; j < chars.length && names.length < num; j++)
            names.push('_$' + chars[i] + chars[j]);
    return arrayShuffle(names, createScd(nsd));
}

// === 游标读取器 (mainjs _$$1 + _$kx) ===
function textReader(text) {
    let c = 0;
    return {
        getCode() { return text.charCodeAt(c++); },
        getLine(n) { const s = text.substr(c, n); c += n; return s; },
        getList() { const n = text.charCodeAt(c); const d = []; for (let i=0;i<n;i++) d.push(text.charCodeAt(c+1+i)); c+=n+1; return d; },
        pos() { return c; },
    };
}

// === Coder ===
class Coder {
    constructor(nsd, cd, mainjsCode) {
        const imm = extractImmucfg(mainjsCode);
        this.globalText1 = imm.globalText1;
        this.globalText2 = imm.globalText2;
        this.cp0 = imm.cp0;
        this.cp2 = imm.cp2;
        this.nsd = nsd;
        this.cd = cd;
        const knMatch = mainjsCode.match(/_\$[\$_A-Za-z0-9]{2}=_\$[\$_A-Za-z0-9]{2}\(0,([0-9]+),_\$[\$_A-Za-z0-9]{2}\(/);
        this.keynameNum = knMatch ? parseInt(knMatch[1]) : 918;
        this.keynames = grenKeys(this.keynameNum, nsd);
        this.keycodes = [];
        this.scd = createScd(nsd);
        this.aebi = [];
        this.r2mkaText = null;
        this.functionsNameSort = [];
        this.mainFunctionIdx = null;
        this.code = '';
        this.cp3 = 0;
        this.hasDebug = true;
        this._debuggerScd = null;
        this._debuggerPosi = [];
    }

    run() {
        const codeArr = this.parseGlobalText1();
        codeArr.push(this.parseGlobalText2());
        codeArr.push("})(", '$_ts', ".scj,", '$_ts', ".aebi);");
        this.code = codeArr.join('');
        let h = 0; for (let i = 0; i < this.code.length; i += 100) h += this.code.charCodeAt(i);
        this.cp3 = h;
        return this;
    }

    parseGlobalText1() {
        const r = textReader(this.globalText1);
        const { scd, keynames } = this;
        const codeArr = [];
        this._globalMates = {};
        this._globalMates.G_e4 = r.getCode();
        this._globalMates.G_sc = r.getCode();
        this._globalMates.G_dK = r.getCode();
        this._globalMates.G_kv = r.getCode();
        this._globalMates.G_cR = r.getCode();
        this._globalMates.G_un = r.getCode();
        const kLen = r.getCode() * 55295 + r.getCode();
        const kcStr = r.getLine(kLen);
        this.keycodes.push(...kcStr.split(String.fromCharCode(257)));
        r.getCode();
        const rLen = r.getCode() * 55295 + r.getCode();
        const r2mkaRaw = r.getLine(rLen);
        this.keycodes.push(r2mkaRaw);
        this.r2mkaText = this._parseR2mka(r2mkaRaw);
        const codeNum = r.getCode();
        for (let current = 0; current < codeNum; current++) {
            if (this.hasDebug) {
                const dScd = createScd(this.nsd);
                let dMax = dScd() % 10 + 10;
                this._debuggerScd = (posi) => {
                    let ret = false;
                    --dMax;
                    if (dMax <= 0) {
                        dMax = dScd() % 10 + 10;
                        if (dMax < 64) { ret = true; this._debuggerPosi.push(posi); }
                    }
                    return ret;
                };
            }
            this._gren(r, current, codeArr);
        }
        codeArr.push('}}}}}}}}}}'.substr(codeNum - 1));
        if (this.mainFunctionIdx) this.mainFunctionIdx.push(codeArr.join('').length);
        return codeArr;
    }

    _parseR2mka(raw) {
        const s = raw.indexOf('"') + 1;
        const e = raw.lastIndexOf('"');
        if (s <= 0 || e <= s) return null;
        const inner = raw.substring(s, e);
        try { return JSON.parse('"' + inner + '"'); } catch(err) {
            try { return eval('("' + inner + '")'); } catch(err2) { return inner; }
        }
    }

    _gren(r, current, codeArr) {
        const { scd, keynames, keycodes } = this;
        codeArr.push('\n\n\n\n\n'.substring(0, scd() % 5));
        const m = {};
        for (const k of ['ku','s6','bs','sq','jw','sg','cu','aw']) m[k] = r.getCode();
        const listK = r.getList();
        const listH = r.getList();
        const listC = r.getList();
        const pairs = [];
        for (let i = 0; i < listC.length; i += 2) pairs.push([listC[i], listC[i+1]]);
        const shuffledPairs = arrayShuffle(pairs, scd);
        const bf = r.getCode();
        const aebiData = r.getList();
        this.aebi[current] = aebiData;
        const funcCount = r.getCode();
        const funcSegs = [];
        for (let i = 0; i < funcCount; i++) funcSegs.push(r.getList());
        const shuffledFuncs = arrayShuffle(funcSegs, scd);
        const opcCount = r.getCode();
        const opcImpls = [];
        for (let i = 0; i < opcCount; i++) opcImpls.push(r.getList());

        if (current > 0) {
            if (!this.mainFunctionIdx) this.mainFunctionIdx = [codeArr.join('').length];
            codeArr.push("function ", keynames[m.jw], "(", keynames[m.s6]);
            listK.forEach(it => codeArr.push(",", keynames[it]));
            codeArr.push("){");
        } else {
            codeArr.push("(function(", keynames[this._globalMates.G_dK], ",", keynames[this._globalMates.G_kv], "){var ", keynames[m.s6], "=0;");
        }

        const fnMap = {};
        shuffledPairs.forEach(([k1, k2]) => {
            const a = ["function ", keynames[k1], "(){var ", keynames[m.sq], "=[", k2, "];Array.prototype.push.apply(", keynames[m.sq], ",arguments);return ", keynames[m.sg], ".apply(this,", keynames[m.sq], ");}"];
            codeArr.push(...a);
            fnMap[keynames[k1]] = a.join('');
        });

        shuffledFuncs.forEach(item => {
            for (let i = 0; i < item.length - 1; i += 2) codeArr.push(keycodes[item[i]], keynames[item[i+1]]);
            codeArr.push(keycodes[item[item.length - 1]]);
        });

        if (listH.length) {
            listH.forEach((it, i) => codeArr.push(i ? "," : 'var ', keynames[it]));
            codeArr.push(';');
        }

        codeArr.push("var ", keynames[m.bs], ",", keynames[m.cu], ",", keynames[m.ku], "=");
        codeArr.push(keynames[m.s6], ",", keynames[m.aw], "=", keynames[this._globalMates.G_kv], "[", current, "];");
        codeArr.push("while(1){", keynames[m.cu], "=", keynames[m.aw], "[", keynames[m.ku], "++];");
        codeArr.push("if(", keynames[m.cu], "<", bf, "){");

        if ([1,2,3,4].includes(current)) {
            try { this._functionsSort(current, fnMap, shuffledPairs, opcImpls, aebiData); } catch(e) {}
        }

        this._ifElse(0, bf, codeArr, opcImpls, keycodes, keynames, keynames[m.cu]);
        codeArr.push("}else ", ';', '}');
    }

    _functionsSort(current, fnMap, pairs, opcImpls, aebi) {
        const { keynames, keycodes } = this;
        const len = pairs.length;
        const getName = (idx) => {
            const arr = opcImpls[idx];
            if (!arr || arr.length !== 5 || !fnMap[keynames[arr[3]]]) throw new Error();
            return keynames[arr[3]];
        };
        let start = 0;
        if (current === 1) {
            this.keycodes.filter(it => typeof it === 'string' && /^\([0-9]+\);$/.test(it)).forEach(it => {
                const s = parseInt(it.slice(1));
                if (s + len > aebi.length) return;
                try { aebi.slice(s, s + len).forEach(getName); } catch(e) { return; }
                start = s;
            });
        }
        aebi.slice(start, start + len).forEach(idx => {
            const name = getName(idx);
            if (name) this.functionsNameSort.push({ name, current, code: fnMap[name] });
        });
    }

    _ifElse(start, end, out, impls, kc, kn, cuName) {
        const arr8 = [4, 16, 64, 256, 1024, 4096, 16384, 65536];
        let diff = end - start;
        if (diff == 0) {
            return;
        } else if (diff == 1) {
            this._appendImpl(start, out, impls, kc, kn);
        } else if (diff <= 4) {
            let text = "if(";
            end--;
            for (; start < end; start++) {
                out.push(text, cuName, "===", start, "){");
                this._appendImpl(start, out, impls, kc, kn);
                text = "}else if(";
            }
            out.push("}else{");
            this._appendImpl(start, out, impls, kc, kn);
            out.push("}");
        } else {
            const step = arr8[arr8.findIndex(it => diff <= it) - 1] || 0;
            let text = "if(";
            for (; start + step < end; start += step) {
                out.push(text, cuName, "<", start + step, "){");
                this._ifElse(start, start + step, out, impls, kc, kn, cuName);
                text = "}else if(";
            }
            out.push("}else{");
            this._ifElse(start, end, out, impls, kc, kn, cuName);
            out.push("}");
        }
    }

    _appendImpl(idx, out, impls, kc, kn) {
        if (this._debuggerScd?.(out.length)) {
            out.push('debugger;');
        }
        const arr = impls[idx]; if (!arr) return;
        const len = arr.length - (arr.length % 2);
        for (let i = 0; i < len; i += 2) out.push(kc[arr[i]], kn[arr[i+1]]);
        if (arr.length !== len) out.push(kc[arr[len]]);
    }

    parseGlobalText2() {
        const r = textReader(this.globalText2);
        r.getCode();
        const kcStr = r.getLine(r.getCode());
        const kc2 = kcStr.split(String.fromCharCode(257));
        const list = r.getList();
        const out = [];
        for (let i = 0; i < list.length - 1; i += 2) out.push(kc2[list[i]], this.keynames[list[i+1]]);
        out.push(kc2[list[list.length - 1]]);
        return out.join('');
    }
}

module.exports = { Coder, extractImmucfg, grenKeys, createScd, arrayShuffle };
```

### C.2 basearr.js — basearr 生成器 (304 行, 验证: HTTP 200)

```javascript
/**
 * basearr 纯算生成器
 * 参考: rs-reverse len157.js + 真实数据对照
 */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1; CRC_TABLE[i] = c; }
function crc32(input) {
    if (typeof input === 'string') input = unescape(encodeURIComponent(input)).split('').map(c => c.charCodeAt(0));
    let val = 0 ^ -1;
    for (let i = 0; i < input.length; i++) val = val >>> 8 ^ CRC_TABLE[(val ^ input[i]) & 255];
    return (val ^ -1) >>> 0;
}
function numToNumarr4(n) { if (Array.isArray(n)) return n.flatMap(x => numToNumarr4(x)); if (typeof n !== 'number') n = 0; return [(n>>24)&255,(n>>16)&255,(n>>8)&255,n&255]; }
function numToNumarr2(n) { if (typeof n !== 'number' || n < 0) n = 0; if (n > 65535) n = 65535; return [n >> 8, n & 255]; }
function numToNumarr8(num) { if (typeof num !== 'number' || num < 0) num = 0; const h = Math.floor(num/4294967296); const l = num%4294967296; return [...numToNumarr4(h),...numToNumarr4(l)]; }
function string2ascii(str) { return str.split('').map(c => c.charCodeAt(0)); }
function ascii2string(arr) { return String.fromCharCode(...arr); }
function numarrJoin(...args) { return args.reduce((ans, it) => { if (it === undefined || it === null) return ans; if (ans.length === 0) return Array.isArray(it) ? it : [it]; if (!Array.isArray(it)) return [...ans, it]; return [...ans, it.length, ...it]; }, []); }

function buildType3(config) {
    return numarrJoin(1, config.maxTouchPoints||0, config.evalToStringLength||33, 128,
        ...numToNumarr4(crc32(config.userAgent)),
        string2ascii(config.platform||'MacIntel'),
        ...numToNumarr4(config.execNumberByTime||1600),
        ...(config.randomAvg||[50,8]), 0, 0,
        ...numToNumarr4(16777216), ...numToNumarr4(0),
        ...numToNumarr2(config.innerHeight||938), ...numToNumarr2(config.innerWidth||1680),
        ...numToNumarr2(config.outerHeight||1025), ...numToNumarr2(config.outerWidth||1680),
        ...numToNumarr8(0), ...numToNumarr4(0), ...numToNumarr4(0),
        ...numToNumarr4(crc32(config.pathname.toUpperCase())),
        ...numToNumarr4(0), ...numToNumarr4(0), ...numToNumarr4(0));
}

function buildType10(config, keys) {
    const r2t = parseInt(ascii2string(keys[21]));
    const k19 = parseInt(ascii2string(keys[19]));
    const rt = config.runTime||Math.floor(Date.now()/1000);
    const st = config.startTime||(rt-1);
    const ct = config.currentTime||Date.now();
    const r20 = Math.floor(Math.random()*1048575);
    return numarrJoin(3, 13, ...numToNumarr4(r2t+rt-st), ...numToNumarr4(k19),
        ...numToNumarr8(r20*4294967296+((ct&0xFFFFFFFF)>>>0)),
        parseInt(ascii2string(keys[24]))||4,
        string2ascii(config.hostname.substr(0,20)));
}

function buildType7(config) {
    return [...numToNumarr4(16777216), ...numToNumarr4(0),
        ...numToNumarr2(config.flag||2830), ...numToNumarr2(config.codeUid||0)];
}

function buildType6(config, keys) {
    const crypto = require('crypto');
    const k22 = ascii2string(keys[22]);
    const BS = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';
    const dk = [{},{},{},{},{},{}];
    for (let i=0;i<BS.length;i++){const c=BS.charCodeAt(i);dk[0][c]=i<<2;dk[1][c]=i>>4;dk[2][c]=(i&15)<<4;dk[3][c]=i>>2;dk[4][c]=(i&3)<<6;dk[5][c]=i;}
    const dec=[];for(let i=0;i<k22.length;i+=4){const c=[0,1,2,3].map(j=>i+j<k22.length?k22.charCodeAt(i+j):undefined);if(c[1]!==undefined)dec.push(dk[0][c[0]]|dk[1][c[1]]);if(c[2]!==undefined)dec.push(dk[2][c[1]]|dk[3][c[2]]);if(c[3]!==undefined)dec.push(dk[4][c[2]]|dk[5][c[3]]);}
    const iv=Buffer.from(dec.slice(0,16)),ct=Buffer.from(dec.slice(16));
    const d=crypto.createDecipheriv('aes-128-cbc',Buffer.from(keys[16]),iv);d.setAutoPadding(false);
    const plain=Buffer.concat([d.update(ct),d.final()]);const pad=plain[plain.length-1];
    const decrypted=[...plain.slice(0,plain.length-pad)];
    function utf8Dec(a){const c=[];for(let i=0;i<a.length;i++){const b=a[i];if(b<128)c.push(b);else if(b<192)c.push(63);else if(b<224){c.push((b&63)<<6|a[++i]&63);}else if(b<240){c.push((b&15)<<12|(a[++i]&63)<<6|a[++i]&63);}else{i+=3;c.push(63);}}return String.fromCharCode(...c);}
    const val=parseInt(utf8Dec(decrypted))||0;
    return [1,...numToNumarr2(0),...numToNumarr2(0),config.documentHidden?0:1,...decrypted,...numToNumarr2(val)];
}

function buildType2(config, keys) {
    const cp1=config._cp1;
    if(!cp1)return[103,101,224,181];
    const map={11:103,5:101,23:224,8:181};
    return[29,30,31,32].map(i=>{const n=ascii2string(keys[i]);const idx=cp1.indexOf(n);return map[idx]||0;});
}

function buildBasearr(config, keys) {
    return numarrJoin(3,buildType3(config),10,buildType10(config,keys),7,buildType7(config),0,[0],6,buildType6(config,keys),2,buildType2(config,keys),9,[8,0],13,[0]);
}

module.exports = { buildBasearr, buildType3, buildType10, buildType7, buildType6, buildType2, crc32, numarrJoin, numToNumarr4, numToNumarr2, numToNumarr8, string2ascii, ascii2string };
```

> **适配新站点时**: 主要修改 `buildType3` (字段结构因站点而异)、`buildType7` (flag 值)、`buildType9` (2B 或 5B)、`buildType2` (映射表)。其他函数通用。
