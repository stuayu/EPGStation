import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
export const get: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const nextUp = await recordedApiModel.getNextUp(
            api.parseRequestParamInt(req.params.recordedId, 'recordedId'),
            req.query.isHalfWidth as any as boolean,
            {
                // express-openapi がスキーマに従って数値へ変換済み
                limit: req.query.limit as any as number | undefined,
                offset: req.query.offset as any as number | undefined,
                target: req.query.target as any as 'all' | 'latest' | 'series' | undefined,
            },
        );
        if (nextUp === null) {
            api.responseError(res, { code: 404, message: 'recorded is not Found' });
        } else {
            api.responseJSON(res, 200, nextUp);
        }
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'NextUpPanelFeatureIsDisabled')
            api.responseError(res, { code: 404, message: 'next up feature is disabled' });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: '次に見る候補を取得',
    tags: ['recorded'],
    parameters: [
        { $ref: '#/components/parameters/PathRecordedId' },
        { $ref: '#/components/parameters/IsHalfWidth' },
        {
            name: 'limit',
            in: 'query',
            description: '1 ページあたりの取得件数 (既定 20, 上限 100)',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100 },
        },
        {
            name: 'offset',
            in: 'query',
            description: '取得開始位置 (無限スクロールの追加読み込み用)',
            required: false,
            schema: { type: 'integer', minimum: 0 },
        },
        {
            name: 'target',
            in: 'query',
            description: '取得対象のリスト。追加読み込み時に片方だけ引くために使う (既定 all)',
            required: false,
            schema: { type: 'string', enum: ['all', 'latest', 'series'] },
        },
    ],
    responses: {
        200: { description: '取得しました' },
        404: { description: '録画または機能がない' },
        default: { description: '予期しないエラー' },
    },
};
