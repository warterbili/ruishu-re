/**
 * 外层 VM 重写 -- 基于阅读 mainjs 的 _$cj(75 opcode) + _$g6(55 opcode) 理解后实现
 * 验证: eval 代码 100% 字节一致
 *
 * 输入: mainjs source + nsd + cd
 * 输出: eval code + r2mkaText + keycodes + keynames + aebi + functionsNameSort + cp3
 */
const fs = require('fs');
const path = require('path');

// ============================================================
// PRNG (mainjs _$ad, line 12)
// 线性同余生成器, seed 来自 nsd
// ============================================================
function createScd(seed) {
    let s = seed;
    return () => {
        s = 15679 * (s & 0xFFFF) + 2531011;
        return s;
    };
}

// ============================================================
// Fisher-Yates 洗牌 (mainjs _$lT, line 21)
// 用 PRNG 做确定性洗牌, 保证同 seed 结果一致
// ============================================================
function arrayShuffle(arr, scd) {
    const a = [...arr];
    let len = a.length;
    while (len > 1) {
        len--;
        const i = scd() % len;
        [a[len], a[i]] = [a[i], a[len]];
    }
    return a;
}

// ============================================================
// 从 mainjs 提取 4 个最长引号字符串
// 按长度排序后分别为: globalText1, cp0, cp2, globalText2
// ============================================================
function extractImmucfg(code) {
    // 找出所有非转义双引号的位置
    const q = [];
    for (let i = 0; i < code.length; i++) {
        if (code[i] === '"' && (i === 0 || code[i - 1] !== '\\')) {
            q.push(i);
        }
    }

    // 每两个引号配对, 提取中间的字符串
    const strs = [];
    for (let i = 0; i < q.length - 1; i += 2) {
        const raw = code.slice(q[i] + 1, q[i + 1]);
        try {
            strs.push(JSON.parse('"' + raw + '"'));
        } catch (e) {
            try {
                strs.push(eval('("' + raw + '")'));
            } catch (e2) {
                strs.push(raw);
            }
        }
    }

    // 按长度降序, 取前 4 个
    strs.sort((a, b) => b.length - a.length);

    return {
        globalText1: strs[0],
        cp0:         strs[1],
        cp2:         strs[2],
        globalText2: strs[3],
    };
}

// ============================================================
// 变量名生成 (mainjs op 53+21+46)
// 生成 _$XX 格式变量名, 再用 PRNG 洗牌
// ============================================================
function grenKeys(num, nsd) {
    const chars = '_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const names = [];
    for (let i = 0; i < chars.length && names.length < num; i++) {
        for (let j = 0; j < chars.length && names.length < num; j++) {
            names.push('_$' + chars[i] + chars[j]);
        }
    }
    return arrayShuffle(names, createScd(nsd));
}

// ============================================================
// 游标读取器 (mainjs _$$1 + _$kx)
// 从 globalText 中按字节/行/列表读取数据
// ============================================================
function textReader(text) {
    let c = 0;
    return {
        // 读一个字符的 charCode
        getCode() {
            return text.charCodeAt(c++);
        },
        // 读 n 个字符的子串
        getLine(n) {
            const s = text.substr(c, n);
            c += n;
            return s;
        },
        // 读一个 length-prefixed 列表 (首字符=长度, 后续=数据)
        getList() {
            const n = text.charCodeAt(c);
            const d = [];
            for (let i = 0; i < n; i++) {
                d.push(text.charCodeAt(c + 1 + i));
            }
            c += n + 1;
            return d;
        },
        // 当前位置
        pos() {
            return c;
        },
    };
}

// ============================================================
// Coder 类 -- 核心重写引擎
// ============================================================
class Coder {
    constructor(nsd, cd, mainjsCode) {
        const imm = extractImmucfg(mainjsCode);
        this.globalText1 = imm.globalText1;
        this.globalText2 = imm.globalText2;
        this.cp0 = imm.cp0;
        this.cp2 = imm.cp2;
        this.nsd = nsd;
        this.cd = cd;

        // 从 mainjs 提取变量名数量 (通常 918)
        const knMatch = mainjsCode.match(
            /_\$[\$_A-Za-z0-9]{2}=_\$[\$_A-Za-z0-9]{2}\(0,([0-9]+),_\$[\$_A-Za-z0-9]{2}\(/
        );
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

        // debugger 相关
        this.hasDebug = true;
        this._debuggerScd = null;
        this._debuggerPosi = [];
    }

    // ----------------------------------------------------------
    // run: 主入口, 生成完整 eval 代码
    // ----------------------------------------------------------
    run() {
        const codeArr = this.parseGlobalText1();
        codeArr.push(this.parseGlobalText2());
        codeArr.push("})(", '$_ts', ".scj,", '$_ts', ".aebi);");
        this.code = codeArr.join('');

        // cp3 = mainjs 校验和 (每 100 字符取 charCode 累加)
        let h = 0;
        for (let i = 0; i < this.code.length; i += 100) {
            h += this.code.charCodeAt(i);
        }
        this.cp3 = h;

        return this;
    }

    // ----------------------------------------------------------
    // parseGlobalText1: 解析主文本, 生成所有代码段
    // ----------------------------------------------------------
    parseGlobalText1() {
        const r = textReader(this.globalText1);
        const { scd, keynames } = this;
        const codeArr = [];

        // 读 6 个全局 opmate
        this._globalMates = {};
        this._globalMates.G_e4 = r.getCode();
        this._globalMates.G_sc = r.getCode();
        this._globalMates.G_dK = r.getCode();
        this._globalMates.G_kv = r.getCode();
        this._globalMates.G_cR = r.getCode();
        this._globalMates.G_un = r.getCode();

        // keycodes 字符串 (用 257 分隔)
        const kLen = r.getCode() * 55295 + r.getCode();
        const kcStr = r.getLine(kLen);
        this.keycodes.push(...kcStr.split(String.fromCharCode(257)));

        // r2mka 文本
        r.getCode(); // 分隔符
        const rLen = r.getCode() * 55295 + r.getCode();
        const r2mkaRaw = r.getLine(rLen);
        this.keycodes.push(r2mkaRaw);
        this.r2mkaText = this._parseR2mka(r2mkaRaw);

        // 遍历所有代码段
        const codeNum = r.getCode();
        for (let current = 0; current < codeNum; current++) {
            // 每个 gren 段重建 debugger PRNG
            if (this.hasDebug) {
                const dScd = createScd(this.nsd);
                let dMax = dScd() % 10 + 10;
                this._debuggerScd = (posi) => {
                    let ret = false;
                    --dMax;
                    if (dMax <= 0) {
                        dMax = dScd() % 10 + 10;
                        if (dMax < 64) {
                            ret = true;
                            this._debuggerPosi.push(posi);
                        }
                    }
                    return ret;
                };
            }
            this._gren(r, current, codeArr);
        }

        // 闭合大括号
        codeArr.push('}}}}}}}}}}'.substr(codeNum - 1));
        if (this.mainFunctionIdx) {
            this.mainFunctionIdx.push(codeArr.join('').length);
        }

        return codeArr;
    }

    // ----------------------------------------------------------
    // _parseR2mka: 从 raw 字符串中提取引号内的内容
    // ----------------------------------------------------------
    _parseR2mka(raw) {
        const s = raw.indexOf('"') + 1;
        const e = raw.lastIndexOf('"');
        if (s <= 0 || e <= s) return null;

        const inner = raw.substring(s, e);
        try {
            return JSON.parse('"' + inner + '"');
        } catch (err) {
            try {
                return eval('("' + inner + '")');
            } catch (err2) {
                return inner;
            }
        }
    }

    // ----------------------------------------------------------
    // _gren: 生成单个代码段 (函数)
    // ----------------------------------------------------------
    _gren(r, current, codeArr) {
        const { scd, keynames, keycodes } = this;

        // 随机换行 (0-4 个)
        codeArr.push('\n\n\n\n\n'.substring(0, scd() % 5));

        // 读 8 个局部 opmate
        const m = {};
        for (const k of ['ku', 's6', 'bs', 'sq', 'jw', 'sg', 'cu', 'aw']) {
            m[k] = r.getCode();
        }

        // 读 3 个 list
        const listK = r.getList();  // 额外参数列表
        const listH = r.getList();  // 局部变量列表
        const listC = r.getList();  // wrapper 函数配对

        // listC 配对后洗牌
        const pairs = [];
        for (let i = 0; i < listC.length; i += 2) {
            pairs.push([listC[i], listC[i + 1]]);
        }
        const shuffledPairs = arrayShuffle(pairs, scd);

        // 读 opcode 范围上界
        const bf = r.getCode();

        // 读 aebi (当前段的字节码)
        const aebiData = r.getList();
        this.aebi[current] = aebiData;

        // 读函数代码段
        const funcCount = r.getCode();
        const funcSegs = [];
        for (let i = 0; i < funcCount; i++) {
            funcSegs.push(r.getList());
        }
        const shuffledFuncs = arrayShuffle(funcSegs, scd);

        // 读 opcode 实现
        const opcCount = r.getCode();
        const opcImpls = [];
        for (let i = 0; i < opcCount; i++) {
            opcImpls.push(r.getList());
        }

        // ---- 函数头 ----
        if (current > 0) {
            // 普通函数声明
            if (!this.mainFunctionIdx) {
                this.mainFunctionIdx = [codeArr.join('').length];
            }
            codeArr.push("function ", keynames[m.jw], "(", keynames[m.s6]);
            listK.forEach(it => codeArr.push(",", keynames[it]));
            codeArr.push("){");
        } else {
            // 第 0 段: IIFE, 使用全局 opmate
            codeArr.push(
                "(function(", keynames[this._globalMates.G_dK],
                ",", keynames[this._globalMates.G_kv],
                "){var ", keynames[m.s6], "=0;"
            );
        }

        // ---- wrapper 函数 ----
        const fnMap = {};
        shuffledPairs.forEach(([k1, k2]) => {
            const a = [
                "function ", keynames[k1],
                "(){var ", keynames[m.sq],
                "=[", k2,
                "];Array.prototype.push.apply(", keynames[m.sq],
                ",arguments);return ", keynames[m.sg],
                ".apply(this,", keynames[m.sq], ");}"
            ];
            codeArr.push(...a);
            fnMap[keynames[k1]] = a.join('');
        });

        // ---- 函数代码段 ----
        shuffledFuncs.forEach(item => {
            for (let i = 0; i < item.length - 1; i += 2) {
                codeArr.push(keycodes[item[i]], keynames[item[i + 1]]);
            }
            codeArr.push(keycodes[item[item.length - 1]]);
        });

        // ---- 局部变量声明 ----
        if (listH.length) {
            listH.forEach((it, i) => {
                codeArr.push(i ? "," : 'var ', keynames[it]);
            });
            codeArr.push(';');
        }

        // ---- while(1) 分发循环 ----
        codeArr.push(
            "var ", keynames[m.bs], ",", keynames[m.cu], ",",
            keynames[m.ku], "=", keynames[m.s6], ",",
            keynames[m.aw], "=", keynames[this._globalMates.G_kv],
            "[", current, "];"
        );
        codeArr.push(
            "while(1){",
            keynames[m.cu], "=", keynames[m.aw], "[", keynames[m.ku], "++];"
        );
        codeArr.push("if(", keynames[m.cu], "<", bf, "){");

        // ---- functionsSort (阶段 1-4) ----
        if ([1, 2, 3, 4].includes(current)) {
            try {
                this._functionsSort(current, fnMap, shuffledPairs, opcImpls, aebiData);
            } catch (e) {
                /* ignore */
            }
        }

        // ---- if/else 二叉分发树 ----
        this._ifElse(0, bf, codeArr, opcImpls, keycodes, keynames, keynames[m.cu]);

        codeArr.push("}else ", ';', '}');
    }

    // ----------------------------------------------------------
    // _functionsSort: 提取函数名排序信息 (用于后续 hook)
    // ----------------------------------------------------------
    _functionsSort(current, fnMap, pairs, opcImpls, aebi) {
        const { keynames, keycodes } = this;
        const len = pairs.length;

        const getName = (idx) => {
            const arr = opcImpls[idx];
            if (!arr || arr.length !== 5 || !fnMap[keynames[arr[3]]]) {
                throw new Error();
            }
            return keynames[arr[3]];
        };

        let start = 0;
        if (current === 1) {
            // 从 keycodes 中找起始偏移
            this.keycodes
                .filter(it => typeof it === 'string' && /^\([0-9]+\);$/.test(it))
                .forEach(it => {
                    const s = parseInt(it.slice(1));
                    if (s + len > aebi.length) return;
                    try {
                        aebi.slice(s, s + len).forEach(getName);
                    } catch (e) {
                        return;
                    }
                    start = s;
                });
        }

        aebi.slice(start, start + len).forEach(idx => {
            const name = getName(idx);
            if (name) {
                this.functionsNameSort.push({ name, current, code: fnMap[name] });
            }
        });
    }

    // ----------------------------------------------------------
    // _ifElse: 递归生成 if/else 二叉分发树
    // 将 opcode 范围 [start, end) 分治成 <= 4 的叶子节点
    // ----------------------------------------------------------
    _ifElse(start, end, out, impls, kc, kn, cuName) {
        const arr8 = [4, 16, 64, 256, 1024, 4096, 16384, 65536];
        let diff = end - start;

        if (diff === 0) {
            return;
        } else if (diff === 1) {
            // 叶子: 单个 opcode
            this._appendImpl(start, out, impls, kc, kn);
        } else if (diff <= 4) {
            // 叶子: 2-4 个 opcode, 逐个 if/else
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
            // 分治: 按 step 切分
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

    // ----------------------------------------------------------
    // _appendImpl: 输出单个 opcode 的实现代码
    // ----------------------------------------------------------
    _appendImpl(idx, out, impls, kc, kn) {
        // 随机插入 debugger (反调试)
        if (this._debuggerScd?.(out.length)) {
            out.push('debugger;');
        }

        const arr = impls[idx];
        if (!arr) return;

        // 交替输出 keycode + keyname
        const len = arr.length - (arr.length % 2);
        for (let i = 0; i < len; i += 2) {
            out.push(kc[arr[i]], kn[arr[i + 1]]);
        }
        // 奇数长度时追加最后一个 keycode
        if (arr.length !== len) {
            out.push(kc[arr[len]]);
        }
    }

    // ----------------------------------------------------------
    // parseGlobalText2: 解析第二段文本 (尾部代码)
    // ----------------------------------------------------------
    parseGlobalText2() {
        const r = textReader(this.globalText2);
        r.getCode(); // 跳过首字节
        const kcStr = r.getLine(r.getCode());
        const kc2 = kcStr.split(String.fromCharCode(257));
        const list = r.getList();
        const out = [];
        for (let i = 0; i < list.length - 1; i += 2) {
            out.push(kc2[list[i]], this.keynames[list[i + 1]]);
        }
        out.push(kc2[list[list.length - 1]]);
        return out.join('');
    }
}

module.exports = { Coder, extractImmucfg, grenKeys, createScd, arrayShuffle, textReader };
