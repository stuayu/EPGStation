import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const option = <apid.ImportExternalRecordedOption>req.body;
        api.responseJSON(res, 200, await recordedApiModel.importExternalRecordedFiles(option));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'ExternalFileImportFeatureIsDisabled')
            api.responseError(res, { code: 404, message: 'external file import feature is disabled' });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '外部録画ファイルを一括追加',
    tags: ['recorded'],
    description: '既に存在するローカルの動画ファイルを録画情報として一括登録する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/ImportExternalRecordedOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: '一括追加しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ImportExternalRecordedResult',
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
