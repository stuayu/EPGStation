/**
 * fMP4 の init セグメント (moov) から HLS の CODECS 属性に書く文字列を求める純粋関数群。
 *
 * マスタープレイリストの `#EXT-X-STREAM-INF` に CODECS を書かないと、
 * **Safari のネイティブ HLS は映像レンディション + 別音声レンディションの構成を再生できない**
 * (実測: WebKit 26 で audioTracks は主音声・副音声の 2 本が見えるのに再生位置が進まない)。
 * init セグメントは既にメモリ上にあるので、そこから実際の値を読む。
 */
namespace Mp4CodecUtil {
    /**
     * init セグメント (moov を含む fMP4) からコーデック文字列を求める
     * 見つからない場合や未知のコーデックの場合は null を返す (呼び出し側は CODECS を省く)
     * @param init: Buffer
     * @return string | null 例: 'avc1.64001f' / 'hvc1.1.6.L123.B0' / 'mp4a.40.2'
     */
    export const parseCodec = (init: Buffer): string | null => {
        const stsd = findBox(init, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
        if (stsd === null || stsd.length < 8) {
            return null;
        }

        // stsd: version(1) + flags(3) + entry_count(4) の後に sample entry が並ぶ
        const entry = stsd.subarray(8);
        if (entry.length < 8) {
            return null;
        }

        const type = entry.subarray(4, 8).toString('ascii');
        switch (type) {
            case 'avc1':
            case 'avc3':
                return parseAvcCodec(entry, type);
            case 'hvc1':
            case 'hev1':
                return parseHevcCodec(entry, type);
            case 'mp4a':
                // 本フォークの配信コマンドは AAC-LC (`-c:a aac`) 固定
                return 'mp4a.40.2';
            default:
                return null;
        }
    };

    /**
     * avc1 / avc3 の sample entry から codec 文字列を作る
     * avcC の profile_idc / profile_compatibility / level_idc をそのまま 16 進で並べる
     * @param entry: Buffer sample entry (先頭は size + type)
     * @param type: string
     * @return string | null
     */
    const parseAvcCodec = (entry: Buffer, type: string): string | null => {
        const avcC = findChildBox(entry.subarray(86), 'avcC');
        if (avcC === null || avcC.length < 4) {
            return null;
        }

        const profile = avcC[1];
        const compatibility = avcC[2];
        const level = avcC[3];

        return `${type}.${toHex(profile)}${toHex(compatibility)}${toHex(level)}`;
    };

    /**
     * hvc1 / hev1 の sample entry から codec 文字列を作る
     * ISO/IEC 14496-15 の HEVCDecoderConfigurationRecord から general_profile_space / idc /
     * compatibility flags / tier / level を読む
     * @param entry: Buffer
     * @param type: string
     * @return string | null
     */
    const parseHevcCodec = (entry: Buffer, type: string): string | null => {
        const hvcC = findChildBox(entry.subarray(86), 'hvcC');
        if (hvcC === null || hvcC.length < 13) {
            return null;
        }

        const profileSpace = (hvcC[1] >> 6) & 0x03;
        const tierFlag = (hvcC[1] >> 5) & 0x01;
        const profileIdc = hvcC[1] & 0x1f;
        const compatibility = hvcC.readUInt32BE(2);
        const levelIdc = hvcC[12];

        // general_profile_compatibility_flags はビット順を反転して 16 進で書く
        const reversed = reverseBits32(compatibility);
        const space = ['', 'A', 'B', 'C'][profileSpace];

        return `${type}.${space}${profileIdc}.${reversed.toString(16).toUpperCase()}.${tierFlag === 0 ? 'L' : 'H'}${levelIdc}.B0`;
    };

    /**
     * 32bit のビット順を反転する (HEVC の general_profile_compatibility_flags 用)
     * @param value: number
     * @return number
     */
    const reverseBits32 = (value: number): number => {
        let result = 0;
        for (let i = 0; i < 32; i++) {
            result = (result << 1) | ((value >>> i) & 1);
        }

        return result >>> 0;
    };

    /**
     * 1 バイトを 2 桁の 16 進文字列にする
     * @param value: number
     * @return string
     */
    const toHex = (value: number): string => value.toString(16).padStart(2, '0');

    /**
     * box のパスを辿って中身 (payload) を返す
     * @param buffer: Buffer
     * @param path: string[] 例: ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']
     * @return Buffer | null
     */
    export const findBox = (buffer: Buffer, path: string[]): Buffer | null => {
        let current: Buffer | null = buffer;
        for (const name of path) {
            if (current === null) {
                return null;
            }
            current = findChildBox(current, name);
        }

        return current;
    };

    /**
     * 直下の box を名前で探し、その payload を返す
     * @param buffer: Buffer
     * @param name: string
     * @return Buffer | null
     */
    const findChildBox = (buffer: Buffer, name: string): Buffer | null => {
        let offset = 0;
        while (offset + 8 <= buffer.length) {
            const size = buffer.readUInt32BE(offset);
            const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
            const boxSize = size === 0 ? buffer.length - offset : size;
            if (boxSize < 8 || offset + boxSize > buffer.length) {
                return null;
            }

            if (type === name) {
                return buffer.subarray(offset + 8, offset + boxSize);
            }

            offset += boxSize;
        }

        return null;
    };
}

export default Mp4CodecUtil;
