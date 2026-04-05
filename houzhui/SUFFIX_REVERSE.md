# 瑞数 URL 后缀逆向记录

---

## 一、结论

### 1.1 当前站点（商标查询 202.127.48.145:8888）
- **POST 请求不需要后缀**，只需 Cookie S + Cookie T 即可返回 200
- 纯算客户端 `revers/scripts/client.js` 已完美工作
- 不带后缀 = 200，带错误后缀 = 400（有则必验，无则放行）

### 1.2 瑞数后缀的普遍情况
- **POST 请求：99% 不需要后缀**
- **GET 请求：80% 不需要后缀**
- 需要后缀的站点（如药监局 nmpa.gov.cn），也只需要传入正确的 URL 路径和参数即可通过
- 后缀由瑞数 VM 在 XHR.open hook 中自动生成，编码了请求的 pathname + search

### 1.3 需要后缀的站点
| 站点 | 版本 | 后缀要求 |
|------|------|----------|
| 国家药品监督管理局 (nmpa.gov.cn) | 瑞数6 | 严格，GET 必须带后缀 |
| 各省电子税务局 | 瑞数6 | 严格 |
| 大部分其他瑞数站点 | 瑞数4/5/6 | 不需要后缀 |

---

## 二、后缀结构（88B / 120B）

```
88B（无 search）:
[0-3]   4B nonce        随机 (Math.random × 4)
[4]     1B flag = 1     固定
[5]     1B = 0          固定
[6-54]  49B session     Cookie S 解密（VM 字节码内部计算）
[55]    1B marker       0x20(无search) / 0x40(有search)
[56-87] 32B sig32       行为统计数据编码（鼠标/键盘）

120B（有 search）:
[0-87]  同上 88B
[88-119] 32B searchSig  search 部分的签名

编码: "0" + URLSafeBase64(bytes)
      URL-safe: + → .   / → _   无 padding
```

---

## 三、后缀生成流程

```
1. XHR.open 被瑞数 hook 拦截
2. createElement('a') 解析 URL → pathname, search
3. r2mKa VM 字节码执行 child[29]（后缀总装函数）:
   a. 构建 result = [flag]
   b. 拼入 session 49B（VM 初始化时从 Cookie S 解密并缓存）
   c. 获取 marker + 32B 行为统计签名
   d. XOR 编码 URL pathname 数据
   e. 经过 child[37] 字节变换 + G[89]/G[108] 数据重组
   f. Base64 编码
4. 后缀追加到 URL: ?paramName=0xxx...
5. 调用原始 XHR.open
```

---

## 四、逆向还原进度

### 已完成 ✅
| 成果 | 说明 |
|------|------|
| 后缀结构 88B/120B | 100% 确认，多次 hook 验证 |
| 32B 签名 = 行为统计 | AST 破解：鼠标位移/速度/方向/键盘事件编码 |
| Base64 编码 | URL-safe，已实现 |
| 字节写入函数 | writeU8/U16/U32/VarLen，AST 提取 |
| child[29] 翻译 | 后缀总装函数，完整翻译 |
| child[65] 翻译 | 签名核心，确认早期返回路径 |
| rt[239] (15KB) | 后缀核心函数，AST 定位 + 56 个子函数分析 |
| 409 个 VM opcodes | AST 从 VM 解释器提取 |
| 字符串表 g72 (96个) | AST 提取 |
| rt 完整映射 (440条) | AST 从 push args 提取 |
| r2mKa 字节码反汇编 | child[59] 6328行，child[40] 684行 |
| Cookie S 管理器 | child[59] 52个子函数自动翻译 1653行 |
| AES 解密模块 | 独立可运行，自测通过 |

### 卡在的地方 ❌
| 问题 | 原因 |
|------|------|
| **49B session** | 在 r2mKa VM 字节码内部计算，不经过 eval code JS 函数 |
| **后缀中间变换** | child[37] + G[89] + G[108] 三步变换在 VM 内部，AST 无法直接追踪 |
| **Cookie S → 49B** | Cookie S 是 HttpOnly，解密在 VM 初始化时完成，push hook 之前 |

### 根本原因
后缀的核心计算在 r2mKa VM 字节码中执行，不调用任何外部 JS 函数。AST 能分析 eval code 的 JS 函数，但 VM 字节码是在 JS 层面之下的另一层抽象。

---

## 五、AST 方法论（★ 最有价值的经验）

### 5.1 为什么 AST 是分析 JSVMP 的最佳工具

| 方法 | 效果 | 说明 |
|------|------|------|
| **AST 分析** | ★★★ | 几小时定位核心函数，精确可靠 |
| Hook rt 函数 | ★★ | 只能看外部调用，VM 内部是黑盒 |
| 字节码手动翻译 | ★ | 耗时，常量表对不上，容易出错 |
| 本地跑 eval code | ✗ | 环境差异导致崩溃 |
| RPC/补环境 | ★★ | 能用但不是纯算 |

### 5.2 AST 分析的具体步骤

```javascript
// 1. 解析 eval code
const ast = acorn.parse(evalCode, { ecmaVersion: 2020 });

// 2. 收集所有函数
walk.simple(ast, { FunctionDeclaration(node) { ... } });

// 3. 从 push args 建立 rt[N] → funcName 映射
// push base = 56, 440 个参数

// 4. 追踪调用链 (递归)
function traceCallChain(funcName) { ... }

// 5. 按特征搜索 (XOR, charCodeAt, push, loop 等)

// 6. 提取关键函数源码
```

### 5.3 AST 的成果清单
- 定位 rt[239] = 后缀核心函数 (15KB, 56子函数)
- 破解 32B 签名 = 行为统计数据编码
- 提取 AES 解密链 (6个函数)
- 提取 Cookie S 管理器 (child[59], 52个子函数)
- 提取 409 个 VM opcodes
- 自动反汇编 + 自动翻译 r2mKa 字节码

---

## 六、后续方向

### 6.1 如果要完成后缀纯算
1. **构建 mini r2mKa VM 解释器** — 用 opcodes.json (409个) + r2mka_parsed.json 直接执行字节码
2. **mock 最小浏览器环境** — 只需 document.cookie, location, createElement('a')
3. **目标**: 执行 child[59] → 49B, 执行 child[29] → 后缀

### 6.2 如果只需要能用
- **JsRpc 方案** (`jsrpc/`) — 已验证通杀商标站点 + 药监局
- **纯算 client.js** (`revers/scripts/client.js`) — 已验证完美工作（不需要后缀的站点）

---

## 七、项目文件说明

```
rs_reverse/
├── revers/scripts/       ← ★ Cookie T 纯算（已完成，可用）
│   ├── client.js         ← 纯算客户端
│   ├── run.js            ← 全流程脚本
│   ├── coder.js          ← VM 重写
│   └── basearr.js        ← 数据构建
├── jsrpc/                ← ★ JsRpc 通杀方案（已验证）
│   ├── server.js
│   ├── inject.js
│   └── client.js
├── houzhui/              ← 后缀逆向研究（本目录）
│   ├── SUFFIX_REVERSE.md ← 本文件
│   └── ast/              ← AST 分析工具和结果
└── README.md             ← 项目总览
```
