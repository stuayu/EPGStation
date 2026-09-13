/**
 * multipart の元ファイル名を、保存時に使える 1 パス要素へ正規化する。
 * Multer が受け取った値は表示・DB 用に使うため、実ファイルの一時名とは分離する。
 */
export default class UploadFileNameUtil {
    private static readonly MAX_UTF8_BYTES = 240;
    private static readonly WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;

    /**
     * パス区切り、制御文字、Windows で使えない文字を除去し、長さを制限する。
     * @param value: string
     * @return string
     */
    public static normalize(value: string): string {
        const baseName = value.normalize('NFC').split(/[\\/]/u).pop() ?? '';
        let normalized = baseName
            // 制御文字を除去することが目的の正規表現なので、この行だけ no-control-regex を外す
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u001f\u007f]/gu, '_')
            .replace(/[<>:"|?*\\/]/gu, '_')
            .replace(/[ .]+$/u, '');

        if (normalized.length === 0 || normalized === '.' || normalized === '..') {
            normalized = 'uploaded';
        }
        if (UploadFileNameUtil.WINDOWS_RESERVED_NAME.test(normalized)) {
            normalized = `_${normalized}`;
        }

        return UploadFileNameUtil.truncateUtf8(normalized);
    }

    private static truncateUtf8(value: string): string {
        if (Buffer.byteLength(value, 'utf8') <= UploadFileNameUtil.MAX_UTF8_BYTES) return value;

        const extensionIndex = value.lastIndexOf('.');
        const candidateExtension = extensionIndex > 0 ? value.slice(extensionIndex) : '';
        const extension =
            Buffer.byteLength(candidateExtension, 'utf8') < UploadFileNameUtil.MAX_UTF8_BYTES ? candidateExtension : '';
        const stem = extensionIndex > 0 ? value.slice(0, extensionIndex) : value;
        const extensionBytes = Buffer.byteLength(extension, 'utf8');
        const budget = Math.max(1, UploadFileNameUtil.MAX_UTF8_BYTES - extensionBytes);
        let result = '';
        for (const char of stem) {
            if (Buffer.byteLength(result + char, 'utf8') > budget) break;
            result += char;
        }
        return `${result || 'uploaded'}${extension}`;
    }
}
