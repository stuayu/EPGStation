import { Operation } from 'express-openapi';
import ISeriesImageModel from '../../../../api/series/ISeriesImageModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesImageModel>('ISeriesImageModel');
        const file = await model.getFile(api.parseRequestParamInt(req.params.seriesId, 'seriesId'));

        if (file === null) {
            // 画像を持たない作品・取得に失敗した場合は 404。
            // クライアントは代替表示へ切り替えるだけなのでサーバエラーにはしない
            api.responseError(res, { code: 404, message: 'series image is not found' });
            return;
        }
        api.responseFile(req, res, file.filePath, file.contentType, false);
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
            api.responseError(res, { code: 404, message: 'series image is not found' });
            return;
        }
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'シリーズのアイキャッチ画像',
    tags: ['series'],
    description:
        'シリーズに紐づく作品のアイキャッチ画像を返す。画像は Annict 作品辞書由来 ' +
        '(しょぼいカレンダーは画像を提供していない)。取得元は作品公式サイトのため、' +
        'サーバ側で一度取得してディスクにキャッシュしたものを配信する',
    parameters: [
        {
            name: 'seriesId',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
        },
    ],
    responses: {
        200: {
            description: '画像を取得しました',
            content: { 'image/jpeg': {}, 'image/png': {}, 'image/webp': {}, 'image/gif': {} },
        },
        404: {
            description: '画像がありません',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
