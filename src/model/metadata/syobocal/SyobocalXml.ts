import { XMLParser } from 'fast-xml-parser';

// ネストタグ・同名タグ・CDATA・属性混在などレスポンス形式の揺れに強い XML パーサー (§5.6)。
// 旧実装は正規表現ベースで、ネストや属性が混じると静かに空配列を返す (パース失敗が検知できない)
// 問題があったため、fast-xml-parser (DOM ベース) に置き換えた
const parser = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
    parseTagValue: false,
    processEntities: true,
});

/**
 * xml 内から タグ名 item の要素をすべて探し、各要素直下の葉フィールド (文字列/数値) を
 * Record<string, string> として返す。ネストした子要素・属性は無視する (数値等は文字列化する)。
 * 不正な XML の場合は例外を投げず空配列を返す (呼び出し側は「該当データなし」として扱う)
 * @param xml string
 * @param item string 探索するタグ名 (例: 'TitleItem' / 'ProgItem')
 * @return Array<Record<string, string>>
 */
export function xmlItems(xml: string, item: string): Array<Record<string, string>> {
    let root: unknown;
    try {
        root = parser.parse(xml);
    } catch {
        return [];
    }

    const found: Array<Record<string, unknown>> = [];
    const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const child of node) visit(child);
            return;
        }
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (key === item) {
                if (Array.isArray(value)) {
                    for (const v of value) if (v && typeof v === 'object') found.push(v as Record<string, unknown>);
                } else if (value && typeof value === 'object') {
                    found.push(value as Record<string, unknown>);
                }
            }
            if (value && typeof value === 'object') visit(value);
        }
    };
    visit(root);

    return found.map(row => {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
            // 子要素 (object/array) は葉フィールドではないので無視する
            if (value === null || typeof value === 'undefined' || typeof value === 'object') continue;
            result[key] = String(value).trim();
        }
        return result;
    });
}

export function parseSyobocalDate(value: string): number | undefined {
    const time = Date.parse(value.replace(' ', 'T') + (/[+-]\d\d:\d\d$|Z$/.test(value) ? '' : '+09:00'));
    return Number.isFinite(time) ? time : undefined;
}

// しょぼいカレンダーの正常な応答コード。200 = 該当あり / 404 = 条件に一致するデータなし。
// どちらも「通信としては成功」なので、これ以外は取得失敗として扱う
const OK_RESULT_CODES = new Set([200, 404]);

/**
 * しょぼいカレンダーの応答が期待した形式かを検証する。妥当でなければ例外を投げる。
 *
 * Cloudflare のレート制限 (error 1015) やメンテナンス時は XML ではなく HTML が返るが、
 * `xmlItems()` はそれを黙って空配列にしてしまうため、**正常な「該当なし」と区別が付かない**。
 * 区別できないまま結果をキャッシュすると、一時的な失敗を数時間引きずることになる。
 * ルート要素と Result/Code を確認して、失敗は失敗として上位へ伝える
 * @param xml: string 応答本文
 * @param rootTag: string 期待するルート要素名 (例: 'ProgLookupResponse')
 * @throws Error 応答が XML でない・別の内容・エラーコードの場合
 */
export function assertSyobocalResponse(xml: string, rootTag: string): void {
    if (xml.includes(`<${rootTag}`) === false) {
        // 先頭だけをエラーメッセージに載せる (HTML が丸ごとログに出るのを防ぐ)
        const head = xml.replace(/\s+/gu, ' ').slice(0, 120);
        throw new Error(`SyobocalInvalidResponse: <${rootTag}> not found (${xml.length} bytes): ${head}`);
    }

    const code = Number(xmlItems(xml, 'Result')[0]?.Code);
    if (Number.isFinite(code) && OK_RESULT_CODES.has(code) === false) {
        throw new Error(`SyobocalResultCode:${code}`);
    }
}
