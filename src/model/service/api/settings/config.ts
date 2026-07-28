import { Operation } from 'express-openapi';
import IAppSettingApiModel from '../../../api/config/IAppSettingApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    try {
        const model = container.get<IAppSettingApiModel>('IAppSettingApiModel');
        api.responseJSON(res, 200, await model.getEditableConfig());
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SystemSettingsFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: 'config.yml 編集画面用の情報取得',
    tags: ['settings'],
    description:
        'config.yml の値・GUI で保存した差分・両者を重ねた実効値と、編集できるキー (再起動要否付き) を返す。保存は PUT /api/settings/system の config キーで行う',
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EditableConfig' } } },
        },
        404: { description: '機能が無効' },
        default: { description: '失敗' },
    },
};
