const decode = (value: string): string =>
    value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .trim();
export function xmlItems(xml: string, item: string): Array<Record<string, string>> {
    const rows: Array<Record<string, string>> = [];
    const itemPattern = new RegExp(`<${item}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${item}>`, 'g');
    const fieldPattern = /<([A-Za-z0-9_]+)(?:\s[^>]*)?>([\s\S]*?)<\/([A-Za-z0-9_]+)>/g;
    for (const itemMatch of xml.matchAll(itemPattern)) {
        const row: Record<string, string> = {};
        for (const field of itemMatch[1].matchAll(fieldPattern))
            if (field[1] === field[3]) row[field[1]] = decode(field[2]);
        rows.push(row);
    }
    return rows;
}
export function parseSyobocalDate(value: string): number | undefined {
    const time = Date.parse(value.replace(' ', 'T') + (/[+-]\d\d:\d\d$|Z$/.test(value) ? '' : '+09:00'));
    return Number.isFinite(time) ? time : undefined;
}
