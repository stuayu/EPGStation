import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import ISavedSearchApiModel from '../../../api/savedSearch/ISavedSearchApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

const getModel = () => container.get<ISavedSearchApiModel>('ISavedSearchApiModel');

const handleError = (res: any, err: unknown): void => {
    const message = api.getErrorMessage(err);
    if (message === 'AdvancedSearchFeatureIsDisabled') {
        api.responseError(res, { code: 404, message: 'advancedSearch feature is disabled' });
    } else if (message === 'SavedSearchIsNull') {
        api.responseError(res, { code: 404, message: 'saved search is not found' });
    } else {
        api.responseServerError(res, message);
    }
};

export const get: Operation = async (req, res) => {
    try {
        const searchId: apid.SavedSearchId = api.parseRequestParamInt(req.params.searchId, 'searchId');
        api.responseJSON(res, 200, await getModel().get(searchId));
    } catch (err: unknown) {
        handleError(res, err);
    }
};

get.apiDoc = {
    summary: '保存検索取得',
    tags: ['searches'],
    description: '保存検索を 1 件取得する (advancedSearch 機能フラグ有効時のみ)',
    parameters: [
        {
            $ref: '#/components/parameters/PathSavedSearchId',
        },
    ],
    responses: {
        200: {
            description: '保存検索を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/SavedSearchItem',
                    },
                },
            },
        },
        404: {
            description: '保存検索が存在しない、または advancedSearch 機能が無効',
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

export const put: Operation = async (req, res) => {
    try {
        const searchId: apid.SavedSearchId = api.parseRequestParamInt(req.params.searchId, 'searchId');
        await getModel().update(searchId, req.body);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: unknown) {
        handleError(res, err);
    }
};

put.apiDoc = {
    summary: '保存検索更新',
    tags: ['searches'],
    description: '保存検索を更新する (advancedSearch 機能フラグ有効時のみ)',
    parameters: [
        {
            $ref: '#/components/parameters/PathSavedSearchId',
        },
    ],
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/UpdateSavedSearchOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: '保存検索の更新に成功した',
        },
        404: {
            description: '保存検索が存在しない、または advancedSearch 機能が無効',
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

export const del: Operation = async (req, res) => {
    try {
        const searchId: apid.SavedSearchId = api.parseRequestParamInt(req.params.searchId, 'searchId');
        await getModel().delete(searchId);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: unknown) {
        handleError(res, err);
    }
};

del.apiDoc = {
    summary: '保存検索削除',
    tags: ['searches'],
    description: '保存検索を削除する (advancedSearch 機能フラグ有効時のみ)',
    parameters: [
        {
            $ref: '#/components/parameters/PathSavedSearchId',
        },
    ],
    responses: {
        200: {
            description: '保存検索を削除しました',
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
