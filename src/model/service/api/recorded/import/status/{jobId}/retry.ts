import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../../../../api/recorded/IRecordedApiModel';
import container from '../../../../../../ModelContainer';
import * as api from '../../../../../api';

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const result = await recordedApiModel.retryImportJob(`${req.params.jobId}`);
        if (result === null) {
            api.responseError(res, { code: 404, message: 'import job not found or has no failed files' });
        } else {
            api.responseJSON(res, 200, result);
        }
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'ExternalFileImportFeatureIsDisabled')
            api.responseError(res, { code: 404, message: 'external file import feature is disabled' });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '外部録画ファイル取り込みジョブの失敗ファイルを再実行',
    tags: ['recorded'],
    description: '指定したジョブのうち取り込みに失敗したファイルのみを対象に新しいジョブを開始する',
    parameters: [{ $ref: '#/components/parameters/PathImportJobId' }],
    responses: {
        200: {
            description: '再実行ジョブを開始しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ImportJobStartResult',
                    },
                },
            },
        },
        404: {
            description: 'ジョブが存在しない、失敗ファイルが無い、または機能が無効',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
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
