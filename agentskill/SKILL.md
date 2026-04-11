---
name: ruishu-reverse
description: 瑞数(Ruishu/Rivers Security)反爬防护纯算逆向 — Cookie T 生成 + URL 后缀处理
triggers:
  - 瑞数
  - ruishu
  - rivers security
  - 412 防护
  - Cookie T
  - 动态JS反爬
  - anti-bot bypass
---

# 瑞数反爬纯算逆向 Skill

> 目标: 任何 Claude 实例读完本文档, 都能独立完成瑞数保护站点的 Cookie T 纯算生成 + URL 后缀处理。
> 已验证: 9+ 站点 HTTP 200。

---

## 决策树

拿到目标 URL 后, 按此流程选择方案:

```
1. HTTP GET 目标 URL
   ├── 非 412 → 不是瑞数防护, 退出
   └── 412 + $_ts.cd + $_ts.nsd → 确认瑞数
       │
2. 是否只需 GET 请求?
   ├── 是 (80%场景) → 纯算方案 [阶段 0→5]
   └── 需要 POST
       │
3. POST 是否需要 URL 后缀?
   ├── 不需要 (99%站点) → 纯算 Cookie + 普通 POST [阶段 0→5]
   └── 需要后缀
       ├── 稳定方案 → JsRpc (浏览器注入, 通杀)
       └── 轻量方案 → sdenv VM 内 XHR (单次POST后需重建实例)
```

**快速验证是否需要后缀**: 纯算 Cookie T + 普通 POST → 200 则不需要, 400/412 则需要。

---

## 防护原理 (精简版)

```
浏览器 GET → 412 + HTML (含 $_ts.nsd, $_ts.cd, mainjs URL, Set-Cookie: xxxS=...)
  ↓
mainjs 执行 → 解码 cd → 提取 45 组 keys + VM 字节码
  ↓
动态生成 ~296KB eval 代码 (变量名由 nsd 种子决定, 每次不同)
  ↓
eval 执行 → 三层嵌套 VM → 收集指纹 → 组装 basearr (154-166B TLV)
  ↓
basearr → Huffman → XOR → AES-CBC → CRC32 → AES-CBC → Base64 → Cookie T
  ↓
浏览器带 Cookie S+T 重新 GET → 200
```

**我们纯算替代的部分**:

| 浏览器做的 | 纯算替代 | 阶段 | 详情 |
|-----------|---------|------|------|
| mainjs → eval 代码 | Coder 重写 | 3 | [coder_rewrite.md](references/coder_rewrite.md) |
| cd → 提取 keys | extractKeys | 2 | [key_extraction.md](references/key_extraction.md) |
| VM 收集指纹 → basearr | 数据驱动适配 | 4 | [basearr_adaptation.md](references/basearr_adaptation.md) |
| basearr → 加密 → Cookie T | generateCookie | 1 | [encryption_chain.md](references/encryption_chain.md) |

---

## 阶段总览

| 阶段 | 输入 | 输出 | 验证标准 | 通用? |
|------|------|------|---------|-------|
| **0 侦察** | 目标 URL | 412 HTML + mainjs + Cookie S + sdenv 参考数据 | sdenv Cookie → 200 | 通用 |
| **1 加密链** | sdenv Cookie T + keys | `generateCookie(basearr, keys) → Cookie T` | sdenv basearr + 纯算加密 → 200 | **通用, 一次性** |
| **2 密钥提取** | $_ts.cd | keys[0..44] (45 组) | keys 和 sdenv 提取的一致 | **通用, 一次性** |
| **3 Coder** | mainjs + nsd + cd | eval 代码 + codeUid + functionsNameSort | eval 代码逐字节一致 | **通用, 一次性** |
| **4 basearr** | 参考数据 + keys | `buildBasearr(config, keys) → basearr` | 纯算全链路 → 200 | **每站点 ~1h** |
| **5 端到端** | 全部 | 纯算 HTTP GET → 200 | 连续 3+ 次 200 | 组装即可 |

**执行顺序**: 严格 0 → 1 → 2 → 3 → 4 → 5, 每步验证通过后再进下一步。

---

## 方法论

### 数据驱动 (用于 Cookie T / basearr — 最重要!)

**核心**: 用 sdenv 采集 3-5 组真实数据 → 逐字节对比 → 找到每个字节的来源。**绝对不要去读内层 VM 代码** (740 个 state, 三层嵌套 — 这是陷阱)。

```
采集 5 session → 每个 TLV 字段拆开 → 逐字节标注:
  固定 (所有 session 相同)       → 硬编码
  来自 keys (匹配 keys[N])      → 动态提取
  时间相关 (有规律变化)          → 找公式
  随机 (无规律)                 → Math.random
  未知                         → 需更多数据或更深分析
```

**真实经验**: 花 2 天读 VM 代码完全浪费。转向数据驱动后, 1 天内解决所有问题。

### AST 分析 (用于 URL 后缀 / eval code 函数)

**核心**: eval code 是合法 JS, 用 acorn 解析 AST → 建立 rt[N] 函数映射 → 递归追踪调用链 → 提取核心算法。几小时完成手工需要数周的工作量。

**产出**: 14 个 AST 工具, ~20h, 从 296KB 混淆代码中完整逆向后缀核心函数。详见 [ast_methodology.md](references/ast_methodology.md)

### 方法选择表

| 目标在哪一层? | 用什么方法 |
|--------------|----------|
| eval code JS 函数 | AST (精确高效) |
| basearr 数据结构 | 数据驱动 (快速可靠) |
| r2mKa VM 字节码 | AST 提取 opcode + 自动反汇编 |
| 运行时动态值 (时间戳等) | sdenv 采集 |

---

## 弯路警告 (来自真实踩坑经验)

| 弯路 | 代价 | 正确做法 |
|------|------|---------|
| 反编译内层 VM 理解 basearr | **2 天浪费** | 数据驱动: 5 session 采集, 10 分钟解决 |
| 照搬 rs-reverse 公式 (idx*7+6 等) | **1 天白费** | 数据驱动: 公式是版本特定的, 不通用 |
| 补环境跑 eval 代码 | document.all 需 C++ Addon | Coder 重写 mainjs 逻辑 |
| 硬编码 type=2 值 | 换 session 就错 | cp1 索引→值映射 (5 session 反推) |
| 跳过混合验证直接做 basearr | 400 了不知道哪步错 | 先 sdenv basearr + 纯算加密 = 200, 证明加密正确 |
| 运行时栈追踪反推 opcode 语义 | 80B/天效率 | AST 静态提取: 400B/小时 (效率 80 倍) |
| HTTP 下载 mainjs 用 string 拼接 | UTF-8 多字节字符损坏 | Buffer 拼接 + toString('utf-8') |

---

## 排错指南

### 返回 412 (Cookie 未被接受)

1. Cookie 名是否正确? → `keys[7].split(';')[5] + 'T'`, 不是硬编码
2. Cookie S 是否一起发了? → 必须同时带 S 和 T
3. Cookie T 格式? → 必须以 "0" 开头
4. 时间是否过期? → Cookie 有效期通常 < 5 分钟, 检查 nonce 时间戳
5. cd 和 Cookie S 是否配套? → 必须来自同一个 412 响应

### 返回 400 (Cookie 格式/内容错误)

1. 加密链是否通过混合验证? → 先用 sdenv basearr + 纯算加密验证
2. basearr 长度是否匹配? → 对比 sdenv 参考 (通常 154-166B)
3. basearr TLV 是否有缺失字段? → 逐字段对比参考
4. keys 提取是否正确? → keys[0] 应为 "64", keys[2] 应为 48B
5. POST 是否需要 URL 后缀? → 先用 sdenv POST 测试确认

### Coder 输出不匹配

1. 逐字节对比找第一个差异位置:
   ```javascript
   for (let i = 0; i < Math.min(gen.length, ref.length); i++) {
       if (gen[i] !== ref[i]) {
           console.log('差异 @' + i + ':', JSON.stringify(gen.substring(i, i+60)));
           console.log('参考:', JSON.stringify(ref.substring(i, i+60)));
           break;
       }
   }
   ```
2. 常见 6 个 bug:
   - opmate 数量: 5 个命名 + 1 个无名 = 6 (不是 7)
   - gren(0) 用**全局** opmate, 不是局部
   - var 声明: 用 mate index 1 (不是 2)
   - while(1): 也用**全局** opmate
   - _ifElse: start 变量在 for 中被修改, else 分支用修改后的 start
   - debugger: 每个 gren 段重建 PRNG(seed=nsd), posis 跨段累积
3. 差 ~180 字符 → 大概率 debugger 对齐问题

### Keys 提取失败

1. keys[0] 是否 = "64" (ASCII [0x36, 0x34])?
   - 是 → XOR 偏移正确
   - 否 → 需要实现 r2mka runTask (难度高, 优先换站点验证)
2. keys.length < 45 → XOR 偏移计算错误
3. keys[29..32] 不是各 4B → 结构异常

### type=2 值不匹配

1. **不要硬编码!** type=2 依赖 nsd → cp1 洗牌结果
2. 采集 5 session, 记录 keys[29..32] 变量名 + type=2 值
3. 在 cp1=grenKeys(keynameNum, nsd) 中查变量名索引
4. 建立 cp1_index → value 映射表 (映射对同一 mainjs 版本固定)
5. 使用脚本: [scripts/collect_type2.js](scripts/collect_type2.js)

---

## 站点适配 Checklist

适配新站点时, 逐项检查打勾:

- [ ] 修改 HOST / PORT / PATH
- [ ] sdenv 跑通 → 200 (确认是标准瑞数版本)
- [ ] 混合验证通过 (sdenv basearr + 纯算加密 → 200)
- [ ] flag 值: 从参考 basearr type=7 的 [8..9] 读取
- [ ] type=9 格式: payload 是 2B `[8,0]` 还是 5B? 从参考读取
- [ ] type=3 结构: 长度/字段数是否和模板一致? 逐字节对比
- [ ] type=2 映射: 5+ session 采集, 建立 cp1 索引→值映射
- [ ] Cookie 名后缀: 'T' 还是 'P'? 看 412 响应 Set-Cookie 头
- [ ] hasDebug: 观察 eval 代码是否有 debugger 语句
- [ ] keynameNum: 从 mainjs 正则提取 (通常 918)
- [ ] 端到端验证: 连续 3+ 次 200

---

## 通用常量速查

```javascript
// PRNG (所有版本通用)
seed = 15679 * (seed & 0xFFFF) + 2531011

// Huffman 权重 (所有版本通用)
byte=0 → weight=45, byte=255 → weight=6, 其余 → weight=1

// AES-128-CBC
外层: key=keys[16], IV=随机16B     内层: key=keys[17], IV=全零16B

// CRC32 多项式
0xEDB88320

// 自定义 Base64 字母表 (所有版本通用)
'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d'

// BASESTR (cd 解码用, 比 Base64 字母表多 24 个字符)
'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^'

// getLine 乘数 (mainjs op88)
55295

// 变量名字符集
'_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

// _ifElse 二叉搜索步长表
[4, 16, 64, 256, 1024, 4096, 16384, 65536]

// Cookie 名
keys[7].split(';')[5] + 'T'

// URL 后缀参数名
keys[7].split(';')[1]
```

### 加密管线 (7 步)

```
basearr (154-166B)
  → Huffman 编码 (~118B)
  → 前 16 字节 XOR keys[2][0:15]
  → AES-128-CBC (key=keys[17], IV=全零, PKCS7)  → ~128B
  → 拼 packet: [2, 8, r2mkaTime(4B), now(4B), 48, keys[2](48B), lenEnc, cipher]
  → CRC32 → [crc(4B), packet]  → ~193B
  → AES-128-CBC (key=keys[16], IV=随机16B, PKCS7)  → ~224B
  → 自定义 Base64 → "0" + 299 字符
```

### 关键 Keys 含义

| key | 长度 | 含义 | 用途 |
|-----|------|------|------|
| keys[2] | 48B | KEYS48 | XOR 前 16B + packet 内嵌全部 48B |
| keys[7] | 变长 | 配置串 (分号分隔) | Cookie 名 `[5]+'T'`, 后缀参数名 `[1]` |
| keys[16] | 16B | KEY2 | 外层 AES 密钥 |
| keys[17] | 16B | KEY1 | 内层 AES 密钥 |
| keys[19] | 变长 | 时间戳串 | type=10[6..9] |
| keys[21] | 变长 | r2mkaTime 串 | nonce 时间 |
| keys[22] | 变长 | 加密数据 | type=6 AES 解密 |
| keys[24-26] | 变长 | 数值串 | type=10 参数 |
| keys[29-32] | 各 4B | 变量名 | type=2 映射 (cp1 索引→值) |
| keys[33-34] | 变长 | 数值串 | codeUid 计算参数 |

---

## 变量名变化警告

**瑞数的变量名不是固定的!** nsd 不同 → grenKeys(918, nsd) 洗牌不同 → eval 代码中所有变量名变化。

```
Session 1 (nsd=84277): _$eX, _$hR, _$cR, _$bO ...
Session 2 (nsd=91234): _$f3, _$gT, _$aK, _$dP ...
```

**hook 定位必须用结构特征, 不用变量名:**
```javascript
// ❌ 错误: 用变量名 (下次就变了)
const target = 'function _$hr(){var _$jZ=[324];';

// ✅ 正确: 用结构特征 (永远不变)
const statePattern = /function\s+(_\$\w+)\(\)\{var\s+(_\$\w+)=\[324\]/;
// ✅ 正确: 用代码长度
if (code.length > 250000) { /* 这是 eval 代码 */ }
// ✅ 正确: 用常量特征
if (code.includes('15679') && code.includes('2531011')) { /* 找到 PRNG */ }
```

---

## 工具依赖

| 工具 | 安装 | 用途 | 阶段 |
|------|------|------|------|
| Node.js crypto/http | 内置 | AES 加解密, HTTP 请求 | 全部 |
| sdenv | `npx pnpm add sdenv` | 参考数据采集, VM 内 XHR | 0, 4, 6 |
| js-beautify | `npm i js-beautify` | 格式化 mainjs (可选) | 3 |
| acorn + acorn-walk | `npm i acorn acorn-walk` | AST 分析 (后缀逆向) | 6 |

**注意**: npm 11.x + Node 24 有依赖解析死循环 bug, 安装 sdenv **必须**用 pnpm。
编译原生模块需要 VS Build Tools (Windows) 或 gcc (Linux)。

---

## 配套数据采集 (阶段 0 核心)

> **瑞数的变量名每次加载都不同!** 必须在**同一个 session** 中采集全套配套数据。
> 分开采集 (先拿 412, 再拿 mainjs) 的话 nsd 已经变了, 数据对不上!

使用 [scripts/collect_session.js](scripts/collect_session.js) 一次性采集:

```
captured/
├── session.json       nsd + cd + Cookie S/T + basearr + 时间戳
├── keys_raw.json      45 组密钥 (index + length + data)
├── ts_init.js         $_ts 初始化脚本 (含 cd)
├── eval_code.js       296KB eval 代码 (配套变量名)
└── mainjs.js          mainjs 源码 (静态, 可单独下载)
```

---

## 文件索引

### 详细参考 (按需加载)

| 文件 | 内容 |
|------|------|
| [references/encryption_chain.md](references/encryption_chain.md) | 阶段 1: Huffman/AES/CRC32/Base64 完整加密解密实现 |
| [references/key_extraction.md](references/key_extraction.md) | 阶段 2: cd 解码 + XOR 偏移推导 + 45 组 keys 提取 |
| [references/coder_rewrite.md](references/coder_rewrite.md) | 阶段 3: 外层 VM 重写 + 75+55 opcode + 9 步调试过程 |
| [references/basearr_adaptation.md](references/basearr_adaptation.md) | 阶段 4: TLV 结构 + 每个 type 实现 + 数据驱动案例 |
| [references/ast_methodology.md](references/ast_methodology.md) | AST 反编译 4 步流水线 + 14 个工具 + 方法对比 |
| [references/vm_hook_cookbook.md](references/vm_hook_cookbook.md) | 7 种 VM 注入技术 + console 侧信道导出 |
| [references/suffix_analysis.md](references/suffix_analysis.md) | URL 后缀 88B/120B 结构 + SHA-1 签名 + 现有方案 |

### 可执行脚本

| 文件 | 用途 |
|------|------|
| [scripts/collect_session.js](scripts/collect_session.js) | 配套数据一次性采集 (sdenv + VM 注入) |
| [scripts/hybrid_verify.js](scripts/hybrid_verify.js) | 混合验证: sdenv basearr + 纯算加密 → 200 |
| [scripts/pure_run.js](scripts/pure_run.js) | 纯算全流程模板 (零第三方依赖) |
| [scripts/collect_type2.js](scripts/collect_type2.js) | type=2 多 session 采集 + 映射推导 |
| [scripts/sdenv_client.js](scripts/sdenv_client.js) | sdenv 客户端 (Cookie + VM 内 XHR) |

### 参考实现

| 文件 | 说明 |
|------|------|
| [lib/coder.js](lib/coder.js) | 外层 VM 重写器 (362 行, 验证: eval 代码 100% 字节一致) |
| [lib/basearr.js](lib/basearr.js) | basearr 生成器 (304 行, 验证: HTTP 200) |
