import { Operation } from 'express-openapi';
import IChannelApiModel from '../../api/channel/IChannelApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const channelApiModel = container.get<IChannelApiModel>('IChannelApiModel');

    try {
        // クエリパラメータから channelId を取得
        const channelId = parseInt(req.query.channelId as string, 10);
        api.responseJSON(res, 200, await channelApiModel.getChannels(channelId));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '放送局情報取得',
    tags: ['channels'],
    description: '放送局情報を取得する',
    parameters: [
        {
            name: 'channelId', // クエリパラメータの名前を指定
            in: 'query', // パラメータの種類を指定
            required: false, // 任意であることを指定
            description: '放送局のID',
            schema: {
                type: 'integer', // データ型を指定
            },
        },
    ],
    responses: {
        200: {
            description: '放送局情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ChannelItems',
                    },
                },
            },
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
