# 瑞数反爬逆向 — 完整技术总结

## 一、项目概述

| 项目 | 说明 |
|------|------|
| 目标站点 | `http://202.127.48.145:8888` (知识产权海关备案查询系统) |
| 防护系统 | 瑞数信息 (Rivers Security) |
| 防护版本 | 瑞数 5/6 代（自定义 VM + 字节码解释器）|
| 方案 A | sdenv（魔改 jsdom）— 本目录 `client.js` |
| 方案 B | 纯算逆向 — `../revers/scripts/pure_e2e.js` (已验证 200) |
| 结果 | 两种方案均可用，128062+ 条数据可获取 |

---

## 二、瑞数防护原理

### 2.1 整体流程

```
浏览器首次访问
    ↓
服务器返回 HTTP 412 + 一段混淆 JS
  ├── <meta> 标签：含加密 content 值
  ├── <script>：设置 $_ts 对象（nsd, cd, cp 等配置）
  └── <script src="主JS.js">：205KB 混淆代码
    ↓
主 JS 执行：
  1. 解析 $_ts.cd（1700+ 字符密文）→ 提取密钥 keys[0..44]
  2. 解析 $_ts.cp[0]（Caesar+6 编码）→ 1498 个字符串
  3. 解析 $_ts.cp[2]（编码数据）→ 243 项数值常量
  4. 动态生成 296KB 的 eval 代码
  5. eval() 执行 → 创建三层 VM
    ↓
VM 执行：
  1. 初始化 _$l0 运行时数组（517 项：函数、常量、DOM引用）
  2. 收集浏览器指纹（canvas、WebGL、字体、UA、屏幕...）
  3. 生成 Cookie T（加密的指纹 + 时间戳数据）
  4. 劫持 XMLHttpRequest.prototype.open（给 URL 加后缀）
  5. 劫持 <a>/<form> 的 href/action（给链接加后缀）
  6. location.replace → 刷新页面带上 Cookie
    ↓
浏览器第二次访问（带 Cookie）→ 200 正常页面
    ↓
后续 AJAX 请求（XHR 被劫持，自动加 URL 后缀）→ 正常数据
```

### 2.2 Cookie 结构

```
Cookie S（HttpOnly）:
  AV7KYchI7HHaS=60Yrfi...
  ↑ 前缀          ↑ 服务器直接 Set-Cookie 返回的初始标识

Cookie T（JS 生成）:
  AV7KYchI7HHaT=08fuQ5GV...
  ↑ 同前缀 + T    ↑ "0" + 自定义Base编码(AES加密(Huffman(环境指纹数据)))
```

### 2.3 URL 后缀

```
原始请求: /searchAction!getVRecordListPage.do
实际请求: /searchAction!getVRecordListPage.do?8h6a7FPl=0R5Hmral...
                                              ^^^^^^^^ ^^^^^^^^^^
                                              参数名    加密值
```

后缀值 = `"0"` + Base编码([nonce:5B][session:49B][signature:34-66B])

### 2.4 $_ts 配置详细结构

```javascript
$_ts = {
    nsd: 84277,                    // 伪随机数种子
    cd:  "qJzx...",               // 1700+ 字符，Base编码的加密数据
                                   // 解码后分两段：
                                   //   part1: task 字节码（用于计算 offset）
                                   //   part2: XOR(keys数据, offset)
    cp: [
        "yruigzout...",           // cp[0]: Caesar+6 编码的 1498 个字符串
                                   //   解码方法: 每个字符 charCode - 6
                                   //   包含所有 DOM API 名称
        ["_$k8","_$cH",...],      // cp[1]: 918 个变量名（混淆映射）
        "qX[...",                 // cp[2]: 编码后 = 243 项数值常量
                                   //   如: 0xFFFF, 6, 0x0F, 4, 10, 0x1F...
        208883,                   // cp[3]: 主 JS 的校验和
                                   //   计算方式: 每100字符取 charCodeAt 求和
        7, 7, ""                  // cp[4-6]: 版本配置
    ],
    aebi: [                       // 字节码数组（6层）
        [492项, 值域0-314],       // aebi[0]: 初始化VM的字节码
        [1014项, 值域0-740],      // aebi[1]: 主逻辑VM的字节码
        [739项],                  // aebi[2-5]: 字符串排列表
        [181项], [40项], [7项]    //   用于构建 96 项字符串查找数组
    ],
    scj: [],                      // IIFE 第一个参数（空数组）
    jf: false                     // 格式化检测标志
}

// IIFE 调用方式：
// eval("(function(_$jI, _$le) { ... })($_ts.scj, $_ts.aebi)")
// _$jI = $_ts.scj = []
// _$le = $_ts.aebi = [6个数组]
```

### 2.5 三层 VM 架构

```
Layer 1: 主 JS 的字节码解释器
  ├── 字节码: $_ts.cd 解密后的数据
  ├── 指令集: 简单的状态机（约 100 个操作码）
  └── 功能: 解析配置、生成 eval 代码

Layer 2: eval 代码的外层 VM（_$$o 函数）
  ├── 字节码: aebi[1]（1014 项状态号）
  ├── 指令集: 741 个状态码（二叉搜索树 switch-case）
  ├── 变量: _$eB, _$iN, _$dv, _$hf（条件标志）, _$_n（PC）
  └── 功能: Cookie 生成、XHR 劫持、DOM 遍历、事件监听

Layer 3: 内层 VM（_$hP/_$cB 函数）
  ├── 字节码: 407 个函数，共 43925B（从 $_ts.cd 提取）
  ├── 指令集: 114 个操作码（0-113）
  │   ├── 栈操作: PUSH, POP, DUP
  │   ├── 算术: ADD, SUB, MUL, DIV, XOR, AND, OR
  │   ├── 比较: EQ, NE, GT, LT, GE, LE
  │   ├── 控制流: JMP, JMP_IF_FALSE, LOOP, RETURN
  │   ├── 函数: CALL_0 ~ CALL_5, APPLY
  │   └── 对象: GET_PROP, SET_PROP, DYN_GET, SET_DYN
  └── 功能: AES 加密、CRC32、Huffman 编码、Base 编码
```

### 2.6 密钥体系

从 `$_ts.cd` 中提取 45 组密钥（keys[0..44]）：

| Key | 大小 | 内容 | 用途 |
|-----|------|------|------|
| keys[0] | 2B | "64" | 配置标识 |
| keys[2] | 48B | 二进制 | XOR 密钥（加密第一轮）|
| keys[7] | 296B | 分号分隔字符串 | 包含 Cookie 名、后缀参数名、JS URL 等 |
| keys[11] | 20B | "http:...8888" | 站点 URL |
| keys[13] | 3B | "674" | 功能位标志 |
| keys[16] | 16B | 二进制 | AES 第二轮密钥 |
| keys[17] | 16B | 二进制 | AES 第一轮密钥 |
| keys[21] | 10B | "1775154267" | r2mka 时间戳 |
| keys[22] | 43B | 加密字符串 | meta content 解密密钥 |
| keys[27] | 507B | 扩展名列表 | 不加后缀的静态资源类型 |
| keys[29-32] | 各4B | 变量名 | VM 内部变量标识 |
| keys[42] | 5B | "84277" | = $_ts.nsd |

keys[7] 解析：
```
7Lmiq0Qi;8h6a7FPl;ejYSepMM;15K0aWZs;Dt8FFzoG;AV7KYchI7HHa;Qy6JDI4LYvbD;...
    [0]      [1]       [2]      [3]      [4]       [5]           [6]
  随机ID   后缀参数名  配置ID    配置     配置   Cookie名前缀    JS路径前缀
```

---

## 三、逆向历程（详细）

### Phase 1: 信息收集（Day 1）

#### 1.1 抓包分析
- 用浏览器 DevTools Network 面板抓取请求
- 发现请求 URL 带有加密后缀参数 `?8h6a7FPl=0xxx...`
- 发现两个 Cookie：`AV7KYchI7HHaS`（短，HttpOnly）和 `AV7KYchI7HHaT`（长，JS生成）
- 首次访问返回 412 状态码 + 一段 JS

#### 1.2 开源方案调研
搜索 GitHub 和看雪论坛，找到三种方案：

| 方案 | 代表项目 | 特点 |
|------|---------|------|
| 纯算逆向 | rs-reverse (⭐529) | 完全还原算法，最快但版本敏感 |
| 补环境 | sdenv (⭐684) | 魔改 jsdom，中等难度 |
| 浏览器+代理 | mitmproxy | 最简单但需要开浏览器 |

#### 1.3 决策
先走纯算路线学习，遇到瓶颈再切换。

### Phase 2: VM 架构逆向（Day 1-2）

#### 2.1 定位 VM 入口
- 写了 5 版油猴脚本尝试 hook XHR/eval/Cookie
- **踩坑**: hook eval 会破坏瑞数的作用域检测，页面按钮失效
- **踩坑**: Proxy 包装 XMLHttpRequest 导致所有请求失败
- **解决**: 用 PerformanceObserver（只读监控，不侵入）成功抓到请求
- 从 Network → Initiator 面板找到调用栈：`_$cB` → `_$c$` → VM 入口

#### 2.2 提取 VM 代码
- 从 DevTools Sources 面板手动复制 VM 脚本 → `vm.js`（7528行）
- 用 Playwright CDP 的 `Debugger.getScriptSource` 提取 → `rs_vm_8.js`（296KB）
- **踩坑**: Playwright 被瑞数检测（WebDriver 标志），页面返回 400
- **解决**: 只用 CDP 提取静态数据，不做页面交互

#### 2.3 字符串表解码
- VM 代码中所有字符串都通过索引访问：`_$hi[31]` 而不是 `"open"`
- 发现 Caesar 编码：`yktj` → 移位-6 → `send`
- 解码全部 1498 个字符串，保存为 `rs_decoded_strings.json`
- **踩坑**: 最初试了 shift=-2，通过 `yktj→send`、`jui{sktz→document` 确认是 -6

#### 2.4 字节码提取与反汇编
- 从 `$_ts.cd` 中提取 43925 字节内嵌字节码
- **踩坑**: 最初把 `$_ts.cd` 当成字节码直接解析，导致栈溢出
- **解决**: cd 是配置数据，真正的字节码在 eval 代码的 `r2mKa` 标记处
- 实现 114 操作码反汇编器 → 407 个函数，5037 行反汇编
- 识别关键函数：main.c42（XHR劫持）、main.c56.c1（ALU，1314B 最大函数）

#### 2.5 VM 反编译
- 从 rs_vm_8.js + rs_string_tables.json 建立字符串映射
- 15 个 96 项字符串数组 × 各自不同的排列
- 通过已知 API 名（cookie=索引112, open=索引31）交叉匹配
- 替换 4467 处索引访问为实际字符串 → 317KB 可读代码
- **关键发现**: `_$l0[500]` = 后缀生成函数，`_$l0[43]` = URL 查询串

### Phase 3: Node.js 运行尝试（Day 2）

#### 3.1 手工补环境
- 写了 170+ 行浏览器 API mock（window/document/navigator/screen/...）
- 旧版主 JS 成功运行，Cookie 生成！
- **踩坑**: 新版主 JS 报 `Invalid array length`（`_$aJ` 函数的 `Array.push`）
- 原因：新版 JS 的代码生成器需要更完整的 DOM API
- 尝试了 Proxy 包装 Array、hook push、try-catch 包装 —— 全部无效

#### 3.2 _$l0 运行时数组捕获
- 通过 hook eval 代码中的 `.push(440项)` 调用注入 `window.__l0 = _$l0`
- 成功捕获 517 项完整数据
- 发现 `_$l0[34]` = 45 组密钥（keys 数组）
- 发现 `_$l0[7] & 4 == 0` → 后缀功能未激活（缺少浏览器特征检测结果）

#### 3.3 jsdom 尝试
- 安装 jsdom，旧版 JS 能跑通 Cookie
- 新版 JS 同样报 `Invalid array length` —— **jsdom 也走不通新 JS**

### Phase 4: 纯算还原（Day 2-3）

#### 4.1 获取 rs-reverse 源码
- 拉取 rs-reverse 全部核心文件：Cookie.js、Coder.js、parser/ 目录
- 理解 Cookie 生成链路：
  ```
  basearr → Huffman → XOR(keys[2]) → AES-CBC(keys[17]) 
  → header拼接 → CRC32 → AES-CBC(keys[16]) → Base编码
  ```

#### 4.2 实现各加密组件
- **CRC32**: 标准查表法，256 项查找表 ✅ 自测通过
- **Huffman**: 静态树（0:权重45, 255:权重6, 其他:1）✅ 自测通过
- **AES-CBC**: S-Box + T-Tables + key expansion ✅ 自测通过
- **Base编码**: 自定义 86 字符集 `qrcklmDoExthWJiHAp1s...` ✅
- **完整链路往返测试**: 加密→解密 7 步全部匹配 ✅

#### 4.3 密钥提取
- 实现 `$_ts.cd` 的 Base 解码（自定义字符集）
- **offset 推导**: 利用已知结构约束（keys[0]="64", keys[2]=48B）反推 8 字节 offset
  ```javascript
  offset[0] = secondPart[0] ^ 45     // keyCount = 45
  offset[1] = secondPart[1] ^ 2      // keys[0].length = 2
  offset[2] = secondPart[2] ^ 0x36   // keys[0][0] = '6'
  ...
  ```
- 实时验证：3 个新 cd 样本全部通过 ✅
- **关键发现**: 同一服务器配置下 offset 固定

#### 4.4 遇到瓶颈
- Cookie 格式正确（193 字符）但服务器拒绝（412）
- 原因 1: basearr 全零（需要真实指纹数据）
- 原因 2: basearr 长度不对（需要 300 项，不是 103 项）
- 原因 3: **加密链路与 rs-reverse 不完全一致**（无法解密 jsdom 的 Cookie）
- 结论: 本站点是更新版瑞数，加密细节有变化

### Phase 5: sdenv 方案落地（Day 3）

#### 5.1 安装
```bash
npm install sdenv --ignore-scripts
cd node_modules/sdenv && npx node-gyp rebuild
```
- sdenv 依赖原生模块 `documentAll.cc`（51行 C++，实现 `document.all` 的 undetectable 特性）
- 需要 C++ 编译器（g++ 或 MSVC）

#### 5.2 一次成功
```javascript
const { jsdomFromUrl } = require('sdenv');
const dom = await jsdomFromUrl(targetUrl, { userAgent });
// 等待 sdenv:exit 事件 → Cookie 自动生成
const cookies = dom.cookieJar.getCookieStringSync(targetUrl);
// cookies = "AV7KYchI7HHaS=60xxx..." → 200 ✅
```

#### 5.3 验证各种请求
| 请求类型 | 结果 |
|---------|------|
| GET 主页面 | 200 ✅ 只需 Cookie |
| GET + 查询参数 | 200 ✅ |
| POST（外部 HTTP）| 412 ❌ 需要后缀 |
| POST（VM 内 XHR）| 200 ✅ 自动加后缀 |
| POST + 搜索参数 | 200 ✅ 数据正确 |

#### 5.4 VM 限制
- 单个 sdenv 实例只能发一次 POST（第二次 `random` 变 undefined）
- 解决: 每次 POST 前重新 `init()`

---

## 四、本站点的具体防护配置

| 配置项 | 值 | 来源 |
|--------|-----|------|
| Cookie 名前缀 | `AV7KYchI7HHa` | keys[7] 第6段 |
| Cookie S 后缀 | `S` | HttpOnly，服务器返回 |
| Cookie T 后缀 | `T` | JS 生成 |
| URL 后缀参数名 | `8h6a7FPl` | keys[7] 第2段 |
| meta 标签 ID | `U07cUYgw9lbI` | keys[7] 第19段 |
| 主 JS 路径 | `/Qy6JDI4LYvbD/YWB5qmnxo45M.c7790ff.js` | keys[7] |
| 功能位标志 | `674` (二进制 1010100010) | keys[13] |
| GET 检查 | 只查 Cookie S | 实测 |
| POST 检查 | 查 Cookie + URL 后缀 | 实测 |

---

## 五、最终方案

### 5.1 工作原理

```
node client.js
    ↓
jsdomFromUrl(目标页面)
    ↓ sdenv 内部自动处理:
    ↓  1. 发送首次请求 → 获取 412 + $_ts + JS URL
    ↓  2. 下载并执行主 JS（完整浏览器环境模拟）
    ↓  3. eval 代码在 sdenv 的 jsdom 中运行
    ↓  4. VM 收集"环境指纹"（sdenv 提供假数据）
    ↓  5. 生成 Cookie T
    ↓  6. location.replace 触发 → sdenv:exit 事件
    ↓
获取 Cookie（cookieJar.getCookieStringSync）
    ↓
GET 请求: 直接用 Cookie（node http 模块）
POST 请求: 通过 VM 内 XHR（自动加后缀）
    ↓
获取真实数据 ✅
```

### 5.2 安装运行

```bash
cd sdenv
npx pnpm add sdenv                    # npm 有依赖解析 bug, 用 pnpm
npx pnpm rebuild sdenv                # 编译原生模块 (需要 VS Build Tools)
node client.js
```

> **注意**: npm 11.x + Node 24 对 sdenv 的依赖树解析存在死循环 bug, 必须用 pnpm 安装。

### 5.3 API 使用

```javascript
const { RuishuClient } = require('./client');

const client = new RuishuClient();
await client.init();  // 获取 Cookie

// GET（不需要后缀）
const page = await client.get('/path');

// POST（自动加后缀）
const data = await client.post('/api', 'key=value');

client.close();  // 每次 POST 后需要重新 init
```

---

## 六、为什么 jsdom 失败而 sdenv 成功

### 6.1 sdenv 的核心改造

| 改造点 | jsdom | sdenv |
|--------|-------|-------|
| `document.all` | 返回 `undefined` | C++ 原生实现，`typeof` 返回 `"undefined"` 但可调用 |
| canvas API | 报错 "install canvas" | 集成 canvas 包，支持 2d/webgl |
| 环境指纹 | 缺失大量 API | 完整模拟 screen/navigator/performance |
| `eval()` 作用域 | 与浏览器不同 | 修复了 eval 的作用域链 |
| `new Array(NaN)` | 直接抛错 | 容错处理 |

### 6.2 `documentAll.cc` 的作用

瑞数检测 `typeof document.all === "undefined"` 来判断是否在真实浏览器中。
- 浏览器: `typeof document.all === "undefined"` 但 `document.all` 可用（HTML 历史遗留特性）
- jsdom: `document.all` 不存在 → 检测失败
- sdenv: 用 V8 的 `ObjectTemplate::MarkAsUndetectable()` 实现 → 通过检测

---

## 七、纯算还原进度

**纯算方案已完成并验证通过 (HTTP 200)**

### 已完成 ✅
- CRC32、Huffman、AES-CBC、Base 编码全部独立实现并验证
- 加密链路 7 步往返测试全部通过
- 密钥提取（offset 推导法）可对任意新 cd 提取 45 组 keys
- Coder 外层 VM 重写 (eval 代码 100% 字节一致)
- codeUid 动态计算
- basearr 完整生成 (159B TLV, 含 type=2 动态映射)
- **端到端纯算验证通过: HTTP GET → keys → Coder → basearr → 加密 → Cookie T → 200**

### 纯算脚本位置
```
../revers/scripts/
├── pure_e2e.js    ← 入口 (验证通过 200)
├── coder.js       ← 外层 VM 重写器
└── basearr.js     ← basearr 生成器
```

### 仍有局限
- URL 后缀生成未纯算还原 (POST 请求仍需 sdenv 的 VM 内 XHR)
- keys XOR 偏移假设 keys[0]="64", 少数站点可能不成立

---

## 八、文件清单

### 本目录（sdenv/）— sdenv 方案
| 文件 | 说明 |
|------|------|
| `README.md` | 本文档 |
| `client.js` | sdenv Cookie + 后缀生成器 |
| `package.json` | 依赖配置 |

### 纯算目录（revers/）— 纯算方案
| 文件 | 说明 |
|------|------|
| `scripts/pure_e2e.js` | 端到端纯算入口 (已验证 200) |
| `scripts/coder.js` | 外层 VM 重写器 |
| `scripts/basearr.js` | basearr 生成器 |
| `captured/mainjs.js` | 主 JS 文件 (Coder 输入) |
| `SKILL_PLAN.md` | 瑞数通用逆向工作流 (5 阶段) |
| `RUISHU_KNOWLEDGE.md` | 集大成技术知识文档 |

---

## 九、关键经验总结

1. **瑞数的核心防护是环境检测，不是算法复杂度**
   - AES/CRC32/Huffman 都是标准算法
   - 真正的壁垒是 `typeof document.all`、canvas 指纹、WebGL 参数等浏览器特征检测

2. **三层 VM 嵌套增加了分析难度但不改变本质**
   - 外层 VM 用状态码序列（741 个状态）
   - 内层 VM 用传统操作码（114 个操作码）
   - 变量名每次加载随机化，但结构不变

3. **纯算还原可行但版本敏感**
   - rs-reverse 针对特定版本，版本更新后参数可能变化
   - offset 推导法（结构约束反推）是我们自创的方法，不依赖 task 执行

4. **sdenv 是最实用的通用方案**
   - 一次安装，所有瑞数站点通用
   - 不需要理解算法细节
   - 缺点：每次 POST 需要重新 init（约 2-3 秒）

5. **GET 和 POST 的防护不同**
   - 不是所有请求都需要后缀
   - 本站点 GET 只查 Cookie，POST 才查后缀
   - 这意味着很多场景只需要 Cookie 就够了

6. **油猴脚本要谨慎**
   - hook eval/Cookie 会被瑞数检测
   - PerformanceObserver 是安全的监控方式
   - 不要用 Proxy 包装原生对象

7. **逆向的正确顺序**
   - 先跑通（sdenv/浏览器）→ 再理解（纯算）→ 最后优化
   - 不要一开始就追求纯算，容易陷入死循环
