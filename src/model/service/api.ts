import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import IPlayList from '../api/IPlayList';

/**
 * セッション Cookie の Path。subDirectory 運用時にその配下だけへ送るようにする
 * @param configuration: IConfiguration
 * @return string
 */
export const getCookiePath = (configuration: { getConfig(): { subDirectory?: string } }): string => {
    const sub = configuration.getConfig().subDirectory;
    if (typeof sub !== 'string' || sub === '') return '/';
    return sub.startsWith('/') ? sub : `/${sub}`;
};

export const getErrorMessage = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error);
};

export const parseRequestParamInt = (value: string | string[], name: string): number => {
    if (Array.isArray(value)) {
        throw new Error(`Invalid route parameter: ${name}`);
    }

    if (!/^-?\d+$/.test(value)) {
        throw new Error(`Invalid route parameter: ${name}`);
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error(`Route parameter is outside the safe integer range: ${name}`);
    }

    return parsed;
};

export interface StreamModeOrProfile {
    mode?: number;
    profile?: string;
}

/**
 * ストリーミング系 API の `mode` (旧形式 index) / `profile` (新形式 id) クエリパラメータを解決する
 * どちらも未指定の場合は 400 応答を返し null を返す
 * @param req: express.Request
 * @param res: express.Response
 * @return StreamModeOrProfile | null
 */
export const parseStreamModeOrProfile = (req: express.Request, res: express.Response): StreamModeOrProfile | null => {
    const rawProfile = req.query.profile;
    const profile = typeof rawProfile === 'string' && rawProfile.length > 0 ? rawProfile : undefined;

    // express-openapi は apiDoc の parameter schema (integer) に基づいてクエリを型変換 (coercion) するため、
    // 通常 req.query.mode は number として渡ってくる (ServiceServer.initOpenApi の Express 5 対策参照)。
    // coercion を経ないリクエストに備えて string も受け付ける。
    const rawMode = req.query.mode;
    let mode: number | undefined;
    if (typeof rawMode === 'number') {
        mode = rawMode;
    } else if (typeof rawMode === 'string' && rawMode.length > 0) {
        mode = parseInt(rawMode, 10);
    }

    if (typeof profile === 'undefined' && (typeof mode === 'undefined' || Number.isNaN(mode))) {
        responseError(res, {
            code: 400,
            message: 'mode or profile is required',
        });

        return null;
    }

    return {
        mode: typeof mode === 'number' && !Number.isNaN(mode) ? mode : undefined,
        profile: profile,
    };
};

export interface IError {
    readonly code: number;
    readonly message: string;
    errors?: string;
}

export const responseError = (res: express.Response, reason: IError): express.Response => {
    const error: IError = {
        code: reason.code,
        message: reason.message,
    };

    res.status(reason.code);
    res.json(error);

    return res;
};

export const responseServerError = (res: express.Response, err?: string): express.Response => {
    const error: IError = {
        code: 500,
        message: 'Internal Server Error',
    };

    if (typeof err !== 'undefined') {
        error.errors = err;
    }

    res.status(error.code);
    res.json(error);

    return res;
};

/**
 * ストリーム開始系 API のエラー応答を行う
 * エンコードプロセスの枠不足 ('EncodeProcessManageModelCreateError') が原因の場合は
 * 503 Service Unavailable として同時配信数の上限に達している旨を返す。
 * それ以外の予期しないエラーは従来通り 500 Internal Server Error として返す。
 * @param res: express.Response
 * @param err: unknown
 * @return express.Response
 */
export const responseStreamStartError = (res: express.Response, err: unknown): express.Response => {
    if (err instanceof Error && err.message === 'EncodeProcessManageModelCreateError') {
        return responseError(res, {
            code: 503,
            message: '同時配信数の上限に達しています',
        });
    }

    return responseServerError(res, getErrorMessage(err));
};

export const responseJSON = (res: express.Response, code: number, body?: unknown): express.Response => {
    res.status(code);
    // non-cache
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    res.json(body);

    return res;
};

/**
 * PlayList を m3u8 としてレスポンスする
 */
export const responsePlayList = (req: express.Request, res: express.Response, list: IPlayList): void => {
    res.setHeader('Content-Type', 'application/x-mpegURL; charset="UTF-8"');
    const disposition = /firefox|Firefox/.test(<string>req.headers['user-agent']) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${list.name};`);
    res.status(200);
    res.write(list.playList);
    res.end();
};

export const responseFile = (
    req: express.Request,
    res: express.Response,
    filePath: string,
    mime: string,
    download = false,
): void => {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        throw new Error('file path is derectory');
    }

    const responseHeaders: Record<string, string | number> = {};
    if (download) {
        responseHeaders['Content-Type'] = 'application/octet-stream';
        responseHeaders['Content-disposition'] = `attachment; filename*=utf-8'ja'${encodeURIComponent(
            path.basename(filePath),
        )};`;
    } else {
        responseHeaders['Content-Type'] = mime;
    }

    const rangeRequest = readRangeHeader(req.headers['range'], stat.size);

    if (rangeRequest === null) {
        responseHeaders['Content-Length'] = stat.size;
        responseHeaders['Accept-Ranges'] = 'bytes';
        sendResponse(200, req, res, responseHeaders, req.method === 'HEAD' ? null : fs.createReadStream(filePath));

        return;
    }

    const start: number = rangeRequest.Start;
    const end: number = rangeRequest.End;

    if (start >= stat.size || end >= stat.size) {
        responseHeaders['Content-Range'] = 'bytes */' + stat.size;
        sendResponse(416, req, res, responseHeaders, null);

        return;
    }

    responseHeaders['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    responseHeaders['Content-Length'] = start === end ? 0 : end - start + 1;
    responseHeaders['Accept-Ranges'] = 'bytes';

    const option = { start: start, end: end };
    const stream = fs.createReadStream(filePath, option);
    sendResponse(206, req, res, responseHeaders, stream);
};

const readRangeHeader = (
    range: string | string[] | undefined | null,
    totalLength: number,
): { Start: number; End: number } | null => {
    if (typeof range !== 'string' || range === null || range.length === 0) {
        return null;
    }

    const array = range.split(/bytes=([0-9]*)-([0-9]*)/);
    const start = parseInt(array[1], 10);
    const end = parseInt(array[2], 10);
    const result = {
        Start: isNaN(start) ? 0 : start,
        End: isNaN(end) ? totalLength - 1 : end,
    };

    if (!isNaN(start) && isNaN(end)) {
        result.Start = start;
        result.End = totalLength - 1;
    }

    if (isNaN(start) && !isNaN(end)) {
        result.Start = totalLength - end;
        result.End = totalLength - 1;
    }

    return result;
};

const sendResponse = (
    code: number,
    req: express.Request,
    res: express.Response,
    responseHeaders: Record<string, string | number>,
    readable: fs.ReadStream | null,
): void => {
    res.status(code);
    res.set(responseHeaders);

    if (readable === null) {
        res.end();
    } else {
        readable.on('open', () => {
            readable.pipe(res);
        });

        readable.on('end', () => {
            readable.close(); // ファイルを開放する
        });

        // 接続切断時もファイルを開放する
        req.on('close', () => {
            readable.close();
        });
    }
};

export const isSecureProtocol = (req: express.Request): boolean => {
    return (
        req.header('x-forwarded-proto') === 'https' ||
        req.header('X-Forwarded-Proto') === 'https' ||
        req.protocol === 'https'
    );
};
