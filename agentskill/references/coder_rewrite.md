# 阶段 3: 外层 VM 重写 (通用, 一次性)

## 核心思想

不运行 VM, 重写 VM。mainjs 是确定性的代码生成器, 只依赖 3 个输入 (nsd, cd, globalText1)。理解算法后用纯 JS 重写, 获取所有中间数据。

## 输入/输出

- 输入: mainjs 源码 + nsd + cd
- 输出: eval 代码 (100% 字节一致) + functionsNameSort + mainFunctionIdx + keynameNum
- 验证标准: Coder 输出 === vm.runInContext(mainjs) 的 eval 输出, 逐字节一致

## 逆向方法 (9 步)

### Step 1: 读 rs-reverse 源码, 建立模块映射表

参照 rs-reverse 的 Coder.js 源码 (335行), 理解架构:

| rs-reverse 模块 | 对应 mainjs 函数 | 功能 |
|----------------|-----------------|------|
| getScd.js | _$ad() (通常 line 12) | PRNG: 15679 * (seed & 0xFFFF) + 2531011 |
| globaltext.js | _$$1() + _$kx (line 77) | 从编码字符串读 charCode |
| arraySwap.js | _$lT() (line 21) | Fisher-Yates 洗牌 |
| grenKeys.js | 内部变量名生成 | 918 个 _$xx 格式变量名 |
| Coder.js | _$cj() (line 70) | 核心代码生成器 (75 opcode) |
| Coder.gren() | _$g6() (line 371) | 代码段生成 (55 opcode) |

### Step 2: 格式化 mainjs, 建立变量表

```bash
npx js-beautify mainjs.js -o mainjs_fmt.js
```

变量表 (名称每次不同, 角色固定):

| mainjs 变量 | 含义 | rs-reverse 对应 |
|-------------|------|----------------|
| _$kx | globalText 编码字符串 | immucfg.globalText1 |
| _$jL | 游标位置 | optext cursor |
| _$cN | keycodes 数组 | this.keycodes |
| _$aB | keynames 变量名表 (918) | this.keynames / cp[1] |
| _$ft | 代码片段数组 | codeArr |
| _$_1 | nsd 值 | $_ts.nsd |

### Step 3: 提取第一层 VM 75 个 opcode

从 mainjs_fmt.js line 95-370, 关键 opcode:

- op 20: 读 nsd
- op 49: 设置 globalText1
- op 53: 变量名字符集
- op 75: grenKeys(0, 918, scd(nsd))
- op 46: 洗牌变量名
- op 88: getLine(getCode()*55295+getCode()) - keycodes/r2mka
- op 76: 拼接 eval 代码
- op 85: eval.call(window, code)

### Step 4: 提取第二层 VM 55 个 opcode

mainjs_fmt.js line 371-700, 关键:

- op 34: getList (递归读子列表)
- op 36: getLine
- op 60: arrayShuffle

### Step 5: 理解两层 VM 调用层级

```
_$cj(56) -> 主初始化
  |-- _$cj(0, 918, prng) -> 变量名生成
  |-- _$g6(36, ...) -> 代码段生成
  |   |-- _$g6(34, len) -> getLine
  |   +-- _$g6(48, ...) -> 代码段循环
  +-- eval(code) -> 执行生成代码
```

### Step 6: 实现 5 个核心模块

1. PRNG (createScd) - 3 行
2. Fisher-Yates 洗牌 (arrayShuffle) - 5 行
3. 游标读取器 (textReader) - 10 行
4. 变量名生成 (grenKeys) - 6 行
5. 字符串提取 (extractImmucfg) - 10 行

### Step 7: 实现 Coder 类

核心类, 组合以上 5 个模块, 按 parseGlobalText1 序列解析 globalText1, 逐段调用 _gren 生成代码, 最终拼接为完整 eval 代码。

### Step 8: 逐字节对比调试 (关键!)

这是最耗时的步骤。实际经历 3 个版本:

- v1: 差 42K 字符, 变量名第一个就不对
- v2: 修 3 个 bug -> 前 51% 匹配
- v3: 又修 3 个 bug -> 差距缩到 180 字符
- 最终: debugger 对齐 -> 100% 匹配

### Step 9: 提取中间数据

Coder 匹配后自动获得: functionsNameSort, mainFunctionIdx, r2mkaText, keynameNum

## 核心算法

### PRNG

```javascript
function createScd(seed) {
    let s = seed;
    return () => { s = 15679 * (s & 0xFFFF) + 2531011; return s; };
}
```

### Fisher-Yates 洗牌

```javascript
function arrayShuffle(arr, scd) {
    const a = [...arr];
    let len = a.length;
    while (len > 1) { len--; const i = scd() % len; [a[len], a[i]] = [a[i], a[len]]; }
    return a;
}
```

### 变量名生成

```javascript
function grenKeys(num, nsd) {
    const chars = '_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const names = [];
    for (let i = 0; i < chars.length && names.length < num; i++)
        for (let j = 0; j < chars.length && names.length < num; j++)
            names.push('_$' + chars[i] + chars[j]);
    return arrayShuffle(names, createScd(nsd));
}
```

### 从 mainjs 提取静态数据

找 mainjs 中所有引号字符串, 取 4 个最长, 按长度排序:

globalText1 (最长) -> cp0 -> cp2 -> globalText2

### extractImmucfg 转义处理 (关键细节)

```javascript
function extractImmucfg(code) {
    const q = [];
    for (let i = 0; i < code.length; i++)
        if (code[i] === '"' && (i === 0 || code[i-1] !== '\\')) q.push(i);
    const strs = [];
    for (let i = 0; i < q.length - 1; i += 2) {
        const raw = code.slice(q[i]+1, q[i+1]);
        try {
            strs.push(JSON.parse('"'+raw+'"'));
        } catch(e) {
            try { strs.push(new Function('return "' + raw + '"')()); }
            catch(e2) { strs.push(raw); }
        }
    }
    strs.sort((a,b) => b.length - a.length);
    return { globalText1: strs[0], cp0: strs[1], cp2: strs[2], globalText2: strs[3] };
}
```

### 文本读取器

```javascript
function textReader(text) {
    let c = 0;
    return {
        getCode() { return text.charCodeAt(c++); },
        getLine(n) { const s = text.substr(c, n); c += n; return s; },
        getList() {
            const n = text.charCodeAt(c);
            const d = [];
            for (let i = 0; i < n; i++) d.push(text.charCodeAt(c+1+i));
            c += n + 1;
            return d;
        },
    };
}
```

### parseGlobalText1 核心序列

```
6 x getCode()                           -> opmate 标志 (6个)
getLine(getCode()*55295 + getCode())     -> keycodes 字符串
1 x getCode()                           -> 分隔
getLine(getCode()*55295 + getCode())     -> r2mkaText
1 x getCode()                           -> 代码段数量 codeNum
for (i=0; i<codeNum; i++) -> _gren(i)   -> 生成代码段
```

### _gren 代码段生成 (完整细节)

8 opmate 含义:

| 索引 | 变量 | 含义 |
|------|------|------|
| 0 | ku | 标识符 |
| 1 | s6 | var 声明 |
| 2 | bs | 判断条件 |
| 3 | sq | wrapper 参数 |
| 4 | jw | while 条件 |
| 5 | sg | apply 目标 |
| 6 | cu | 当前段名 |
| 7 | aw | 全局 opmate |

读 3 个 list:

- listK: 函数参数
- listH: 变量声明
- listC: wrapper 配对

### _ifElse 二叉搜索分发

步长表: `[4, 16, 64, 256, 1024, 4096, 16384, 65536]`

根据步长对 opcode 进行二叉搜索, 生成嵌套的 if-else 结构, 将线性 opcode 列表转化为高效的分发逻辑。

### parseGlobalText2

```javascript
parseGlobalText2() {
    const r = textReader(this.globalText2);
    r.getCode();
    const kcStr = r.getLine(r.getCode());
    const kc2 = kcStr.split(String.fromCharCode(257));
    const list = r.getList();
    const out = [];
    for (let i = 0; i < list.length - 1; i += 2)
        out.push(kc2[list[i]], this.keynames[list[i+1]]);
    out.push(kc2[list[list.length - 1]]);
    return out.join('');
}
```

### keynameNum 动态提取

```javascript
const m = mainjs.match(/_\$[\$_A-Za-z0-9]{2}=_\$[\$_A-Za-z0-9]{2}\(0,([0-9]+),/);
const keynameNum = m ? parseInt(m[1]) : 918;
```

### codeUid 计算

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

## 调试中发现的 6 个坑 (真实经验)

1. **opmate 数量**: 全局 opmate 是 5 个命名 + 1 个无名 = 6 (不是 7)
2. **gren(0) 的参数**: 用全局 G_$dK/G_$kv, 不是局部 opmate
3. **var 声明变量**: 用 opmate index 1 (_$$6), 不是 index 2 (_$b$)
4. **while(1) 循环**: 也用全局 opmate
5. **_ifElse 递归**: start 变量在 for 循环中被修改, else 分支用修改后的 start
6. **debugger PRNG**: 每个 gren 段重建 (seed=nsd), posis 数组跨段累积
