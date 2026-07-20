import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (_req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const info = await recordedApiModel.getCleanupInfo();
        api.responseJSON(res, 200, info);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画クリーンアップの削除候補情報を取得',
    tags: ['recorded'],
    description:
        '録画クリーンアップを実行した場合に削除される対象 (DB 未登録の録画実ファイル・ドロップログファイル) を実削除せずに取得する',
    responses: {
        200: {
            description: '削除候補情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedCleanupInfo',
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
