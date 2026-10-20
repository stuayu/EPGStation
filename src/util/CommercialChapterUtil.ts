import type * as apid from '../../api';

/** チャプター名が trim 後、大文字小文字を問わず CM で始まるか判定する。 */
export function isCommercialChapter(chapter: apid.VideoChapter): boolean {
    return (chapter.title ?? '').trim().toUpperCase().startsWith('CM');
}
