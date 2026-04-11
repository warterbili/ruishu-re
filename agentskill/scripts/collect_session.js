/**
 * 瑞数配套数据一次性采集脚本
 * 在同一个 sdenv session 中采集全套配套数据
 * 用法: node collect_session.js
 *
 * 产出:
 *   captured/session.json    - nsd + cd + Cookie S/T + basearr + 时间戳
 *   captured/keys_raw.json   - 45 组密钥
 *   captured/ts_init.js      - $_ts 初始化脚本
 *   captured/eval_code.js    - eval 代码 (配套变量名)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const vm = require('vm');
const fs = require('fs');
const crypto = require('crypto');
const { jsdomFromUrl } = require('sdenv');

// === 配置 (修改这里) ===
const URL = 'http://TARGET_HOST/TARGET_PATH';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

let captured = { cd: null, nsd: null, evalCode: null };

// Hook vm.runInContext — 必须在 sdenv 执行前设置
const origRun = vm.runInContext;
vm.runInContext = function(code, ctx, opts) {
    if (typeof code === 'string') {
        // 捕获 $_ts 初始化脚本 (含 cd 和 nsd)
        if (code.includes('$_ts.cd=') && code.length < 5000) {
            const cdM = code.match(/cd="([^"]+)"/);
            const nsdM = code.match(/nsd=(\d+)/);
            if (cdM) captured.cd = cdM[1];
            if (nsdM) captured.nsd = parseInt(nsdM[1]);
            fs.mkdirSync('captured', { recursive: true });
            fs.writeFileSync('captured/ts_init.js', code);
        }
        // 捕获 eval 代码 (>100KB)
        if (code.length > 100000 && !captured.evalCode) {
            captured.evalCode = code;
            fs.mkdirSync('captured', { recursive: true });
            fs.writeFileSync('captured/eval_code.js', code);
        }
    }
    return origRun.call(this, code, ctx, opts);
};

// === 以下函数需要从 lib/ 导入或内联 ===
// const { extractKeys, decryptCookieT } = require('../lib/...');
// 这里内联简化版, 实际使用时替换为完整实现

async function collectAll() {
    console.log('开始采集:', URL);

    // sdenv 运行
    const dom = await jsdomFromUrl(URL, {
        userAgent: UA,
        consoleConfig: { error: () => {} },
    });
    await new Promise(r => {
        dom.window.addEventListener('sdenv:exit', r);
        setTimeout(r, 10000);
    });

    // 提取 Cookie
    const cookies = dom.cookieJar.getCookieStringSync(URL);
    const cookieT = cookies.match(/T=([^;]+)/)?.[1];
    captured.cookieS = cookies.match(/S=([^;]+)/)?.[1];
    captured.cookieT = cookieT;

    dom.window.close();

    // 保存
    fs.mkdirSync('captured', { recursive: true });
    fs.writeFileSync('captured/session.json', JSON.stringify({
        url: URL,
        nsd: captured.nsd,
        cd: captured.cd,
        cookieS: captured.cookieS,
        cookieT: captured.cookieT,
        evalCodeLength: captured.evalCode?.length,
        timestamp: new Date().toISOString(),
    }, null, 2));

    console.log('采集完成:');
    console.log('  nsd:', captured.nsd);
    console.log('  cd:', captured.cd?.length, 'chars');
    console.log('  eval:', captured.evalCode?.length, 'chars');
    console.log('  Cookie T:', cookieT?.length, 'chars');

    return captured;
}

collectAll().catch(console.error);
