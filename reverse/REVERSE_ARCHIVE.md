# 瑞数 Cookie T 逆向全档案 — 完整心路历程

> 从零到纯算 200 的完整记录：每一次尝试、每一个弯路、每一个突破

---

## 目录

1. [项目背景](#一项目背景)
2. [Phase 1: 信息收集与首次接触](#二phase-1-信息收集与首次接触)
3. [Phase 2: VM 注入与状态机追踪 (22 步进化)](#三phase-2-vm-注入与状态机追踪)
4. [Phase 3: 加密链逆向](#四phase-3-加密链逆向)
5. [Phase 4: 密钥提取 — 从 hook 到纯算](#五phase-4-密钥提取)
6. [Phase 5: 外层 VM 重写 (Coder)](#六phase-5-外层-vm-重写)
7. [Phase 6: basearr 站点适配](#七phase-6-basearr-站点适配)
8. [Phase 7: 端到端纯算验证](#八phase-7-端到端纯算验证)
9. [弯路与教训](#九弯路与教训)
10. [VM 注入技术手册](#十vm-注入技术手册)
11. [未解决问题：URL 后缀](#十一未解决问题url-后缀)
12. [完整文件索引](#十二完整文件索引)

---

## 一、项目背景

| 项 | 说明 |
|---|------|
| 目标 | `http://202.127.48.145:8888` 知识产权海关备案查询 |
| 防护 | 瑞数信息 (Rivers Security) 5/6 代 |
| 架构 | 三层 VM + 自定义字节码 + 环境指纹检测 |
| 最终结果 | 纯算生成 Cookie T → HTTP 200 |

### 瑞数防护流程
```
浏览器 GET → 412 + HTML
  ├── Set-Cookie: xxxS=... (Cookie S, HttpOnly)
  ├── <script> $_ts.nsd=81494; $_ts.cd="qx2x..." </script>
  └── <script src="mainjs.js"> (205KB 混淆 JS)
       ↓
  mainjs 解码 cd → 生成 296KB eval 代码
       ↓
  eval → 三层 VM 启动 → 收集环境指纹 → 生成 basearr
       ↓
  basearr → Huffman → XOR → AES → CRC → AES → Base64 → Cookie T
       ↓
  location.replace → 带 Cookie S + Cookie T 再次访问 → 200
```

### 三层 VM 架构
```
Layer 1: mainjs 的字节码解释器
  ├── 字节码: $_ts.cd 解密后的数据
  ├── 指令集: ~100 个操作码
  └── 功能: 解析配置、生成 eval 代码

Layer 2: eval 代码的外层 VM (_$$o)
  ├── 字节码: aebi[1] (1014 项状态号)
  ├── 指令集: 741 个状态码 (二叉搜索树 switch-case)
  └── 功能: Cookie 生成、XHR 劫持、DOM 遍历

Layer 3: 内层 VM (_$gW/_$dm)
  ├── 字节码: 407 个函数, 共 43925B
  ├── 指令集: 114 个操作码 (栈操作/算术/控制流/函数调用)
  └── 功能: AES 加密、CRC32、Huffman、Base64
```

---

## 二、Phase 1: 信息收集与首次接触

### 2.1 抓包分析
- 浏览器 DevTools Network 面板
- 发现 URL 带加密后缀参数 `?8h6a7FPl=0xxx...`
- 两个 Cookie: `xxxS`(短, HttpOnly) + `xxxT`(长, JS 生成)
- 首次访问返回 412

### 2.2 开源方案调研
| 方案 | 代表项目 | 特点 |
|------|---------|------|
| 纯算逆向 | rs-reverse (⭐529) | 完全还原算法, 最快但版本敏感 |
| 补环境 | sdenv (⭐684) | 魔改 jsdom, 中等难度 |
| 浏览器代理 | mitmproxy | 最简单但需开浏览器 |

### 2.3 $_ts 配置结构
```javascript
$_ts = {
    nsd: 84277,           // 伪随机数种子
    cd: "qJzx...",        // 1700+ 字符加密数据
    cp: [
        "yruigzout...",   // cp[0]: Caesar+6 编码 1498 个字符串
        ["_$k8",...],     // cp[1]: 918 个变量名 (混淆映射)
        "qX[...",         // cp[2]: 243 项数值常量
        208883,           // cp[3]: mainjs 校验和
        7, 7, ""          // cp[4-6]: 版本配置
    ],
    aebi: [               // 字节码数组 (6 层)
        [492项],          // aebi[0]: 初始化 VM
        [1014项],         // aebi[1]: 主逻辑 VM
        [739项],          // aebi[2-5]: 排列映射表
        [181项], [40项], [7项]
    ]
}
```

### 2.4 密钥体系发现
从 `$_ts.cd` 提取 45 组密钥:

| Key | 大小 | 用途 |
|-----|------|------|
| keys[2] | 48B | KEYS48 (XOR + packet 内嵌) |
| keys[7] | ~296B | 配置串 (Cookie名/后缀参数名等) |
| keys[16] | 16B | KEY2 (外层 AES 密钥) |
| keys[17] | 16B | KEY1 (内层 AES 密钥) |
| keys[21] | ~10B | r2mkaTime 时间戳 |
| keys[22] | ~43B | type=6 加密数据 |
| keys[29-32] | 各4B | type=2 变量名映射 |
| keys[33-34] | 变长 | codeUid 计算参数 |

---

## 三、Phase 2: VM 注入与状态机追踪

### 22 步进化史 — 从盲目 hook 到完整算法还原

这是整个逆向过程最核心的部分。我们通过 22 个渐进式脚本, 从完全不了解 VM 内部结构, 一步步追踪到完整的加密管线。

---

### Step 1-3: 基础捕获

#### Step 1: 数据采集套件 (`step1_capture.js`)
**技术**: vm.runInContext 拦截 + sdenv 运行

```javascript
const origRun = vm.runInContext;
vm.runInContext = function(code, ctx, opts) {
    if (code.includes('$_ts.cd=')) {
        // 捕获 $_ts 初始化脚本
        fs.writeFileSync('ts_init.js', code);
    }
    if (code.length > 250000) {
        // 捕获 eval 代码 (>250KB)
        fs.writeFileSync('eval_code.js', code);
    }
    return origRun.call(this, code, ctx, opts);
};
```

**成果**: 采集到完整的 412.html, mainjs.js, eval_code.js, cookie.txt
**发现**: 打包数据是确定性的 — 相同配置 → 相同代码

#### Step 2: 本地重放验证 (`step2_test_local.js`)
**技术**: 本地 HTTP 服务器 + sdenv 重放

搭建本地服务器, 用捕获的静态文件喂给 sdenv:
- **结果**: eval 代码逐字节一致, 证明代码生成无随机性
- **意义**: 可以离线分析, 不用每次联网

#### Step 3: Debug 注入 (`step3_debug.js`)
**技术**: Object.defineProperty 劫持 Document.prototype.cookie

```javascript
// 注入到 eval 代码前面
const inject = `
Object.defineProperty(Document.prototype, 'cookie', {
    set: function(val) {
        console.log('COOKIE SET:', val.substring(0, 50));
        // 保存原始设置
        this.__cookies = (this.__cookies || '') + val;
    },
    get: function() { return this.__cookies || ''; }
});
`;
```

**成果**: 捕获到 Cookie 写入时刻, 但无法深入追踪数据来源
**决策**: 需要更深层的状态追踪

---

### Step 4-9: 状态机追踪

#### Step 4: 管线追踪 (`step4_trace_pipeline.js`)
**技术**: 在 _$dm while(1) 循环中注入日志

```javascript
// 在 while(1){_$_Z=_$j8[_$bh++]; 前注入
const inject = `
var __states = [];
// 在每次状态分发前记录
`;
```

**发现**: 53 个唯一状态, **State 324 是加密入口点**
**产出**: pipeline_trace.json

#### Step 5: 深度追踪 (`step5_deep_trace.js`)
**技术**: 完整参数/返回值序列化

扩展 Step 4, 对每个状态的输入输出做完整快照:
- 数组: 记录长度 + 前 10 个元素
- 字符串: 记录长度 + 前 50 字符
- 函数: 记录 toString().length

**关键发现**: State 324 → State 380 → Cookie 写入的调用链

#### Step 6: State 324 深入 (`step6_324_deep.js`)
**技术**: IIFE 函数包装, 捕获输入/输出

```javascript
// 包装 _$hr (state 324)
const orig_hr = _$hr;
_$hr = function() {
    console.log('324 IN:', arguments);
    const result = orig_hr.apply(this, arguments);
    console.log('324 OUT:', result);
    return result;
};
```

**重大发现**:
- fn_len=36 → Huffman 编码函数
- fn_len=110 → AES 加密函数
- fn_len=206 → Base64 编码函数
- basearr (1117B) → Huffman (154B) → 加密 (224B)

#### Step 7: 内层函数调用图 (`step7_324_internals.js`)
**技术**: 正则批量包装 46 个内层函数

```javascript
// 用正则找到所有 wrapper 函数并包装
code = code.replace(/function (_\$\w+)\(/g, (match, name) => {
    return `function ${name}(/* wrapped */`;
    // 每个函数入口记录: 函数名 + 参数类型
});
```

**发现**: 函数调用子图 — 从 State 324 到各个加密子函数的完整路径

#### Step 8: 寄存器追踪 (`step8_func_trace.js`)
**技术**: 监控 _$c1 (累加器) 在 while 循环中的变化

**发现**: 数据流转过程:
```
array → string → function → object → array → ...
```
追踪到关键的类型变换点

#### Step 9: 内层 VM 入口 hook (`step9_inner_vm.js`)
**技术**: 逗号表达式注入

```javascript
// 在 _$gW 调用处用逗号表达式注入
// 原: _$gW(_$ar)
// 改: (console.log('gW:', _$ar._$hn.length), _$gW(_$ar))
```

**发现**: 内层 VM 执行 206 字节函数做最终 Base64 编码

---

### Step 10-15: 中间数据提取

#### Step 10: Huffman 与加密数据 (`step10_huffman_encrypt.js`)
**技术**: _$gH 返回值过滤

按函数 ID 过滤:
- fn=140: basearr 组装 (1117B 输入)
- fn=161: Huffman 压缩 (154B 输出)
- fn=110: AES 加密中间值

#### Step 11: 完整管线数组 (`step11_full_arrays.js`)
**技术**: 关键函数 ID 过滤 (140, 161, 38, 110, 263, 42, 206, 106)

**关键验证**:
- fn=140 输入: 完整 basearr (1117B)
- fn=161 输出: Huffman 结果 (154B) — 在最终 Cookie 中找到偏移匹配!
- fn=206 输出: Base64 字符串 = Cookie T 去掉 "0" 前缀

**这是第一次看到完整的数据管线!**

#### Step 12: 操作码追踪 (`step12_dm_opcodes.js`)
**技术**: 记录 _$dm while(1) 循环中的每个操作码

State 324 中约 2000-3000 个操作码, 追踪到:
```
1117B → 154B → 224B → base64
```
数组大小变化的精确时刻

#### Step 13: State 380 精确追踪 (`step13_state380.js`)
**技术**: 聚焦 State 380 (Cookie 组装)

**发现**: State 380 完成:
1. Huffman 编码
2. Header 构造 (21B)
3. CRC32 计算
4. 外层加密 → 224B
5. 格式化输出

#### Step 14: l0[506] 函数 (`step14_l0_506.js`)
**技术**: 替换 `return _$cR[506](_$ar)` 为带日志版本

**发现**: l0[506] = 最终 AES-CBC 加密函数
- 输入: 193B (21B header + 154B Huffman + 4B CRC + 14B padding)
- 输出: 224B 加密结果

#### Step 15: Base64 前数据 (`step15_pre_b64.js`)
**技术**: 内层 VM 函数 IO 按长度过滤

**验证**: fn=206 输入恰好是 224B 加密数组, 输出是 Base64 字符串

---

### Step 16-18: 字节码 VM 分析

#### Step 16: fn=206 字节码追踪 (`step16_fn206_bytecode.js`)
**技术**: 在 _$gW 循环内按函数长度条件追踪

```javascript
if (_$gH._$hn.length === 206) {
    // 记录每个操作码 + 栈状态
}
```

**发现**: 206 条指令执行, 完整追踪了 Base64 生成过程

#### Step 17: fn=206 栈状态精确追踪 (`step17_fn206_detail.js`)
**技术**: 每个操作码记录栈顶 3 个值

```
PC: 0, op: 12, stack: [224B_array]
PC: 1, op: 54, stack: [224B_array, function]
PC: 2, op: 42, stack: [result_string]
...
```

#### Step 18: op=54/op=42 函数追踪 (`step18_op54_func.js`)
**技术**: 逗号表达式包装函数调用

**发现**:
- op=54 = 函数调用 (通过 _$ms 数组)
- op=42 = 方法调用 (直接调用)
- 捕获到每个函数的 toString() 源码

---

### Step 19-22: 完整重建

#### Step 19: 填补空白 (`step19_fill_gaps.js`)
**技术**: 增强版 _$bO 包装 + _$gW 操作码追踪

一次性捕获所有遗漏:
1. **_$bO** (Huffman 编码器): 函数源码 + 权重表 + 完整 IO
2. **_$b5** (CRC32): 函数源码 + 输入 (154B) + 输出 (32位数)
3. **_$hk** (Base64): 函数源码 + 输入 (224B) + 输出 (字符串)
4. **所有密钥**: 通过 _$_0 访问函数捕获

**至此, 加密管线的每一步都有完整的输入/输出数据对!**

#### Step 20: 加密引擎 (`step20_encryption.js`)
**技术**: 包装 _$dg (加密分发器)

**发现**:
- _$hd: 初始化加密对象 (key + mode)
- _$eL: 执行加密 (AES-128-CBC)
- 内层加密: key=keys[17], IV=全零
- 外层加密: key=keys[16], IV=随机 16B

#### Step 21: 密钥导出 (`step21_keys.js`)
**技术**: Phase 标记 + _$cR[34] 转储

在 _$hr 入口设置 phase 标记, 首次访问时导出完整密钥数组:
- keys[2]: 48B XOR 掩码
- keys[16]: 16B 外层 AES 密钥
- keys[17]: 16B 内层 AES 密钥
- keys[21]: r2mkaTime 时间戳
- 共 34 个有效密钥条目

#### Step 22: 终极一次性捕获 (`step22_definitive.js`)
**技术**: 最小化注入, 单次 Cookie 写入时全量捕获

```
一次运行, 捕获:
├── bO_in/bO_out: Huffman 输入 (basearr) + 输出
├── dg_in/dg_out: AES 输入 (154B) + 输出 (224B)
├── b5_in/b5_out: CRC32 输入 + CRC 值
├── hk_in/hk_out: Base64 输入 (224B) + 输出
└── final cookie: 完整 Cookie T
```

**交叉验证**:
- bO_out === dg_in.data (Huffman 输出 → 加密输入) ✓
- dg_out === hk_in (加密输出 → Base64 输入) ✓

**这个文件是最终的参考基准, 完整记录了算法规格。**

---

## 四、Phase 3: 加密链逆向

### 从 Cookie T 倒推每一步

```
Cookie T: "0WNKAHc0EoJ2l7mF..." (300 字符)
  ↑ [去掉前缀 "0"]
  ↑ [自定义 Base64 解码, 字母表 64 字符]
224B 字节数组
  ↑ [分离: IV(16B) + 密文(208B)]
  ↑ [AES-128-CBC 解密, key=keys[16]]
193B = CRC32(4B) + 189B
  ↑ [验证 CRC32, 多项式 0xEDB88320]
189B = [2, 8, nonce(8B), 48, keys48(48B), lenEnc, cipher]
  ↑ [提取 cipher, AES-128-CBC 解密, key=keys[17], IV=0]
~118B XOR'd Huffman 数据
  ↑ [前 16 字节 XOR keys[2][0:15]]
~118B Huffman 编码数据
  ↑ [Huffman 解码, 权重: 0→45, 255→6, 其余→1]
154-159B basearr (TLV 结构)
```

### 混合验证 — 证明加密链正确

`test_hybrid2.js` 做了关键验证:
1. sdenv 运行 → 获取真实 Cookie T
2. 纯算解密 Cookie T → 提取真实 basearr
3. 用真实 basearr + 纯算加密 → 生成新 Cookie T
4. 新 Cookie T → HTTP 200 ✅

**这证明了: 加密链 100% 正确, 唯一剩余问题是 basearr 生成。**

### 加密链中的关键常量

| 常量 | 值 | 来源 |
|------|---|------|
| Base64 字母表 | `qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d` | mainjs cp[2] 前 64 字符 |
| Huffman 权重 | 0→45, 255→6, 其余→1 | 所有版本通用 |
| CRC32 多项式 | 0xEDB88320 | 标准 |
| 内层 AES IV | 全零 (16B) | 固定 |
| Packet 标记 | [2, 8] | 固定 |
| KEYS48 长度标记 | 48 | 固定 |

---

## 五、Phase 4: 密钥提取

### 5.1 Hook 方式 (extract_keys.js)

**技术**: sdenv + vm.runInContext 注入

```javascript
// 劫持 _$_0 函数 (密钥访问器)
const orig = `function _$_0(_$gH)`;
const hook = `function _$_0(_$gH) {
    if (!__ex.done && _$gH === 17) {
        __ex.key1 = _$cR[34][17]; // 内层 AES 密钥
        __ex.key2 = _$cR[34][16]; // 外层 AES 密钥
        __ex.keys48 = _$cR[34][2]; // XOR 掩码
        __ex.done = true;
    }`;
```

**优点**: 100% 准确
**缺点**: 依赖 sdenv, 依赖精确函数名, 速度慢

### 5.2 纯算方式 (extract_keys_pure.js) — 突破!

**技术**: 已知明文攻击 + 自定义 Base64 解码

```javascript
// cd 字符串 → 自定义 Base64 解码 → 字节数组
// 前 2 字节 = code 段长度
// code 段: bytes[2..end]
// keys 段: bytes[end+1..]

// 已知明文: keys[0]="64", keys[1]="64", keys[2]=48 字节
// XOR 偏移推导:
const offset = [
    sp[0] ^ 45,    // keyCount = 45
    sp[1] ^ 2,     // keys[0].length = 2
    sp[2] ^ 0x36,  // keys[0][0] = '6' (ASCII)
    sp[3] ^ 0x34,  // keys[0][1] = '4' (ASCII)
    sp[4] ^ 2,     // keys[1].length = 2
    sp[5] ^ 0x36,  // keys[1][0] = '6'
    sp[6] ^ 0x34,  // keys[1][1] = '4'
    sp[7] ^ 48     // keys[2].length = 48
];

// 8 字节循环 XOR 解密整个 keys 段
const decrypted = keysPart.map((b, i) => b ^ offset[i % 8]);
```

**这是最优雅的解法** — 纯数学分析, 零 VM 依赖, 毫秒级完成。

### 5.3 变长长度编码
```
0xxxxxxx (< 128):   1 字节长度
10xxxxxx (128-191):  2 字节 ((x&63)<<8 | next)
110xxxxx (192-223):  3 字节 ((x&31)<<16 | next<<8 | next)
```

### 5.4 自检机制
```javascript
if (keys.length < 45) throw new Error('XOR 偏移错误');
if ([29,30,31,32].some(i => keys[i]?.length !== 4))
    throw new Error('keys 结构异常');
```

---

## 六、Phase 5: 外层 VM 重写

### 6.1 为什么需要 Coder

Coder 不是重写整个 VM — 只重写 **mainjs 的代码生成逻辑**:
- mainjs 读取 cd + 静态数据 → 生成 eval 代码
- Coder 用纯 JS 重现这个过程
- 获取 `functionsNameSort` 和 `mainFunctionIdx` → 算 codeUid

### 6.2 从 mainjs 提取静态数据

```javascript
// 找 mainjs 中 4 个最长引号字符串
extractImmucfg(mainjs) → {
    globalText1,  // 最长, 主编码数据
    cp0,          // Caesar+6 编码字符串表
    cp2,          // 数值常量表
    globalText2   // 第二段编码数据
}
```

### 6.3 核心 PRNG

```javascript
// 所有瑞数版本通用的伪随机数生成器
function prng(seed) {
    seed = 15679 * (seed & 0xFFFF) + 2531011;
    return seed;
}
```

用于 Fisher-Yates 洗牌: 变量名排列、函数排序等。

### 6.4 代码段生成流程

```
parseGlobalText1:
  6 × getCode()                          → opmate 标志
  getLine(getCode()*55295 + getCode())    → keycodes (变量名编码)
  1 × getCode()
  getLine(getCode()*55295 + getCode())    → r2mkaText (任务树)
  1 × getCode()                          → codeNum (代码段数量)
  for i=0..codeNum → _gren(i)            → 生成代码段

每个 _gren(i):
  8 × getCode()      → 局部 opmate 标志
  3 × getList()      → listK, listH, listC
  listC 配对后洗牌    → wrapper 函数映射
  1 × getCode()      → bf (opcode 上限)
  1 × getList()      → aebi 数据
  1 × getCode()      → 函数数量
  N × getList()      → 函数代码, 洗牌
  1 × getCode()      → opcode 数量
  M × getList()      → opcode 实现
  → 拼接: IIFE头 + wrapper + 代码 + while(1) + if/else
```

### 6.5 踩过的坑

1. **gren(0) 的 IIFE 参数**: 用**全局 opmate**, 不是局部
2. **while(1) 中的 _$aw**: 也用全局 opmate
3. **var 声明**: 用 _$$6 (mate index 1), 不是 _$b$ (mate index 2)
4. **hasDebug 时**: 每个 gren 段重建 debugger PRNG, posis 累积
5. **_ifElse 递归**: start 变量在 for 循环中被修改, else 分支用修改后的 start
6. **escape 序列**: 用 Function 构造器而非 JSON.parse

### 6.6 codeUid 计算

```javascript
const funcIdx = parseInt(ascii(keys[33]));
const sliceMul = parseInt(ascii(keys[34]));
const func = coder.functionsNameSort[funcIdx];
const mainCode = evalCode.slice(mainFunctionIdx[0], mainFunctionIdx[1]);
const one = CRC32(func.code);
const len = Math.floor(mainCode.length / 100);
const two = CRC32(mainCode.substr(len * sliceMul, len));
const codeUid = (one ^ two) & 65535;
```

### 6.7 验证
**Coder 输出的 eval 代码和 mainjs 原始输出: 100% 字节一致** (296,097 chars)

---

## 七、Phase 6: basearr 站点适配

### 7.1 方法论: 数据驱动, 不碰内层 VM

rs-reverse 的核心教训: 拿真实 basearr 逐字节对照已知数据源, 不要试图理解内层 VM。

### 7.2 参考数据采集

```javascript
// 用 sdenv 运行 → 捕获真实 Cookie T → 解密得到真实 basearr
const dom = await jsdomFromUrl(url, { userAgent: UA });
// 等待 sdenv:exit
const cookie = dom.cookieJar.getCookieStringSync(url);
// 解密 cookie → basearr (159B)
```

### 7.3 TLV 字段逐个匹配

#### type=3 (73B) — 环境指纹
```
[4..7]  = CRC32(UserAgent)              ← uuid() 函数
[8+]    = platform 字符串长度 + "MacIntel"
[+]     = execNumberByTime              ← 3ms 内循环计数 (~1600)
[+]     = execRandomByNumber            ← 98 个随机数的均值/方差
[57..60] = CRC32(pathname.toUpperCase()) ← 跨会话固定
```

#### type=10 — 时间+网络 (关键发现)
```
[2..5]  = r2mkaTime + runTime - startTime  ← 不是纯 r2mkaTime!
[10..17] = numToNumarr8(random*1048575*2^32 + currentTime)
         ← 高 20 位随机, 低 32 位时间戳
[19+]   = hostname 字符串
```

**type=10[10..17] 的发现是重大突破** — 这 8 个字节困扰了很久, 最终从 rs-reverse 的 len157.js 中找到公式。

#### type=7 (12B) — 标识
```
[8..9]  = flag (站点特定, 我们的是 [11,14]=2830)
[10..11] = codeUid (CRC32 函数代码 XOR)
```

#### type=2 (4B) — 会话标识 (数据驱动破解)

观测 3 个 session:
```
Session A: [103, 181, 101, 224]
Session B: [181, 101, 103, 224]
Session C: [101, 181, 224, 103]
```

**不是简单排列!** 通过 5 session 采集发现:
- cp1 = grenKeys(918, nsd) 生成 918 个变量名
- keys[29..32] 的变量名在 cp1 中查找索引
- cp1 索引固定: [11, 5, 23, 8]
- 对应固定值表: `[103,0,102,203,224,181,108,240,101,126,...]`
- 建立映射表即可, **无需实现 r2mka runTask**

#### type=6 (16B) — 加密数据
```
keys[22] → ascii → 自定义 Base64 解码 → 32 字节
前 16B = IV, 后 16B = 密文
AES-128-CBC 解密 (key=keys[16], iv=前16B) → 8 字节明文
```

---

## 八、Phase 7: 端到端纯算验证

### 最终流程

```javascript
// 1. HTTP GET → 412
const r1 = await httpGet(PATH);
const cd = r1.body.match(/\$_ts\.cd="([^"]+)"/)[1];
const nsd = parseInt(r1.body.match(/\$_ts\.nsd=(\d+)/)[1]);
const cookieS = r1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');

// 2. 纯算提取 keys
const keys = extractKeys(cd);

// 3. Coder 重写 → codeUid
const coder = new Coder(nsd, cd, mainjs);
coder.run();
const codeUid = computeCodeUid(coder, keys);

// 4. 生成 basearr
const basearr = buildBasearr(config, keys);

// 5. 加密
const cookieT = generateCookie(basearr, keys);

// 6. 验证
const r2 = await httpGet(PATH, cookieS + '; ' + cookieName + '=' + cookieT);
// r2.status === 200 ✅
```

### 连续验证: 多次运行全部 200

---

## 九、弯路与教训

### ❌ 弯路 1: 反编译内层 VM (浪费 2 天)

尝试理解 740 个 state 的内层 VM:
- 追踪了 fn=161 (Huffman) 的 161 条字节码
- 追踪了 fn=206 (Base64) 的 206 条字节码
- 实现了 114 个操作码的反汇编器
- 产出 5037 行反汇编代码

**结论**: 完全理解了架构, 但对 basearr 生成**毫无帮助**。basearr 的值通过数据对比找来源, 不是通过读 VM 代码。

### ❌ 弯路 2: 补环境跑 eval 代码 (浪费 1 天)

用 Node.js vm.createContext + 170+ 行 DOM mock:
- 旧版 mainjs 成功运行
- 新版 mainjs 报 `Invalid array length`
- 尝试 Proxy 包装 Array、hook push、try-catch — 全失败

**根本原因**: `document.all` 需要 C++ V8 Addon (MarkAsUndetectable), 纯 JS 做不到。

### ❌ 弯路 3: 硬编码 type=2 (浪费半天)

直接写死 `[103, 181, 101, 224]`:
- 第一个 session 成功
- 第二个 session 失败
- 原因: type=2 和 nsd 相关, 每个 session 的 cp1 洗牌不同

### ❌ 弯路 4: 假设 rs-reverse 公式通用

rs-reverse 的 `idx*7+6` (type=2 映射) 和 `flag: 4114` (type=7) 都是特定版本/站点参数。
直接套用 → 失败。必须从自己的参考数据中提取。

### ✅ 正确顺序

```
1. 先跑通 (sdenv/浏览器) → 证明目标可行
2. 混合验证 (sdenv basearr + 纯算加密 = 200) → 证明加密链正确
3. 再做 basearr → 知道问题只在 basearr
4. 数据驱动逐字节匹配 → 不猜, 每个字节有出处
```

---

## 十、VM 注入技术手册

### 10.1 vm.runInContext 拦截

**最基础的 hook — 拦截所有 VM 代码执行**

```javascript
const origRun = vm.runInContext;
vm.runInContext = function(code, ctx, opts) {
    if (code.length > 250000) {
        // 大代码块 = eval 代码, 可以在这里注入
        code = injectCode + code;
    }
    if (code.includes('$_ts.cd=')) {
        // $_ts 初始化脚本, 提取 cd
        const m = code.match(/\$_ts\.cd="([^"]+)"/);
    }
    return origRun.call(this, code, ctx, opts);
};
```

**适用**: 捕获 eval 代码、提取 cd/nsd、注入 hook 代码

### 10.2 Object.defineProperty 劫持

**劫持 DOM 属性的读写**

```javascript
Object.defineProperty(Document.prototype, 'cookie', {
    set: function(val) {
        console.log('[cookie set]', val.substring(0, 50));
        this.__cookie_store = val;
    },
    get: function() {
        return this.__cookie_store || '';
    }
});
```

**适用**: 捕获 Cookie 写入时刻和最终值

### 10.3 函数包装 (IIFE 模式)

**在不修改原函数的情况下拦截输入输出**

```javascript
// 找到目标函数定义
const target = 'function _$hr(';
const pos = code.indexOf(target);

// 在函数体开头注入
const inject = `
    if (typeof __phase !== 'undefined' && __phase === '324') {
        console.log('[_$hr] args:', JSON.stringify(Array.from(arguments).map(a =>
            Array.isArray(a) ? {type:'array', len:a.length} : typeof a
        )));
    }
`;
code = code.substring(0, pos + target.length + bodyStart) + inject + code.substring(pos + target.length + bodyStart);
```

**适用**: 追踪特定函数的调用

### 10.4 逗号表达式注入

**最精巧的注入方式 — 在表达式中间插入代码**

```javascript
// 原代码: _$gW(_$ar)
// 注入后: (console.log('gW:', _$ar._$hn.length), _$gW(_$ar))

// 原代码: return _$cR[506](_$ar)
// 注入后: return (console.log('l506:', _$ar.length), _$cR[506](_$ar))
```

**优点**: 不改变代码结构和返回值
**适用**: 在不改变控制流的前提下记录中间值

### 10.5 Phase 标记

**区分不同执行阶段的数据**

```javascript
// 全局相位变量
var __phase = '';

// 在 State 324 入口设置
// 在 _$hr 函数开头:
__phase = '324';

// 在其他 hook 中检查:
if (__phase === '324') {
    // 只在加密阶段记录
}
```

**适用**: 避免在非关键阶段产生大量噪音日志

### 10.6 正则批量函数包装

**一次性包装多个函数**

```javascript
// 找到所有 wrapper 函数并批量包装
code = code.replace(
    /function (_\$[a-zA-Z0-9]+)\(([^)]*)\)\s*\{/g,
    (match, name, args) => {
        return `function ${name}(${args}) {
            if (__phase === '324') console.log('[${name}] called');
        `;
    }
);
```

**适用**: 追踪函数调用图

### 10.7 sdenv 事件监听

```javascript
dom.window.addEventListener('sdenv:exit', () => {
    // VM 执行完毕, Cookie 已生成
    const cookies = dom.cookieJar.getCookieStringSync(baseUrl);
});
```

---

## 十一、未解决问题: URL 后缀

### 后缀结构

```
原始: /searchAction!getVRecordListPage.do
实际: /searchAction!getVRecordListPage.do?8h6a7FPl=0R5Hmral...
                                         ^^^^^^^^ ^^^^^^^^^^
                                         参数名    加密值
```

后缀参数名来自 keys[7].split(';')[1]。

### 后缀值结构
```
"0" + Base64([nonce(5B), session(49B), signature(34-66B)])
```

### 已知信息
- GET 请求**不需要后缀**, 只需 Cookie
- POST 请求**需要后缀**
- sdenv 方案中, VM 内的 XHR 会自动加后缀
- 纯算目前没有实现后缀生成

### 后缀生成的实现方向
1. 追踪 VM 中 XHR.prototype.open 的劫持逻辑
2. 找到后缀生成函数 (_$l0[500])
3. 用类似 Step 4-22 的追踪方法提取算法
4. 或者从 rs-reverse 的后缀实现中参考

### 后缀逆向的优先级
- 如果只需要 GET 数据: 不需要后缀, 纯算已够用
- 如果需要 POST 查询: 目前用 sdenv VM 内 XHR 方案
- 纯算后缀: 需要额外逆向工作

---

## 十二、完整文件索引

### 生产脚本 (`revers/scripts/`)
| 文件 | 说明 |
|------|------|
| `run.js` | 全动态入口 (自动下载 mainjs) |
| `pure_e2e.js` | 本地版入口 (依赖 captured/mainjs.js) |
| `coder.js` | 外层 VM 重写器 |
| `basearr.js` | basearr 生成器 |

### 原始逆向脚本 (`learn_js/reverse/`)

#### archive/steps/ (22 步)
| 文件 | 技术 | 成果 |
|------|------|------|
| step1_capture.js | vm.runInContext 拦截 | 采集原始数据 |
| step2_test_local.js | 本地重放 | 验证确定性 |
| step3_debug.js | cookie setter hook | 捕获写入时刻 |
| step4_trace_pipeline.js | while(1) 注入 | 发现 53 个状态 |
| step5_deep_trace.js | 全参数序列化 | 324→380 调用链 |
| step6_324_deep.js | IIFE 包装 | 发现 Huffman/AES/Base64 函数 |
| step7_324_internals.js | 批量函数包装 | 完整调用图 |
| step8_func_trace.js | 寄存器监控 | 数据类型变换追踪 |
| step9_inner_vm.js | 逗号表达式注入 | 内层 VM 入口 |
| step10_huffman_encrypt.js | 返回值过滤 | Huffman + AES 数据 |
| step11_full_arrays.js | 多函数 ID 过滤 | **完整数据管线** |
| step12_dm_opcodes.js | 操作码追踪 | 2000+ 操作码序列 |
| step13_state380.js | 聚焦 380 | Cookie 组装流程 |
| step14_l0_506.js | 替换函数 | 最终 AES 加密 |
| step15_pre_b64.js | 函数长度过滤 | Base64 前 224B |
| step16_fn206_bytecode.js | 条件字节码追踪 | Base64 指令序列 |
| step17_fn206_detail.js | 栈状态快照 | 206 条指令栈 |
| step18_op54_func.js | 函数代码捕获 | 函数源码提取 |
| step19_fill_gaps.js | 增强包装 | **所有空白填补** |
| step20_encryption.js | 加密分发器包装 | AES 引擎规格 |
| step21_keys.js | Phase 标记转储 | 完整密钥集 |
| step22_definitive.js | 最小化一次性 | **终极参考基准** |

#### core/ (7 个核心脚本)
| 文件 | 说明 |
|------|------|
| decrypt_vm_cookie.js | Cookie 逆向解密工具 (7 步反向) |
| extract_keys.js | Hook 方式密钥提取 (sdenv + vm 注入) |
| extract_keys_pure.js | **纯算密钥提取** (已知明文攻击) |
| generate_cookie.js | 纯算加密 (硬编码密钥, 自验证) |
| pure_cookie.js | 单文件端到端 (简化版 basearr) |
| run_mainjs.js | 最小化 VM 沙箱 (捕获 eval 代码) |
| test_hybrid2.js | **混合验证** (sdenv basearr + 纯算加密 = 200) |

#### basearr_gen/debug_scripts/ (10 个调试脚本)
| 文件 | 说明 |
|------|------|
| collect_data.js | sdenv 参考数据采集 |
| collect_type2.js | type=2 多 session 采集 |
| collect_fv20_map.js | fixedValue20 映射分析 (5 session) |
| compute_session.js | codeUid + fixedValue20 计算 |
| cookie.js | 加密链端到端验证 |
| extract_r2mka.js | r2mka 文本提取 |
| r2mka_parser.js | 任务树递归解析器 |
| fix_r2mka.js | escape 序列修复 |
| check_keynum.js | keynameNum 动态提取 |
| extract_keynum.js | 正则提取参数 |

#### analysis/ (11 个文档)
| 文件 | 说明 |
|------|------|
| BASEARR_ALGORITHM.md | 所有 TLV 字段详细规格 + 辅助函数 |
| COOKIE_ALGORITHM.md | keys 提取 + 加密链完整算法 |
| COOKIE_FLOW.md | 端到端数据流图 |
| DECOMPILE.md | 三层 VM 架构 + fn=161 字节码分析 |
| decompile_type10_v2.md | type=10 描述符状态分析 |
| disasm_fn161.js | fn=161 反汇编器工具 |
| PLAN.md | 5 阶段工作计划 |
| PROGRESS.md | 详细进度追踪 |
| RS_REVERSE_DIFF.md | 与 rs-reverse 源码对比 |
| RS_REVERSE_METHOD.md | rs-reverse 方法论分析 |
| STATUS.md | 当前完成状态总结 |

---

## 附录: 技术演进总结

```
依赖层级:  sdenv 全依赖 → Hook 半依赖 → 纯数学零依赖
攻击方式:  Hook 拦截 → 已知明文攻击 → 算法重构
验证方式:  信任 sdenv → 解密验证 → 数学证明 (加密↔解密往返)
性能:      秒级 (sdenv) → 毫秒级 (纯算)

最终: 一个 HTTP 请求 + 纯 JS 计算 = 有效 Cookie T
```
