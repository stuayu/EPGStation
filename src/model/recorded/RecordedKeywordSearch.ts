import StrUtil from '../../util/StrUtil';
import DBUtil from '../db/DBUtil';

/**
 * 録画検索の where 句 1 つ分
 */
export interface RecordedKeywordSearchCondition {
    query: string;
    values: Record<string, any>;
}

/**
 * 録画検索の実行計画
 */
export interface RecordedKeywordSearchPlan {
    conditions: RecordedKeywordSearchCondition[];
    /** 高度検索が有効なとき true (レガシー検索との判別用) */
    isAdvanced: boolean;
}

/**
 * 検索対象フィールド
 */
export type RecordedSearchField = 'name' | 'description' | 'extended' | 'tag' | 'channel';

/**
 * 解析済みの検索語 1 つ
 */
export interface RecordedSearchTerm {
    /** 検索対象。未指定 (フィールド指定なし) の場合は横断検索 */
    fields: RecordedSearchField[];
    keyword: string;
    /** 除外 (-keyword) なら true */
    isNegative: boolean;
}

/**
 * OR で連結される検索語グループ。グループ内は AND
 */
export type RecordedSearchQuery = RecordedSearchTerm[][];

namespace RecordedKeywordSearch {
    /** フィールド指定なしの検索語が対象とするカラム */
    export const CROSS_SEARCH_FIELDS: RecordedSearchField[] = ['name', 'description', 'extended', 'tag'];

    /** field: 記法のエイリアス */
    export const FIELD_ALIASES: Record<string, RecordedSearchField> = {
        title: 'name',
        name: 'name',
        desc: 'description',
        description: 'description',
        ext: 'extended',
        extended: 'extended',
        detail: 'extended',
        tag: 'tag',
        ch: 'channel',
        channel: 'channel',
    };

    /**
     * フィールド → 検索対象カラム (tag のみ EXISTS 副問い合わせ)
     * null 許容カラムは除外検索 (not) で NULL 比較が unknown にならないよう coalesce する
     */
    export const FIELD_COLUMNS: Record<Exclude<RecordedSearchField, 'tag'>, string> = {
        name: 'recorded.halfWidthName',
        description: "coalesce(recorded.halfWidthDescription, '')",
        extended: "coalesce(recorded.halfWidthExtended, '')",
        channel: "coalesce(recorded.halfWidthChannelName, '')",
    };

    /** タグ検索用の中間テーブル・タグテーブル名 */
    export const TAG_RELATION_TABLE = 'recorded_tags_recorded_tag';
    export const TAG_TABLE = 'recorded_tag';
}

/**
 * 検索文字列をトークンに分割する。
 * ダブルクォートで囲んだ範囲は 1 トークンとして扱う
 * @param keyword: string
 * @return string[]
 */
export const tokenizeSearchKeyword = (keyword: string): string[] => {
    const tokens: string[] = [];
    let buffer = '';
    let isQuoted = false;

    for (const char of keyword) {
        if (char === '"') {
            isQuoted = !isQuoted;
            continue;
        }

        if (isQuoted === false && /\s/.test(char) === true) {
            if (buffer.length > 0) {
                tokens.push(buffer);
                buffer = '';
            }
            continue;
        }

        buffer += char;
    }

    if (buffer.length > 0) {
        tokens.push(buffer);
    }

    return tokens;
};

/**
 * 検索文字列を解析して OR グループの配列へ変換する
 *
 * 対応する記法
 *   - `hoge fuga`      : AND 検索
 *   - `hoge OR fuga`   : OR 検索 (`|` も可)
 *   - `-hoge`          : 除外
 *   - `title:hoge`     : フィールド指定 (title/desc/extended/tag/channel)
 *   - `"hoge fuga"`    : フレーズ検索
 *
 * @param keyword: string
 * @return RecordedSearchQuery
 */
export const parseRecordedSearchKeyword = (keyword: string): RecordedSearchQuery => {
    const groups: RecordedSearchTerm[][] = [];
    let current: RecordedSearchTerm[] = [];

    for (const rawToken of tokenizeSearchKeyword(StrUtil.toHalf(keyword))) {
        // OR 区切り
        if (rawToken === '|' || rawToken.toUpperCase() === 'OR') {
            if (current.length > 0) {
                groups.push(current);
                current = [];
            }
            continue;
        }

        let token = rawToken;

        // 除外指定
        let isNegative = false;
        if (token.startsWith('-') === true || token.startsWith('!') === true) {
            isNegative = true;
            token = token.slice(1);
        }

        // フィールド指定
        let fields: RecordedSearchField[] = RecordedKeywordSearch.CROSS_SEARCH_FIELDS;
        const separatorIndex = token.indexOf(':');
        if (separatorIndex > 0) {
            const field = RecordedKeywordSearch.FIELD_ALIASES[token.slice(0, separatorIndex).toLowerCase()];
            if (typeof field !== 'undefined') {
                fields = [field];
                token = token.slice(separatorIndex + 1);
            }
        }

        if (token.length === 0) {
            continue;
        }

        current.push({
            fields: fields,
            keyword: token,
            isNegative: isNegative,
        });
    }

    if (current.length > 0) {
        groups.push(current);
    }

    return groups;
};

/**
 * タグ名検索用の EXISTS 副問い合わせを生成する
 * @param valueName: string バインド変数名
 * @param like: string
 * @return string
 */
const createTagExistsQuery = (valueName: string, like: string): string => {
    return (
        `exists (select 1 from ${RecordedKeywordSearch.TAG_RELATION_TABLE} ${valueName}_rel` +
        ` inner join ${RecordedKeywordSearch.TAG_TABLE} ${valueName}_tag` +
        ` on ${valueName}_tag.id = ${valueName}_rel.recordedTagId` +
        ` where ${valueName}_rel.recordedId = recorded.id` +
        ` and ${valueName}_tag.halfWidthName ${like} :${valueName})`
    );
};

/**
 * 検索語 1 つ分の where 句を生成する
 * @param term: RecordedSearchTerm
 * @param valueName: string バインド変数名
 * @param like: string
 * @return string
 */
const createTermQuery = (term: RecordedSearchTerm, valueName: string, like: string): string => {
    const or: string[] = [];
    for (const field of term.fields) {
        if (field === 'tag') {
            or.push(createTagExistsQuery(valueName, like));
        } else {
            or.push(`${RecordedKeywordSearch.FIELD_COLUMNS[field]} ${like} :${valueName}`);
        }
    }

    const query = DBUtil.createOrQuery(or);

    return term.isNegative === true ? `not (${query})` : `(${query})`;
};

/**
 * 従来の検索 (番組名 AND 検索 or 概要 AND 検索) の where 句を生成する
 * @param keyword: string
 * @param like: string
 * @return RecordedKeywordSearchCondition
 */
const buildLegacyCondition = (keyword: string, like: string): RecordedKeywordSearchCondition => {
    const keywords = StrUtil.toHalf(keyword).split(/ /);
    const valueBaseName = 'keyword';

    const nameAnd: string[] = [];
    const descriptionAnd: string[] = [];
    const values: any = {};
    keywords.forEach((str, i) => {
        str = `%${str}%`;

        // value
        const valueName = `${valueBaseName}Name${i}`;
        values[valueName] = str;

        // name
        nameAnd.push(`halfWidthName ${like} :${valueName}`);
        // description
        descriptionAnd.push(`halfWidthDescription ${like} :${valueName}`);
    });

    const or: string[] = [];
    if (nameAnd.length > 0) {
        or.push(`(${DBUtil.createAndQuery(nameAnd)})`);
    }
    if (descriptionAnd.length > 0) {
        or.push(`(${DBUtil.createAndQuery(descriptionAnd)})`);
    }

    return {
        query: DBUtil.createOrQuery(or),
        values: values,
    };
};

/**
 * 録画検索のキーワード条件を組み立てる
 *
 * 機能フラグ advancedSearch が無効の場合は従来と完全に同じ where 句を返す
 * @param keyword: string 検索文字列
 * @param like: string DB 種別ごとの like 演算子
 * @param isAdvancedEnabled: boolean 高度検索が有効か
 * @return RecordedKeywordSearchPlan
 */
export const buildRecordedKeywordSearchPlan = (
    keyword: string,
    like: string,
    isAdvancedEnabled: boolean,
): RecordedKeywordSearchPlan => {
    if (isAdvancedEnabled === false) {
        return {
            conditions: [buildLegacyCondition(keyword, like)],
            isAdvanced: false,
        };
    }

    const groups = parseRecordedSearchKeyword(keyword);
    if (groups.length === 0) {
        // 記号のみなど解析結果が空になる場合は従来検索へフォールバックする
        return {
            conditions: [buildLegacyCondition(keyword, like)],
            isAdvanced: false,
        };
    }

    const values: Record<string, any> = {};
    const orQuerys: string[] = [];
    let index = 0;

    for (const group of groups) {
        const andQuerys: string[] = [];
        for (const term of group) {
            const valueName = `keyword${index}`;
            index++;
            values[valueName] = `%${term.keyword}%`;
            andQuerys.push(createTermQuery(term, valueName, like));
        }
        orQuerys.push(`(${DBUtil.createAndQuery(andQuerys)})`);
    }

    return {
        conditions: [
            {
                query: DBUtil.createOrQuery(orQuerys),
                values: values,
            },
        ],
        isAdvanced: true,
    };
};

export default RecordedKeywordSearch;
