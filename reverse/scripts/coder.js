/**
 * 外层 VM 重写 — 基于阅读 mainjs 的 _$cj(75 opcode) + _$g6(55 opcode) 理解后实现
 *
 * 输入: mainjs 源码 + nsd + cd
 * 输出: eval 代码 + r2mkaText + keycodes + keynames + aebi + functionsNameSort + cp3
 */
const fs = require('fs');
const path = require('path');

// === PRNG (mainjs _$ad, line 12) ===
function createScd(seed) {
    let s = seed;
    return () => { s = 15679 * (s & 0xFFFF) + 2531011; return s; };
}

// === Fisher-Yates 洗牌 (mainjs _$lT, line 21) ===
function arrayShuffle(arr, scd) {
    const a = [...arr];
    let len = a.length;
    while (len > 1) { len--; const i = scd() % len; [a[len], a[i]] = [a[i], a[len]]; }
    return a;
}

// === 从 mainjs 提取 4 个最长引号字符串 ===
function extractImmucfg(code) {
    const q = [];
    for (let i = 0; i < code.length; i++) if (code[i] === '"' && (i === 0 || code[i-1] !== '\\')) q.push(i);
    const strs = [];
    for (let i = 0; i < q.length - 1; i += 2) {
        const raw = code.slice(q[i]+1, q[i+1]);
        try { strs.push(JSON.parse('"'+raw+'"')); } catch(e) { try { strs.push(eval('("'+raw+'")')); } catch(e2) { strs.push(raw); } }
    }
    strs.sort((a,b) => b.length - a.length);
    return { globalText1: strs[0], cp0: strs[1], cp2: strs[2], globalText2: strs[3] };
}

// === 变量名生成 (mainjs op 53+21+46) ===
function grenKeys(num, nsd) {
    const chars = '_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const names = [];
    for (let i = 0; i < chars.length && names.length < num; i++)
        for (let j = 0; j < chars.length && names.length < num; j++)
            names.push('_$' + chars[i] + chars[j]);
    return arrayShuffle(names, createScd(nsd));
}

// === 游标读取器 (mainjs _$$1 + _$kx) ===
function textReader(text) {
    let c = 0;
    return {
        getCode() { return text.charCodeAt(c++); },
        getLine(n) { const s = text.substr(c, n); c += n; return s; },
        getList() { const n = text.charCodeAt(c); const d = []; for (let i=0;i<n;i++) d.push(text.charCodeAt(c+1+i)); c+=n+1; return d; },
        pos() { return c; },
    };
}

// === Coder ===
class Coder {
    constructor(nsd, cd, mainjsCode) {
        const imm = extractImmucfg(mainjsCode);
        this.globalText1 = imm.globalText1;
        this.globalText2 = imm.globalText2;
        this.cp0 = imm.cp0;
        this.cp2 = imm.cp2;
        this.nsd = nsd;
        this.cd = cd;
        // keynameNum 从 mainjs 动态提取 (rs-reverse config/index.js 的方法)
        const knMatch = mainjsCode.match(/_\$[\$_A-Za-z0-9]{2}=_\$[\$_A-Za-z0-9]{2}\(0,([0-9]+),_\$[\$_A-Za-z0-9]{2}\(/);
        this.keynameNum = knMatch ? parseInt(knMatch[1]) : 918;
        this.keynames = grenKeys(this.keynameNum, nsd);
        this.keycodes = [];
        this.scd = createScd(nsd);
        this.aebi = [];
        this.r2mkaText = null;
        this.functionsNameSort = [];
        this.mainFunctionIdx = null;
        this.code = '';
        this.cp3 = 0;
        this.hasDebug = true; // 我们站点有 debugger
        this._debuggerScd = null;
        this._debuggerPosi = [];
    }

    run() {
        const codeArr = this.parseGlobalText1();
        codeArr.push(this.parseGlobalText2());
        codeArr.push("})(", '$_ts', ".scj,", '$_ts', ".aebi);");
        this.code = codeArr.join('');
        // cp[3] hash (mainjs op 30)
        let h = 0; for (let i = 0; i < this.code.length; i += 100) h += this.code.charCodeAt(i);
        this.cp3 = h;
        return this;
    }

    // 对应 mainjs _$cj(56) 主流程 → _$g6(36) 代码段生成循环
    parseGlobalText1() {
        const r = textReader(this.globalText1);
        const { scd, keynames } = this;
        const codeArr = [];

        // 读 opmate 标志: 5 个有名 + 1 个无名 = 6 个 getCode
        this._globalMates = {};
        this._globalMates.G_e4 = r.getCode();  // pos 0
        this._globalMates.G_sc = r.getCode();  // pos 1
        this._globalMates.G_dK = r.getCode();  // pos 2
        this._globalMates.G_kv = r.getCode();  // pos 3
        this._globalMates.G_cR = r.getCode();  // pos 4
        this._globalMates.G_un = r.getCode();  // pos 5 (setMate 无参)

        // 读 keycodes 字符串: 长度 = getCode()*55295 + getCode()
        const kLen = r.getCode() * 55295 + r.getCode();  // pos 6,7
        const kcStr = r.getLine(kLen);
        this.keycodes.push(...kcStr.split(String.fromCharCode(257)));

        // 读 r2mka: 1 个 opmate + 长度
        r.getCode(); // setMate 无参
        const rLen = r.getCode() * 55295 + r.getCode();
        const r2mkaRaw = r.getLine(rLen);
        this.keycodes.push(r2mkaRaw);
        this.r2mkaText = this._parseR2mka(r2mkaRaw);

        // 代码段数量
        const codeNum = r.getCode();

        // 生成各代码段 — debugger 在循环外初始化（对齐 rs-reverse）
        for (let current = 0; current < codeNum; current++) {
            if (this.hasDebug) {
                const dScd = createScd(this.nsd);
                let dMax = dScd() % 10 + 10;
                this._debuggerScd = (posi) => {
                    let ret = false;
                    --dMax;
                    if (dMax <= 0) {
                        dMax = dScd() % 10 + 10;
                        if (dMax < 64) { ret = true; this._debuggerPosi.push(posi); }
                    }
                    return ret;
                };
            }
            this._gren(r, current, codeArr);
        }
        codeArr.push('}}}}}}}}}}'.substr(codeNum - 1));
        if (this.mainFunctionIdx) this.mainFunctionIdx.push(codeArr.join('').length);
        return codeArr;
    }

    // 提取 r2mka 纯文本 (mainjs 中 r2mka keycodes 元素格式: 代码..."r2mKa0\x00..."...)
    _parseR2mka(raw) {
        const s = raw.indexOf('"') + 1;
        const e = raw.lastIndexOf('"');
        if (s <= 0 || e <= s) return null;
        const inner = raw.substring(s, e);
        try { return JSON.parse('"' + inner + '"'); } catch(err) {
            try { return eval('("' + inner + '")'); } catch(err2) { return inner; }
        }
    }

    // 代码段生成 (对应 mainjs _$g6(36) + 后续循环)
    _gren(r, current, codeArr) {
        const { scd, keynames, keycodes } = this;

        // 换行填充 (mainjs op 15/84)
        codeArr.push('\n\n\n\n\n'.substring(0, scd() % 5));

        // 8 个 opmate (对应 _$g6 中的 getCode 调用)
        const m = {};
        for (const k of ['ku','s6','bs','sq','jw','sg','cu','aw']) m[k] = r.getCode();

        // 3 个数据列表
        const listK = r.getList();
        const listH = r.getList();
        const listC = r.getList();

        // listC 两两配对后洗牌
        const pairs = [];
        for (let i = 0; i < listC.length; i += 2) pairs.push([listC[i], listC[i+1]]);
        const shuffledPairs = arrayShuffle(pairs, scd);

        // bf 标志 (opcode 范围上限)
        const bf = r.getCode();

        // aebi 数据
        const aebiData = r.getList();
        this.aebi[current] = aebiData;

        // 函数数量 + 函数代码段
        const funcCount = r.getCode();
        const funcSegs = [];
        for (let i = 0; i < funcCount; i++) funcSegs.push(r.getList());
        const shuffledFuncs = arrayShuffle(funcSegs, scd);

        // opcode 实现数量 + 实现
        const opcCount = r.getCode();
        const opcImpls = [];
        for (let i = 0; i < opcCount; i++) opcImpls.push(r.getList());

        // === 生成代码 ===

        if (current > 0) {
            if (!this.mainFunctionIdx) this.mainFunctionIdx = [codeArr.join('').length];
            codeArr.push("function ", keynames[m.jw], "(", keynames[m.s6]);
            listK.forEach(it => codeArr.push(",", keynames[it]));
            codeArr.push("){");
        } else {
            // ★ current=0: 参数用全局 opmate, var 用 _$$6 (index 1)
            codeArr.push("(function(", keynames[this._globalMates.G_dK], ",", keynames[this._globalMates.G_kv], "){var ", keynames[m.s6], "=0;");
        }

        // wrapper 函数
        const fnMap = {};
        shuffledPairs.forEach(([k1, k2]) => {
            const a = ["function ", keynames[k1], "(){var ", keynames[m.sq], "=[", k2, "];Array.prototype.push.apply(", keynames[m.sq], ",arguments);return ", keynames[m.sg], ".apply(this,", keynames[m.sq], ");}"];
            codeArr.push(...a);
            fnMap[keynames[k1]] = a.join('');
        });

        // 代码段拼接
        shuffledFuncs.forEach(item => {
            for (let i = 0; i < item.length - 1; i += 2) codeArr.push(keycodes[item[i]], keynames[item[i+1]]);
            codeArr.push(keycodes[item[item.length - 1]]);
        });

        // 变量声明
        if (listH.length) {
            listH.forEach((it, i) => codeArr.push(i ? "," : 'var ', keynames[it]));
            codeArr.push(';');
        }

        // while(1) 循环 — ★ 注意混合使用全局和局部 opmate
        codeArr.push("var ", keynames[m.bs], ",", keynames[m.cu], ",", keynames[m.ku], "=");
        codeArr.push(keynames[m.s6], ",", keynames[m.aw], "=", keynames[this._globalMates.G_kv], "[", current, "];");
        codeArr.push("while(1){", keynames[m.cu], "=", keynames[m.aw], "[", keynames[m.ku], "++];");
        codeArr.push("if(", keynames[m.cu], "<", bf, "){");

        // functionsSort
        if ([1,2,3,4].includes(current)) {
            try { this._functionsSort(current, fnMap, shuffledPairs, opcImpls, aebiData); } catch(e) {}
        }

        // if/else 嵌套 — 传入 _$cu 变量名
        this._ifElse(0, bf, codeArr, opcImpls, keycodes, keynames, keynames[m.cu]);
        codeArr.push("}else ", ';', '}');
    }

    _functionsSort(current, fnMap, pairs, opcImpls, aebi) {
        const { keynames, keycodes } = this;
        const len = pairs.length;
        const getName = (idx) => {
            const arr = opcImpls[idx];
            if (!arr || arr.length !== 5 || !fnMap[keynames[arr[3]]]) throw new Error();
            return keynames[arr[3]];
        };
        let start = 0;
        if (current === 1) {
            this.keycodes.filter(it => typeof it === 'string' && /^\([0-9]+\);$/.test(it)).forEach(it => {
                const s = parseInt(it.slice(1));
                if (s + len > aebi.length) return;
                try { aebi.slice(s, s + len).forEach(getName); } catch(e) { return; }
                start = s;
            });
        }
        aebi.slice(start, start + len).forEach(idx => {
            const name = getName(idx);
            if (name) this.functionsNameSort.push({ name, current, code: fnMap[name] });
        });
    }

    // 精确对齐 rs-reverse grenIfelse — start 在循环中被修改
    _ifElse(start, end, out, impls, kc, kn, cuName) {
        const arr8 = [4, 16, 64, 256, 1024, 4096, 16384, 65536];
        let diff = end - start;
        if (diff == 0) {
            return;
        } else if (diff == 1) {
            this._appendImpl(start, out, impls, kc, kn);
        } else if (diff <= 4) {
            let text = "if(";
            end--;
            for (; start < end; start++) {
                out.push(text, cuName, "===", start, "){");
                this._appendImpl(start, out, impls, kc, kn);
                text = "}else if(";
            }
            out.push("}else{");
            this._appendImpl(start, out, impls, kc, kn);
            out.push("}");
        } else {
            const step = arr8[arr8.findIndex(it => diff <= it) - 1] || 0;
            let text = "if(";
            for (; start + step < end; start += step) {
                out.push(text, cuName, "<", start + step, "){");
                this._ifElse(start, start + step, out, impls, kc, kn, cuName);
                text = "}else if(";
            }
            out.push("}else{");
            this._ifElse(start, end, out, impls, kc, kn, cuName);
            out.push("}");
        }
    }

    _appendImpl(idx, out, impls, kc, kn) {
        // debugger 插入 (对应 rs-reverse grenIfElseAssign)
        if (this._debuggerScd?.(out.length)) {
            out.push('debugger;');
        }
        const arr = impls[idx]; if (!arr) return;
        const len = arr.length - (arr.length % 2);
        for (let i = 0; i < len; i += 2) out.push(kc[arr[i]], kn[arr[i+1]]);
        if (arr.length !== len) out.push(kc[arr[len]]);
    }

    parseGlobalText2() {
        const r = textReader(this.globalText2);
        r.getCode(); // opmate
        const kcStr = r.getLine(r.getCode());
        const kc2 = kcStr.split(String.fromCharCode(257));
        const list = r.getList();
        const out = [];
        for (let i = 0; i < list.length - 1; i += 2) out.push(kc2[list[i]], this.keynames[list[i+1]]);
        out.push(kc2[list[list.length - 1]]);
        return out.join('');
    }
}

// === 测试 ===
if (require.main === module) {
    const mainjs = fs.readFileSync(path.join(__dirname, '../captured/mainjs.js'), 'utf-8');
    const session = JSON.parse(fs.readFileSync(path.join(__dirname, 'ref_data/session.json'), 'utf-8'));

    console.log('=== Coder 测试 ===\n');
    const coder = new Coder(session.nsd, session.cd, mainjs);
    coder.run();

    console.log('eval 代码:', coder.code.length, 'chars');
    console.log('keycodes:', coder.keycodes.length);
    console.log('aebi:', coder.aebi.length, '段');
    console.log('r2mkaText:', coder.r2mkaText ? coder.r2mkaText.length + ' chars, r2mKa:' + coder.r2mkaText.startsWith('r2mKa') : 'null');
    console.log('functionsNameSort:', coder.functionsNameSort.length);
    console.log('mainFunctionIdx:', coder.mainFunctionIdx);
    console.log('cp3:', coder.cp3);

    // 对照 ref
    const ref = fs.readFileSync(path.join(__dirname, 'ref_data/eval_code.js'), 'utf-8');
    console.log('\nref eval:', ref.length, 'chars');
    console.log('长度匹配:', coder.code.length === ref.length ? '✅' : '❌ (差' + (coder.code.length - ref.length) + ')');

    if (coder.code === ref) {
        console.log('内容完全匹配 ✅✅✅');
    } else {
        for (let i = 0; i < Math.min(coder.code.length, ref.length); i++) {
            if (coder.code[i] !== ref[i]) {
                console.log('第一个差异 @' + i + ':');
                console.log('  gen:', JSON.stringify(coder.code.substring(i, i+60)));
                console.log('  ref:', JSON.stringify(ref.substring(i, i+60)));
                break;
            }
        }
    }
}

module.exports = { Coder, extractImmucfg, grenKeys, createScd, arrayShuffle };
