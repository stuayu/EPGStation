import { Operation } from 'express-openapi';
import IVideoAnalyzeJobModel from '../../../video/IVideoAnalyzeJobModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    try {
        const model = container.get<IVideoAnalyzeJobModel>('IVideoAnalyzeJobModel');
        api.responseJSON(res, 200, model.getJob());
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: '録画ファイル一括解析ジョブの状況取得',
    tags: ['videos'],
    description:
        '実行中・直近の一括解析ジョブを返す。ジョブはサーバ側で進むため、画面を閉じたあとに開き直しても進捗を追える',
    responses: {
        200: {
            description: 'ジョブの状況を取得しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoAnalyzeJob' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};

export const post: Operation = async (req, res) => {
    try {
        const model = container.get<IVideoAnalyzeJobModel>('IVideoAnalyzeJobModel');
        api.responseJSON(res, 200, await model.start(req.body));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'VideoAnalyzeJobIsAlreadyRunning') api.responseError(res, { code: 409, message: message });
        else if (message === 'VideoFileIsNotFound') api.responseError(res, { code: 404, message: message });
        else if (message === 'InvalidVideoAnalyzeJobType' || message === 'InvalidVideoAnalyzeJobMode')
            api.responseError(res, { code: 400, message: message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '録画ファイル一括解析ジョブの開始',
    tags: ['videos'],
    description:
        'ffprobe メタデータ / TS (PSI/SI) の一括解析をサーバ側で開始する。' +
        'mode が unanalyzed なら未解析ファイルのみ、all なら解析済みを含む全件を強制的に解析し直す。' +
        'recordedId を指定した場合はその録画のファイルだけを対象にし、解析済みでも必ずやり直す (単一番組の再解析)。' +
        '進捗は GET /api/videos/analyze で取得する',
    requestBody: {
        content: {
            'application/json': { schema: { $ref: '#/components/schemas/StartVideoAnalyzeJobOption' } },
        },
        required: true,
    },
    responses: {
        200: {
            description: 'ジョブを開始しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoAnalyzeJob' } } },
        },
        400: { description: '指定が不正' },
        404: { description: '指定した録画のビデオファイルが無い' },
        409: { description: 'すでに解析ジョブが実行中' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};

export const del: Operation = async (_req, res) => {
    try {
        const model = container.get<IVideoAnalyzeJobModel>('IVideoAnalyzeJobModel');
        api.responseJSON(res, 200, model.cancel());
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

del.apiDoc = {
    summary: '録画ファイル一括解析ジョブの中断',
    tags: ['videos'],
    description: '実行中の一括解析ジョブに中断を要求する。解析中の 1 件を終えてから止まる',
    responses: {
        200: {
            description: '中断を要求しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoAnalyzeJob' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
