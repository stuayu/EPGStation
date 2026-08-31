# ストリーミング再生基盤刷新 現状調査

調査対象: `doc/streaming-revamp-spec.md` の Phase 1。調査時点: 2026-08-31。

## 1. EncodePresets.ts

`src/util/EncodePresets.ts` は、ハードウェアアクセラレータ × codec × quality × 用途から、録画エンコードと配信 `StreamProfile` を生成する純粋関数群。主な構造は次のとおり。

- 型・表: `EncodeTargetKind` と `EncodePresetExpansion` は21-32行、`QualityParam` と `StreamTuning` は34-51行。codec名・録画エンコード用キー・表示名は65-94行、qualityの解像度/ビットレート表は136-144行。
- 入力補助: rigaya系判定は96-99行、実行ファイル解決は101-122行、quality最大値判定は174-183行、codec別ビットレートは197-200行、設定値の妥当性判定と配列補完は207-230行。
- `buildName(quality, codec, hwaccel)` は240-244行。配信画面名へ quality、H.264/HEVC、QSV等の実装名を連結する。
- `timeoutRate(hwaccel, codec)` は256-261行。録画後エンコードのタイムアウト倍率であり、ストリーミング再生の判定ではない。
- `buildVideoFilter(hwaccel, height, deinterlace)` は270-282行。呼び出し側から `deinterlace: boolean` を受け、trueなら software/nvenc/qsv は `yadif`、VAAPIは `deinterlace_vaapi` を付ける。qsv/vaapiは `format=nv12` 固定。fps、pix_fmt、profileの入力は受けない。
- `buildVideoCodecOptions(hwaccel, codec, height, videoBitrate, lowLatency)` は300-357行。profileは codecとheightから `h264Profile`/`hevcProfile`、levelもheightから決める。software HEVC/H.264は `-pix_fmt yuv420p` 固定。HEVC profileは374行の `hevcProfile()` が常に `main` を返す。fpsはここでは決めない。
- H.264 profile/levelは359-366行、HEVC profile/levelは368-385行、VAAPIデバイス引数は387-389行。
- rigaya引数は `buildRigayaArgs(hwaccel, codec, height, videoBitrate, deinterlace, tuning, isFileInput)`（421-455行）。deinterlace=trueなら436-439行で、VCEEncCは `--interlace tff --vpp-yadif`、他は `--interlace tff --vpp-deinterlace normal`。常に450行で `--output-depth 8`、profileは446行でHEVC `main`。ファイル入力だけ166行の `FILE_INPUT_SYNC_OPTIONS` を434行で付ける。
- rigayaの速度方針は470-480行、HEVCのhvc1タグは482-489行、rigaya→ffmpegのパイプ前段は508-526行。ファイル入力判定は520行の `%INPUT%` 有無。
- `buildLiveHlsCmd(hwaccel, codec, height, videoBitrate, audioBitrate, execPaths?)` は548-590行。rigaya系は556-574行で `deinterlace=true`、非rigaya系は578-588行で `buildVideoFilter(..., true)`。つまりライブ入力はTSとみなし、無条件でdeinterlaceする。GOPは15フレーム。
- `buildRecordedMp4Cmd(scope, hwaccel, codec, height, videoBitrate, audioBitrate, execPaths?)` は603-653行。`scope === 'ts'` のとき `isTs=true` としてdeinterlace、`scope === 'encoded'` はfalse。rigaya系は614-632行、非rigaya系は635-651行。encodedでも `-flags low_delay` を付ける。
- `buildRecordedHlsCmd(...)` は679-732行。TSならdeinterlace、encodedなら非deinterlace。rigaya系は690-708行、非rigaya系は711-730行。GOPは15フレーム。
- `expand(presets, execPaths?)` は741-847行。codec/quality/targetの直積を作り、recorded、live HLS、recorded TS/encodedの各配列を生成する。streaming向けのvideo metadataはheight/codec/bitrateのみで、scan/fps/bit depth/HDRは持たない。
- `applyToConfig(config)` は860-928行。手書き `config.encode`、`stream.profiles.*`、旧形式 `stream.live.*`/`stream.recorded.*` のいずれかがあるscopeを上書きせず、空scopeだけ自動生成する。

仕様書との直接の不一致は、166行の全ファイル入力固定 `--fps 30000/1001`、435-438行の無条件deinterlace指定、270-280行の`nv12`固定、374行のHEVC Main固定。さらに`buildLiveHlsCmd`はライブの実測情報を受けず常にdeinterlaceする。

## 2. StreamProfileManageModel と設定型

### `IConfigFile.ts`

- `StreamingCmd` は36-39行。必須`name`と任意`cmd`だけ。
- `StreamContainer` は42行で `'m2ts' | 'm2tsll' | 'mp4' | 'webm' | 'hls'`。
- `StreamVideoParam` は44-49行で codec/width/height/bitrate、`StreamAudioParam` は51-54行で codec/bitrate。映像特性のscan/fps/pix_fmt/profile/HDRはない。
- 既存 `StreamProfile` は61-69行。id/name/container/video/audio/cmd/isUnconvertedを持つ。仕様の`StreamPreset`は品質条件、用途、HDR、bit depth等を持つため同一概念ではない。
- `stream`本体は585-616行。旧形式は `live.ts.{m2ts,m2tsll,webm,mp4,hls}`、`recorded.{ts,encoded}.{webm,mp4,hls}`。新形式は `profiles.live` と `profiles.recorded.{ts,encoded}`。

### `StreamProfileManageModel.ts`

- `getLiveProfiles()` は45-61行。`stream.profiles.live` がundefinedでなければ新形式のみを返し、定義済みなら空配列でも旧形式へフォールバックしない。旧形式はm2ts→m2tsll→webm→mp4→hlsの順で正規化。
- `getRecordedProfiles(type)` は68-86行。`type`がtsなら`profiles.recorded.ts`、encodedなら同encodedを優先。旧形式はwebm→mp4→hls。
- `resolveLegacyMode(kind, container, mode)` は96-104行。同一scopeかつ同一containerに絞った配列のindexをmodeとして解決。
- 旧形式のid生成は113-132行。`{live|recorded-ts|recorded-encoded}-{container}-{index}`。旧`name`からvideo/audioは推測せず、cmd未定義なら`isUnconverted: true`。
- 新形式のcmd補完は141-153行。cmdあり、または`isUnconverted` trueならそのまま。video/audio両方なしなら無変換。それ以外は`buildCmd`。
- `buildCmd(scope, container, video?, audio?)` は165-222行。codec既定はwebmだけlibvpx-vp9/libvorbis、それ以外libx264/aac。video/audio bitrate既定は3000k/192k。encoded sourceだけyadifを外し、それ以外は181行で無条件`yadif`。入力はencodedが`-ss %SS% -i %INPUT%`、他は`-i pipe:0`。liveだけ`-re`。
- container分岐は188-221行。m2tsllはmap 0、字幕/データcopy、nobuffer/low_delay/max_delay、mpegts出力。webmはrealtime/speed 4。mp4はbaseline、fastdecode/zerolatency、fragmented MP4。hlsは`%streamFileDir%`のTSセグメント、live list size 17、recorded list size 0。m2tsはpipeへのmpegts。
- scaleは229-243行。videoが無い、またはwidth/heightが両方無い場合は無指定、片方だけならもう片方-2。

### 新旧形式の共存

サーバ実配信は新形式scope優先。`ConfigApiModel`（182-205行）は解決済みprofilesを`api.d.ts`の`streamProfiles`へ公開し、旧形式は208-291行で別途`streamConfig`へ変換。クライアント`ServerConfigModel`（37-121行）は新形式から旧形式表示用配列を生成し、現在のUIは旧形式のname/indexを使う。よって新形式の配列数・container内順序・nameと、UI表示用旧形式のミラーがずれると表示と実配信がずれる。

## 3. 配信サービスの受け取り・cmd生成・プロセス起動

- `StreamApiModel` は、ライブのm2ts/m2tsll/webm/mp4/hlsを77-205行で個別開始する。`resolveProfile`（214-253行）はprofile id指定を優先し、なければcontainer内の旧mode indexを解決。profile指定時の表示modeは同container内index。
- 録画はwebm/mp4/hlsを283-357行で開始する。`getRecordedVideoConfig`（367-384行）がvideo_fileの`type`を調べ、encodedなら`recorded.encoded`、それ以外は`recorded.ts`を使う。録画TSの中身の映像特性ではなくDBのtypeでscopeを分ける。
- 全streamの共通optionは`StreamBaseModel.setOption`（50-53行）。現在渡すのはliveがchannelId/cmd/audioTrack、recordedがvideoFileId/playPosition/cmd/audioTrack。profile object自体はサービスへ渡らず、cmd文字列へ早期に変換される。
- `LiveStreamBaseModel.createProcessOption`（97-128行）は`%FFMPEG%`/`%TSREADEX%`、音声placeholderを展開。HLSだけstreamFileDir/streamNumを置換。cmdなしはMirakurun streamをそのまま流すためプロセスを作らない。
- Liveの`start`（136-230行）はMirakurun streamを取得し、プロセスを`IStreamProcessManageModel.create`で起動。TSを放送時刻/BIT/EIT/字幕Transformへ通し、stdinへpipe。in-memory HLSならfMP4出力を`Fmp4Packager`へ送る。
- `RecordedStreamBaseModel.start`（140-240行）はvideo file情報を取得し、playPositionを範囲検証、TSならbyte rateからファイルread streamを作成、process managerで起動。HLSはdisk/in-memoryをcmdの`%streamFileDir%`有無で判定。TS HLSだけARIB subtitle Transformを挿入。
- recorded cmdの展開は`createProcessOption`（423-461行）。`%SS%`はTSなら空、encodedならplayPosition、`%INPUT%`はfile path。audio placeholderとHLS pathを置換し、process optionのinput/output/cmd/priorityを作る。
- 実クラス`LiveStreamModel`/`LiveHLSStreamModel`/`RecordedStreamModel`/`RecordedHLSStreamModel`は各々stream typeだけを返す薄いDIクラス（各ファイル7-9行）。実処理はbaseに集約。
- HLSはdisk方式ならplaylistファイル生成を100ms周期で監視、in-memory方式なら`HLSMemoryStoreModel`/`Fmp4Packager`を使う。録画in-memoryは先行量60セグメント超過時に比例throttle（`RecordedStreamBaseModel` 50-76行）する。

## 4. 既存の映像メタデータとDB保存

### ffprobe

`VideoUtil.getDetailedInfo`（`src/model/api/video/VideoUtil.ts:73-95`）は`-show_format -show_streams -of json`を実行する。取得する値はformatのduration、size、bit_rate、start_time、最初のvideo streamのcodec_name/width/height、最初のaudio streamのcodec_name。`pix_fmt`、field_order、avg/r_frame_rate、color_primaries、color_transfer、color_space、profile、bit depthは取得・保存しない。

`VideoFileAnalyzeModel.analyzeMetadata`（98-145行）は上記を`video_file`へ保存する。エンティティ（`src/db/entities/VideoFile.ts:45-103`）に保存されるのはduration、startTime、startAt、videoCodec、audioCodec、width、height、bitRate、analyzedAt。sizeも既存size更新。保存されない映像特性が仕様Phase 3の不足分。

### TS解析

`TsInfoAnalyzer`はPAT/SDT/NIT/PMT/EIT[p/f]/TDT/TOT/BITを解析する。主要な型は`ITsInfoAnalyzer.ts:7-53`。

- 放送・サービス: networkId、transportStreamId、serviceId、serviceType、serviceName、serviceProviderName、networkName。
- 番組: eventId、eventName、eventDescription、eventExtended、eventStartAt、eventDuration、genres最大3組。
- EIT映像: videoType（mpeg2/h.264/h.265）、videoResolution（1080i/2160p等）、videoStreamContent、videoComponentType。
- EIT音声: audioSamplingRate、audioComponentType。
- PMT: videoStreamType、videoPid、audioStreamType、audioPid。
- 時刻/系列: firstTdtAt、BIT sections。

解析時の読み取り・判定は`TsInfoAnalyzer.ts:70-210`、映像codec/解像度のdescriptor表は130-172行、stream typeは189-192行。対象serviceは`VideoFileAnalyzeModel.analyzeTsInfo`（161-186行）が録画channel由来のexpectedServiceIdを渡し、無ければTsInfoAnalyzerが推定する。中央読み・先頭TDT再読・PCR補正の設計は既存コードとPROJECT_OVERVIEWの記載どおり。

DB `video_file_ts_info`（`src/db/entities/VideoFileTsInfo.ts:17-178`）に保存されるのは、上記の放送/番組/PMT/TDT/BIT値とanalyzedAt。映像の実測width/height/fps/pix_fmt/field_order/HDR/bit depthは保存されない。`videoType`と`videoResolution`はEIT descriptor由来で、ffprobeの実測値ではない。

## 5. クライアントの画質選択

- `client/src/util/StreamQualityUtil.ts:9-82` はサーバconfigの旧`streamConfig`からname配列を取り、nameをDPlayer quality `{name,url,type}`へ変換。modeは配列範囲へ丸めるだけ。source/client capabilityによる選択はない。
- `OnAirSelectStreamState.ts:40-159` はライブのM2TS/M2TS-LL/WebM/MP4/HLSと、各配列のindexを管理。保存するのはstream typeとmode。`OnAirSelectStream.vue:1-35,116-203` は2つのv-selectと外部アプリ切替を表示し、視聴ページへtype/channel/modeを渡す。
- `RecordedDetailSelectStreamState.ts:31-145` はvideoFile.typeでrecorded.ts/encodedを切り替え、WebM/MP4/HLSとmode indexを列挙。`RecordedDetailSelectStreamDialog.vue:1-25,66-93` は同じ2段v-select。
- `WatchHistoryPlayDialog.vue:1-35,46-93` は「そのまま再生」と「ストリーミング」を選ぶ。encodedは直接再生を常に表示、TSはstreaming設定が無いときだけ直接再生を最後の手段として表示。streaming選択は既存stateを使う。
- `LiveHLSVideo.vue:45-160`、`LiveMpegTsVideo.vue:80-145`、`RecordedStreamingVideo.vue:77-190`、`RecordedHLSStreamingVideo.vue:78-270` は、config name配列をDPlayer qualityへ変換。切替時はURLをmode付きで再生成し、録画は現在位置を渡す。Live HLS/Recorded HLSはDPlayer type `hls`、ARIB字幕を使用。
- `WatchOnAir.vue`（433-465行付近）はroute queryのtype/channel/modeをparseし、VideoContainerへmodeを渡す。`WatchRecorded.vue`は直接再生中心、`WatchRecordedStreaming.vue`（317-345行付近）はvideoFileId/recordedId/streamingType/modeをparseしてstreaming playerを生成する。いずれもqualityは整数mode。
- `client/src/components/video/`では`BaseVideo`がDPlayer共通処理、`NormalVideo`が直接ファイル再生、`LiveHLSVideo`/`LiveMpegTsVideo`/`RecordedStreamingVideo`/`RecordedHLSStreamingVideo`が配信方式別処理、`VirtualTimeline`がストリーミングの時間軸/チャプター表示を担当。新仕様のrecommended preset、HDR、correction、client capabilities UIは未実装。
- `ServerConfigModel`（37-121行）は新`streamProfiles`を旧`streamConfig`へ変換してからUIへ渡す。ただしSafari/iOSでは128-191行でWebM/MP4等を削除するUAベースの既存互換処理が残る。

## 6. API定義

ルートの`api.yml`は11行が`paths: {}`。既存APIのOpenAPI定義は各ルートファイルの`apiDoc`で組み立てられる。

実際のstreams関連は次のroute群。

- `src/model/service/api/streams/live/{channelId}/m2ts.ts`
- `m2tsll.ts`
- `mp4.ts`
- `webm.ts`
- `hls.ts`
- `m2ts/playlist.ts`
- `src/model/service/api/streams/recorded/{videoFileId}/mp4.ts`
- `webm.ts`
- `hls.ts`
- 共通のstream stop/keep/info route群

各開始APIは`mode`または`profile`（後者優先）と、必要に応じて`audioTrack`を受ける。m2ts系/MP4/WebMはストリーム本体を返し、HLSはstreamIdをJSONで返す。

videos関連は、`src/model/service/api/videos/{videoFileId}.ts`のファイル取得/削除、`metadata.ts`、`duration.ts`、`playlist.ts`、`chapters.ts`、`audio-tracks.ts`、`playback-position.ts`等。`metadata`はDBのffprobe保存値、`chapters`と`audio-tracks`は要求時ffprobe。playback-options endpointはまだない。

共有型は`api.d.ts:908-930`の`ClientStreamProfile`、`api.d.ts:997-1027`付近のConfig streamConfig/streamProfiles、`api.d.ts:1240-1265`付近のmode/profile付きstream option。`api.yml`には関連schemaとしてStreamContainer（222-230行）、StreamVideoParam（232-245行）、StreamAudioParam（246-255行）、ClientStreamProfile（256-277行）があるが、pathsは空。

## 7. ChannelType、BS4K/CS4K

正の定義は`api.d.ts:20-66`。`GR`/`BS`/`CS`/`SKY`、`NW1`〜`NW40`、`BS4K`、`CS4K`を含む。OpenAPI enumも`api.yml:91-140`で同じ値。旧`src/v1.d.ts:4`はGR/BS/CS/SKYだけで、旧API型が取り残されている。

ChannelTypeはchannel entity/API、tuner type、reservation判定等で使われる。`ChannelDB.getChannelTypeId`（165行付近）やMirakurun物理channelのtypeを経由するが、ストリーミングのSourceCapabilitiesへ変換する処理はない。現行のBS4K/CS4K対応は型・EPG/チャンネル分類までであり、stream cmdのcodec/scan/fps/bit depth/HDR選択には接続していない。

## 8. 既存config.ymlの後方互換条件

既存ユーザーの設定を動かすために保持すべき条件。

- `stream.profiles.live`、`stream.profiles.recorded.ts`、`stream.profiles.recorded.encoded`が定義されているscopeは、新形式を実配信の正として扱う。新形式をBuilt-inで上書きしない。
- 新形式profileの`id`はAPIの`profile` queryとクライアント保存値の参照キー。運用中に変更・再利用しない。
- 旧形式の`stream.live.ts.{m2ts,m2tsll,webm,mp4,hls}`と`stream.recorded.{ts,encoded}.{webm,mp4,hls}`を読み、各配列のname/cmdをそのまま使える必要がある。
- 旧形式でcmdが無い項目は無変換。cmdの有無を勝手に推測・補完して挙動を変えない。
- 旧`?mode=N`はcontainer内配列のindex。container間で混ぜず、配列の順序・件数を変えない。現在のprofile優先構成では、旧形式UIミラーとprofilesのcontainer内順序/nameを一致させる。
- 旧形式のmode idは`live-{container}-{index}`または`recorded-{ts|encoded}-{container}-{index}`で決定的に扱う。
- `%FFMPEG%`、`%TSREADEX%`、`%INPUT%`、`%OUTPUT%`、`%SS%`、`%streamFileDir%`、`%streamNum%`のplaceholderを保持する。`%DUALMONOMODE%`、`%AUDIOMAP%`、`%AUDIOFILTER%`も音声切替/boostのため保持する。
- cmdの`|`はshell経由実行を意味する。tsreadex等の前処理パイプを壊さない。
- HLS cmdの`%streamFileDir%`有無はdisk/in-memory判定。削除・自動挿入でHLS方式を変えない。
- HLS disk方式の`%OUTPUT%`、`streamFilePath`、`streamNum`置換とplaylist監視を保持する。in-memory fMP4 cmdは`pipe:1`前提。
- live入力/recorded TS入力はpipe、recorded encodedは`-ss %SS% -i %INPUT%`。入力方式をscopeだけでなく勝手に変更しない。
- `streamFilePath`、`tsreadex`、`ffmpeg`、音声track指定、isEnableTSLiveStream/isEnableTSRecordedStream/isEnableEncodedRecordedStreamの解決を保持する。
- `encodePresets`は未設定scopeだけを補完し、手書きencode/stream設定を上書きしない。Feature Flagで互換層を無効化しない。
- クライアントは当面`streamConfig`のname/indexを読むため、`ConfigApiModel`のstreamConfig公開と`ServerConfigModel`のprofiles→streamConfig変換を維持する。
- iOS/Safari向けの既存WebM/MP4除外、M2TS-LL対応判定、HLS type指定、DPlayerのARIB字幕初期化を壊さない。

現行の実ファイル`config/config.yml`は新形式profilesを上部（159行以降）に置き、旧形式を1020-1253行にUIミラーとして残す。旧形式の配列順・件数・nameをprofiles側と一致させるという運用コメントもある。テンプレートには新形式中心の構成があるため、ユーザー環境の旧形式だけのconfigも別途扱う必要がある。

## 9. 既存型との重複・再利用判断

- `IConfigFile.StreamContainer`は仕様の出力containerと同じ値集合なので、Phase 2の`IStreamPreset.ts`で再定義せずimportして再利用。
- `IConfigFile.StreamProfile`は既存config/APIの実行プリセット。仕様の`StreamPreset`はbuiltin/legacy、source/client conditions、品質カテゴリ、HDR、bit depth、fps、deinterlaceを持つ設計上位概念。名前は似るが置換せず別型にした。
- `IConfigFile.StreamVideoParam`/`StreamAudioParam`は既存cmd自動生成向けの最小設定で、仕様の`StreamPreset.output`とは粒度が違う。既存型を拡張せず、Phase 2では仕様型に閉じた。
- `TsInfo`はTSのcodec/解像度/音声/放送情報を持つが、ffprobe由来のfps/scan/pix_fmt/HDR/bit depthを持たない。SourceCapabilitiesへ直接aliasせず、Phase 3で変換・補完する前提。
- `LiveStreamOption`/`RecordedStreamOption`は実行時cmdを受けるtransport option。PlaybackDecisionとは責務が違う。

## 10. Phase 2で追加した型

- `src/model/stream/capability/ISourceCapabilities.ts`: `VideoTransport`、`VideoCodecKind`、`ScanType`、`ColorPrimaries`、`TransferKind`、`HdrKind`、`SourceClass`、`SourceCapabilities`。
- `src/model/stream/capability/IClientCapabilities.ts`: `ClientCapabilities`。
- `src/model/stream/preset/IStreamPreset.ts`: `StreamPreset`、`VideoCorrectionMode`。既存`StreamContainer`を再利用。
- `src/model/stream/resolver/IPlaybackDecision.ts`: `PlaybackDecision`。

実装クラス、DI登録、API、既存cmd、既存UIは変更していない。

## 11. 仕様書の想定と実コードの食い違い

- 仕様書はPhase 1の確認済み違反としてEncodePresetsの固定fps/deinterlace/nv12/Mainを挙げる。実コードはそのとおりで、まだ修正されていない。
- 仕様書Phase 3はffprobeのpix_fmt、field_order、fps、color metadataを使う想定。しかし現行`VideoUtil.getDetailedInfo`はcodec/解像度等だけ取得し、DBにも保存しない。
- 仕様書は`SourceCapabilities`をSource Analyzerが作るアーキテクチャだが、現行のlive/recorded開始経路はprofile→cmd文字列であり、SourceCapabilities/ClientCapabilities/Resolverは存在しない。
- 仕様書はBS4Kをchannel typeまたは実測HEVC Main10/HLG/BT.2020の複合で扱う。現行はChannelTypeへ`BS4K`/`CS4K`を追加済みだが、stream cmd生成はchannel typeも実測映像特性も参照しない。
- 仕様書のsourceClass既定値（legacy-broadcast/bs4k）は未実装。TSはscopeから無条件yadif、encodedはtypeからyadifなしで、scan判定ではない。
- 仕様書はBS4K 59.94pを維持するとするが、rigayaファイル入力へ全て`--fps 30000/1001`、rigaya/ffmpeg出力へ8bit/Mainを付ける。
- 仕様書はprogressive sourceにdeinterlace引数を一切付けないとするが、現行自動生成ライブ/TS系は`yadif`またはrigaya deinterlaceを付ける。手書きcmdも既存configではyadifが多い。
- 仕様書はMain10/10bit/HDR preserveを要求するが、現行自動生成は`--output-depth 8`、`-pix_fmt yuv420p`、HEVC Main固定。10bit/HDR metadataの経路なし。
- 仕様書はAPIの`GET /api/streams/.../playback-options`または同等APIを推奨するが、現行にplayback-options endpointはない。`api.yml`の`paths`も空で、既存APIはfs-routesのapiDoc定義。
- 仕様書のレスポンス例は`recommended`/`profiles`/HDR/correctionを返すが、現行Config APIは`streamProfiles`と旧`streamConfig`を返すだけで、端末能力や入力ごとのavailable判定はしない。
- 仕様書はクライアントがMediaCapabilities、dynamic-range、screen、networkを使う想定だが、現行画質選択はconfig nameとmode index。Safari除外だけUAベースで存在する。
- 仕様書はpreset id中心のUIを要求するが、現行UIはDPlayer quality nameと整数mode。profile query対応はサーバにあるが、クライアントの視聴導線はmode中心。
- 仕様書は4K/HDR項目の非表示、映像補正/HDR選択、Bottom Sheet、再生開始popupを要求するが、Phase 1時点で未実装。
- 仕様書は録画後エンコードを変更対象外とするが、`EncodePresets.ts`は録画エンコードと配信プリセットを同一ファイルで生成する。Phase 5以降の修正ではrecorded encode (`config/enc.js`)とstreaming生成の境界を誤って変更しない必要がある。
- 仕様書のLegacyカタログは概念として列挙されるが、現行コードに独立したLegacy preset registryはない。旧configを`StreamProfileManageModel.normalizeLegacyList`がその場で正規化する。
- 仕様書は`mmt-tlv`を型に持つ。Phase 2では型だけ追加したが、現行Mirakurun→stream経路はMPEG-TS pipeで、MMT/TLV分岐は未実装。

## 12. 未調査・Phase 3以降へ送る事項

- 実ファイルのffprobe `pix_fmt`/profile/field_order/fps/color metadataをSourceCapabilitiesへ変換する仕様とDBキャッシュ方針。
- ライブでchannel type、networkId、配信開始後実測をどう統合するか。
- encoder capability検出とTTL cache、Main10/HDR非対応時の明示的fallback。
- Built-in/Legacy/ユーザー定義のregistry優先順位と、旧modeの互換マッピングをAPI/クライアントでどう固定するか。
- HLS CODECS/HDR metadata、hvc1、ARIB字幕、disk/in-memory両方式を新CommandBuilderへ移行する境界。
- 画質切替時の録画位置・音声・字幕・fullscreen/PiP維持を、現在のVideoContainer再生成経路へどう統合するか。
