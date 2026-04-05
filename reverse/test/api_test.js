/**
 * 瑞数纯算 API 全面测试
 *
 * 测试: 查询、搜索、国家筛选、翻页、组合查询
 */
const { RuishuPureClient } = require('../scripts/client.js');

async function test() {
    console.log('==========================================');
    console.log('  瑞数纯算 API 测试');
    console.log('==========================================\n');

    const client = new RuishuPureClient();
    await client.init();
    console.log('✅ Cookie 就绪\n');

    let passed = 0, failed = 0;

    async function check(name, fn) {
        try {
            const result = await fn();
            if (result) {
                console.log('✅ ' + name);
                passed++;
            } else {
                console.log('❌ ' + name);
                failed++;
            }
        } catch (e) {
            console.log('❌ ' + name + ' — ' + e.message);
            failed++;
        }
    }

    // ============================================================
    // 1. GET 主页
    // ============================================================
    await check('GET 主页', async () => {
        const r = await client.get('/zscq/search/jsp/vBrandSearchIndex.jsp');
        console.log('   status=' + r.status + ' body=' + r.body.length + ' chars');
        return r.status === 200 && r.body.length > 1000;
    });

    // ============================================================
    // 2. POST 全量查询
    // ============================================================
    await check('POST 全量查询', async () => {
        const r = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            'page=1&rows=5&sidx=RECORD_NUM&sord=desc&_search=false&nd=' + Date.now());
        const data = JSON.parse(r.body);
        console.log('   records=' + data.records + ' rows=' + data.rows.length);
        return r.status === 200 && data.records > 100000 && data.rows.length === 5;
    });

    // ============================================================
    // 3. 搜索: 华为
    // ============================================================
    await check('搜索 "华为"', async () => {
        const r = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            'page=1&rows=10&sidx=RECORD_NUM&sord=desc&RECORD_NAME=' + encodeURIComponent('华为') + '&_search=false&nd=' + Date.now());
        const data = JSON.parse(r.body);
        console.log('   records=' + data.records);
        data.rows.forEach((row, i) => console.log('   [' + (i+1) + '] ' + row.APPLY_USER_NAME + ' | ' + row.RECORD_NAME));
        return r.status === 200 && data.records === 4;
    });

    // ============================================================
    // 4. 搜索: 苹果
    // ============================================================
    await check('搜索 "苹果"', async () => {
        const r = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            'page=1&rows=10&sidx=RECORD_NUM&sord=desc&RECORD_NAME=' + encodeURIComponent('苹果') + '&_search=false&nd=' + Date.now());
        const data = JSON.parse(r.body);
        console.log('   records=' + data.records);
        data.rows.forEach((row, i) => console.log('   [' + (i+1) + '] ' + row.APPLY_USER_NAME + ' | ' + row.RECORD_NAME));
        return r.status === 200 && data.records === 3;
    });

    // ============================================================
    // 5. 国家筛选: 美国 (502)
    // ============================================================
    await check('国家筛选: 美国', async () => {
        const r = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            'page=1&rows=3&sidx=RECORD_NUM&sord=desc&COUNTRY=502&_search=false&nd=' + Date.now());
        const data = JSON.parse(r.body);
        const countries = [...new Set(data.rows.map(r => r.CONUTRY_NAME))];
        console.log('   records=' + data.records + ' countries=' + JSON.stringify(countries));
        return r.status === 200 && data.records > 10000 && countries[0] === '美国';
    });

    // ============================================================
    // 6. 国家筛选: 日本 (116)
    // ============================================================
    await check('国家筛选: 日本', async () => {
        const r = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            'page=1&rows=3&sidx=RECORD_NUM&sord=desc&COUNTRY=116&_search=false&nd=' + Date.now());
        const data = JSON.parse(r.body);
        const countries = [...new Set(data.rows.map(r => r.CONUTRY_NAME))];
        console.log('   records=' + data.records + ' countries=' + JSON.stringify(countries));
        return r.status === 200 && data.records > 2000 && countries[0] === '日本';
    });

    // ============================================================
    // 7. 国家筛选: 阿富汗 (101)
    // ============================================================
    await check('国家筛选: 阿富汗', async () => {
        const r = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            '_search=false&nd=' + Date.now() + '&rows=30&page=1&sidx=RECORD_NUM&sord=desc&COUNTRY=101');
        const data = JSON.parse(r.body);
        console.log('   records=' + data.records);
        if (data.rows.length > 0) console.log('   [1] ' + data.rows[0].APPLY_USER_NAME + ' | ' + data.rows[0].CONUTRY_NAME);
        return r.status === 200 && data.records > 0;
    });

    // ============================================================
    // 8. 组合: 国家 + 商品类型 + 注册类型
    // ============================================================
    await check('组合: 阿富汗+商品类型2+注册类型4', async () => {
        const r = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            '_search=false&nd=' + Date.now() + '&rows=30&page=1&sidx=RECORD_NUM&sord=desc&APPLY_USER_NAME=&RECORD_NAME=&RECORD_NUM=&REGISTER_NUM=&PRODUCT_TYPE=2&VERIFY_STATE=&LEGALOF_USER_NAME=&RECORD_STATE=&CHECK_MERCH=&CAN_USE_PRODUCT=&COUNTRY=101&REGISTER_TYPE=4&ISLIKE=true');
        const data = JSON.parse(r.body);
        console.log('   records=' + data.records);
        if (data.rows.length > 0) console.log('   [1] ' + data.rows[0].APPLY_USER_NAME + ' | ' + data.rows[0].RECORD_NAME);
        return r.status === 200 && data.records >= 1;
    });

    // ============================================================
    // 9. 翻页: 第1-3页
    // ============================================================
    await check('翻页: 3页连续', async () => {
        let allRows = [];
        for (let page = 1; page <= 3; page++) {
            const r = await client.post('/searchUser/searchAction!getVRecordListPage.do',
                'page=' + page + '&rows=5&sidx=RECORD_NUM&sord=desc&_search=false&nd=' + Date.now());
            const data = JSON.parse(r.body);
            allRows.push(...data.rows.map(r => r.RECORD_NUM));
        }
        const unique = [...new Set(allRows)];
        console.log('   总行数=' + allRows.length + ' 去重=' + unique.length);
        return allRows.length === 15 && unique.length === 15; // 每页不重复
    });

    // ============================================================
    // 10. 国家列表 API
    // ============================================================
    await check('国家列表 API', async () => {
        const r = await client.post('/param/paramAction!getParamTypeList.do',
            'ns=' + Date.now() + '&code=Country');
        const text = r.body.replace(/'/g, '"');
        const data = JSON.parse(text);
        const us = data.find(x => x.name === '美国');
        const jp = data.find(x => x.name === '日本');
        const cn = data.find(x => x.name === '中国');
        console.log('   国家数=' + data.length + ' 美国=' + (us ? us.value : '?') + ' 日本=' + (jp ? jp.value : '?') + ' 中国=' + (cn ? cn.value : '?'));
        return r.status === 200 && data.length > 200 && us && jp && cn;
    });

    // ============================================================
    // 11. 按申请人搜索
    // ============================================================
    await check('按申请人搜索', async () => {
        const r = await client.post('/searchUser/searchAction!getVRecordListPage.do',
            'page=1&rows=5&sidx=RECORD_NUM&sord=desc&APPLY_USER_NAME=' + encodeURIComponent('腾讯') + '&_search=false&nd=' + Date.now());
        const data = JSON.parse(r.body);
        console.log('   records=' + data.records);
        if (data.rows.length > 0) console.log('   [1] ' + data.rows[0].APPLY_USER_NAME + ' | ' + data.rows[0].RECORD_NAME);
        return r.status === 200 && data.records > 0;
    });

    // ============================================================
    // 12. Cookie 自动刷新
    // ============================================================
    await check('Cookie 自动刷新', async () => {
        // 破坏 Cookie T
        client._cookieT = 'invalid_cookie_value';
        const r = await client.get('/zscq/search/jsp/vBrandSearchIndex.jsp');
        console.log('   刷新后 status=' + r.status);
        return r.status === 200;
    });

    // ============================================================
    // 汇总
    // ============================================================
    console.log('\n==========================================');
    console.log('  结果: ' + passed + ' 通过, ' + failed + ' 失败');
    console.log('==========================================');
}

test().catch(e => console.error('Fatal:', e.message));
