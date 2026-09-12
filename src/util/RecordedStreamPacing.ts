/**
 * 録画ファイル入力を配信する ffmpeg の読み出し速度制限。
 *
 * 先頭だけ 45 秒分をバーストして再生開始を早め、その後は実時間の 1.5 倍を
 * 上限にして供給する。ブラウザ側は前方 30 秒で読み込みを止め、15 秒まで
 * 消費すると再開するため、WebKit の一時的な読み込み遅延を吸収しつつ、録画全体を
 * 無制限の速度で読み切らない。readrate_catchup は I/O 遅延から戻るときだけ
 * 最大 2 倍で回復する。
 */
export const RECORDED_STREAM_READRATE = 1.5;
export const RECORDED_STREAM_INITIAL_BURST_SECONDS = 45;
export const RECORDED_STREAM_CATCHUP_READRATE = 2;

/**
 * 録画入力用の ffmpeg 読み出し制限オプションを返す
 * @return string
 */
export const recordedStreamPacingArgs = (): string =>
    `-readrate ${RECORDED_STREAM_READRATE} ` +
    `-readrate_initial_burst ${RECORDED_STREAM_INITIAL_BURST_SECONDS} ` +
    `-readrate_catchup ${RECORDED_STREAM_CATCHUP_READRATE}`;
