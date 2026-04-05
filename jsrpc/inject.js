/**
 * JsRpc 浏览器注入脚本
 * 在目标网站 F12 → Console 粘贴执行
 * 支持: getCookie, get, post, getSuffix
 */
!function() {
    function Hlclient(wsURL) {
        this.wsURL = wsURL;
        this.handlers = {};
        this.socket = null;
        if (!wsURL) return;
        var self = this;
        this.socket = new WebSocket(wsURL);
        this.socket.onopen = function() { console.log('[RPC] ★ 已连接:', wsURL); };
        this.socket.onmessage = function(e) {
            try {
                var data = JSON.parse(e.data);
                if (data.action && self.handlers[data.action]) {
                    self.handlers[data.action](function(result) {
                        self.socket.send(JSON.stringify({
                            action: data.action, id: data.id,
                            data: typeof result === 'string' ? result : JSON.stringify(result)
                        }));
                    }, data.param);
                }
            } catch (err) {}
        };
        this.socket.onclose = function() {
            console.log('[RPC] 断开,3秒重连');
            setTimeout(function() { new Hlclient(wsURL); }, 3000);
        };
    }
    Hlclient.prototype.regAction = function(name, fn) {
        this.handlers[name] = fn;
        console.log('[RPC] 注册:', name);
    };
    window.Hlclient = Hlclient;
}();

var rpc = new Hlclient("ws://127.0.0.1:12080/ws?group=ruishu");

// getCookie — 获取当前页面 Cookie
rpc.regAction("getCookie", function(resolve) {
    resolve(document.cookie);
});

// get — GET 请求 (瑞数自动加后缀)
rpc.regAction("get", function(resolve, param) {
    var xhr = new XMLHttpRequest();
    var origOpen = XMLHttpRequest.prototype.open;
    var capturedUrl = '';
    XMLHttpRequest.prototype.open = function(m, url) {
        capturedUrl = url;
        XMLHttpRequest.prototype.open = origOpen;
        return origOpen.apply(this, arguments);
    };
    xhr.open('GET', param || '/', true);
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            resolve(JSON.stringify({
                status: xhr.status,
                url: capturedUrl,
                bodyLen: xhr.responseText.length,
                body: xhr.responseText
            }));
        }
    };
    xhr.send();
});

// post — POST 请求 (瑞数自动加后缀)
rpc.regAction("post", function(resolve, param) {
    try {
        var config = JSON.parse(param);
        var xhr = new XMLHttpRequest();
        var origOpen = XMLHttpRequest.prototype.open;
        var capturedUrl = '';
        XMLHttpRequest.prototype.open = function(m, url) {
            capturedUrl = url;
            XMLHttpRequest.prototype.open = origOpen;
            return origOpen.apply(this, arguments);
        };
        xhr.open('POST', config.url, true);
        xhr.setRequestHeader('Content-Type', config.contentType || 'application/x-www-form-urlencoded');
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                resolve(JSON.stringify({
                    status: xhr.status,
                    url: capturedUrl,
                    body: xhr.responseText
                }));
            }
        };
        xhr.send(config.body || '');
    } catch(e) {
        resolve(JSON.stringify({ error: e.message }));
    }
});

// getSuffix — 获取后缀参数名和值
rpc.regAction("getSuffix", function(resolve, param) {
    var origOpen = XMLHttpRequest.prototype.open;
    var captured = false;
    XMLHttpRequest.prototype.open = function(m, url) {
        if (!captured) {
            // 匹配 ?key=0xxx 或 &key=0xxx
            var match = url.match(/[?&]([^=]+)=(0[a-zA-Z0-9._]+)/);
            if (match) {
                captured = true;
                XMLHttpRequest.prototype.open = origOpen;
                resolve(JSON.stringify({
                    paramName: match[1],
                    suffix: match[2],
                    fullUrl: url
                }));
            }
        }
        return origOpen.apply(this, arguments);
    };
    var xhr = new XMLHttpRequest();
    xhr.open('GET', param || window.location.pathname, true);
    xhr.send();
    setTimeout(function() {
        if (!captured) {
            XMLHttpRequest.prototype.open = origOpen;
            resolve('TIMEOUT');
        }
    }, 5000);
});

// getLocation — 获取当前页面信息
rpc.regAction("getLocation", function(resolve) {
    resolve(JSON.stringify({
        href: location.href,
        hostname: location.hostname,
        pathname: location.pathname,
        protocol: location.protocol
    }));
});

console.log('[RPC] ★★★ 就绪! 方法: getCookie, get, post, getSuffix, getLocation');
