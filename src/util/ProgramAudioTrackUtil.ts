import * as apid from '../../api';

/**
 * 番組情報 (EPG) の音声 ES 一覧から、ライブ配信で選べる音声トラック一覧を組み立てるユーティリティ。
 *
 * 録画済みの音声トラックは ffprobe で実ファイルを見て決まる (`GET /api/videos/{videoFileId}/audio-tracks`) が、
 * ライブには実ファイルが無いため、番組情報の `audios[]` (Mirakurun の Program.audios[]) から導出する。
 *
 * 二か国語放送は「1 つのステレオ ES の左右に主音声・副音声」を入れるデュアルモノラル
 * (componentType = 0x02) で送られるため、ES 1 本を主音声・副音声の 2 件へ展開する。
 * 音声 ES が複数ある放送はそれぞれが独立した音声なので展開しない。
 */
namespace ProgramAudioTrackUtil {
    // ARIB STD-B10 の component_type。1 つの ES に主音声・副音声が入る
    const DUAL_MONO_COMPONENT_TYPE = 0x02;

    // 表示に使う言語コード (ISO 639-2) の対応表。載っていないものはコードをそのまま出す
    const LANGUAGE_NAMES: { [code: string]: string } = {
        jpn: '日本語',
        eng: '英語',
        deu: 'ドイツ語',
        fra: 'フランス語',
        ita: 'イタリア語',
        rus: 'ロシア語',
        zho: '中国語',
        kor: '韓国語',
        spa: 'スペイン語',
        por: 'ポルトガル語',
        tha: 'タイ語',
        etc: 'その他',
    };

    /**
     * 番組情報から選べる音声トラック一覧を組み立てる
     * 切り替えるものが無い場合 (通常のステレオ放送・情報なし) は空配列を返す
     * @param audios?: apid.ProgramAudioInfo[] 番組情報の音声 ES 一覧
     * @param audioComponentType?: number audios が無い番組向けの主音声 component_type
     * @return apid.VideoAudioTrack[]
     */
    export const getLiveAudioTracks = (
        audios?: apid.ProgramAudioInfo[],
        audioComponentType?: number,
    ): apid.VideoAudioTrack[] => {
        // audios が無い番組でも、主音声の component_type だけでデュアルモノラルは判別できる
        if (typeof audios === 'undefined' || audios.length === 0) {
            return audioComponentType === DUAL_MONO_COMPONENT_TYPE ? buildDualMonoTracks(0, undefined) : [];
        }

        // 主音声を先頭にし、それ以外は componentTag 順 (PMT の ES の並びに相当) に揃える
        const sorted = [...audios].sort((a, b) => {
            if (a.isMain !== b.isMain) {
                return a.isMain === true ? -1 : 1;
            }

            return (a.componentTag ?? 0) - (b.componentTag ?? 0);
        });

        if (sorted.length === 1) {
            return sorted[0].componentType === DUAL_MONO_COMPONENT_TYPE ? buildDualMonoTracks(0, sorted[0].langs) : [];
        }

        const tracks: apid.VideoAudioTrack[] = [];
        for (let i = 0; i < sorted.length; i++) {
            const audio = sorted[i];

            // 複数 ES の中にデュアルモノラルが混ざることがある。その ES だけ主音声・副音声へ展開する
            if (audio.componentType === DUAL_MONO_COMPONENT_TYPE) {
                tracks.push(...buildDualMonoTracks(i, audio.langs));

                continue;
            }

            tracks.push({
                track: i.toString(10),
                name: buildTrackName(i, audio.langs?.[0]),
                streamIndex: i,
                isDualMono: false,
                codec: null,
                language: audio.langs?.[0] ?? null,
                channels: null,
            });
        }

        return tracks;
    };

    /**
     * デュアルモノラルの ES 1 本を主音声・副音声の 2 件へ展開する
     * @param streamIndex: number 音声 ES のインデックス
     * @param langs?: string[] 音声 ES の言語 (主音声・副音声の順)
     * @return apid.VideoAudioTrack[]
     */
    const buildDualMonoTracks = (streamIndex: number, langs?: string[]): apid.VideoAudioTrack[] => {
        const mainLang = langs?.[0] ?? null;
        const subLang = langs?.[1] ?? null;

        return [
            {
                track: 'main',
                name: mainLang === null ? '主音声' : `主音声 (${toLanguageName(mainLang)})`,
                streamIndex: streamIndex,
                isDualMono: true,
                codec: null,
                language: mainLang,
                channels: null,
            },
            {
                track: 'sub',
                name: subLang === null ? '副音声' : `副音声 (${toLanguageName(subLang)})`,
                streamIndex: streamIndex,
                isDualMono: true,
                codec: null,
                language: subLang,
                channels: null,
            },
        ];
    };

    /**
     * 独立した音声 ES の表示名を組み立てる
     * @param index: number 音声 ES のインデックス
     * @param lang?: string 言語コード
     * @return string
     */
    const buildTrackName = (index: number, lang?: string): string => {
        const base = index === 0 ? '主音声' : `音声 ${index + 1}`;

        return typeof lang === 'undefined' ? base : `${base} (${toLanguageName(lang)})`;
    };

    /**
     * 言語コードを表示名へ変換する
     * @param lang: string
     * @return string
     */
    const toLanguageName = (lang: string): string => {
        return LANGUAGE_NAMES[lang] ?? lang;
    };
}

export default ProgramAudioTrackUtil;
