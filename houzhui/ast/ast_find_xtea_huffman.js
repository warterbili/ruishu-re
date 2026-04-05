var code = require("fs").readFileSync("C:/lsd_project/learn_js/reverse/captured/eval_code.js", "utf-8");

// ============================================================
// 1. 找 XTEA 函数 (特征: 0x9E3779B9 = 2654435769)
// ============================================================
var xteaPos = code.indexOf("2654435769");
console.log("XTEA delta at:", xteaPos);
if (xteaPos >= 0) {
    var funcStart = code.lastIndexOf("function ", xteaPos);
    var d = 0;
    for (var i = funcStart; i < code.length; i++) {
        if (code[i] === "{") d++;
        else if (code[i] === "}") { d--; if (d === 0) {
            var src = code.substring(funcStart, i+1);
            var funcName = src.match(/function\s+(_\$\w+)/);
            console.log("XTEA in:", funcName ? funcName[1] : "anon", "(" + src.length + " chars)");
            console.log(src.substring(0, 500));
            require("fs").writeFileSync("C:/lsd_project/rs_reverse/houzhui/debug_output/xtea_func.js", src);
            break;
        }}
    }
}

// ============================================================
// 2. 找 Huffman 函数 (特征: 权重初始化 + 树构建)
// ============================================================
console.log("\n=== Huffman ===");
// _$lO[28]=45, _$lO[36]=6 — 从常量表
// 搜索同时出现 _$lO[28] 和 _$lO[36] 的函数
var funcs = {};
var funcRe = /function\s+(_\$\w+)\s*\(([^)]*)\)\s*\{/g;
var m;
while (m = funcRe.exec(code)) {
    var name = m[1];
    var start = m.index;
    var d2 = 0;
    for (var i = start + m[0].length - 1; i < code.length; i++) {
        if (code[i] === "{") d2++;
        else if (code[i] === "}") { d2--; if (d2 === 0) {
            funcs[name] = { start: start, end: i+1, len: i+1-start };
            break;
        }}
    }
}

// 找包含 Huffman 特征的函数
for (var name in funcs) {
    var src = code.substring(funcs[name].start, funcs[name].end);
    // Huffman: 通常有优先队列 + 二叉树构建
    if (src.includes("_$lO[28]") && src.includes("_$lO[36]") && funcs[name].len > 200) {
        console.log("Huffman candidate:", name, "(" + funcs[name].len + " chars)");
        console.log(src.substring(0, 300));
        console.log("");
    }
}

// ============================================================
// 3. 找 Cookie S 读取 + 解密的完整链路
// ============================================================
console.log("\n=== Cookie S 处理链 ===");

// document.cookie 访问: _$if[_$dn[16]] (g68[16]="cookie")
// 之前 AST 找到: _$cR[5][_$jO[3]](_$if[_$dn[16]],"; ")
// _$cR[5] = rt[5] = String.prototype.split 或类似
// _$if = document

// 找到这行的完整上下文
var cookieSplit = code.indexOf('_$if[_$dn[16]]');
while (cookieSplit >= 0) {
    var ctx = code.substring(cookieSplit - 50, cookieSplit + 150);
    if (ctx.includes('split') || ctx.includes('; ') || ctx.includes('_$dn[25]')) {
        console.log("Cookie split at " + cookieSplit + ":");
        console.log("  " + ctx.replace(/\s+/g, ' ').substring(0, 180));
    }
    cookieSplit = code.indexOf('_$if[_$dn[16]]', cookieSplit + 1);
}

// ============================================================
// 4. 找 Cookie S 名称匹配
// ============================================================
console.log("\n=== Cookie 名称匹配 ===");
// Cookie 名称 "AV7KYchI7HHaS" 来自 meta tag
// eval code 读取 meta tag: document.getElementById(id).content
// 或 getElementsByTagName("meta")

// 搜索 getElementById
var getByIdCount = 0;
var getByIdRe = /getElementById|_\$dn\[76\]/g; // g72[76]="getElementById" 但这是 g72 不是 g68
while (m = getByIdRe.exec(code)) getByIdCount++;
console.log("getElementById references:", getByIdCount);

// g68 字符串表中: 没有 getElementById
// g72 字符串表中: [76]="getElementById"
// 在 eval code 中，g72 是通过 r2mKa VM 访问的
// eval code 自己的字符串表是 g68

// 搜索 meta tag 读取
// getElementsByTagName("meta") — g68[35]="getElementsByTagName"?
// 检查 g68
var g68 = ["response","click","document","{","defineProperty","from","removeEventListener","event","*","substr","undefined","button","/","pathname","floor","removeChild","cookie",".","appName","charAt","http:","\"","parse","https:","set",";","localStorage","EventTarget","onreadystatechange","onerror","}","eval","hostname","onabort","1","getElementsByTagName","x","r","content","toLowerCase","%","Element","random","base","result","history","enctype","substring","substring","setInterval","Request","host","outerHTML","fetch","assign","max","indexedDB","HTMLGenericElement","timeStamp","sendBeacon","clearInterval","pff0","statusText","HTMLFormElement","showModalDialog","[native code]","0","getTime","|","mousemove","c","keydown","then","message","hasOwnProperty","responseXML","#onsubmit","#href","function ","stack","onloadend","method","matchMedia","datas-ts","onloadstart","//","cloneNode","canPlayType","import","443","performance","Math","keyCode","javascript:","setTimeout","onprogress","80"];

console.log("g68[35]:", g68[35]); // getElementsByTagName
console.log("g68[38]:", g68[38]); // content

// 搜索 _$dn[35] (getElementsByTagName)
var gbtRe = /_\$dn\[35\]/g;
var gbtCount = 0;
while (m = gbtRe.exec(code)) {
    gbtCount++;
    if (gbtCount <= 3) {
        var ctx2 = code.substring(m.index - 30, m.index + 80);
        console.log("  _$dn[35] at " + m.index + ": " + ctx2.replace(/\s+/g, ' ').substring(0, 100));
    }
}
console.log("_$dn[35] (getElementsByTagName) total:", gbtCount);

// 搜索 _$dn[38] (content)
var contentRe = /_\$dn\[38\]/g;
var contentCount = 0;
while (m = contentRe.exec(code)) {
    contentCount++;
    if (contentCount <= 3) {
        var ctx3 = code.substring(m.index - 30, m.index + 80);
        console.log("  _$dn[38] at " + m.index + ": " + ctx3.replace(/\s+/g, ' ').substring(0, 100));
    }
}
console.log("_$dn[38] (content) total:", contentCount);
