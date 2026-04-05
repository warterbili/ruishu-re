/**
 * 瑞数反爬 Cookie + 后缀生成器 — 基于 sdenv
 *
 * 功能：
 *   1. 自动获取 412 响应 → 执行瑞数 JS → 生成 Cookie
 *   2. GET 请求：直接用 Cookie 发送
 *   3. POST 请求：通过 VM 内 XHR 发送（自动加 URL 后缀）
 *
 * 依赖：npm install sdenv
 *
 * 用法：
 *   node rs_sdenv_client.js
 *   或 const { RuishuClient } = require('./rs_sdenv_client');
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { jsdomFromUrl } = require('sdenv');
const http = require('http');

// ============================================================
//  配置
// ============================================================
const CONFIG = {
    host: '202.127.48.145',
    port: 8888,
    entryPath: '/zscq/search/jsp/vBrandSearchIndex.jsp',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
};

// ============================================================
//  RuishuClient 类
// ============================================================
class RuishuClient {
    constructor(config = {}) {
        this.config = { ...CONFIG, ...config };
        this.dom = null;
        this.cookies = '';
        this.ready = false;
    }

    get baseUrl() {
        return `http://${this.config.host}:${this.config.port}`;
    }

    /**
     * 初始化：访问页面 → 执行瑞数 JS → 生成 Cookie
     */
    async init() {
        const url = `${this.baseUrl}${this.config.entryPath}`;
        console.log(`[init] 访问 ${url}`);

        this.dom = await jsdomFromUrl(url, {
            userAgent: this.config.userAgent,
            consoleConfig: { error: () => {} },
        });

        // 等待 Cookie 生成（location.replace 事件标志完成）
        await new Promise(resolve => {
            this.dom.window.addEventListener('sdenv:exit', () => resolve());
            setTimeout(resolve, 8000);
        });

        this.cookies = this.dom.cookieJar.getCookieStringSync(this.baseUrl);
        this.ready = true;
        console.log(`[init] Cookie 就绪: ${this.cookies.substring(0, 50)}...`);
        return this;
    }

    /**
     * GET 请求 — 直接用 Cookie（不需要后缀）
     */
    async get(path) {
        if (!this.ready) throw new Error('请先调用 init()');
        return new Promise((resolve, reject) => {
            http.request({
                hostname: this.config.host,
                port: this.config.port,
                path,
                method: 'GET',
                headers: {
                    'User-Agent': this.config.userAgent,
                    'Host': `${this.config.host}:${this.config.port}`,
                    'Cookie': this.cookies,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
            }, res => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
            }).on('error', reject).end();
        });
    }

    /**
     * POST 请求 — 通过 VM 内 XHR（自动加后缀）
     */
    async post(path, data) {
        if (!this.ready) throw new Error('请先调用 init()');
        const w = this.dom.window;
        return new Promise((resolve, reject) => {
            const xhr = new w.XMLHttpRequest();
            xhr.open('POST', path, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    resolve({
                        status: xhr.status,
                        body: xhr.responseText,
                    });
                }
            };
            xhr.onerror = () => reject(new Error('XHR error'));
            if (typeof data === 'object' && !(data instanceof String)) {
                xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                const encoded = Object.entries(data)
                    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                    .join('&');
                xhr.send(encoded);
            } else {
                xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                xhr.send(data || '');
            }
            setTimeout(() => {
                if (xhr.readyState !== 4) reject(new Error('请求超时'));
            }, 30000);
        });
    }

    /**
     * 关闭 DOM 释放资源
     */
    close() {
        if (this.dom) {
            this.dom.window.close();
            this.dom = null;
            this.ready = false;
        }
    }
}

// ============================================================
//  示例：获取知识产权备案数据
// ============================================================
async function demo() {
    console.log('='.repeat(60));
    console.log('  瑞数反爬绕过客户端 (sdenv)');
    console.log('='.repeat(60));
    console.log('');

    const client = new RuishuClient();

    try {
        // Step 1: 初始化
        await client.init();

        // Step 2: GET 主页面
        console.log('\n[GET] 主页面...');
        const page = await client.get(CONFIG.entryPath);
        console.log(`  状态: ${page.status}, 长度: ${page.body.length}`);

        // Step 3: POST 查询数据（jqGrid 格式）
        console.log('\n[POST] 查询备案列表 (第1页)...');
        const r1 = await client.post('/searchUser/searchAction!getVRecordListPage.do', {
            page: 1,
            rows: 10,
            sidx: 'RECORD_NUM',
            sord: 'desc',
            _search: 'false',
            nd: Date.now(),
        });
        console.log(`  状态: ${r1.status}, 长度: ${r1.body.length}`);

        if (r1.status === 200 && r1.body.length > 2) {
            const data = JSON.parse(r1.body);
            console.log(`  总记录: ${data.records}, 总页数: ${data.total}`);
            console.log(`  本页数据: ${data.rows?.length} 条`);
            if (data.rows?.length > 0) {
                console.log('\n  第一条记录:');
                const row = data.rows[0];
                console.log(`    备案号: ${row.RECORD_NUM || 'N/A'}`);
                console.log(`    权利人: ${row.APPLY_USER_NAME || 'N/A'}`);
                console.log(`    注册号: ${row.REGISTER_NUM || 'N/A'}`);
                console.log(`    状态: ${row.RECORD_STATE || 'N/A'}`);
            }
        }

        // Step 4: 多次请求 — 每次重新 init（VM 限制：单 session 只能发一次 POST）
        client.close();

        console.log('\n[POST] 搜索 "华为"（重新 init）...');
        await client.init();
        const r2 = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            'page=1&rows=5&sidx=RECORD_NUM&sord=desc&RECORD_NAME=' + encodeURIComponent('华为') + '&_search=false&nd=' + Date.now()
        );
        console.log(`  状态: ${r2.status}, 长度: ${r2.body.length}`);
        if (r2.status === 200 && r2.body.length > 2) {
            const data = JSON.parse(r2.body);
            console.log(`  搜索 "华为" 结果: ${data.records} 条`);
            if (data.rows) {
                data.rows.forEach((row, i) => {
                    console.log(`  [${i + 1}] ${row.APPLY_USER_NAME} | ${row.REGISTER_NUM} | ${row.RECORD_NUM}`);
                });
            }
        }
        client.close();

        // Step 5: 翻页
        console.log('\n[POST] 第2页（重新 init）...');
        await client.init();
        const r3 = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            'page=2&rows=5&sidx=RECORD_NUM&sord=desc&_search=false&nd=' + Date.now()
        );
        console.log(`  状态: ${r3.status}`);
        if (r3.status === 200 && r3.body.length > 2) {
            const data = JSON.parse(r3.body);
            console.log(`  第2页: ${data.rows?.length} 条`);
            if (data.rows) {
                data.rows.forEach((row, i) => {
                    console.log(`  [${i + 1}] ${row.APPLY_USER_NAME} | ${row.REGISTER_NUM}`);
                });
            }
        }

    } catch (e) {
        console.log('错误:', e.message);
    } finally {
        client.close();
    }

    console.log('\n' + '='.repeat(60));
    console.log('  完成');
    console.log('='.repeat(60));
}

// 如果直接运行则执行 demo
if (require.main === module) {
    demo();
}

module.exports = { RuishuClient, CONFIG };
