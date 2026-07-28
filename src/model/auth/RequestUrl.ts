import { Request } from 'express';

/**
 * リクエストからアクセス元のベース URL (scheme://host) を求める。
 * OAuth のコールバック URL 生成に使うため、リバースプロキシ配下でも
 * 外から見える URL になるよう X-Forwarded-* を優先する
 * @param req: Request
 * @return string 例: 'https://epg.example.com'
 */
export const getRequestBaseUrl = (req: Request): string => {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto =
        typeof forwardedProto === 'string' && forwardedProto !== ''
            ? forwardedProto.split(',')[0].trim()
            : req.protocol;
    const forwardedHost = req.headers['x-forwarded-host'];
    const host =
        typeof forwardedHost === 'string' && forwardedHost !== ''
            ? forwardedHost.split(',')[0].trim()
            : req.headers.host;
    return `${proto}://${host}`;
};
