import { Operation } from 'express-openapi';
import { getCurrentVersion } from '../../../util/CurrentVersion';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    try {
        // git 管理下ではチェックアウト中のタグを返す (更新チェックの比較対象と表示を揃えるため)
        api.responseJSON(res, 200, { version: getCurrentVersion() });
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'バージョン情報取得',
    tags: ['version'],
    description: 'バージョン情報を取得する',
    responses: {
        200: {
            description: 'バージョン情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Version',
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
