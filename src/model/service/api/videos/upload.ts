import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import { UploadedVideoFileOption } from '../../../operator/recorded/IRecordedManageModel';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        if (typeof req.file === 'undefined' && typeof req.body.localFilePath === 'undefined') {
            throw new Error('FileIsNotFound OR localFilePathNotFound');
        }

        // multipart なので数値も文字列で届く
        const recordedId =
            typeof req.body.recordedId === 'undefined' || req.body.recordedId === ''
                ? undefined
                : Number(req.body.recordedId);
        if (typeof recordedId === 'number' && Number.isNaN(recordedId) === true) {
            throw new Error('InvalidRecordedId');
        }

        const option: UploadedVideoFileOption = {
            recordedId: recordedId,
            parentDirectoryName: req.body.parentDirectoryName,
            viewName: req.body.viewName,
            fileType: req.body.fileType,
            fileName: req.file ? req.file.originalname : undefined,
            filePath: req.file ? req.file.path : undefined,
            localFilePath: req.body.localFilePath,
        };
        if (typeof req.body.subDirectory !== 'undefined') {
            option.subDirectory = req.body.subDirectory;
        }

        const resultRecordedId = await recordedApiModel.addUploadedVideoFile(option);

        api.responseJSON(res, 200, { recordedId: resultRecordedId });
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

post.apiDoc = {
    summary: 'アップロードしたビデオファイルを追加',
    tags: ['videos'],
    description:
        'アップロードしたビデオファイルを追加する。' +
        'recordedId を省略しかつ fileType が ts の場合は、TS の PSI/SI から放送局・番組名・時刻・ジャンルを取り出して番組情報を自動作成する',
    requestBody: {
        content: {
            'multipart/form-data': {
                schema: {
                    $ref: '#/components/schemas/UploadVideoFileOption',
                },
            },
        },
    },
    responses: {
        200: {
            description: 'アップロードしたビデオファイルを追加しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/UploadVideoFileResult',
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
