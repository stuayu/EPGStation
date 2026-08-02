// web-bml (tsukumijima フォーク) の decodeTS (TS デコーダ) を薄くラップするモジュール。
// web-bml はビルド済みの dist/ を npm パッケージとしてコミットしているため、
// submodule のビルドや遅延 require は不要で、そのまま import して使える。
// メッセージ型 (ResponseMessage 等) も web-bml/worker (dist/d.ts/lib/ws_api.d.ts) が
// export するものをそのまま re-export し、独自の複製は持たない。
import type stream from 'stream';
import { decodeTS as webBmlDecodeTS } from 'web-bml/worker';
import type { DecodeTSOptions } from 'web-bml/worker';

export type {
    BITBroadcaster,
    BITExtendedBroadcaster,
    BITMessage,
    BITService,
    ComponentPMT,
    CurrentTime,
    DecodeTSOptions,
    ErrorMessage,
    ESEvent,
    ESEventUpdatedMessage,
    ESImmediateEvent,
    ESNPTEvent,
    ModuleDownloadedMessage,
    ModuleFile,
    ModuleListEntry,
    ModuleListUpdatedMessage,
    NPTReference,
    PCRMessage,
    PESMessage,
    PMTMessage,
    ProgramInfoMessage,
    ResponseMessage,
    VideoStreamUrlMessage,
} from 'web-bml/worker';

export type DecodeTSFunction = (options: DecodeTSOptions) => stream.Transform;

// web-bml の decodeTS は TsStream (aribts の Transform 派生クラス) を返す。
// EPGStation 側は Transform としてしか扱わないため DecodeTSFunction へ型を合わせる
const defaultDecodeTS = webBmlDecodeTS as unknown as DecodeTSFunction;

let currentDecodeTS: DecodeTSFunction = defaultDecodeTS;

/**
 * web-bml の decodeTS (TS デコーダ) を取得する
 * @return DecodeTSFunction
 */
export function loadDecodeTS(): DecodeTSFunction {
    return currentDecodeTS;
}

/**
 * テスト専用: decodeTS を差し替える。
 * 実際の TS 解析を持ち込まずに DataBroadcastingManageModel の配線 (登録上限・backpressure・
 * 後始末) をテストするため、スタブの Transform に差し替えられるようにしている。
 * value を省略すると本来の web-bml の decodeTS へ戻す。
 * プロダクションコードから呼び出さないこと
 * @param value: DecodeTSFunction | undefined
 */
export function __setDecodeTSForTest(value: DecodeTSFunction | undefined): void {
    currentDecodeTS = value ?? defaultDecodeTS;
}
