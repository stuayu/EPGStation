import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const put: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        await recordedApiModel.changeProtect(api.parseRequestParamInt(req.params.recordedId, 'recordedId'), true);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

put.apiDoc = {
    summary: '録画を自動削除対象から除外',
    tags: ['recorded'],
    description: '録画を自動削除対象から除外する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedId',
        },
    ],
    responses: {
        200: {
            description: '録画を自動削除対象から除外しました',
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
