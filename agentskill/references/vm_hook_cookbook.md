# VM Hook 技术手册: 7 种经过验证的注入技术

本文档记录了在瑞数反爬逆向工程过程中验证有效的 7 种 VM 注入技术。所有代码均经过实际测试。

---

## A.1 vm.runInContext 拦截

**目的**: 在 eval 执行前捕获或修改代码内容。

瑞数的 JS 代码通过 eval 加载执行, 拦截 `vm.runInContext` 可以在代码执行前获取完整内容, 用于分析或修改。

```javascript
const vm = require('vm');
const originalRunInContext = vm.runInContext;

vm.runInContext = function(code, context, options) {
    // 捕获 $_ts 初始化脚本 (通常较短)
    if (code.includes('$_ts')) {
        const fs = require('fs');
        fs.writeFileSync('ts_init.js', code);
        console.log('[HOOK] $_ts init script captured, length:', code.length);
    }

    // 捕获 eval 代码 (>250KB 的为主要业务代码)
    if (code.length > 250000) {
        const fs = require('fs');
        fs.writeFileSync('eval_code.js', code);
        console.log('[HOOK] eval code captured, length:', code.length);
    }

    // 可在此处对 code 进行修改后再执行
    // code = code.replace('targetPattern', 'replacementCode');

    return originalRunInContext.call(this, code, context, options);
};
```

**关键点**:
- `$_ts` 初始化脚本包含站点配置信息
- 超过 250KB 的 eval 代码为瑞数核心逻辑, 包含 VM 字节码和所有运行时函数

---

## A.2 Object.defineProperty Cookie 劫持

**目的**: 拦截 document.cookie 的写入操作, 在 Cookie T 生成时捕获其值。

```javascript
let cookieCache = '';

Object.defineProperty(Document.prototype, 'cookie', {
    get: function() {
        return cookieCache;
    },
    set: function(val) {
        // 捕获 Cookie T 写入
        if (val.indexOf('FSSBBIl1UgzbN7N80T=') !== -1) {
            console.log('[HOOK] Cookie T captured:', val);
        }

        // 捕获 Cookie S 写入
        if (val.indexOf('FSSBBIl1UgzbN7N80S=') !== -1) {
            console.log('[HOOK] Cookie S captured:', val);
        }

        // 维护 cookie 缓存, 模拟浏览器行为
        const name = val.split('=')[0];
        const cookies = cookieCache.split('; ').filter(c => c && !c.startsWith(name + '='));
        // 不缓存带 max-age=0 的删除指令
        if (!val.includes('max-age=0')) {
            cookies.push(val.split(';')[0]);
        }
        cookieCache = cookies.join('; ');
    },
    configurable: true
});
```

**关键点**:
- Cookie 名称因站点而异, `FSSBBIl1UgzbN7N80T` 和 `FSSBBIl1UgzbN7N80S` 为常见命名模式
- 需要正确维护 cookieCache, 否则后续瑞数逻辑读取 cookie 会异常
- `configurable: true` 确保可被后续代码重新定义

---

## A.3 逗号表达式注入

**目的**: 零侵入式函数监控, 在不改变控制流和返回值的前提下插入日志。

逗号表达式的特性: 依次执行所有子表达式, 返回最后一个表达式的值。

```javascript
// 原始代码
result = targetFunction(arg1, arg2);

// 注入后 (不改变任何行为)
result = (console.log('[TRACE] targetFunction called:', arg1, arg2), targetFunction(arg1, arg2));
```

**实际应用: 追踪 VM 操作码执行**

```javascript
// 原始 VM 分发循环中的调用
handlers[opcode](state);

// 注入监控
(console.log('[VM] opcode:', opcode, 'stack:', state.stack.slice(-3)), handlers[opcode](state));
```

**进阶: 在 AST 改写中批量应用**

```javascript
// AST 遍历时, 对目标 CallExpression 包裹逗号表达式
// 原始 AST 节点: callExpr
// 改写为: SequenceExpression([logExpr, callExpr])
```

**关键点**:
- 不改变控制流, 不影响返回值
- 不需要修改函数签名或调用方式
- 适合在 AST 改写中批量注入到关键调用点
- 性能开销极小, 仅多一次 console.log

---

## A.4 函数体替换

**目的**: 对已知签名的函数进行包装, 添加监控逻辑。

```javascript
// 示例: 捕获 State 324 入口函数
// State 324 是瑞数 VM 中负责 Cookie 生成的关键状态

// 在 eval 代码中定位目标函数后替换
function hookState324Entry(evalCode) {
    // 定位目标函数 (通过结构特征, 非函数名)
    // 假设已通过 AST 分析确定函数位置
    const pattern = /function\s+(\w+)\((\w+),\s*(\w+),\s*(\w+)\)\s*\{/;
    const match = evalCode.match(pattern);

    if (match) {
        const funcName = match[1];
        const originalBody = extractFunctionBody(evalCode, match.index);

        // 包装函数, 添加入口/出口监控
        const wrapped = `
function ${funcName}(${match[2]}, ${match[3]}, ${match[4]}) {
    console.log('[State324] ENTER, args:', Array.from(arguments).map(a => typeof a));
    var __result = (function(${match[2]}, ${match[3]}, ${match[4]}) {
        ${originalBody}
    }).apply(this, arguments);
    console.log('[State324] EXIT, result type:', typeof __result);
    return __result;
}`;
        return evalCode.replace(match[0] + originalBody + '}', wrapped);
    }
    return evalCode;
}
```

**WARNING**: 函数名每次加载都会变化 (瑞数动态混淆), 绝对不能依赖函数名定位。必须使用结构特征:
- 参数个数
- 函数体内的特征调用
- 所在作用域的位置
- AST 节点的结构模式

---

## A.5 Phase 标记

**目的**: 通过全局变量区分执行上下文, 仅在关键阶段采集数据。

瑞数 VM 在初始化阶段会执行大量与目标无关的逻辑, 如果无差别采集会产生大量噪声。Phase 标记用于精确控制采集窗口。

```javascript
// 在全局作用域定义
globalThis.__phase = 0;

// 在 eval 代码注入中设置阶段标记
// Phase 0: 初始化阶段 (忽略)
// Phase 1: Cookie 生成阶段 (重点采集)
// Phase 2: 后续请求阶段 (按需采集)

// 在关键入口处设置
// 例如: 检测到 State 324 开始执行时
globalThis.__phase = 1;

// 在数据采集 hook 中检查阶段
function logIfCritical(tag, data) {
    if (globalThis.__phase === 1) {
        console.log(tag, JSON.stringify(data));
    }
}

// 实际应用: 只在 Phase 1 记录数组操作
const originalPush = Array.prototype.push;
Array.prototype.push = function() {
    if (globalThis.__phase === 1 && this.length > 100) {
        logIfCritical('__BASEARR__', {
            len: this.length,
            newItems: Array.from(arguments).slice(0, 5)
        });
    }
    return originalPush.apply(this, arguments);
};
```

**关键点**:
- 大幅减少日志噪声, 只关注关键执行路径
- Phase 切换点需要通过预分析确定 (通常在特定函数调用或特定 opcode 执行时)
- 可配合 A.4 函数体替换, 在入口函数中设置 phase

---

## A.6 console.log 侧信道导出

**目的**: 利用 sdenv 的 consoleConfig 回调机制, 将 VM 内部数据导出到外部 Node.js 环境。

sdenv 环境中 console.log 的输出可以通过 consoleConfig 配置项捕获, 这是从 VM 内部向外传递数据的可靠通道。

```javascript
// Node.js 外部: sdenv 配置
const collectedData = {
    keys: null,
    baseArr: null,
    cookieT: null
};

const sdenvConfig = {
    consoleConfig: {
        log: function() {
            const msg = arguments[0];

            // 捕获 keys 数组
            if (typeof msg === 'string' && msg.startsWith('__K__')) {
                const payload = msg.substring(5);
                collectedData.keys = JSON.parse(payload);
                console.error('[COLLECT] keys captured, length:', collectedData.keys.length);
            }

            // 捕获 base 数组
            if (typeof msg === 'string' && msg.startsWith('__BASEARR__')) {
                const payload = msg.substring(11);
                collectedData.baseArr = JSON.parse(payload);
                console.error('[COLLECT] baseArr captured, length:', collectedData.baseArr.length);
            }

            // 捕获 Cookie T
            if (typeof msg === 'string' && msg.startsWith('__CT__')) {
                const payload = msg.substring(6);
                collectedData.cookieT = payload;
                console.error('[COLLECT] Cookie T captured');
            }
        }
    }
};
```

```javascript
// VM 内部 (注入到 eval 代码中): 使用约定前缀发送数据
// 在关键位置插入:

// 导出 keys 数组
console.log('__K__' + JSON.stringify(keys));

// 导出 base 数组 (运行时常量表)
console.log('__BASEARR__' + JSON.stringify(baseArr));

// 导出 Cookie T
console.log('__CT__' + cookieValue);
```

**关键点**:
- 前缀命名应唯一, 避免与正常 console.log 冲突
- 外部使用 `console.error` 输出调试信息, 与内部的 `console.log` 通道分离
- JSON.stringify 处理复杂数据结构, 注意循环引用问题
- 大数组序列化可能有性能影响, 按需截断

---

## A.7 正则批量函数发现

**目的**: 在混淆代码中通过结构特征批量定位目标函数, 适用于函数名被混淆的场景。

```javascript
/**
 * 通过结构特征查找函数
 * @param {string} code - 完整的 eval 代码
 * @param {RegExp} bodyPattern - 函数体内的特征正则
 * @returns {Array} 匹配的函数信息
 */
function findFunctionsByPattern(code, bodyPattern) {
    const results = [];
    // 匹配所有函数声明和函数表达式
    const funcDeclRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
    let match;

    while ((match = funcDeclRegex.exec(code)) !== null) {
        const funcStart = match.index;
        const bodyStart = match.index + match[0].length;

        // 通过括号深度追踪提取完整函数体
        const body = extractByBracketDepth(code, bodyStart - 1);

        if (body && bodyPattern.test(body)) {
            results.push({
                name: match[1],
                params: match[2],
                body: body,
                position: funcStart
            });
        }
    }
    return results;
}

/**
 * 括号深度追踪, 提取完整的 {} 块
 * @param {string} code - 源代码
 * @param {number} openBracePos - 开括号位置
 * @returns {string} 完整的函数体 (含外层花括号)
 */
function extractByBracketDepth(code, openBracePos) {
    let depth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = openBracePos; i < code.length; i++) {
        const ch = code[i];

        // 字符串状态追踪 (避免将字符串内的括号计入深度)
        if (!inString && (ch === '"' || ch === "'")) {
            inString = true;
            stringChar = ch;
        } else if (inString && ch === stringChar && code[i - 1] !== '\\') {
            inString = false;
        }

        if (!inString) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
            if (depth === 0) {
                return code.substring(openBracePos, i + 1);
            }
        }
    }
    return null;
}
```

**实际应用: CRC32 函数发现**

```javascript
// CRC32 函数的结构特征: 包含 0xEDB88320 常量或特征位运算模式
const crc32Pattern = /0xEDB88320|>>>.*0xFF/;
const crc32Functions = findFunctionsByPattern(evalCode, crc32Pattern);

if (crc32Functions.length > 0) {
    crc32Functions.forEach(fn => {
        console.log('[FOUND] CRC32 candidate:', fn.name, 'at position:', fn.position);
        console.log('  params:', fn.params);
        console.log('  body length:', fn.body.length);
    });
}
```

**其他常用特征模式**:

```javascript
// SHA-1 函数: 包含特征初始化常量
const sha1Pattern = /0x67452301|0xEFCDAB89|0x98BADCFE/;

// Base64 编码: 包含标准 Base64 字符表
const base64Pattern = /ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/;

// XHR hook: 包含 XMLHttpRequest 和 open/send 相关操作
const xhrHookPattern = /XMLHttpRequest.*prototype\.(open|send)/;

// Cookie 操作: 包含 document.cookie 赋值
const cookiePattern = /document\.cookie\s*=/;
```

**关键点**:
- 括号深度追踪必须处理字符串内的括号, 否则会提前截断
- 特征正则应选择算法中不可变的常量 (如 CRC32 的 magic number), 而非可能被混淆的变量名
- 同一特征可能匹配多个函数, 需要结合参数个数、函数体长度等做进一步筛选
- 该技术是 AST 分析的轻量替代, 适合快速定位候选函数后再做精确分析
