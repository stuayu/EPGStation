import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const option = <apid.RecordedCleanupOption | undefined>req.body;
        const target: apid.RecordedCleanupTarget = option?.target ?? 'all';
        await recordedApiModel.fileCleanup(target);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画をクリーンアップ',
    tags: ['recorded'],
    description:
        '録画をクリーンアップする。target を dropLogOnly にするとドロップログファイルのみが削除され、録画実ファイルは削除されない',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/RecordedCleanupOption',
                },
            },
        },
        required: false,
    },
    responses: {
        200: {
            description: '録画をクリーンアップしました',
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
