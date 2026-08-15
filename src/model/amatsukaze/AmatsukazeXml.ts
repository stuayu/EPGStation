/**
 * AmatsukazeServer との RPC で使われる DataContractSerializer 形式 XML の
 * 最小限のパーサ / ビルダ。
 *
 * AmatsukazeServer (C#) は RPC の引数を DataContractSerializer で XML 化して送ってくる。
 * 受け取る XML は要素と文字列だけで構成され、属性は名前空間宣言と i:nil のみという
 * 限定的な形をしているため、外部ライブラリを足さずにここで扱う。
 *
 * 注意点:
 * - DataContractSerializer はメンバをアルファベット順に並べるが、こちらは順序に依存せず
 *   タグ名で子要素を探す (Amatsukaze 側の実装が変わっても壊れにくくするため)
 * - 値が null のメンバは `<Xxx i:nil="true" />` で送られてくる
 * - 送信時は要素名の名前空間を明示する必要がある (既定の名前空間が異なると C# 側で読めない)
 */

/** DataContract で使う名前空間 */
export const AMATSUKAZE_CONTRACT_NAMESPACE = 'http://schemas.datacontract.org/2004/07/Amatsukaze.Server';

/** 単純型 (string など) をルートに置く場合の名前空間 */
export const SERIALIZATION_NAMESPACE = 'http://schemas.microsoft.com/2003/10/Serialization/';

/** XSD インスタンス名前空間 (i:nil で使う) */
export const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';

/**
 * パース結果のノード
 */
export interface XmlNode {
    // 名前空間接頭辞を除いた要素名
    name: string;
    attributes: Record<string, string>;
    children: XmlNode[];
    // 要素直下のテキスト (子要素を持つ場合は空文字)
    text: string;
}

/**
 * XML の実体参照を戻す
 * @param text: string
 * @return string
 */
const unescapeXml = (text: string): string => {
    return text.replace(/&(#x?[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/g, (matched, entity: string) => {
        switch (entity) {
            case 'amp':
                return '&';
            case 'lt':
                return '<';
            case 'gt':
                return '>';
            case 'quot':
                return '"';
            case 'apos':
                return "'";
            default:
                break;
        }

        if (entity.startsWith('#x') === true || entity.startsWith('#X') === true) {
            return String.fromCodePoint(parseInt(entity.slice(2), 16));
        }
        if (entity.startsWith('#') === true) {
            return String.fromCodePoint(parseInt(entity.slice(1), 10));
        }

        return matched;
    });
};

/**
 * テキストを XML エスケープする
 * @param text: string
 * @return string
 */
export const escapeXml = (text: string): string => {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
};

/**
 * 要素名から名前空間接頭辞を落とす
 * @param name: string
 * @return string
 */
const stripPrefix = (name: string): string => {
    const index = name.indexOf(':');

    return index < 0 ? name : name.slice(index + 1);
};

/**
 * 開始タグの属性部分を解析する
 * @param source: string 属性部分の文字列
 * @return Record<string, string> 名前空間接頭辞を除いた属性名をキーにした辞書
 */
const parseAttributes = (source: string): Record<string, string> => {
    const attributes: Record<string, string> = {};
    const regexp = /([A-Za-z_][\w.\-:]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

    for (;;) {
        const matched = regexp.exec(source);
        if (matched === null) {
            break;
        }
        const value = typeof matched[3] === 'undefined' ? matched[4] : matched[3];
        attributes[stripPrefix(matched[1])] = unescapeXml(value);
    }

    return attributes;
};

/**
 * DataContractSerializer 形式の XML をパースする
 * @param xml: string
 * @return XmlNode ルート要素
 * @throws XML として解釈できない場合
 */
export const parseXml = (xml: string): XmlNode => {
    const stack: XmlNode[] = [];
    let root: XmlNode | null = null;
    let position = 0;

    while (position < xml.length) {
        const start = xml.indexOf('<', position);
        if (start < 0) {
            break;
        }

        // タグの手前のテキストを現在の要素へ積む
        if (start > position && stack.length > 0) {
            const text = xml.slice(position, start);
            stack[stack.length - 1].text += unescapeXml(text);
        }

        // XML 宣言・コメント・DOCTYPE は読み飛ばす
        if (xml.startsWith('<?', start) === true || xml.startsWith('<!', start) === true) {
            const skipEnd = xml.indexOf('>', start);
            if (skipEnd < 0) {
                break;
            }
            position = skipEnd + 1;
            continue;
        }

        const end = xml.indexOf('>', start);
        if (end < 0) {
            break;
        }

        const inner = xml.slice(start + 1, end);
        if (inner.startsWith('/') === true) {
            // 終了タグ
            const closed = stack.pop();
            if (typeof closed === 'undefined') {
                throw new Error(`invalid xml: unexpected closing tag <${inner}>`);
            }
            position = end + 1;
            continue;
        }

        const isSelfClosing = inner.endsWith('/');
        const body = isSelfClosing === true ? inner.slice(0, -1) : inner;
        const nameMatched = /^\s*([\w.\-:]+)/.exec(body);
        if (nameMatched === null) {
            throw new Error(`invalid xml: broken tag <${inner}>`);
        }

        const node: XmlNode = {
            name: stripPrefix(nameMatched[1]),
            attributes: parseAttributes(body.slice(nameMatched[0].length)),
            children: [],
            text: '',
        };

        if (stack.length === 0) {
            if (root !== null && isSelfClosing === false) {
                throw new Error('invalid xml: multiple root elements');
            }
            if (root === null) {
                root = node;
            }
        } else {
            stack[stack.length - 1].children.push(node);
        }

        if (isSelfClosing === false) {
            stack.push(node);
        }

        position = end + 1;
    }

    if (root === null) {
        throw new Error('invalid xml: root element not found');
    }

    return root;
};

/**
 * 指定した名前の子要素を 1 つ返す
 * @param node: XmlNode | null
 * @param name: string
 * @return XmlNode | null 見つからない場合は null
 */
export const findChild = (node: XmlNode | null, name: string): XmlNode | null => {
    if (node === null) {
        return null;
    }

    for (const child of node.children) {
        if (child.name === name) {
            return child;
        }
    }

    return null;
};

/**
 * 指定した名前の子要素をすべて返す
 * @param node: XmlNode | null
 * @param name: string
 * @return XmlNode[]
 */
export const findChildren = (node: XmlNode | null, name: string): XmlNode[] => {
    if (node === null) {
        return [];
    }

    return node.children.filter(child => child.name === name);
};

/**
 * 要素が null (i:nil="true") かどうか
 * @param node: XmlNode | null
 * @return boolean
 */
export const isNil = (node: XmlNode | null): boolean => {
    return node === null || node.attributes.nil === 'true';
};

/**
 * 子要素の文字列値を取り出す
 * @param node: XmlNode | null
 * @param name: string
 * @return string | null 値が無い (または null) 場合は null
 */
export const getChildText = (node: XmlNode | null, name: string): string | null => {
    const child = findChild(node, name);
    if (isNil(child) === true || child === null) {
        return null;
    }

    return child.text;
};

/**
 * 子要素の数値を取り出す
 * @param node: XmlNode | null
 * @param name: string
 * @param defaultValue: number 値が無い・数値でない場合に返す値
 * @return number
 */
export const getChildNumber = (node: XmlNode | null, name: string, defaultValue = 0): number => {
    const text = getChildText(node, name);
    if (text === null) {
        return defaultValue;
    }

    const value = Number(text);

    return Number.isFinite(value) === true ? value : defaultValue;
};

/**
 * 子要素の真偽値を取り出す
 * @param node: XmlNode | null
 * @param name: string
 * @param defaultValue: boolean
 * @return boolean
 */
export const getChildBoolean = (node: XmlNode | null, name: string, defaultValue = false): boolean => {
    const text = getChildText(node, name);
    if (text === null) {
        return defaultValue;
    }

    return text === 'true';
};

/**
 * DataContract の型を 1 つ書き出す
 * @param typeName: string ルート要素名 (C# の型名)
 * @param members: Array<{ name: string; value: string | number | boolean | null }>
 *        DataContractSerializer に合わせてアルファベット順に並べて渡すこと
 * @return string
 */
export const buildContractXml = (
    typeName: string,
    members: Array<{ name: string; value: string | number | boolean | null }>,
): string => {
    const body = members
        .map(member => {
            if (member.value === null) {
                return `<${member.name} i:nil="true" />`;
            }

            return `<${member.name}>${escapeXml(String(member.value))}</${member.name}>`;
        })
        .join('');

    return `<${typeName} xmlns="${AMATSUKAZE_CONTRACT_NAMESPACE}" xmlns:i="${XSI_NAMESPACE}">${body}</${typeName}>`;
};

/**
 * DataContract の enum 値を単体で書き出す (RPC 引数が enum の場合に使う)
 * @param typeName: string enum の型名
 * @param value: string メンバ名
 * @return string
 */
export const buildEnumXml = (typeName: string, value: string): string => {
    return `<${typeName} xmlns="${AMATSUKAZE_CONTRACT_NAMESPACE}">${escapeXml(value)}</${typeName}>`;
};

/**
 * RPC 引数が string の場合の XML を書き出す
 * @param value: string
 * @return string
 */
export const buildStringXml = (value: string): string => {
    return `<string xmlns="${SERIALIZATION_NAMESPACE}">${escapeXml(value)}</string>`;
};
