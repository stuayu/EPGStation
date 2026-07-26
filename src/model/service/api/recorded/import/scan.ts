import { Operation } from 'express-openapi';
import * as apid from '../../../../../../api';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const option = <apid.ImportScanOption>req.body;
        api.responseJSON(res, 200, await recordedApiModel.scanImportDirectory(option));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'ExternalFileImportFeatureIsDisabled')
            api.responseError(res, { code: 404, message: 'external file import feature is disabled' });
        else if (message === 'ImportDirNotFound' || message === 'ImportPathNotAllowed')
            api.responseError(res, { code: 400, message: message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '外部録画ファイル取り込みディレクトリをスキャン',
    tags: ['recorded'],
    description: 'config.importDirs 配下を走査し、取り込み候補ファイルと推定した番組情報・重複警告を返す (副作用なし)',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/ImportScanOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: 'スキャンしました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ImportScanResult',
                    },
                },
            },
        },
        400: {
            description: '不正なディレクトリ指定',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
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
