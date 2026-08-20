import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../api/stream/IStreamApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const put: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        await streamApiModel.keep(api.parseRequestParamInt(req.params.streamId, 'streamId'));
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err: unknown) {
        // シークや画質切替でストリームを作り直した直後は、古い streamId への
        // keep が飛んでくる。存在しないストリームは 404 で返す (500 ではない)
        if (api.getErrorMessage(err) === 'StreamIsUndefined') {
            api.responseError(res, { code: 404, message: 'stream is not found' });

            return;
        }
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

put.apiDoc = {
    summary: 'ストリーム停止タイマーを更新する',
    tags: ['streams'],
    description: 'ストリーム停止タイマーを更新する',
    parameters: [
        {
            $ref: '#/components/parameters/PathStreamId',
        },
    ],
    responses: {
        200: {
            description: 'ストリーム停止タイマーを更新しました',
        },
        404: {
            description: '指定したストリームが存在しません',
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
