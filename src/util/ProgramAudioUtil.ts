import * as apid from '../../api';

/**
 * DB に JSON 文字列で保存した音声 ES 一覧 (Mirakurun の Program.audios[]) を扱うユーティリティ
 *
 * program.audios は Mirakurun が返した値をそのまま保存しているだけなので、
 * 読み出し側では壊れた JSON・想定外の形を必ず弾く (放送波由来の値は欠けることがある)
 */
namespace ProgramAudioUtil {
    /**
     * DB の JSON 文字列を ProgramAudioInfo[] へ変換する
     * @param json: string | null | undefined
     * @return apid.ProgramAudioInfo[] | null 解釈できない場合は null
     */
    export const parse = (json: string | null | undefined): apid.ProgramAudioInfo[] | null => {
        if (typeof json !== 'string' || json.length === 0) {
            return null;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch (err: any) {
            return null;
        }

        if (Array.isArray(parsed) === false) {
            return null;
        }

        const result: apid.ProgramAudioInfo[] = [];
        for (const audio of parsed as any[]) {
            if (audio === null || typeof audio !== 'object' || typeof audio.componentType !== 'number') {
                continue;
            }

            const item: apid.ProgramAudioInfo = {
                componentType: audio.componentType,
                isMain: audio.isMain === true,
            };
            if (typeof audio.componentTag === 'number') {
                item.componentTag = audio.componentTag;
            }
            if (typeof audio.samplingRate === 'number') {
                item.samplingRate = audio.samplingRate;
            }
            if (Array.isArray(audio.langs) === true) {
                const langs = (audio.langs as any[]).filter((lang): lang is string => typeof lang === 'string');
                if (langs.length > 0) {
                    item.langs = langs;
                }
            }

            result.push(item);
        }

        return result.length === 0 ? null : result;
    };
}

export default ProgramAudioUtil;
