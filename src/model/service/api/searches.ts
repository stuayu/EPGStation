import { Operation } from 'express-openapi';
import ISavedSearchApiModel from '../../api/savedSearch/ISavedSearchApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

const getModel = () => container.get<ISavedSearchApiModel>('ISavedSearchApiModel');

const handleError = (res: any, err: unknown): void => {
    const message = api.getErrorMessage(err);
    if (message === 'AdvancedSearchFeatureIsDisabled') {
        api.responseError(res, { code: 404, message: 'advancedSearch feature is disabled' });
    } else {
        api.responseServerError(res, message);
    }
};

export const get: Operation = async (req, res) => {
    try {
        const offset = typeof req.query.offset === 'undefined' ? undefined : parseInt(req.query.offset as any, 10);
        const limit = typeof req.query.limit === 'undefined' ? undefined : parseInt(req.query.limit as any, 10);
        api.responseJSON(res, 200, await getModel().gets(offset, limit));
    } catch (err: unknown) {
        handleError(res, err);
    }
};

get.apiDoc = {
    summary: '保存検索一覧取得',
    tags: ['searches'],
    description: '保存検索一覧を取得する (advancedSearch 機能フラグ有効時のみ)',
    parameters: [
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
    ],
    responses: {
        200: {
            description: '保存検索一覧を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/SavedSearchItems',
                    },
                },
            },
        },
        404: {
            description: 'advancedSearch 機能が無効',
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

export const post: Operation = async (req, res) => {
    try {
        const searchId = await getModel().create(req.body);
        api.responseJSON(res, 201, {
            searchId: searchId,
        });
    } catch (err: unknown) {
        handleError(res, err);
    }
};

post.apiDoc = {
    summary: '保存検索追加',
    tags: ['searches'],
    description: '保存検索を追加する (advancedSearch 機能フラグ有効時のみ)',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/AddSavedSearchOption',
                },
            },
        },
        required: true,
    },
    responses: {
        201: {
            description: '保存検索の追加に成功した',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/AddedSavedSearch',
                    },
                },
            },
        },
        404: {
            description: 'advancedSearch 機能が無効',
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
