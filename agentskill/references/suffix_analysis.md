# Phase 6: URL Suffix 分析

## 当前状态

经过大量站点实测验证: **99% 的瑞数站点 POST 请求不需要 URL suffix**, 只需要 Cookie 中的 S 值和 T 值即可通过验证。

仅极少数站点在 GET 请求或特定接口上需要 suffix, 绝大多数场景下纯 Cookie 方案已足够。

---

## Suffix 结构

存在两种变体: 88 字节(无 search)和 120 字节(有 search)。

### 88B 变体 (URL 无 query string)

```
偏移       长度    内容           说明
[0-3]      4B     nonce          随机数
[4]        1B     flag = 1       固定标志位
[5]        1B     = 0x6a         站点标记
[6-54]     49B    session        Cookie S 解密所得 (VM 内部状态, 每会话固定)
[55]       1B     marker         0x20 = 无 search / 0x40 = 有 search
[56-87]    32B    sig32          行为统计编码
```

### 120B 变体 (URL 含 query string)

```
偏移       长度    内容           说明
[0-87]     88B    同上 88B 结构
[88-119]   32B    searchSig      search 部分的 SHA-1 签名
```

### 编码方式

```
"0" + URLSafeBase64(bytes)

URL-safe 替换规则:
  + -> .
  / -> _
  无 padding (去除尾部 =)
```

---

## 参数名获取

suffix 追加到 URL 时使用的参数名从以下位置提取:

```javascript
keys[7].split(';')[1]
```

其中 `keys` 为瑞数配置数组, `keys[7]` 包含分号分隔的多个配置项, 第二段即为 suffix 参数名。

---

## Suffix 生成流程 (AST 追踪所得)

1. **XHR.open 拦截**: 瑞数 hook 了 XMLHttpRequest.prototype.open, 所有 XHR 请求经过瑞数逻辑
2. **URL 解析**: 通过 `createElement('a')` 创建临时链接元素, 浏览器自动解析出 pathname 和 search
3. **VM 执行**: `r2mKa` VM 字节码执行 `child[29]` 节点, 该节点负责 suffix 的计算与拼接
4. **URL 追加**: 计算完成后 suffix 作为新的 query parameter 追加到原始 URL

---

## 32B 签名: 行为统计编码

suffix 中的 32 字节签名 (偏移 56-87) **不是加密算法的输出**, 而是行为统计数据的编码:

- 鼠标移动轨迹统计
- 键盘事件统计
- 其他浏览器行为指标

这些数据被编码为固定 32 字节, 用于服务端判断请求是否来自真实浏览器。

---

## SHA-1 签名发现

120B 变体中的后 32 字节 (`searchSig`) 经确认为 SHA-1 签名, 证据如下:

- **rt[67] 常量**: VM 运行时数组 `rt[67]` 中存储了 SHA-1 算法的初始化常量
- **4 个 SHA-1 函数**: AST 追踪定位到 4 个标准 SHA-1 轮函数, 与 RFC 3174 完全一致
- 签名对象为 URL 的 search 部分 (query string)

此前曾怀疑使用 XTEA 或 AES 加密, 经数据驱动对比确认实际为 SHA-1。

---

## AST 成果总结

| 成果项 | 说明 |
|--------|------|
| Suffix 编码方式 | URLSafeBase64, 前缀 "0" |
| 88B / 120B 结构 | 完整字段映射 |
| 参数名来源 | keys[7].split(';')[1] |
| XHR hook 机制 | createElement('a') 解析 URL |
| VM 入口 | child[29] 节点 |
| 签名算法 | SHA-1 (非 XTEA/AES) |
| 32B sig | 行为统计编码 (非加密) |

---

## 未解决问题

### 49B session 数据 (偏移 6-54)

- 来源于 Cookie S 的解密结果
- 在 VM 内部生成和维护, 每会话固定
- 完整的生成逻辑尚未从 VM 字节码中提取

### VM 字节码层面

- child[29] 的完整执行路径未完全还原
- VM 内部状态机的转换逻辑复杂
- 字节码级别的纯计算还原工作量大

---

## 可用方案

### 方案一: JsRpc (推荐, 通用)

通过远程调用浏览器中已加载的瑞数 JS 环境, 直接获取生成结果。

- 优点: 通用性强, 适用于所有站点, 无需理解内部逻辑
- 缺点: 依赖浏览器实例, 有一定性能开销

### 方案二: sdenv VM 内部 XHR

利用 sdenv 环境执行瑞数 JS, 在 VM 内部发起 XHR 请求。

- 优点: 无需浏览器, 可脚本化
- 缺点: 每个 sdenv 实例仅能发一次 POST 请求, 需要频繁初始化新实例

### 方案三: 纯计算 (适用于不需要 suffix 的站点)

对于 99% 不需要 suffix 的站点, 只需计算 Cookie S 和 T 即可。

- 优点: 性能最优, 完全脱离浏览器
- 缺点: 仅适用于不需要 suffix 的场景

---

## 纯 Suffix 实现的未来方向

若要实现完全脱离浏览器的 suffix 纯计算:

1. **49B session 还原**: 需深入 VM 字节码, 追踪 Cookie S 解密后的完整处理链路
2. **行为统计模拟**: 32B sig 需要合理的行为数据填充, 可参考真实浏览器采集的样本
3. **SHA-1 计算**: search 部分签名已明确算法, 可直接实现
4. **编码拼装**: 各字段结构已明确, 拼装和编码逻辑可直接实现

关键瓶颈在于 49B session 数据的生成, 这部分深埋在 VM 字节码执行流程中, 是纯计算方案的最后难点。
