import { Operation } from 'express-openapi';
import * as apid from '../../../../api';
import ISeriesApiModel from '../../api/series/ISeriesApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

const SORT_KEYS: ReadonlySet<string> = new Set([
    'updatedAt',
    'title',
    'firstAiredAt',
    'lastAiredAt',
    'recordedCount',
    'totalFileSize',
]);

const num = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return typeof value !== 'undefined' && Number.isFinite(parsed) ? parsed : undefined;
};

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesApiModel>('ISeriesApiModel');
        const sort = typeof req.query.sort === 'string' && SORT_KEYS.has(req.query.sort) ? req.query.sort : undefined;
        api.responseJSON(
            res,
            200,
            await model.list({
                keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
                offset: num(req.query.offset) ?? 0,
                limit: num(req.query.limit) ?? 30,
                sort: sort as apid.SeriesSortKey | undefined,
                order: req.query.order === 'asc' ? 'asc' : req.query.order === 'desc' ? 'desc' : undefined,
                seasonYear: num(req.query.seasonYear),
                seasonName: typeof req.query.seasonName === 'string' ? req.query.seasonName : undefined,
                status: req.query.status === 'onair' || req.query.status === 'finished' ? req.query.status : undefined,
                origin:
                    req.query.origin === 'dictionary' || req.query.origin === 'local' ? req.query.origin : undefined,
                // express-openapi がスキーマに従い boolean へ変換するが、素の文字列で来る場合にも備える
                hasMissing: (req.query.hasMissing as unknown) === true || req.query.hasMissing === 'true',
            }),
        );
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: 'シリーズ一覧',
    tags: ['series'],
    description: '並べ替え・クール/放送状態/欠番による絞り込みに対応する',
    parameters: [
        { name: 'keyword', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
        {
            name: 'sort',
            in: 'query',
            required: false,
            description: '並べ替えキー',
            schema: {
                type: 'string',
                enum: ['updatedAt', 'title', 'firstAiredAt', 'lastAiredAt', 'recordedCount', 'totalFileSize'],
            },
        },
        { name: 'order', in: 'query', required: false, schema: { type: 'string', enum: ['asc', 'desc'] } },
        { name: 'seasonYear', in: 'query', required: false, schema: { type: 'integer' } },
        {
            name: 'seasonName',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['WINTER', 'SPRING', 'SUMMER', 'AUTUMN'] },
        },
        {
            name: 'status',
            in: 'query',
            required: false,
            description: 'onair: 直近に録画がある / finished: 一定期間録画が無い',
            schema: { type: 'string', enum: ['onair', 'finished'] },
        },
        {
            name: 'origin',
            in: 'query',
            required: false,
            description: 'dictionary: 外部の作品辞書起点のシリーズのみ / local: 録画タイトルから作られたシリーズのみ',
            schema: { type: 'string', enum: ['dictionary', 'local'] },
        },
        {
            name: 'hasMissing',
            in: 'query',
            required: false,
            description: 'true の場合、欠番のあるシリーズのみ返す',
            schema: { type: 'boolean' },
        },
    ],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
