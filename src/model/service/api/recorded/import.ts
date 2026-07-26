import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const option = <apid.ImportRegisterOption>req.body;
        api.responseJSON(res, 200, await recordedApiModel.startImportJob(option));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'ExternalFileImportFeatureIsDisabled')
            api.responseError(res, { code: 404, message: 'external file import feature is disabled' });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '外部録画ファイルの取り込みジョブを開始',
    tags: ['recorded'],
    description:
        'スキャン結果を元に外部録画ファイルの取り込みをバックグラウンドジョブとして開始する。進捗は /recorded/import/status/{jobId} で取得する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/ImportRegisterOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: 'ジョブを開始しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ImportJobStartResult',
                    },
                },
            },
        },
        404: {
            description: '機能が無効',
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
