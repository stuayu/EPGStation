import DPlayer from 'dplayer';
import { AribKeyCode, BMLBrowser, BMLBrowserFonts, ResponseMessage } from 'web-bml';
import router from '@/router';
import container from '@/model/ModelContainer';
import IChannelModel from '@/model/channels/IChannelModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import * as apid from '../../../api';

/**
 * データ放送 WebSocket (`<subDirectory>/api/dataBroadcasting/ws`) へ渡す接続パラメータ。
 * src/model/service/dataBroadcasting/IDataBroadcastingManageModel.ts の DataBroadcastingParam と同じ形
 */
export type DataBroadcastingConnectParam =
    | {
          type: 'epgStationLive';
          channelId: apid.ChannelId;
          demultiplexServiceId?: number;
      }
    | {
          type: 'epgStationRecorded';
          videoFileId: apid.VideoFileId;
          // 録画ファイル内のバイト位置 (概算)。未指定時は先頭から
          seek?: number;
          demultiplexServiceId?: number;
      };

export interface DataBroadcastingManagerCallbacks {
    // BML ブラウザが数字キーを利用中かどうかが変化したとき (数字キーをリモコンの選局に使うか、BML へ渡すかの判定に使う)
    onUsedKeyListChanged?: (isUsingNumericKey: boolean) => void;
    // BML ブラウザの読み込み/通信状態が変化したとき (リモコンのローディング表示に使う)
    onLoadingChanged?: (loading: boolean) => void;
}

/**
 * データ放送 (BML) 機能を管理するクラス。
 *
 * KonomiTV (tsukumijima/KonomiTV) の LiveDataBroadcastingManager の実装方式に強く従っている。
 * iframe 越しに postMessage で矩形を送り合う方式ではなく、BMLBrowser (web-bml) を DPlayer の DOM に直接
 * 挿入し、映像の DOM 要素そのものを BML ブラウザの中/外へ物理的に移動させることで表示を成立させる。
 *
 * BMLBrowser インスタンス (内部に JS-Interpreter を持つ) を Vue のリアクティブ監視に含めると
 * 壊れるため、このクラスは Vue コンポーネントではなくプレーンな TypeScript クラスとして実装する
 * (呼び出し側の Vue コンポーネントはこのクラスのインスタンスを reactive でないフィールドとして保持すること)
 */
export default class DataBroadcastingManager {
    // BML は 960x540 sessionStorage キー (Greg: 受信機の電源を切るまでグローバルに持続するメモリ)
    private static readonly GREG_STORAGE_KEY = 'EPGStation-BMLBrowser-Greg';
    private static readonly GREG_SIZE = 64;

    private readonly player: DPlayer;
    private readonly param: DataBroadcastingConnectParam;
    private readonly callbacks?: DataBroadcastingManagerCallbacks;

    // 映像が入る DOM 要素。DPlayer 内の dplayer-video-wrap-aspect をそのまま使う (中に映像と字幕が含まれる)
    private readonly mediaElement: HTMLElement;
    private containerElement: HTMLElement | null = null;

    private bmlBrowser: BMLBrowser | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private ws: WebSocket | null = null;

    private isDestroying = false;
    // 動画の要素が BML ブラウザ上に移動されているかどうか
    private isVideoElementMovedToBmlBrowser = false;
    // 初回の d ボタン (データ放送の表示) を自動送出済みかどうか
    private hasSentInitialDataButton = false;

    // BML ブラウザの解像度 (load イベントで実測値に更新される。既定は 960x540)
    private bmlBrowserWidth = 960;
    private bmlBrowserHeight = 540;

    /**
     * @param player DPlayer のインスタンス
     * @param param データ放送 WebSocket へ渡す接続パラメータ
     * @param callbacks リモコン UI 等へ状態を伝えるためのコールバック
     */
    constructor(player: DPlayer, param: DataBroadcastingConnectParam, callbacks?: DataBroadcastingManagerCallbacks) {
        this.player = player;
        this.param = param;
        this.callbacks = callbacks;
        this.mediaElement = player.template.videoWrapAspect;
    }

    /**
     * データ放送機能を開始する。BML ブラウザの生成、データ放送 WebSocket への接続を行う
     */
    public async init(): Promise<void> {
        // BML ブラウザが入る DOM 要素。DPlayer 内の dplayer-video-wrap の中に動的に追加する (映像レイヤーより下)
        // スタイルは client/src/App.vue のグローバル CSS で定義する
        const container_ = document.createElement('div');
        container_.classList.add('dplayer-bml-browser');
        this.containerElement = this.player.template.videoWrap.insertAdjacentElement('afterbegin', container_) as HTMLElement;

        this.bmlBrowser = new BMLBrowser({
            mediaElement: document.createElement('p'), // ここではダミーの p 要素を渡し、load 時に本物の映像要素と差し替える
            containerElement: this.containerElement,
            storagePrefix: 'EPGStation-BMLBrowser_',
            nvramPrefix: 'nvram_',
            broadcasterDatabasePrefix: '',
            videoPlaneModeEnabled: true,
            fonts: this.getFonts(),
            indicator: {
                setUrl: (_name: string, loading: boolean) => this.setLoading(loading),
                setNetworkingGetStatus: (connecting: boolean) => this.setLoading(connecting),
                setNetworkingPostStatus: (connecting: boolean) => this.setLoading(connecting),
                setReceivingStatus: () => {
                    // 何もしない
                },
                setEventName: () => {
                    // 何もしない
                },
            },
            greg: {
                getReg: (index: number) => DataBroadcastingManager.loadGreg()[index] ?? '',
                setReg: (index: number, value: string) => {
                    const greg = DataBroadcastingManager.loadGreg();
                    greg[index] = value;
                    window.sessionStorage.setItem(DataBroadcastingManager.GREG_STORAGE_KEY, JSON.stringify(greg));
                },
            },
            epg: {
                // データ放送からのチャンネル切り替え。EPGStation の channel (networkId + serviceId) を突き合わせて視聴画面へ遷移する
                tune: (originalNetworkId: number, _transportStreamId: number, serviceId: number): boolean => {
                    const channelModel = container.get<IChannelModel>('IChannelModel');
                    const target = channelModel.getChannels(false).find(c => c.networkId === originalNetworkId && c.serviceId === serviceId);
                    if (typeof target === 'undefined') {
                        container.get<ISnackbarState>('ISnackbarState').open({
                            color: 'error',
                            text: `切り替え先のチャンネルが見つかりませんでした (networkId: ${originalNetworkId} / serviceId: ${serviceId})`,
                        });

                        return false;
                    }

                    // ストリーム種別 (hls / m2tsll 等) は現在の視聴画面のクエリを引き継ぐ
                    const currentType = typeof router.currentRoute.value.query.type === 'string' ? router.currentRoute.value.query.type : 'hls';
                    void Util.move(router, {
                        path: '/onair/watch',
                        query: { type: currentType, channel: target.id.toString(10), mode: '0' },
                    });

                    return true;
                },
            },
            // 双方向 (ネット接続) 機能: データ放送のサーバー側プロキシ実装が無いため無効化する
            // TODO: サーバー側にデータ放送用のインターネットアクセスプロキシ API を実装したらここを差し替える
            ip: {
                isIPConnected: () => 0,
                getConnectionType: () => 403,
                get: async () => ({}),
                transmitTextDataOverIP: async () => ({ resultCode: NaN, statusCode: '', response: new Uint8Array() }),
                confirmIPNetwork: async () => null,
            },
            showErrorMessage: (title: string, message: string, code?: string): void => {
                container.get<ISnackbarState>('ISnackbarState').open({
                    color: 'error',
                    text: `${title}: ${message}${typeof code !== 'undefined' ? ` (${code})` : ''}`,
                });
            },
        });

        // BML ブラウザが保持する FontFace をこの時点で全て明示的にロードしておき、画面のチラつきを防ぐ
        for (const font of (this.bmlBrowser as unknown as { fonts: FontFace[] }).fonts) {
            font.load(); // ロード完了を待たない
        }

        // BML ブラウザがロードされたときのイベント
        this.bmlBrowser.addEventListener('load', event => {
            this.bmlBrowserWidth = event.detail.resolution.width;
            this.bmlBrowserHeight = event.detail.resolution.height;
            this.containerElement?.style.setProperty('--bml-browser-width', `${this.bmlBrowserWidth}px`);
            this.containerElement?.style.setProperty('--bml-browser-height', `${this.bmlBrowserHeight}px`);

            this.calculateScaleFactor(this.player.template.videoWrap.clientWidth, this.player.template.videoWrap.clientHeight);
            this.moveVideoElementToBmlBrowser();

            // ARIB のデータ放送は起動直後 invisible (非表示) で、d ボタンを押して初めて表示される。
            // EPGStation では「データ放送を有効にする」操作自体が表示の意思表示なので、
            // 最初の 1 回だけ自動で d を送り、ユーザーが d を探さなくても表示されるようにする
            if (this.hasSentInitialDataButton === false) {
                this.hasSentInitialDataButton = true;
                this.sendKey(AribKeyCode.DataButton);
            }
        });

        // BML ブラウザの表示状態が変化したときのイベント
        this.bmlBrowser.addEventListener('invisible', event => {
            if (event.detail === true) {
                this.moveVideoElementToDPlayer();
                if (this.containerElement !== null) {
                    this.containerElement.style.display = 'none';
                }
            } else {
                this.moveVideoElementToBmlBrowser();
                if (this.containerElement !== null) {
                    this.containerElement.style.display = 'block';
                }
            }
        });

        // 現在 BML ブラウザ上で利用しているキーの一覧が変化したときのイベント (数字キーの奪い合い判定に使う)
        this.bmlBrowser.addEventListener('usedkeylistchanged', event => {
            this.callbacks?.onUsedKeyListChanged?.([...event.detail.usedKeyList].includes('numeric-tuning'));
        });

        // DPlayer のリサイズを監視し、拡大縮小率を再計算する
        this.resizeObserver = new ResizeObserver(entries => {
            const entry = entries[0];
            if (typeof entry === 'undefined') return;
            this.calculateScaleFactor(entry.contentRect.width, entry.contentRect.height);
        });
        this.resizeObserver.observe(this.player.template.videoWrap);

        this.connectWebSocket();
    }

    /**
     * データ放送 WebSocket へ接続する
     */
    private connectWebSocket(): void {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${location.host}${Util.getSubDirectory()}/api/dataBroadcasting/ws?param=${encodeURIComponent(JSON.stringify(this.param))}`;

        this.ws = new WebSocket(url);
        this.ws.onmessage = event => {
            if (this.isDestroying === true || this.bmlBrowser === null) return;
            try {
                const msg = JSON.parse(event.data) as ResponseMessage;
                this.bmlBrowser.emitMessage(msg);
            } catch (err) {
                console.error(err);
            }
        };
        this.ws.onclose = event => {
            if (this.isDestroying === true) return;
            // 1000 (正常終了) / 4000 (正常終了・追い出し) 以外はユーザーに知らせる
            // 1008: パラメータ不正 / 1011: サーバー内部エラー
            if (event.code !== 1000 && event.code !== 4000) {
                container.get<ISnackbarState>('ISnackbarState').open({
                    color: 'error',
                    text: `データ放送との接続が切断されました (code: ${event.code})`,
                });
            }
        };
    }

    /**
     * リモコンからの ARIB キー押下を BML ブラウザへ送る
     * @param keyCode: AribKeyCode
     */
    public sendKey(keyCode: AribKeyCode): void {
        if (this.bmlBrowser === null) return;
        this.bmlBrowser.content.processKeyDown(keyCode);
        this.bmlBrowser.content.processKeyUp(keyCode);
    }

    /**
     * データ放送機能を終了し、破棄する
     */
    public async destroy(): Promise<void> {
        if (this.ws !== null) {
            try {
                this.ws.close();
            } catch (err) {
                // 既に閉じている場合等は無視する
            }
            this.ws = null;
        }

        if (this.resizeObserver !== null) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        // データ放送内に移動していた映像の要素を DPlayer に戻す (BML ブラウザの破棄前に行う必要がある)
        this.moveVideoElementToDPlayer();

        if (this.bmlBrowser !== null) {
            this.isDestroying = true;
            await this.bmlBrowser.destroy();
            this.isDestroying = false;
            this.bmlBrowser = null;
        }

        this.containerElement?.remove();
        this.containerElement = null;
    }

    /**
     * BML 用フォントの定義を返す。サブディレクトリ運用でも壊れないよう root-relative なパスにする
     */
    private getFonts(): BMLBrowserFonts {
        const base = `${Util.getSubDirectory()}/fonts/bml`;

        return {
            roundGothic: { source: `url("${base}/KosugiMaru-Regular.woff2")` },
            boldRoundGothic: { source: `url("${base}/KosugiMaru-Bold.woff2")` },
            squareGothic: { source: `url("${base}/Kosugi-Regular.woff2")` },
        };
    }

    /**
     * BML ブラウザの読み込み/通信状態をコールバックへ伝える (リモコンのローディング表示用)
     */
    private setLoading(loading: boolean): void {
        this.callbacks?.onLoadingChanged?.(loading);
    }

    /**
     * sessionStorage から Greg (受信機の電源を切るまでグローバルに持続するメモリ) を読み出す
     */
    private static loadGreg(): string[] {
        const raw = window.sessionStorage.getItem(DataBroadcastingManager.GREG_STORAGE_KEY);
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) === true) {
                    return parsed;
                }
            } catch (err) {
                // 壊れていた場合は初期化する
            }
        }

        return [...new Array(DataBroadcastingManager.GREG_SIZE)].map(() => '');
    }

    /**
     * データ放送画面の拡大/縮小率を再計算し、CSS カスタムプロパティに設定する
     * データ放送は 960×540 か 720×480 の固定サイズなので、レスポンシブにするために transform: scale() を使う
     * @param containerWidth: BML ブラウザが入るコンテナ要素の幅
     * @param containerHeight: BML ブラウザが入るコンテナ要素の高さ
     */
    private calculateScaleFactor(containerWidth: number, containerHeight: number): void {
        if (this.containerElement === null) return;

        // 高さは BML ブラウザの高さをそのまま利用するが、横幅は常に高さに対して 16:9 の比率になるようにする
        // (BML ブラウザのサイズが 960×540 なら問題ないが、720×480 の場合は 854×480 として計算される)
        const scaleFactorWidth = containerWidth / ((this.bmlBrowserHeight * 16) / 9);
        const scaleFactorHeight = containerHeight / this.bmlBrowserHeight;
        const scaleFactor = Math.min(scaleFactorWidth, scaleFactorHeight);

        // (BML ブラウザの高さに対して 16:9 の比率の幅) ÷ (BML ブラウザの幅) で横に引き伸ばす倍率を算出
        const magnification = (this.bmlBrowserHeight * 16) / 9 / this.bmlBrowserWidth;

        this.containerElement.style.setProperty('--bml-browser-scale-factor-width', `${scaleFactor * magnification}`);
        this.containerElement.style.setProperty('--bml-browser-scale-factor-height', `${scaleFactor}`);
    }

    /**
     * 映像の DOM 要素を DPlayer から BML ブラウザ (データ放送) 内に移動する
     * データ放送が読み込まれるか、表示状態になるときに呼び出される
     */
    private moveVideoElementToBmlBrowser(): void {
        if (this.isDestroying === true || this.bmlBrowser === null) return;

        const videoElement = this.bmlBrowser.getVideoElement();
        if (videoElement === null) return; // 現在データ放送に映像が表示されていない

        // ダミーで渡した p 要素があれば削除
        if (videoElement.firstElementChild instanceof HTMLParagraphElement) {
            videoElement.firstElementChild.remove();
        }

        videoElement.appendChild(this.mediaElement);

        this.mediaElement.style.width = '100%';
        this.mediaElement.style.height = '100%';
        for (const child of Array.from(this.mediaElement.children)) {
            (child as HTMLElement).style.display = 'block';
            (child as HTMLElement).style.visibility = 'visible';
            if (child instanceof HTMLVideoElement) {
                child.style.width = '100%';
                child.style.height = '100%';
            }
        }

        // BML ブラウザのアスペクト比が 16:9 以外のケース (運用上は 720×480 のみ該当) に限定して適用する
        if (this.bmlBrowserWidth / this.bmlBrowserHeight !== 16 / 9) {
            const magnification = (this.bmlBrowserHeight * 16) / 9 / this.bmlBrowserWidth;
            this.mediaElement.style.transform = `scaleY(${magnification})`;
            this.mediaElement.style.transformOrigin = 'center center';
            // 親要素に映像のアスペクト比を矯正する目的で scaleY() が設定されるため、
            // Canvas 要素 (字幕描画) のみ親要素の scaleY() を打ち消す縮小方向の scaleY() を設定する
            for (const child of Array.from(this.mediaElement.children)) {
                if (child instanceof HTMLCanvasElement) {
                    child.style.transform = `scaleY(${1 / magnification})`;
                    child.style.transformOrigin = 'center center';
                }
            }
        } else {
            this.mediaElement.style.transform = '';
            this.mediaElement.style.transformOrigin = '';
            for (const child of Array.from(this.mediaElement.children)) {
                if (child instanceof HTMLCanvasElement) {
                    child.style.transform = '';
                    child.style.transformOrigin = '';
                }
            }
        }

        this.isVideoElementMovedToBmlBrowser = true;
    }

    /**
     * 映像の DOM 要素を BML ブラウザ (データ放送) から DPlayer 内に移動する
     * データ放送が非表示状態になるか、破棄されるときに呼び出される
     */
    private moveVideoElementToDPlayer(): void {
        if (this.isDestroying === true) return;
        if (this.isVideoElementMovedToBmlBrowser === false) return; // 既に DPlayer 内にある

        // データ放送内に移動していた映像の要素を DPlayer に戻す (BML ブラウザより上のレイヤーに配置)
        if (this.containerElement !== null) {
            this.player.template.videoWrap.insertBefore(this.mediaElement, this.containerElement.nextElementSibling);
        }

        this.mediaElement.style.width = '';
        this.mediaElement.style.height = '';
        for (const child of Array.from(this.mediaElement.children)) {
            (child as HTMLElement).style.display = '';
            (child as HTMLElement).style.visibility = '';
            if (child instanceof HTMLVideoElement) {
                child.style.width = '';
                child.style.height = '';
            }
            if (child instanceof HTMLCanvasElement) {
                child.style.transform = '';
                child.style.transformOrigin = '';
            }
        }
        this.mediaElement.style.transform = '';
        this.mediaElement.style.transformOrigin = '';

        this.isVideoElementMovedToBmlBrowser = false;
    }
}
