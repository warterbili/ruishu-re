# 瑞数 (Ruishu) 反爬逆向 — 纯算 + AST 反编译 + JsRpc 通杀

> 从零到完整突破瑞数动态安全防护 (Rivers Security)。包含 Cookie T 纯算生成、URL 后缀 AST 深度逆向、JsRpc 通杀方案、sdenv 补环境方案, 以及一份 3000 行的 Agent Skill 文档, 让 AI 也能独立完成瑞数逆向。

## 成果总览

| 方案 | 原理 | 适用场景 | 状态 |
|------|------|----------|------|
| **纯算 Cookie T** | 纯 JS 实现加密链, 零浏览器依赖 | GET/POST (不需要后缀的站点, 99%) | **已完成, HTTP 200** |
| **JsRpc 通杀** | WebSocket 调用浏览器中的瑞数 VM | 所有站点, 包括需要后缀的 | **已完成, 通杀验证** |
| **sdenv 补环境** | 魔改 jsdom 模拟浏览器环境 | Cookie + 后缀, 单实例 | **已完成, 可用** |
| **URL 后缀 AST 逆向** | AST 反编译 eval code + VM 字节码 | 深度逆向研究 | **已完成 80%, 卡在 VM 层** |
| **Agent Skill** | 3000 行完整逆向知识文档 | AI Agent 自动化逆向 | **已完成, 可直接使用** |

## 目标���点

**中国知识产权海关备案查询系统**
`http://202.127.48.145:8888/`

该站点使用瑞数 4/5 代动态安全防护, 对所有请求进行加密 Cookie 验证。

---

## 快速开始

### 纯算方案 (推荐, 零依赖)

```bash
cd reverse/scripts
node client.js
```

```javascript
const { RuishuPureClient } = require('./reverse/scripts/client.js');

const client = new RuishuPureClient();
await client.init();

// GET 页面
const page = await client.get('/zscq/search/jsp/vBrandSearchIndex.jsp');

// POST 查询商标
const result = await client.post(
    '/searchUser/searchAction!getVRecordListPage.do',
    'page=1&rows=10&sidx=RECORD_NUM&sord=desc&_search=false&nd=' + Date.now()
);

// 搜索 (支持中文)
const search = await client.post(
    '/searchUser/searchAction!getVRecordListPage.do',
    'page=1&rows=10&RECORD_NAME=' + encodeURIComponent('华为') + '&nd=' + Date.now()
);
```

Cookie 过期自动刷新, 无需手动处理。

### JsRpc 方案 (通杀所有瑞数站点)

```bash
cd jsrpc && npm install

# 1. 启动服务端
node server.js

# 2. 浏览器打开目标站点 → F12 → Console → 粘贴 inject.js

# 3. 调用
node client.js                              # 自动测试
node client.js get /path                    # GET
node client.js post /api "key=value"        # POST (自动带后缀)
```

---

## 瑞数防护原理

```
浏览器首次访问
    ↓
服务器返回 HTTP 412 + 混淆 JS
  ├── Cookie S (HttpOnly, 服务端标识)
  ├── <meta> 标签 (加密 content)
  ├── <script> $_ts = { nsd, cd, cp, aebi } (配置数据)
  └── <script src="mainjs.js"> (205KB 混淆代码)
    ↓
mainjs 执行:
  1. 解密 $_ts.cd → 提取 45 组密钥
  2. 用 nsd 种子生成 918 个随机变量名
  3. 动态生成 296KB eval 代码
  4. eval() → 启动三层嵌套 VM
    ↓
VM 执行:
  1. 收集浏览器指纹 (Canvas, WebGL, UA, 屏幕...)
  2. 组装 basearr (154B TLV 结构)
  3. basearr → Huffman → XOR → AES-CBC → CRC32 → AES-CBC → Base64
  4. 写入 Cookie T = "0" + Base64 结果
  5. 劫持 XHR.open (给请求加 URL 后缀)
    ↓
浏览器带 Cookie S + Cookie T 再次访问 → 200
```

### 三层 VM 架构

```
Layer 1: mainjs 字节码解释器 (~100 opcodes)
  └─ 解析配置, 生成 eval 代码

Layer 2: eval code 外层 VM — _$$o (741 state codes)
  └─ Cookie T 生成, XHR 劫持, DOM 遍历, 事件监听

Layer 3: 内层 VM — r2mKa (114 opcodes, 407 函数, 43925B 字节码)
  └─ AES/CRC32/Huffman/Base64, 环境指纹收集
```

---

## 项目结构

```
rs_reverse/
│
├── reverse/                         ★ 纯算实现 (核心成果)
│   ├── scripts/
│   │   ├── client.js                纯算客户端 (233行, 一键使用)
│   │   ├── run.js                   Cookie T 全流程脚本
│   │   ├── coder.js                 外层 VM 重写 (362行)
│   │   ├── basearr.js               明文数据构建 (304行)
│   │   └── pure_e2e.js              端到端验证
│   ├── captured/
│   │   └── mainjs.js                缓存的 mainjs
│   ├── test/
│   │   └── api_test.js              API 接口测试
│   └── REVERSE_ARCHIVE.md           完整逆向过程记录
│
├── houzhui/                         ★ URL 后缀 AST 深度逆向
│   ├── ast/                         14 个 AST 分析工具
│   │   ├── ast_trace_rt239.js       定位后缀核心函数 rt[239] (15KB)
│   │   ├── ast_deep_bs.js           拆解 56 个子函数
│   │   ├── ast_extract_opcodes.js   提取 409 个 VM opcodes
│   │   ├── ast_r2mka_disasm.js      自动反汇编 (6328行输出)
│   │   ├── ast_bytecode_to_js.js    栈模拟翻译 (字节码→伪JS)
│   │   ├── ast_suffix_structure.js  后缀 88B/120B 结构分析
│   │   ├── ast_find_xtea_huffman.js 定位加密函数 (SHA-1/XTEA)
│   │   ├── ast_verify_all.js        440 个 rt[N] 完整映射
│   │   ├── ast_session_chain.js     AES 解密链提取
│   │   ├── ast_cookie_s_decrypt.js  Cookie S 解密路径
│   │   ├── ast_cookie_s_complete.js 核心函数翻译
│   │   ├── ast_translate_child40.js TLV 解析器翻译
│   │   ├── ast_trace_session49.js   49B session 追踪
│   │   └── ast_trace_49b.js         纯 AST 完整 49B 路径
│   └── SUFFIX_REVERSE.md            后缀逆向完整记录
│
├── jsrpc/                           ★ JsRpc 通杀方案
│   ├── server.js                    WebSocket RPC 服务端
│   ├── inject.js                    浏览器注入脚本
│   ├── client.js                    Node.js 客户端
│   └── README.md                    使用说明
│
├── sdenv/                           补环境方案 (魔改 jsdom)
│   ├── client.js                    sdenv 客户端
│   └── README.md                    技术总结
│
├── agentskill/                      ★ AI Agent Skill 文档
│   └── SKILL_PLAN.md               3000行完整逆向知识 (可直接喂给 AI)
│
├── rs-reverse-src/                  pysunday/rs-reverse 开源参考
│   └── src/                         参考实现源码
│
├── captured/                        抓包数据
│   ├── 412.html                     首次访问的 412 响应
│   ├── eval_code.js                 捕获的 eval 代码 (296KB)
│   ├── mainjs.js                    主 JS 文件
│   └── meta.json                    meta 标签数据
│
└── SKILL_PLAN.md                    → agentskill/SKILL_PLAN.md 副本
```

---

## 四种方案详解

### 1. 纯算 Cookie T (reverse/scripts/)

**完全不依赖浏览器**, 纯 Node.js 实现整条加密链:

```
$_ts.cd → extractKeys() → 45 组密钥
mainjs + nsd → Coder 重写 → eval 代码 + codeUid
已知参数 → buildBasearr() → 154B TLV 明文
basearr → Huffman → XOR → AES-CBC → CRC32 → AES-CBC → Base64 → Cookie T
```

核心文件:
- `coder.js` — 外层 VM 重写 (362行), 从 mainjs 生成 eval 代码, 逐字节与原始一致
- `basearr.js` — 明文数据构建 (304行), 8 种 TLV type 全覆盖
- `client.js` — 完整客户端 (233行), Cookie 自动更新

### 2. JsRpc 通杀 (jsrpc/)

通过 WebSocket 调用浏览器中真实运行的瑞数 VM, Cookie + 后缀全自动:

```
Node.js ←HTTP→ JsRpc Server ←WebSocket→ 浏览器中的瑞数 VM
```

已验证: 商标查询站点 + 国家药品监督管理局 (瑞数6, 最严格)

### 3. sdenv 补环境 (sdenv/)

魔改 jsdom 模拟浏览器环境, 让瑞数 JS 在 Node.js 中真实执行:
- 优点: Cookie + 后缀都能生成
- 限制: 单实例只能发一次 POST (Math.random 变 undefined)

### 4. URL 后缀 AST 逆向 (houzhui/)

对 URL 后缀进行深度逆向研究, 使用 AST 作为核心分析工具。

#### 后缀结构 (88B / 120B)

```
"0" + URLSafeBase64([
    [0-3]   4B nonce        随机
    [4-5]   flag + marker
    [6-54]  49B session     Cookie S 解密 (VM 内部)
    [55]    0x20(无search) / 0x40(有search)
    [56-87] 32B signature   SHA-1(行为数据 + URL)
])
```

#### AST 反编译链路 (核心方法论)

```
eval_code.js (296KB)
    ↓ acorn.parse() → AST
    ↓ 遍历 _$_I 的 if(op===N) 分支
opcode 语义映射 (409 条)
    ↓ 反汇编器逐条翻译字节码
汇编代码 (6328 行)
    ↓ 栈模拟翻译 (自动)
可读伪 JS 代码 (1653 行)
    ↓ 人工语义标注
带注释的可执行代码
```

关键发现:
- 后缀签名使用 **SHA-1** (不是 XTEA/AES)
- 32B signature = 鼠标/键盘**行为统计编码** (不是加密)
- URL 数据通过 **createElement('a') 解析** 后 XOR 编码进后缀
- 当前卡在: 49B session 在 VM 字节码内部计算, AST 无法触及

#### 为什么 AST 是 JSVMP 逆向的最优解

| 方法 | 效率 | 说明 |
|------|------|------|
| **AST 静态分析** | ★★★★★ | 20h → 52 个函数, ~400B/h, opcode 100% 精确 |
| 运行时栈追踪 | ★★ | 2天 → 1 个函数, ~80B/天, 需要猜 opcode 语义 |
| 手工阅读混淆代码 | ★ | 296KB 混淆代码, 不现实 |

---

## Agent Skill (agentskill/)

`SKILL_PLAN.md` 是一份 **3000+ 行的完整逆向知识文档**, 包含:

- 瑞数防护完整原理 (三层 VM 架构、加密链路、$_ts 结构)
- 6 个阶段的逐步实现指南 (侦察 → 加密链 → 密钥提取 → VM 重写 → basearr 适配 → 验证)
- 完整代码模板 (纯算客户端、sdenv 客户端、混合验证、数据采集)
- 两大方法论: **数据驱动** (basearr) + **AST 分析** (后缀/eval code)
- 从字节码到伪代码的完整反编译链路
- 弯路警告 (来自真实踩坑经验)
- VM 注入技术手册 (7 种注入方式)

**设计目标**: 任何 AI Agent (如 Claude) 读完此文档, 都能独立完成瑞数保护站点的逆向。

---

## 方法论

### 数据驱动 (Cookie T / basearr)

> 遇到不理解的字节 → 多采几组真实数据 → 逐字节对比 → 找规律

不要读 VM 代码, 用 sdenv 采集 3-5 组真实数据, 逐字节对比找到每个字段的来源。
我们花了 2 天读 VM 代码理解 basearr — 完全浪费。转向数据驱动后 1 天内解决。

### AST 分析 (URL 后缀 / eval code)

> eval code 是合法 JS → acorn 解析 → 函数映射 → 调用链追踪 → 自动反汇编

VM 解释器 `_$_I` 的源码就在 eval code 里, AST 直接读出 409 个 opcode 的 JS 实现。
14 个 AST 工具, ~20h, 产出 6328 行反汇编 + 1653 行伪代码。

**当你能打开黑盒读电路图时, 永远不要从外面猜。**

---

## API 参考

### 查询商标备案记录
```
POST /searchUser/searchAction!getVRecordListPage.do
Content-Type: application/x-www-form-urlencoded

page=1&rows=10&sidx=RECORD_NUM&sord=desc&_search=false&nd=<timestamp>
可选: RECORD_NAME=<商标名>&COUNTRY=<国家代码>

响应: { total, page, records, rows: [{ RECORD_NUM, REGISTER_NUM, APPLY_USER_NAME, ... }] }
```

### 获取国家列表
```
POST /param/paramAction!getParamTypeList.do
ns=<timestamp>&code=Country

响应: [{ value: "142", name: "中国" }, { value: "502", name: "美国" }, ...]
```

---

## 技术栈

- **Node.js 18+** — 运行环境
- **acorn + acorn-walk** — AST 解析 (后缀逆向)
- **crypto** (Node.js 内置) — AES-128-CBC, CRC32
- **无外部依赖** — 纯算方案零第三方库

## 致谢

- [pysunday/rs-reverse](https://github.com/pysunday/rs-reverse) — 开源参考实现, 9+ 站点验证
- [anthropic/claude-code](https://github.com/anthropics/claude-code) — AI 辅助逆向分析

## License

MIT
