const MPEG_TS_PACKET_SIZE = 188;

/**
 * 録画 TS の再生位置に対応する読み出し開始 byte を計算する
 * @param bitRate: number ffprobe が返すビットレート (bit/s)
 * @param playPosition: number 再生位置 (秒)
 * @param fileSize: number ファイルサイズ (byte)
 * @return number 188 byte の TS パケット境界へ揃えた開始 byte
 */
export const calculateRecordedStreamStartByte = (bitRate: number, playPosition: number, fileSize: number): number => {
    if (
        Number.isFinite(playPosition) === false ||
        playPosition <= 0 ||
        Number.isFinite(bitRate) === false ||
        bitRate <= 0
    ) {
        return 0;
    }

    const safeFileSize = Number.isFinite(fileSize) === true ? Math.max(0, fileSize) : 0;
    const estimatedOffset = Math.floor((bitRate / 8) * playPosition);
    const clampedOffset = Math.max(0, Math.min(estimatedOffset, safeFileSize));

    return Math.floor(clampedOffset / MPEG_TS_PACKET_SIZE) * MPEG_TS_PACKET_SIZE;
};
