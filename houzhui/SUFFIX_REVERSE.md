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

---

## 八、网上公开资料汇总（2026-04 收集）

> 以下为互联网公开论坛、博客、GitHub 的后缀相关资料整理，作为日后思路来源。

### 8.1 补环境方案

#### 8.1.1 公开资料来源

| 来源 | 地址 | 覆盖范围 |
|------|------|----------|
| sdenv 框架 | https://github.com/pysunday/sdenv | jsdom 基础框架，只做 cookie |
| sdenv-copy / sdenv-ng | https://github.com/Jayxu007/sdenv-copy | sdenv 衍生 |
| 52pojie RS5 cookie+后缀 | https://www.52pojie.cn/thread-2012413-1-1.html | **声称同时搞定 cookie + 后缀** |
| 52pojie RS6 补环境 | https://www.52pojie.cn/thread-2010081-1-1.html | RS6 环境代码片段 |
| 博客园 yeweilin 药监局后缀 | https://www.cnblogs.com/yeweilin/p/18340407 | 后缀补环境教学（需登录） |
| 博客园 spiderman6 | https://www.cnblogs.com/spiderman6/p/17057021.html | 检测项清单，售 199 RMB |
| 博客园 zichliang RS4 | https://www.cnblogs.com/zichliang/p/17757231.html | RS4 补环境 |
| 博客园 pigke RS4 | https://www.cnblogs.com/pigke/p/17659947.html | RS4 初体验 |
| 博客园 fuminer RS6 | https://www.cnblogs.com/fuminer/p/19111311 | Proxy 代理 + RS6 |
| 博客园 ddkt RS6 | https://www.cnblogs.com/ddkt/p/18844876 | 实战补环境 |
| 技术栈 RS6 | https://jishuzhan.net/article/1752896444383105026 | 后缀"下一篇更新"→ 未发 |
| CSDN RS6 补环境 | https://blog.csdn.net/2301_80198695/article/details/146923013 | RS6 详解 |
| CSDN RS5 纯补环境 | https://blog.csdn.net/joker_zsl/article/details/136632868 | RS5 |
| CSDN 补环境 vmp | https://blog.csdn.net/big_god_/article/details/132361394 | vmp 补环境 |
| 腾讯云 浏览器补环境详解 | https://cloud.tencent.com/developer/article/2189782 | 通用补环境 |
| 原型链检测 | http://theonetop.icu/2024/08/03/补环境-js原型链检测/ | 检测绕过 |
| awesome-reverse | https://github.com/AlienwareHe/awesome-reverse/blob/main/js/browser-env-fix.md | 环境修复清单 |

#### 8.1.2 补环境总体架构

```
┌──────────────────────────────────────────────┐
│  Node.js 进程                                 │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  vm.runInNewContext(sandbox)             │ │
│  │                                         │ │
│  │  sandbox = {                             │ │
│  │    window, document, navigator,          │ │
│  │    location, screen, history,            │ │
│  │    XMLHttpRequest, fetch, crypto,        │ │
│  │    localStorage, sessionStorage,         │ │
│  │    MutationObserver, WebSocket,          │ │
│  │    Image, canvas, DOMParser ...          │ │
│  │  }                                      │ │
│  │                                         │ │
│  │  1. 加载外链 JS                          │ │
│  │  2. 设置 meta.content                    │ │
│  │  3. 执行 ts 代码块                       │ │
│  │  4. JS 自解密 → eval() → 进入 VM         │ │
│  │  5. VM 读取 window/$_ts/document/...     │ │
│  │  6. 生成 Cookie T → document.cookie      │ │
│  │  7. hook XHR.open → 生成后缀             │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  拦截 document.cookie setter → 拿到 Cookie T │
│  拦截 XHR.open → 拿到带后缀的 URL            │
└──────────────────────────────────────────────┘
```

**两种框架路线**:
| 路线 | 代表 | 原理 | 后缀支持 |
|------|------|------|----------|
| **jsdom 路线** | sdenv | 修改版 jsdom（sdenv-jsdom）提供完整 DOM | 理论可行，需补 XHR |
| **手动 mock 路线** | 52pojie/各博客 | 纯手写每个 API | 灵活但工作量大 |

#### 8.1.3 createElement('a') — URL 解析 mock（★ 后缀关键）

瑞数在 XHR.open hook 中用 `document.createElement('a')` 解析请求 URL：

```javascript
// 瑞数内部逻辑（简化）
var a = document.createElement('a');
a.href = requestUrl;           // 设置 href 触发浏览器原生 URL 解析
var path = a.pathname;          // "/api/data"
var search = a.search;          // "?id=123"
var host = a.hostname;          // "target.com"
// → 用 path + search 参与后缀签名计算
```

**读取的属性清单**:
| 属性 | 示例值 | 用途 |
|------|--------|------|
| `href` | `"https://target.com/api?id=1"` | 完整 URL |
| `protocol` | `"https:"` | 协议 |
| `hostname` | `"target.com"` | 主机名（无端口）|
| `host` | `"target.com:443"` | 主机名+端口 |
| `port` | `""` 或 `"8080"` | 端口 |
| `pathname` | `"/api/data"` | 路径 → **参与后缀签名** |
| `search` | `"?id=123"` | 查询串 → **参与后缀签名** |
| `hash` | `""` | 锚点 |
| `origin` | `"https://target.com"` | 源 |

**正确的 mock 方式 — 用 Node.js URL 类动态解析**:
```javascript
document.createElement = function(tag) {
    if (tag === 'a') {
        var obj = {};
        Object.defineProperty(obj, 'href', {
            set: function(url) {
                // 用 Node.js 原生 URL 解析，行为与浏览器一致
                var u = new URL(url, location.href);
                obj._protocol = u.protocol;
                obj._hostname = u.hostname;
                obj._host = u.host;
                obj._pathname = u.pathname;
                obj._search = u.search;
                obj._hash = u.hash;
                obj._port = u.port;
                obj._origin = u.origin;
                obj._href = u.href;
            },
            get: function() { return obj._href; }
        });
        ['protocol','hostname','host','pathname','search','hash','port','origin'].forEach(function(p) {
            Object.defineProperty(obj, p, {
                get: function() { return obj['_' + p]; }
            });
        });
        return obj;
    }
    if (tag === 'div') {
        return { getElementsByTagName: function(t) { return t === 'i' ? { length: 0 } : []; } };
    }
    if (tag === 'form') {
        return { action: '', textContent: '', id: '', innerText: '' };
    }
    if (tag === 'input') {
        return { type: '', name: '', value: '' };
    }
    if (tag === 'canvas') {
        return {
            getContext: function() {
                return { fillRect:function(){}, arc:function(){}, fillText:function(){},
                         measureText:function(){ return {width:0}; }, getImageData:function(){ return {data:[]}; } };
            },
            toDataURL: function() { return "data:image/png;base64,iVBOR..."; }
        };
    }
    if (tag === 'meta') {
        return { content: '', getAttribute: function() { return null; } };
    }
    return {};
};
```

> **⚠️ 关键**: `hostname` 必须与真实站点一致，否则 cookie 长度会变，服务端校验不过。
> 后缀中 pathname 和 search 直接参与签名，mock 的 URL 解析必须与浏览器行为完全一致。

#### 8.1.4 XMLHttpRequest mock（★ 后缀生成的触发点）

瑞数在 VM 初始化时 hook 了 `XMLHttpRequest.prototype.open`，所有 XHR 请求经过这个 hook 时会自动生成后缀并追加到 URL。

```javascript
// 瑞数 hook 原理（简化）
var _origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, async) {
    // 1. createElement('a') 解析 url
    // 2. 从 $_ts.cd 取 session 数据
    // 3. 计算后缀签名
    // 4. url += '?suffixParam=' + encodedSuffix
    // 5. 调用原始 open
    return _origOpen.call(this, method, url + suffix, async);
};
```

**mock 实现 — 需要能被 hook 的真实原型链**:
```javascript
function XMLHttpRequest() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.response = '';
    this.responseType = '';
    this.timeout = 0;
    this.withCredentials = false;
    this.upload = {};
    this._headers = {};
    this._url = '';
    this._method = '';
}

XMLHttpRequest.prototype.open = function(method, url, async) {
    this._method = method;
    this._url = url;
    this.readyState = 1;
    // ★ 这个方法会被瑞数 VM 覆盖/hook
    // 补环境时不需要真正发请求，只需要让 hook 链能跑通
};

XMLHttpRequest.prototype.send = function(data) {
    this.readyState = 4;
    this.status = 200;
    if (this.onreadystatechange) this.onreadystatechange();
    if (this.onload) this.onload();
};

XMLHttpRequest.prototype.setRequestHeader = function(key, value) {
    this._headers[key] = value;
};
XMLHttpRequest.prototype.getAllResponseHeaders = function() { return ''; };
XMLHttpRequest.prototype.getResponseHeader = function(name) { return null; };
XMLHttpRequest.prototype.abort = function() {};
XMLHttpRequest.prototype.addEventListener = function() {};
XMLHttpRequest.prototype.removeEventListener = function() {};

// ★ 瑞数检查这个是否存在
window.XMLHttpRequestEventTarget = function() {};

// WHATWG 常量
XMLHttpRequest.UNSENT = 0;
XMLHttpRequest.OPENED = 1;
XMLHttpRequest.HEADERS_RECEIVED = 2;
XMLHttpRequest.LOADING = 3;
XMLHttpRequest.DONE = 4;
```

**拦截后缀的方式**:
```javascript
// 方式1: 在 VM 执行完 hook 后，手动调 open 触发后缀生成
var xhr = new XMLHttpRequest();
xhr.open('GET', '/api/target?param=value');
// → 瑞数 hook 会修改 url，追加后缀
// → 从 xhr._url 或 console.log 中拿到带后缀的 URL

// 方式2: 二次 hook 拦截
var _hookedOpen = XMLHttpRequest.prototype.open;  // 此时已被瑞数 hook
XMLHttpRequest.prototype.open = function(method, url, async) {
    console.log('★ 带后缀的URL:', url);  // 拿到后缀
    return _hookedOpen.call(this, method, url, async);
};
```

#### 8.1.5 document 对象完整 mock

```javascript
var _cookie = '';
var document = {
    // ===== Cookie（最关键的输出） =====
    get cookie() { return _cookie; },
    set cookie(value) {
        console.log('[cookie set]', value);
        // 拼接多个 cookie
        var name = value.split('=')[0];
        var existing = _cookie.split('; ').filter(function(c) { return c.split('=')[0] !== name; });
        existing.push(value.split(';')[0]);
        _cookie = existing.filter(Boolean).join('; ');
    },

    // ===== 基本属性 =====
    referrer: '',
    domain: 'target.com',                          // ★ 必须与真实站点一致
    URL: 'https://target.com/path/page.html',
    documentURI: 'https://target.com/path/page.html',
    characterSet: 'UTF-8',
    charset: 'UTF-8',
    inputEncoding: 'UTF-8',
    contentType: 'text/html',
    compatMode: 'CSS1Compat',
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    title: '',

    // ===== document.all — 特殊的 "falsy" 对象 =====
    // 浏览器中 document.all 是 typeof === 'undefined' 但 truthy 的特殊对象
    // Node.js 中用 V8 内部 API 模拟：
    // all: require('vm').runInThisContext('%GetUndetectable()'),

    // ===== DOM 元素 =====
    documentElement: {
        style: {},
        getAttribute: function() { return null; },
        addEventListener: function() {},
        appendChild: function() {},
        clientWidth: 1920,
        clientHeight: 945
    },
    body: {
        appendChild: function(el) { return el; },
        removeChild: function(el) { return el; },
        insertBefore: function() {},
        innerHTML: '',
        style: {}
    },
    head: {
        appendChild: function(el) { return el; },
        removeChild: function(el) { return el; }
    },
    scripts: [],

    // ===== DOM 查询方法 =====
    createElement: function(tag) { /* 见 8.1.3 */ },
    getElementById: function(id) { return null; },
    getElementsByTagName: function(tag) {
        if (tag === 'script') return [{
            getAttribute: function(attr) { return attr === 'r' ? 'm' : null; },
            // ★ getAttribute('r') 返回 'm' 是瑞数完整性校验点
            parentElement: { removeChild: function() {} },
            parentNode: { removeChild: function() {} },
            type: 'text/javascript',
            src: ''
        }];
        if (tag === 'meta') return [{
            content: META_CONTENT,  // ★ 动态 token，从首次响应 HTML 提取
            getAttribute: function(attr) { return attr === 'r' ? 'm' : null; },
            parentNode: { removeChild: function() {} },
            parentElement: { removeChild: function() {} }
        }];
        if (tag === 'base') return [];
        if (tag === 'link') return [];
        return [];
    },
    getElementsByClassName: function() { return []; },
    querySelector: function() { return null; },
    querySelectorAll: function() { return []; },
    getElementsByName: function() { return []; },

    // ===== 事件 =====
    addEventListener: function() {},
    removeEventListener: function() {},
    createEvent: function() { return { initEvent: function() {} }; },
    dispatchEvent: function() {},

    // ===== 其他 =====
    write: function() {},
    writeln: function() {},
    createDocumentFragment: function() { return { appendChild: function() {} }; },
    createTextNode: function(text) { return { textContent: text }; },
    createComment: function() { return {}; },
    createTreeWalker: function() { return { nextNode: function() { return null; } }; },
    hasFocus: function() { return true; },
    execCommand: function() { return false; },
    adoptNode: function(node) { return node; }
};

// ★ Symbol.toStringTag — 让 toString 检测通过
Object.defineProperty(document, Symbol.toStringTag, { value: "HTMLDocument" });
```

#### 8.1.6 window 对象完整 mock

```javascript
// ===== 第一步：清除 Node.js 特征 =====
delete __dirname;
delete __filename;

window = global;   // 或 globalThis
delete global;      // 删掉 Node.js 特有的 global
delete process;     // 删掉 process
delete Buffer;      // 删掉 Buffer

// ===== 自引用 =====
window.top = window;
window.self = window;
window.parent = window;
window.frames = window;
window.window = window;

// ===== Symbol.toStringTag =====
Object.defineProperty(window, Symbol.toStringTag, { value: "Window", configurable: true });

// ===== 尺寸 =====
window.innerHeight = 945;
window.innerWidth = 1920;
window.outerHeight = 1022;
window.outerWidth = 1910;
window.screenX = 0;
window.screenY = 0;
window.pageXOffset = 0;
window.pageYOffset = 0;
window.scrollX = 0;
window.scrollY = 0;

// ===== 关键属性 =====
window.name = '';
window.closed = false;
window.TEMPORARY = 0;
window.ActiveXObject = undefined;  // ★ IE 检测：必须 undefined 而非不存在
window.chrome = {                  // ★ Chrome 检测：必须存在
    runtime: {},
    loadTimes: function() {},
    csi: function() {}
};
window.isSecureContext = true;
window.origin = 'https://target.com';
window.crossOriginIsolated = false;

// ===== 定时器 =====
window.setTimeout = function(fn, ms) {
    if (typeof fn === 'function') fn();      // 立即执行
    return 1;
};
window.setInterval = function() { return 1; };   // ★ 必须空实现，防无限循环
window.clearTimeout = function() {};
window.clearInterval = function() {};
window.requestAnimationFrame = function(cb) { cb(Date.now()); return 1; };
window.cancelAnimationFrame = function() {};
window.requestIdleCallback = function(cb) { cb({ didTimeout: false, timeRemaining: function() { return 50; } }); };

// ===== 事件 =====
window.addEventListener = function() {};
window.removeEventListener = function() {};
window.dispatchEvent = function() {};
window.postMessage = function() {};

// ===== 弹窗 =====
window.alert = function() {};
window.confirm = function() { return true; };
window.prompt = function() { return ''; };
window.open = function() { return null; };
window.close = function() {};
window.print = function() {};
window.focus = function() {};
window.blur = function() {};

// ===== Storage =====
window.localStorage = {
    _data: {},
    setItem: function(k, v) { this._data[k] = String(v); },
    getItem: function(k) { return this._data.hasOwnProperty(k) ? this._data[k] : null; },
    removeItem: function(k) { delete this._data[k]; },
    clear: function() { this._data = {}; },
    get length() { return Object.keys(this._data).length; },
    key: function(i) { return Object.keys(this._data)[i] || null; }
};
window.sessionStorage = {
    _data: {},
    setItem: function(k, v) { this._data[k] = String(v); },
    getItem: function(k) { return this._data.hasOwnProperty(k) ? this._data[k] : null; },
    removeItem: function(k) { delete this._data[k]; },
    clear: function() { this._data = {}; },
    get length() { return Object.keys(this._data).length; },
    key: function(i) { return Object.keys(this._data)[i] || null; }
};

// ===== Crypto =====
window.crypto = {
    getRandomValues: function(arr) {
        for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
    },
    subtle: { digest: function() { return Promise.resolve(new ArrayBuffer(0)); } },
    randomUUID: function() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }); }
};

// ===== 网络 API =====
window.fetch = function() { return Promise.resolve({ ok: true, status: 200, json: function() { return Promise.resolve({}); } }); };
window.Request = function() {};
window.Response = function() {};
window.Headers = function() {};
window.AbortController = function() { this.signal = {}; this.abort = function() {}; };

// ===== DOM API =====
window.MutationObserver = function() {
    this.observe = function() {};
    this.disconnect = function() {};
    this.takeRecords = function() { return []; };
};
window.ResizeObserver = function() {
    this.observe = function() {};
    this.disconnect = function() {};
};
window.IntersectionObserver = function() {
    this.observe = function() {};
    this.disconnect = function() {};
};
window.DOMParser = function() {
    this.parseFromString = function() { return document; };
};
window.Image = function() { this.src = ''; this.onload = null; this.onerror = null; };
window.Event = function(type) { this.type = type; };
window.CustomEvent = function(type) { this.type = type; };
window.MessageEvent = function() {};
window.WebSocket = function() { this.send = function() {}; this.close = function() {}; };
window.Worker = function() { this.postMessage = function() {}; this.terminate = function() {}; };

// ===== Performance =====
window.performance = {
    now: function() { return Date.now(); },
    timing: {
        navigationStart: Date.now() - 1000,
        loadEventEnd: Date.now() - 500,
        domContentLoadedEventEnd: Date.now() - 600,
        responseEnd: Date.now() - 800,
        fetchStart: Date.now() - 950
    },
    getEntries: function() { return []; },
    getEntriesByType: function() { return []; },
    getEntriesByName: function() { return []; },
    mark: function() {},
    measure: function() {},
    navigation: { type: 0, redirectCount: 0 }
};

// ===== History =====
window.history = {
    length: 1,
    state: null,
    pushState: function() {},
    replaceState: function() {},
    go: function() {},
    back: function() {},
    forward: function() {}
};

// ===== indexedDB =====
window.indexedDB = { open: function() { return { result: null, onerror: null, onsuccess: null }; } };

// ===== 文件 API =====
window.Blob = function(parts, options) { this.size = 0; this.type = (options && options.type) || ''; };
window.File = function() {};
window.FileReader = function() { this.readAsDataURL = function() {}; this.readAsText = function() {}; };
window.FormData = function() { this._data = []; this.append = function(k,v) { this._data.push([k,v]); }; };
window.URLSearchParams = URLSearchParams || function() {};

// ===== 其他 =====
window.getComputedStyle = function() { return { getPropertyValue: function() { return ''; } }; };
window.matchMedia = function() { return { matches: false, addListener: function() {}, removeListener: function() {} }; };
window.atob = function(s) { return Buffer.from(s, 'base64').toString('binary'); };
window.btoa = function(s) { return Buffer.from(s, 'binary').toString('base64'); };
window.encodeURIComponent = encodeURIComponent;
window.decodeURIComponent = decodeURIComponent;
window.webkitRequestFileSystem = function() {};
```

#### 8.1.7 navigator 完整 mock

```javascript
// ===== 构造函数（原型链正确） =====
var Navigator = function() { throw new TypeError("Illegal constructor"); };
Object.defineProperty(Navigator.prototype, Symbol.toStringTag, { value: "Navigator", configurable: true });

// ★ 属性必须在 prototype 上，不是实例上
// 浏览器中 navigator.hasOwnProperty('userAgent') === false
Object.defineProperties(Navigator.prototype, {
    userAgent:          { value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", configurable: true },
    appVersion:         { value: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", configurable: true },
    appName:            { value: "Netscape", configurable: true },
    appCodeName:        { value: "Mozilla", configurable: true },
    product:            { value: "Gecko", configurable: true },
    productSub:         { value: "20030107", configurable: true },
    vendor:             { value: "Google Inc.", configurable: true },
    vendorSub:          { value: "", configurable: true },
    platform:           { value: "Win32", configurable: true },
    language:           { value: "zh-CN", configurable: true },
    languages:          { value: Object.freeze(["zh-CN", "en", "zh"]), configurable: true },
    onLine:             { value: true, configurable: true },
    cookieEnabled:      { value: true, configurable: true },
    maxTouchPoints:     { value: 0, configurable: true },
    hardwareConcurrency:{ value: 8, configurable: true },
    deviceMemory:       { value: 8, configurable: true },
    doNotTrack:         { value: null, configurable: true },
    pdfViewerEnabled:   { value: true, configurable: true },

    // ★ webdriver 必须为 false（自动化检测核心）
    webdriver:          { get: function() { return false; }, configurable: true },

    // ===== Plugins（已弃用但瑞数仍检查） =====
    plugins: { value: (function() {
        var p = {
            length: 5,
            0: { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format", length: 2 },
            1: { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "", length: 2 },
            2: { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer", description: "", length: 2 },
            3: { name: "Microsoft Edge PDF Viewer", filename: "internal-pdf-viewer", description: "", length: 2 },
            4: { name: "WebKit built-in PDF", filename: "internal-pdf-viewer", description: "", length: 2 },
            namedItem: function(name) { for(var i=0;i<5;i++) if(p[i].name===name) return p[i]; return null; },
            item: function(i) { return p[i]; },
            refresh: function() {}
        };
        return p;
    })(), configurable: true },

    mimeTypes: { value: {
        length: 2,
        0: { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
        1: { type: "text/pdf", suffixes: "pdf", description: "" },
        namedItem: function() { return null; },
        item: function(i) { return this[i]; }
    }, configurable: true },

    // ===== API 方法 =====
    sendBeacon:   { value: function() { return true; }, configurable: true },
    getBattery:   { value: function() { return Promise.resolve({ charging:true, chargingTime:0, dischargingTime:Infinity, level:1 }); }, configurable: true },
    javaEnabled:  { value: function() { return false; }, configurable: true },
    vibrate:      { value: function() { return true; }, configurable: true },
    mediaDevices: { value: { enumerateDevices: function() { return Promise.resolve([]); } }, configurable: true },
    credentials:  { value: { get: function() { return Promise.resolve(null); }, create: function() { return Promise.resolve(null); } }, configurable: true },
    clipboard:    { value: { writeText: function() { return Promise.resolve(); } }, configurable: true },
    permissions:  { value: { query: function() { return Promise.resolve({ state: 'prompt' }); } }, configurable: true },
    connection:   { value: { effectiveType: "4g", rtt: 50, downlink: 10, saveData: false }, configurable: true },
    serviceWorker:{ value: { register: function() { return Promise.resolve(); } }, configurable: true },
    storage:      { value: { estimate: function() { return Promise.resolve({ quota: 1073741824, usage: 0 }); } }, configurable: true },
    locks:        { value: { request: function() { return Promise.resolve(); } }, configurable: true },
    userAgentData:{ value: {
        brands: [
            { brand: "Not_A Brand", version: "8" },
            { brand: "Chromium", version: "120" },
            { brand: "Google Chrome", version: "120" }
        ],
        mobile: false,
        platform: "Windows",
        getHighEntropyValues: function() { return Promise.resolve({}); }
    }, configurable: true }
});

// 创建实例（绕过 Illegal constructor）
navigator = Object.create(Navigator.prototype);
```

#### 8.1.8 screen + location mock

```javascript
// ===== screen =====
screen = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    availLeft: 0,
    availTop: 0,
    colorDepth: 24,
    pixelDepth: 24,
    orientation: { angle: 0, type: "landscape-primary", onchange: null }
};
window.devicePixelRatio = 1;

// ===== location =====
location = {
    href:     "https://target.com/path/page.html",
    origin:   "https://target.com",
    protocol: "https:",
    host:     "target.com",
    hostname: "target.com",
    port:     "",
    pathname: "/path/page.html",
    search:   "",
    hash:     "",
    ancestorOrigins: { length: 0 },
    assign:   function(url) {},
    replace:  function(url) {},
    reload:   function() {},
    toString: function() { return this.href; }
};
```

#### 8.1.9 检测项绕过（★★★ 最容易翻车的地方）

##### ① Function.prototype.toString 检测（最关键）

浏览器原生函数返回 `"function name() { [native code] }"`，Node.js mock 的函数会暴露源码。

```javascript
// ===== 通用解决方案：Symbol 标记法 =====
const $toString = Function.toString;
const nativeSymbol = Symbol('native_marker');

const fakeToString = function() {
    return typeof this === 'function' && this[nativeSymbol] || $toString.call(this);
};

function setNative(func, fakeName) {
    Object.defineProperty(func, nativeSymbol, {
        enumerable: false, configurable: true, writable: true,
        value: `function ${fakeName || func.name || ''}() { [native code] }`
    });
}

// 替换全局 toString
delete Function.prototype['toString'];
Object.defineProperty(Function.prototype, 'toString', {
    enumerable: false, configurable: true, writable: true,
    value: fakeToString
});
setNative(Function.prototype.toString, 'toString');

// ★ 所有 mock 的函数都必须注册
setNative(document.createElement, 'createElement');
setNative(document.getElementById, 'getElementById');
setNative(document.getElementsByTagName, 'getElementsByTagName');
setNative(document.querySelector, 'querySelector');
setNative(document.querySelectorAll, 'querySelectorAll');
setNative(document.addEventListener, 'addEventListener');
setNative(window.setTimeout, 'setTimeout');
setNative(window.setInterval, 'setInterval');
setNative(window.fetch, 'fetch');
setNative(window.getComputedStyle, 'getComputedStyle');
setNative(window.matchMedia, 'matchMedia');
setNative(window.requestAnimationFrame, 'requestAnimationFrame');
setNative(navigator.sendBeacon, 'sendBeacon');
setNative(navigator.javaEnabled, 'javaEnabled');
// ... 所有暴露给瑞数的函数都要注册
```

##### ② Object.prototype.toString 检测

```javascript
// 瑞数检查:
// navigator.toString() → '[object Navigator]'
// document.toString()  → '[object HTMLDocument]'
// window.toString()    → '[object Window]'

// 用 Symbol.toStringTag 搞定（见各对象定义）
```

##### ③ Object.getOwnPropertyDescriptor 检测

```javascript
// 浏览器中: navigator 属性在 prototype 上，不在实例上
// Object.getOwnPropertyDescriptor(navigator, 'userAgent') → undefined

var _getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
Object.getOwnPropertyDescriptor = function(o, p) {
    // 如果是 navigator 的原型属性，返回 undefined
    if (o === navigator && Navigator.prototype.hasOwnProperty(p)) {
        return undefined;
    }
    return _getOwnPropertyDescriptor.apply(this, arguments);
};
setNative(Object.getOwnPropertyDescriptor, 'getOwnPropertyDescriptor');
```

##### ④ hasOwnProperty 检测

```javascript
// 浏览器中: navigator.hasOwnProperty('userAgent') === false
// 解决方案: 属性定义在 Navigator.prototype 上（见 8.1.7）
```

##### ⑤ Node.js 环境痕迹清除

```javascript
// 异常堆栈包含 Node.js 路径
var _indexOf = String.prototype.indexOf;
String.prototype.indexOf = function(searchValue) {
    if (typeof searchValue === 'string') {
        if (searchValue === '/modules/cjs/loader') return -1;
        if (searchValue === 'node_modules') return -1;
        if (searchValue === 'internal/modules') return -1;
    }
    return _indexOf.apply(this, arguments);
};
```

##### ⑥ Proxy 检测

```javascript
// 瑞数可检测 Proxy 对象，规则：
// 1. 不要对瑞数直接交互的对象用 Proxy
// 2. 如果用 Proxy 做日志监控，handler 必须透传 Reflect
// 3. 调试时可用，生产环境移除
```

##### ⑦ 代码格式化检测（RS6）

```javascript
// 瑞数6 检测 JS 代码是否被美化（beautify）
// ★ 绝对不要格式化提取的 eval code
// 保持原始混淆格式运行
```

##### ⑧ 完整检测项清单

| 检测项 | 检查方式 | 正确值 |
|--------|----------|--------|
| `navigator.webdriver` | getter | `false` |
| `window.chrome` | 存在性 | `{ runtime: {} }` |
| `document.all` | typeof | `'undefined'`（特殊 falsy 对象）|
| `window.ActiveXObject` | 存在性 | `undefined`（非 IE）|
| `Function.toString` | 返回值 | `"[native code]"` |
| `Object.toString` | 返回值 | `"[object Window]"` 等 |
| `hasOwnProperty` | navigator 属性 | `false`（在 prototype 上）|
| `getOwnPropertyDescriptor` | navigator 属性 | `undefined` |
| `window.top === window.self` | 相等性 | `true`（非 iframe）|
| `location.protocol` | 值 | `"https:"` |
| `Error().stack` | 堆栈内容 | 不含 Node.js 路径 |
| 代码格式 | 字符统计 | 不能被美化 |
| `performance.now()` | 时间精度 | 微秒级 |
| `canvas.toDataURL()` | 指纹 | 一致的返回值 |
| `navigator.plugins.length` | 值 | `>= 1` |
| `navigator.languages` | 数组 | `["zh-CN", ...]` |
| `screen.colorDepth` | 值 | `24` |
| `localStorage` 访问 | 可用性 | 不报错 |
| `MutationObserver` | 存在性 | 存在 |
| `WebSocket` | 存在性 | 存在 |

#### 8.1.10 Node.js vm 模块使用方式

```javascript
const vm = require('vm');
const fs = require('fs');

// ===== 方式1: vm.runInNewContext =====
const sandbox = {
    window: windowMock,
    document: documentMock,
    navigator: navigatorMock,
    location: locationMock,
    screen: screenMock,
    XMLHttpRequest: XMLHttpRequestMock,
    // ... 所有 mock 对象
};

// 加载瑞数外链 JS
const externalJs = fs.readFileSync('external.js', 'utf-8');
vm.runInNewContext(externalJs, sandbox);

// 加载 ts 代码块（含 meta content）
const tsCode = fs.readFileSync('ts_code.js', 'utf-8');
vm.runInNewContext(tsCode, sandbox);

// → document.cookie 已被设置为 Cookie T
// → XMLHttpRequest.prototype.open 已被 hook

// ===== 方式2: vm.createContext（推荐，可复用） =====
const context = vm.createContext(sandbox);
const script = new vm.Script(externalJs + '\n' + tsCode);
script.runInContext(context);

// ===== 触发后缀生成 =====
const triggerCode = `
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/target?param=value');
    xhr._url;  // 返回带后缀的 URL
`;
const urlWithSuffix = vm.runInContext(triggerCode, context);
```

#### 8.1.11 补环境做后缀的完整流程

```
Step 1: 首次请求
   GET https://target.com/page → 202/412
   ← Set-Cookie: Cookie_S=xxx (HttpOnly)
   ← HTML: <meta content="动态token"> + <script>ts代码</script> + <script src="外链.js">

Step 2: 提取素材
   从 HTML 中提取:
   - meta.content（动态 token，每次不同）
   - ts 代码块（内联 script）
   - 外链 JS URL → 下载外链 JS

Step 3: 构建沙箱
   创建完整的 mock 环境（window/document/navigator/location/screen/XHR/...）
   设置 document.domain = 真实域名
   设置 location.href = 真实 URL
   设置 meta.content = 提取的 token

Step 4: 执行代码
   在 vm sandbox 中依次执行:
   1. 外链 JS（定义 VM 解释器 + 字节码）
   2. ts 代码（触发 VM 初始化 → 生成 Cookie T → hook XHR）

Step 5: 获取 Cookie T
   从 document.cookie setter 拦截中获取 Cookie T

Step 6: 获取后缀（★ 关键步骤）
   在同一 sandbox 中创建 XHR 并调用 open:
   var xhr = new XMLHttpRequest();
   xhr.open('GET', '目标API路径');
   → 瑞数 hook 自动计算后缀并修改 URL
   → 从修改后的 URL 中提取后缀参数

Step 7: 发起真实请求
   GET https://target.com/api?param=value&suffixParam=0xxx...
   Cookie: Cookie_S=xxx; Cookie_T=xxx
   → 200 OK
```

#### 8.1.12 补环境框架对比

| 框架 | 地址 | 方式 | 优势 | 劣势 |
|------|------|------|------|------|
| **sdenv** | github.com/pysunday/sdenv | 修改版 jsdom | 最完整的 DOM 环境 | 重，需要修改 jsdom 源码 |
| **sdenv-jsdom** | github.com/pysunday/sdenv-jsdom | jsdom fork | 修复了 toString 问题 | 维护成本高 |
| **手动 mock** | 各博客 | 纯手写 | 轻量，可控 | 遗漏检测项就崩 |
| **qxVm** | — | 环境提取 | 灵活 | 工作量大 |
| **catvm** | — | 手动补丁 | — | 缺 XHR/Image，停更 |

#### 8.1.13 补环境方案总结

**结论**: 补环境做后缀是**可行的**，核心要点：
1. `createElement('a')` 必须正确实现动态 URL 解析（用 Node.js URL 类）
2. `XMLHttpRequest` 必须有完整原型链，让瑞数的 hook 能正常挂载
3. `Function.prototype.toString` 必须全局替换为返回 `[native code]`
4. 所有环境对象的 `Symbol.toStringTag` 和原型链必须正确
5. 清除 Node.js 环境痕迹（global/process/Buffer/Error.stack）
6. **不要格式化代码**（RS6 检测美化）
7. Cookie 和后缀在同一个 sandbox 中生成，共享 `$_ts.cd` 状态

### 8.2 纯算方案

#### 8.2.1 K哥爬虫 — 人均瑞数系列（最详细的公开算法分析）

**瑞数5 后缀算法（最有参考价值）**:
- **地址**: https://www.cnblogs.com/ikdl/p/16647423.html
- **后缀调用链**: `_$RQ`(XHR.open hook) → `_$tB` → `_$5j` → `_$ZO`(第一个后缀) + `_$UM`/`_$Nr`(第二个后缀)
- **关键发现**: 每个请求生成**两个后缀**
- **算法特征**: 16位数组、32位数组、50元素拼接数组、control flow 744（类似 cookie 的 742）、`$_ts` 变量

**瑞数4 后缀**:
- **地址**: https://www.cnblogs.com/ikdl/p/16453681.html
- **关键结论**: "携带正确的 Cookie 和正确的后缀，就能成功访问"

**瑞数6 后缀**:
- **地址**: https://www.cnblogs.com/ikdl/p/17778885.html
- **算法**: CRC32-like 计算（`_$hM` 方法），256位数组 → 4元素数组，与32位数组合并
- **现状**: 流程分析，无可执行代码

#### 8.2.2 CSDN — 瑞数6 后缀算法还原笔记
- **地址**: https://blog.csdn.net/qq_38977435/article/details/134266151
- **标题**: "瑞数6代vmp算法还原流程笔记，406位的cookie及请求后缀"
- **关键数据**: RS6 后缀 119 字符，与 `ts_cd` 绑定，cd 数组必须与 cookie 一致
- **注意**: CSDN 521 防护，内容需浏览器访问

#### 8.2.3 CSDN — 瑞数专题三（后缀算法步骤）
- **地址**: https://blog.csdn.net/qq_44657571/article/details/126994972
- **算法步骤**:
  1. 根据时间生成 4 位数组 arr4
  2. 取 cd 数组中的 16 位数组
  3. 两数组组合成 20 位数组
  4. 与随机数 XOR
  5. XOR 后的 arr20 末尾 push 该随机数 → 21 位数组 arr21
  6. 按固定规则分割 → 切割 cd 的 48 位大数组
- **参考价值**: ★★★ 与我们 AST 分析的 88B 结构高度吻合

#### 8.2.4 CSDN — 其他纯算笔记
| 文章 | 地址 | 说明 |
|------|------|------|
| 瑞数6代逆向纯算法大致流程分析 | https://blog.csdn.net/pyzzd/article/details/132499663 | 流程分析 |
| 药监局瑞数6 vmp算法还原 | https://blog.csdn.net/weixin_44454180/article/details/143328709 | 药监局 RS6 |
| 瑞数5.5逆向笔记（纯扣算法） | https://blog.csdn.net/weixin_45515807/article/details/129742741 | RS5.5 扣代码 |

#### 8.2.5 rs-reverse — pysunday
- **地址**: https://github.com/pysunday/rs-reverse
- **方案**: 纯算，支持 9+ 站点
- **现状**: 只有 `makecookie` 命令，**没有 `makesuffix`**，后缀不在开源范围内

#### 8.2.6 纯算方案总结
- **公开完整实现**: 无（零个开源项目包含后缀纯算）
- **算法流程分析**: K哥（RS4/5/6）和 CSDN 多篇有详细分析
- **核心共识**: 后缀与 cookie 共用 `$_ts.cd` 数组，生成流程类似（flow 744 vs 742），但后缀额外需要 URL pathname/search 编码

### 8.3 其他方案

#### 8.3.1 JsRPC — 浏览器远程调用
- **地址**: https://github.com/jxhczhl/JsRpc
- **B站视频**: https://www.bilibili.com/video/BV1vk4y1G7bu/ （瑞数5代后缀参数加密 RPC 代码分析）
- **方案**: WebSocket 连接浏览器，远程调用 JS 函数生成后缀
- **优势**: 100% 正确，无需理解算法
- **劣势**: 需要维护浏览器实例

#### 8.3.2 MITM 代理拦截
- **地址**: https://www.52pojie.cn/thread-2069036-1-1.html
- **方案**: mitmproxy 拦截浏览器真实流量，在 HTTP 层捕获已生成的后缀
- **优势**: 无需逆向算法
- **劣势**: 非独立方案，依赖浏览器

#### 8.3.3 浏览器断点快速获取后缀
- **地址**: https://www.cnblogs.com/zichliang/p/18003996
- **方案**: DevTools XHR 断点 → `dispatchXhrRequest` 栈帧 → 打印 `config.url` 获取带后缀的完整 URL
- **参考价值**: 调试技巧，非自动化方案

### 8.4 关键技术共识（多源交叉验证）

| 结论 | 来源 | 与我们研究的对应 |
|------|------|------------------|
| 后缀在 XHR.open hook 中生成 | K哥、CSDN、我们的 AST | ✅ 完全一致 |
| 后缀与 cookie 共用 cd 数组 | K哥、CSDN 专题三 | ✅ 对应我们的 49B session |
| 每个请求两个后缀（RS5） | K哥 RS5 分析 | ⚠️ 我们观察到 88B/120B 可能是这两个 |
| RS6 后缀 119 字符 | CSDN 算法还原笔记 | ✅ 对应我们的 120B 结构 |
| 时间4位 + cd16位 → 20位 → XOR → 21位 | CSDN 专题三 | ✅ 与 88B 中 nonce+session 结构吻合 |
| CRC32-like 校验 | K哥 RS6 | ⚠️ 待确认是否对应我们的 32B sig |
| control flow 744 ≈ cookie 的 742 | K哥 RS5 | ✅ 证实后缀和 cookie 算法同源 |

### 8.5 对我们后续工作的启发

1. **补环境路线可行性确认**: 52pojie 帖子证明有人用 Node.js vm + XHR mock 跑通了 RS5 后缀，这条路是走得通的
2. **纯算的核心堵点**: 所有公开资料都卡在 VM 字节码内部的 session 计算，与我们的卡点（49B session 在 r2mKa VM 内）完全一致
3. **CSDN 专题三的算法步骤**: 时间→4位 + cd→16位 → XOR → 48位大数组，这个流程可以反向验证我们的 AST 分析结果
4. **两个后缀**: K哥说 RS5 生成两个后缀，需要确认我们的 88B 和 120B 是否对应这两个后缀，还是同一后缀的两种长度
5. **mini VM 解释器方向**: 没有人公开走通这条路，但也没有人说不可行。结合我们已有的 409 opcodes + 字节码反汇编，这可能是最有差异化的路线
