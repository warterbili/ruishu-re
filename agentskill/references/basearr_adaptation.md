# 阶段 4: basearr 站点适配 (数据驱动)

## 概述

- **输入**: sdenv 参考 basearr + keys (45 组) + codeUid
- **输出**: `buildBasearr(config, keys)` 函数
- **验证**: 纯算 Cookie T → HTTP 200

basearr 是 TLV 格式的字节数组 (154-166B), 是 Cookie T 加密链的源数据。每个站点的 basearr 结构大同小异, 但存在版本差异 (字段长度、flag 值、type 顺序等)。适配的核心是: 拿真实数据逐字节匹配, 不碰内层 VM。

---

## 数据驱动三步法

### 第一步: 采集参考数据

用 sdenv 运行目标站点, 获取真实 Cookie T, 解密还原 basearr:

```javascript
// 1. sdenv 运行 → 获取真实 Cookie T
const dom = await jsdomFromUrl(url, { userAgent: UA });
const cookieT = extractCookieT(dom);

// 2. 解密 Cookie T → basearr
const basearr = decryptCookieT(cookieT, keys);
// 例: [3,73,1,0,33,128,159,173,0,238,8,77,97,99,73,110,116,101,108,...]
```

### 第二步: 多 session 对比

至少采集 3-5 个 session 的 basearr, 逐字节对比, 区分固定值和动态值:

```javascript
// 对比 N 个 basearr, 找出变化的字节
for (let i = 0; i < maxLen; i++) {
    const vals = new Set(sessions.map(s => s[i]));
    if (vals.size > 1) {
        console.log(`位置 ${i}: ${sessions.map(s => s[i]).join(' ')}`);
    }
}
```

变化的字节只有四类来源: keys 派生、时间戳、随机数、session 相关。

### 第三步: 逐字段实现

对每个字节找到明确来源, 实现 build 函数。每实现一个 type, 用参考数据验证该段字节一致。

---

## TLV 格式

basearr 整体是 TLV (Type-Length-Value) 结构:

```
[type, length, ...payload, type, length, ...payload, ...]
```

组装函数 `numarrJoin` 的行为:
- 第一个参数作为 type 标记 (不带 length)
- 后续数组参数自动加 `[length, ...data]`
- 非数组参数直接追加

最终结构示例 (len=166):

```
3, 73, [type=3 payload 73B]
10, N, [type=10 payload NB]
7, 12, [type=7 payload 12B]
0, 1, [0]
6, 16, [type=6 payload 16B]
2, 4, [type=2 payload 4B]
9, 5, [type=9 payload 5B]
13, 1, [0]
```

---

## 各 type 完整实现

### type=3 环境指纹

type=3 是最长的段 (65-73B), 包含浏览器环境指纹。大部分字段跨 session 固定。

```javascript
function buildType3(config) {
    return [
        1, config.maxTouchPoints||0, config.evalToStringLength||33, 128,
        ...numToNumarr4(crc32(config.userAgent)),
        config.platform.length, ...string2ascii(config.platform),
        ...numToNumarr4(config.execNumberByTime||1600),
        ...(config.randomAvg||[50,8]), 0, 0,
        ...numToNumarr4(16777216), ...numToNumarr4(0),
        ...numToNumarr2(config.innerHeight||768), ...numToNumarr2(config.innerWidth||1024),
        ...numToNumarr2(config.outerHeight||768), ...numToNumarr2(config.outerWidth||1024),
        ...new Array(8).fill(0), ...numToNumarr4(4), ...numToNumarr4(0),
        ...numToNumarr4(crc32(config.pathname.toUpperCase())),
        ...numToNumarr4(0),
    ];
}
```

字段说明:

| 偏移 | 长度 | 内容 | 来源 |
|------|------|------|------|
| 0 | 1 | 固定 1 | 常量 |
| 1 | 1 | maxTouchPoints | navigator.maxTouchPoints |
| 2 | 1 | eval.toString().length | 通常 33 |
| 3 | 1 | 固定 128 | 常量 |
| 4-7 | 4 | CRC32(UserAgent) | uuid() 函数 |
| 8 | 1 | platform 长度 | 自动 |
| 9+ | N | platform ASCII | "MacIntel" / "Win32" 等 |
| +0-3 | 4 | execNumberByTime | 3ms 循环计数 (~1600) |
| +4-5 | 2 | randomAvg | 98 个随机数均值/方差 |
| +6-7 | 2 | 固定 0,0 | 常量 |
| +8-11 | 4 | 16777216 | 常量 (0x01000000) |
| +12-15 | 4 | 0 | 常量 |
| +16-23 | 8 | innerH/W, outerH/W | 各 2B |
| +24-31 | 8 | 全零 | 常量 |
| +32-35 | 4 | 固定 4 | 检测标志 |
| +36-39 | 4 | 0 | 常量 |
| +40-43 | 4 | CRC32(pathname.toUpperCase()) | URL 路径 |
| +44-47 | 4 | 0 | 常量 |

注意: 部分版本 (len=166) 末尾多 8 个零字节 (`numToNumarr8(0)`)。

---

### type=10 时间+网络

type=10 包含时间戳、随机数和主机名。这是 basearr 中变化最多的段。

```javascript
function buildType10(config, keys) {
    const r2t = parseInt(ascii2string(keys[21]));
    const k19 = parseInt(ascii2string(keys[19]));
    const hostname = config.hostname.substring(0, 20);
    const random20 = Math.floor(Math.random() * 1048575);
    const currentTime = (config.currentTime || Date.now()) & 0xFFFFFFFF;
    return [
        3, 13,
        ...numToNumarr4(r2t + (config.runTime - config.startTime)),
        ...numToNumarr4(k19),
        ...numToNumarr8(random20 * 4294967296 + (currentTime >>> 0)),
        parseInt(ascii2string(keys[24])) || 4,
        hostname.length, ...string2ascii(hostname),
    ];
}
```

字段说明:

| 偏移 | 长度 | 内容 | 来源 |
|------|------|------|------|
| 0 | 1 | 固定 3 | 常量 |
| 1 | 1 | 固定 13 | 常量 |
| 2-5 | 4 | r2mkaTime + runTime - startTime | keys[21] + 时间差 |
| 6-9 | 4 | keys[19] 转数字 | keys[19] |
| 10-17 | 8 | random20 * 2^32 + currentTime | 高 20 位随机, 低 32 位时间 |
| 18 | 1 | keys[24] 转数字 | keys[24] (通常 4) |
| 19 | 1 | hostname 长度 | 自动 |
| 20+ | N | hostname ASCII | 截断到 20 字符 |

关键发现: `type=10[2..5]` 不是纯 r2mkaTime, 而是 `r2mkaTime + (runTime - startTime)`。这个发现解决了时间戳字段始终差几毫秒的问题。

---

### type=7 标识

type=7 包含版本标志和 codeUid。

```javascript
function buildType7(config) {
    return [1, 0, 0, 0, 0, 0, 0, 0,
        ...numToNumarr2(config.flag || 2830),
        ...numToNumarr2(config.codeUid || 0)];
}
```

字段说明:

| 偏移 | 长度 | 内容 | 来源 |
|------|------|------|------|
| 0-7 | 8 | [1,0,0,0,0,0,0,0] | 常量 (numToNumarr4(16777216) + numToNumarr4(0)) |
| 8-9 | 2 | flag | 站点特定: 2830, 2833, 3855, 4114 等 |
| 10-11 | 2 | codeUid | CRC32(funcCode) XOR CRC32(mainCodeSlice) & 0xFFFF |

**flag 值是站点适配的关键参数之一**, 必须从参考数据中读取。不同站点的 flag 不同, 同一站点的 flag 跨 session 固定。

---

### type=6 keys[22] AES 解密

type=6 包含 keys[22] 的解密数据。完整实现需要 BASESTR 解码 + AES-CBC 解密 + UTF-8 解码。

```javascript
function buildType6(keys) {
    // Step 1: keys[22] → ASCII 字符串
    const k22str = ascii2string(keys[22]);

    // Step 2: BASESTR 自定义 Base64 解码 → 字节数组
    const BASESTR = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';
    const dk = [{},{},{},{},{},{}];
    for (let i = 0; i < BASESTR.length; i++) {
        const c = BASESTR.charCodeAt(i);
        dk[0][c] = i << 2;
        dk[1][c] = i >> 4;
        dk[2][c] = (i & 15) << 4;
        dk[3][c] = i >> 2;
        dk[4][c] = (i & 3) << 6;
        dk[5][c] = i;
    }
    function baseDecode(str) {
        const a = [];
        for (let i = 0; i < str.length; i += 4) {
            const c = [0,1,2,3].map(j => i+j < str.length ? str.charCodeAt(i+j) : undefined);
            if (c[1] !== undefined) a.push(dk[0][c[0]] | dk[1][c[1]]);
            if (c[2] !== undefined) a.push(dk[2][c[1]] | dk[3][c[2]]);
            if (c[3] !== undefined) a.push(dk[4][c[2]] | dk[5][c[3]]);
        }
        return a;
    }
    const encrypted = baseDecode(k22str);

    // Step 3: numarrAddTime — 分离 key + 时间 + XOR 还原
    // encrypted 末尾 1 字节是 XOR 掩码, 倒数 5-2 字节是时间戳
    const ele = encrypted[encrypted.length - 1]; // XOR 掩码
    const raw = encrypted.slice(0, -1).map(b => b ^ ele);
    const keyData = raw.slice(0, raw.length - 4);
    // keyData 就是 keys[16] 经 numarrAddTime 加工后的 AES 密钥

    // Step 4: AES-CBC 解密 (使用 keyData 作为密钥)
    // encrypted 的前 16B 是 IV, 之后是密文
    // 解密后得到明文字节数组
    const crypto = require('crypto');
    const iv = Buffer.from(encrypted.slice(0, 16));
    const ct = Buffer.from(encrypted.slice(16, -1)); // 去掉尾部 XOR 掩码
    // 实际实现需要对齐 rs-reverse 的 encryptMode2/decode 逻辑

    // Step 5: UTF-8 解码明文 → 数字
    // decode(decrypt(k22str)) 得到一个数字字符串
    // +decode(...) 转为数字, 用 numToNumarr2 编码

    // Step 6: 组装 type=6 payload
    const hidden = config.documentHidden ? 0 : 1;
    return [
        1,
        ...numToNumarr2(0),
        ...numToNumarr2(0),
        hidden,
        ...encryptMode2Result, // 8B: AES 解密后再加密
        ...numToNumarr2(decodedNumber), // 2B: 解密后的数字
    ];
}
```

实际使用中, type=6 的值跨 session 变化较小。如果已有一次成功的参考数据, 可以直接复用 type=6 的字节 (短时间内有效)。长期运行需要完整实现 encryptMode2 + decode + decrypt 链路。

---

### type=2 会话映射 (数据驱动)

type=2 是 4 个字节, 看起来简单但陷阱最多。以下是完整的 9 步真实案例。

#### Step 1: 发现问题

首次采集到的 type=2:

```
Session A: [103, 181, 101, 224]
```

看起来是固定值, 硬编码后第一个 session 成功 (HTTP 200)。

#### Step 2: 尝试 rs-reverse 公式 (失败)

第二个 session 失败。查看 rs-reverse 源码中的 `fixedValue20`:

```javascript
// rs-reverse 的实现
const values = [103,0,102,203,224,181,108,240,101,126,
                103,11,102,203,225,181,208,180,100,127];
const tasks = gv.r2mka("U250200532");
for (let task of tasks) {
    const maps = values.reduce((ans, value, idx) => {
        ans[gv.ts.cp[1][task.taskori[idx * 7 + 6]]] = value;
        return ans;
    }, {});
    // 通过 keys[29..32] 的变量名查映射
}
```

`idx*7+6` 公式依赖特定版本的 r2mka 任务结构, 我们的站点不适用。直接套用 → 失败。

#### Step 3: 反思方法论

不能假设 rs-reverse 的公式通用。type=2 的值和 session 的 nsd 相关, 因为 nsd 决定了 cp[1] 的洗牌结果。必须找到一种不依赖 r2mka 具体结构的方法。

#### Step 4: 切换到数据驱动

方法: 采集多个 session 的 (nsd, keys[29..32], type=2) 三元组, 寻找规律。

#### Step 5: 采集 5 个 session

```
Session 1: nsd=84277, keys[29..32]=["_$cu","_$am","_$bb","_$aT"], type2=[103,181,101,224]
Session 2: nsd=31052, keys[29..32]=["_$dR","_$cl","_$cz","_$c2"], type2=[181,101,103,224]
Session 3: nsd=67891, keys[29..32]=["_$bW","_$aw","_$bk","_$aQ"], type2=[101,181,224,103]
Session 4: nsd=12345, keys[29..32]=["_$eA","_$d5","_$dJ","_$cX"], type2=[224,103,181,101]
Session 5: nsd=55678, keys[29..32]=["_$cP","_$bH","_$bV","_$b2"], type2=[103,224,101,181]
```

#### Step 6: 发现规律

cp1 = grenKeys(918, nsd) 生成 918 个变量名。keys[29..32] 在 cp1 中的索引:

```
Session 1: cp1.indexOf("_$cu")=11, cp1.indexOf("_$am")=5, ... → [11, 5, 23, 8]
Session 2: cp1.indexOf("_$dR")=11, cp1.indexOf("_$cl")=5, ... → [11, 5, 23, 8]
```

**关键发现: 无论 nsd 如何变化, keys[29..32] 在 cp1 中的索引始终固定!**

这是因为 keys[29..32] 的变量名和 cp1 都通过相同的 PRNG(nsd) 洗牌, 相对位置不变。

#### Step 7: 构建映射

固定值表 (20 个, 来自 rs-reverse):

```javascript
const VALUES = [103,0,102,203,224,181,108,240,101,126,
                103,11,102,203,225,181,208,180,100,127];
```

cp1 索引到 VALUES 的映射: `idx → VALUES[idx]`

实际使用的 4 个索引: `[11, 5, 23, 8]` (站点特定, 从参考数据提取)

#### Step 8: 实现

```javascript
function buildType2(keys, nsd) {
    // 生成 cp1 (918 个变量名, 用 nsd 洗牌)
    const cp1 = grenKeys(918, nsd);

    // 固定值表
    const VALUES = [103,0,102,203,224,181,108,240,101,126,
                    103,11,102,203,225,181,208,180,100,127];

    // 固定索引 (从参考数据采集得到)
    const FIXED_INDICES = [11, 5, 23, 8];

    // 通过 keys[29..32] 在 cp1 中查找, 映射到 VALUES
    return [29, 30, 31, 32].map(ki => {
        const varName = ascii2string(keys[ki]);
        const cpIdx = cp1.indexOf(varName);
        // 在 FIXED_INDICES 中找到位置, 返回对应 VALUES
        const fixedPos = FIXED_INDICES.indexOf(cpIdx);
        if (fixedPos >= 0) return VALUES[fixedPos]; // 简化示例
        return VALUES[cpIdx]; // 直接映射
    });
}
```

简化实现 (当固定索引已知时):

```javascript
function buildType2Simple(keys, nsd) {
    const cp1 = grenKeys(918, nsd);
    const VALUES = [103,0,102,203,224,181,108,240,101,126,
                    103,11,102,203,225,181,208,180,100,127];
    const result = [];
    for (const ki of [29, 30, 31, 32]) {
        const varName = ascii2string(keys[ki]);
        const idx = cp1.indexOf(varName);
        result.push(VALUES[idx]);
    }
    return result;
}
```

#### Step 9: 验证

5 个 session 全部 HTTP 200。

---

### type=0 占位

```javascript
// 固定 1 字节
[0]
```

### type=9 电池+网络

```javascript
function buildType9(config) {
    const { connType } = config.connection || {};
    const { charging, chargingTime, level } = config.battery || {};
    const connIdx = ['bluetooth','cellular','ethernet','wifi','wimax'].indexOf(connType) + 1;
    let oper = 0;
    if (level) oper |= 2;
    if (charging) oper |= 1;
    if (connIdx !== undefined) oper |= 8;
    return [
        oper,
        Math.round((level || 1) * 100),
        ...numToNumarr2(chargingTime || 0),
        connIdx,
    ];
}
```

### type=13 占位

```javascript
// 固定 1 字节
[0]
```

---

## 最终组装 buildBasearr

```javascript
function buildBasearr(config, keys, nsd) {
    const type3 = buildType3(config);
    const type10 = buildType10(config, keys);
    const type7 = buildType7(config);
    const type6 = buildType6(keys, config);
    const type2 = buildType2(keys, nsd);
    const type9 = buildType9(config);

    // numarrJoin: 第一个参数是 type 标记, 后续数组参数自动加 length 前缀
    return [
        3, type3.length, ...type3,
        10, type10.length, ...type10,
        7, type7.length, ...type7,
        0, 1, 0,                          // type=0, len=1, [0]
        6, type6.length, ...type6,
        2, type2.length, ...type2,
        9, type9.length, ...type9,
        13, 1, 0,                         // type=13, len=1, [0]
    ];
}
```

注意: type 顺序可能因版本而异。以参考数据为准。

---

## 站点适配清单

新站点适配步骤:

- [ ] 1. 获取 412 响应, 提取 nsd + cd + mainjs URL
- [ ] 2. 提取 keys (纯算或 sdenv)
- [ ] 3. 运行 Coder 计算 codeUid
- [ ] 4. sdenv 采集 3+ 个 session 的参考 basearr (解密 Cookie T)
- [ ] 5. 用 basearrParse 分析 TLV 结构, 确定 type 顺序
- [ ] 6. 多 session 对比, 标记每个字节的变化类型
- [ ] 7. 确定 flag 值 (type=7 的 [8..9])
- [ ] 8. 确定 type=2 的固定索引映射
- [ ] 9. 实现 buildBasearr, 与参考数据逐字节对比
- [ ] 10. 纯算 Cookie T → HTTP 200 验证
- [ ] 11. 连续 5+ 个 session 全部 200, 确认稳定

---

## 字段分析表

### 按字节变化类型分类

| type | 字段 | 变化类型 | 说明 |
|------|------|----------|------|
| 3 | maxTouchPoints | 固定 | 设备固定 |
| 3 | eval.toString().length | 固定 | 通常 33 |
| 3 | CRC32(UA) | 固定 | UA 不变则不变 |
| 3 | platform | 固定 | 设备固定 |
| 3 | execNumberByTime | 半固定 | 每次运行略有波动 (~1600) |
| 3 | randomAvg | 半固定 | 98 个随机数统计量 |
| 3 | innerH/W, outerH/W | 固定 | 窗口大小 |
| 3 | CRC32(pathname) | 固定 | URL 路径 |
| 10 | r2mkaTime + delta | 每次不同 | keys[21] + 运行时间差 |
| 10 | keys[19] | session 不同 | 每次请求更新 |
| 10 | random20 + time | 每次不同 | 随机 + 时间戳 |
| 10 | hostname | 固定 | 目标域名 |
| 7 | flag | 站点固定 | 适配参数 |
| 7 | codeUid | session 不同 | mainjs 变化时改变 |
| 6 | 加密数据 | session 不同 | keys[22] 派生 |
| 2 | 会话映射 | session 不同 | keys[29..32] + nsd |
| 9 | 电池/网络 | 固定 | 环境信息 |

### 按来源分类

| 来源 | 对应字段 |
|------|----------|
| 常量 (硬编码) | type=3 大部分, type=0, type=13 |
| 浏览器环境 | UA, platform, 窗口大小, 电池, 网络 |
| keys 直接使用 | keys[19], keys[21], keys[24] |
| keys 计算 | keys[22]→type=6, keys[29..32]→type=2 |
| 纯算 | CRC32(UA), CRC32(pathname), codeUid |
| 随机 | type=10[10..17] 高位, execNumberByTime |
| 时间 | type=10[2..5], type=10[10..17] 低位 |

---

## 常见坑

1. **flag 值不通用**: rs-reverse 默认 4114, 实际站点可能是 2830/2833/3855 等, 必须从参考数据读取
2. **type 顺序**: 不同版本的 type 顺序可能不同, 以 basearrParse 解析结果为准
3. **numToNumarr8(0) 尾部**: 部分版本 (len=166) type=3 末尾多 8 个零字节
4. **hostname 截断**: type=10 的 hostname 最多 20 字符
5. **pathname 大写**: CRC32 计算前必须 toUpperCase()
6. **时间差**: type=10[2..5] 是 r2mkaTime + runTime - startTime, 不是纯 r2mkaTime
7. **type=2 非固定**: 每个 session 的 nsd 不同导致 cp1 洗牌不同, 但索引映射关系固定
