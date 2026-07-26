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
