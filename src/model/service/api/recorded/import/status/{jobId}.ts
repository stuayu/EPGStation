import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../../../api/recorded/IRecordedApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const get: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const status = await recordedApiModel.getImportJobStatus(`${req.params.jobId}`);
        if (status === null) {
            api.responseError(res, { code: 404, message: 'import job is not found' });
        } else {
            api.responseJSON(res, 200, status);
        }
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'ExternalFileImportFeatureIsDisabled')
            api.responseError(res, { code: 404, message: 'external file import feature is disabled' });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: '外部録画ファイル取り込みジョブの進捗を取得',
    tags: ['recorded'],
    parameters: [{ $ref: '#/components/parameters/PathImportJobId' }],
    responses: {
        200: {
            description: '取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ImportJobStatus',
                    },
                },
            },
        },
        404: {
            description: 'ジョブが存在しない、または機能が無効',
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
