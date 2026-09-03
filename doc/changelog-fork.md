# フォーク版の変更ログ

stuayu フォークで加えた変更を**新しい順**に記録したもの。1 項目が「背景 → 何をしたか → 実装場所 → 注意点」の形で書かれている。

> [!IMPORTANT]
> ここは**履歴**であって現在の仕様書ではない。「今どうなっているか」を知りたい場合は先に
> [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) を読むこと。このファイルは
> **その機能がなぜそうなっているのかを調べるとき**に、目的の項目だけを探して読む。

## 読み方

- 全体を通読する必要はない。**下の索引で項目名を探し、その文字列でファイル内を検索**する (エディタの検索 / `grep -n "<項目名>" doc/changelog-fork.md`)
- 該当箇所の前後 30〜60 行がその変更の全体になる
- 設計の結論だけが欲しい場合は [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)、設定値は [conf-manual.md](conf-manual.md)、配信周りは [streaming-refresh.md](streaming-refresh.md) にまとまっている

## 2026-09-03

- **視聴画面をスマートフォン向けに作り直した**: 320x568 では左のアイコンナビ (48px) とパネル見出し (48px) だけで縦が埋まり、右パネルの本文が 216px しか残らないため、SNS 投稿は本文入力欄が画面外、チャンネル一覧は 2 件しか見えなかった。**横持ちではさらに映像だけで画面が埋まり、パネルの高さが 0 になって操作できなかった** (タブ行ごと画面外)。

    - **縦積みは縦持ちのときだけにした**。レイアウトの切り替えを `(max-width: 1024px) and (orientation: portrait)` に限定し、**横持ち (`orientation: landscape`) では左右分割に戻す** (パネル幅 44%、上限 360px、下限 240px、左のアイコンナビは隠す)。実測で iPhone SE 横 (568x320) のパネル高さが 0 → 320px、SNS タブが画面外 → 画面内になった。
    - **狭い縦持ち (720px 以下) では視聴に不要なクロムを畳む**。左のアイコンナビ (`WatchSideBar`) とパネル見出し (`panel-header`、放送局名は上部バーと重複) を隠し、その分をパネルへ回す。ナビを隠す代わりに上部バー左へ戻るボタン (`WatchLayout.goBack()`、履歴が無ければ `/onair`) を置いた。
    - **上部 (バー + 映像) は実寸で固定し、余りをすべてパネルへ渡す** (`.main` / `.video-area` を `flex: 0 0 auto`)。`flex: 1 1 auto` のままだとパネルの中身の高さに応じて映像が伸縮し、タブを切り替えるたびに配分が変わっていた。あわせて画面全体スクロール (`overflow-y: auto`) をやめ、パネル本文の中だけをスクロールさせる (全体スクロールだとタブ行が画面外へ流れ、操作先が見えなくなる)。
    - **映像を小さくしてパネルを広げるトグルを追加した** (上部バー右、`isWatchVideoCompact` として localStorage へ永続化)。**幅を詰めて 16:9 を保つ実装にすると 320px 端末で映像が 242px になり DPlayer のコントロールが重なって押せなくなった**ため、幅は保ったまま枠の高さ (`24svh`) だけを下げ、映像は枠の中で letterbox させている。
    - **データ放送のリモコンを開くと映像の下へ 450px ほど積み上がり、映像自体が画面外へスクロールアウトしていた** (Chromium + 受信できる放送局で実測)。`.video-area` に `max-height: 60svh` + `overflow-y: auto` を与えてパネルのタブ行を守り、リモコンの中身 (`.v-expansion-panel-text__wrapper`) を `max-height: 30svh` + スクロールに、さらに `:has(.v-expansion-panel--active)` でリモコンを開いている間だけ映像を `20svh` へ縮める。映像 y = -101px (画面外) → +38px (画面内)、リモコン高さ 452px → 234px になった。
    - **リモコンを開くとチャンネル切替ボタン (`.channel-switch`) が色ボタンの上に重なって「黄」を塞いでいた**。このボタンは映像枠の縦中央 (`top: 50%`) に置かれているが、枠はリモコン込みで伸びるため中央が映像の外へ出る。リモコンを開いている間は隠す (チャンネル切り替えはパネルの「チャンネル」タブでできる)。
    - **番組名が長いと上部バーが横へ伸び、戻るボタンと映像サイズのボタンが画面外へ出ていた** (実測: 320px 幅で `.watch-top-bar` が 579px、縮小トグルが x=619px)。`WatchTopBar` のルートが `flex-shrink: 0` だったため縮まず、`WatchLayout` 側の `min-width: 0` が効いていなかった。伸縮する側なので `flex: 1 1 auto` + `min-width: 0` に変え、`.top` にも `min-width: 0` / `overflow: hidden` を付けた。**`.top > :first-child` で伸ばす指定も、戻るボタンを先頭に足した時点で当たる相手が変わっていた**ため `.top > .watch-top-bar` に直した。
    - **チャンネル一覧 (`WatchPanelChannels`) は狭い端末で 2 列にした**。1 件 70px の 1 列では 3 件しか入らず放送局を探せないため、`.list` を 2 列グリッドにし、番組名を 1 行 (`-webkit-line-clamp: 1`)、次番組と放送時刻 (進捗バーで代替できる) を省いた。**ピン留めが 0 件のときは最初の放送波・地域タブを初期選択にする** (「ピン留めした放送局がありません」だけの画面で開かない)。
    - 実測 (playwright WebKit、SNS 投稿タブの本文領域): iPhone SE 216px → 285px (映像を小さくすると 324px)、iPhone 14 Pro 240px → 336px (同 394px)。チャンネル一覧の完全に見える件数は 3 件 → 6 件 (iPhone 14 Pro を小さくすると 8 件)。いずれもページスクロールは発生せず、4 つのタブは常に画面内にある。

- **画質選択 UI を一般ユーザー・技術ユーザーの両方に分かるように改善した**: 従来はプリセット ID ごとに手書きの短い日本語ラベルだけを出しており、「オリジナル」「1080p 標準」等の名前だけでは何が得なのか分からず、`badges`(HDR / 4K 等) は `source` を渡していなかったため実際には一度も表示されていなかった。

    - **表示ラベルの単一入口 `client/src/util/PlaybackLabelUtil.ts` を作り、名前・一言説明・技術詳細・バッジを 1 か所で決めるようにした**。`getPlaybackLabel(profile, source?, recommended?)` は auto のとき `summary` に「今回の選択: <recommended.label>」、`detail` に `recommended.reason` (サーバの選定理由の日本語文) を出す。既知 ID 以外は `profile.label` から解像度らしき数値を拾って summary のフォールバックにし (`guessResolutionSummary()`)、それも無理なら「カスタムプリセット」にした (旧「再生用プリセット」は情報量ゼロだったため置き換え)。バッジは `おすすめ` / `4K` / `HDR` / `変換なし` / `通信量小` / `カスタム` の意味のある集合へ絞り、幅の都合で最大 2 個の上限は維持。ダイアログのトグルボタン用に短縮ラベル `getPlaybackShortLabel()` (auto は「おまかせ (今回: <label>)」) を追加し、使われていなかった `getAutoReasonLabel` は削除した。
    - **HDR バッジが出ないバグを直した**: `PlaybackQualityItem.vue` が `getPlaybackLabel()` に `source` を渡していなかった。`source` / `recommended` / `container` (`streamContainer` prop) を追加で受け取り、詳細表示 (`showDetail`) のときは `profile.detail` に加えて `profile.modes[<container>]` の mode 番号 (config.yml の `stream.*` と対応する数値) も出すようにした。auto 行は選択中かどうかに関わらず常に理由文 (`detail`) を出す。
    - **`PlaybackQualityList.vue` に「詳しく表示」トグルを追加した**。状態は `IPlaybackOptionsState.preference.showQualityDetail` (新規 boolean, 既定 false) として `savePreference()` 経由で localStorage へ永続化し、全画面 (放送中選択ダイアログ・録画詳細選択ダイアログ) で共有する。「その他の画質」セクションは **「このサーバー独自の設定 (件数)」** に改名し、config.yml 由来のプリセットであることが分かるようにした。auto は表示側でも先頭に来るよう `primaryProfiles` でソートして保証。「利用可能な画質がありません」は「この配信方式で使える画質がありません。配信方式を変えてください」に変更し、原因が分かるようにした。
    - **配信方式セレクタの下にヒント文を追加した** (`OnAirSelectStream.vue` / `RecordedDetailSelectStreamDialog.vue`。`hint` + `persistent-hint`、ラベル自体には書かない)。「配信方式を変えると選べる画質も変わります」。
    - **配信方式セレクタを手で変えても画質の選択表示が追随しない不整合を直した**。`dialogState.selectedStreamConfig` / `selectedStreamMode` を `@Watch` し、変更後の mode に一致する `PlaybackProfile` があれば `playbackState.selectPreset()` で選択表示を合わせる。ただし **`modes[container] === mode` の単純な先頭一致で探すと、選んだ画質が毎回「おまかせ」へ巻き戻る** (実機で確認)。`auto` は解決先プリセットと同じ mode を持ち、一覧の先頭にいるため必ず先にヒットするため。現在は「選択中の画質が既にその mode ならそのまま」「`auto` 以外を先に探し、無ければ `auto`」の 2 段で判定している。
    - **`PlaybackProfile` に `role` を追加した** (`api.yml` / `api.d.ts` / `IPlaybackApiModel` / `PlaybackApiModel.createProfiles()`)。`profile.id` は `live-m2tsll-1080p-avc` のような実プリセット id なので、`PlaybackLabelUtil` の辞書を id で引くと `auto` 以外は必ず外れ、**一言説明とバッジが実際には一度も出ていなかった** (実機で確認)。サーバは以前から `builtinRole()` で役割 (`auto` / `original` / `2160p-high` / `1080p-high` / `1080p` / `720p` / `data-saver`) を計算して並び順に使っていたので、それを API に載せてクライアントの引き当てキーにした。
    - **録画の配信では「おまかせ」が選べないのに、ボタンだけ「おまかせ」と出ていた**のを直した。`profiles` に `auto` が入るのはライブだけで、録画側は実プリセットしか返らない。`PlaybackOptionsState.getInitialPresetId()` は `auto` が無ければ `recommended.resolvedId` を初期選択にする (一覧の 1 行が選択済みになり、トグルボタンの表記とも一致する)。
    - **DPlayer 設定メニュー (`BaseVideo.setPlaybackProfiles()`) の画質名も `PlaybackLabelUtil.getPlaybackLabel().name` へ統一**し、ダイアログ側の表記と揃えた。`VideoContainer.vue` からは `playbackOptions.source` を渡して HDR 等の判定に使えるようにしたが、`LiveHLSVideo.vue` 等の内部呼び出し (`this.setPlaybackProfiles(profiles, 'hls')`) は source を持っていないため第 1〜3 引数のみで呼んでおり、これらでは HDR バッジ相当の判定は効かない (名前生成には影響しない)。DPlayer の設定メニューが画質切替の唯一の入口という規約は変えていない。
    - **狭い端末の見え方は playwright (WebKit) の実測で詰めた** (`devices['iPhone SE']` 320x568 / `devices['iPhone 14 Pro']`)。320px では 1 行 238px のうち prepend の radio と append のバッジで両端を取られ、本文が 102px しか残らず「おまかせ (自 / 動)」のように名前が折り返っていた。**バッジは行の右端 (`#append`) ではなく本文側 (名前の右) へ置く**こと、行の左右余白を 8px に詰めること、radio を `density="compact"` にすることで本文幅を確保している。「詳しく表示」も当初は `v-switch` にしていたが、狭い端末でつまみがカード右端をはみ出すためトグルボタン (`v-btn` + `mdi-eye`) にした。
    - 既存の client util 系テスト (`test/ut`) はサーバ側 `dist/` を `require()` する構成で、client (Vite/ESNext ビルド) の純粋関数を実行できる自動テスト基盤が無いため、`PlaybackLabelUtil` への自動テスト追加は見送った (代わりに上記の実機確認で担保している)。

- **配信選択ダイアログのポップアップ二重表示をやめ、視聴画面の設定アイコン重複を解消した**: 放映中一覧から放送局を選ぶと、配信選択ダイアログ (`OnAirSelectStream`) の上にさらに画質選択シート (`PlaybackQualitySheet`) が自動で開き、モーダルが 2 枚重なっていた (録画詳細の `RecordedDetailSelectStreamDialog` も同じ実装)。原因は `maybeOpenQualitySheet()` がダイアログを開いた契機で無条件にシートも開いていたこと。

    - **画質選択はダイアログの中でインライン展開する**。「画質: <名前>」ボタンで `PlaybackQualityList` を開閉し、オーバーレイは常に 1 枚に保つ。設定「再生前に画質を選ぶ」が ON のときだけ最初から展開した状態で開く。画質一覧を開くとダイアログが縦に伸びるため、本文側 (`.select-stream-body`) と一覧 (`.quality-list`) にそれぞれ `max-height` + `overflow-y: auto` を与えて狭い端末でも操作ボタンが画面外へ出ないようにした。
    - **`epgstation.playback.selection-made` の localStorage フラグは廃止**した (「一度でも選んだか」でシートの自動表示を切り替える必要が無くなったため)。
    - **画質 → サーバ mode の対応付けを修正した**。従来は「表示中のプロファイル配列の添字」をそのまま `mode` として使っており、絞り込みや並び替えが入ると別の設定で再生していた。`PlaybackProfile.modes[<container>]` から引き直す。配信方式 (M2TS-LL / HLS / MP4 / WebM) を切り替えたときは、そのコンテナで `playback-options` を取り直す。
    - **視聴画面 (ライブ・録画) の右上にあった設定アイコン (`PlaybackOptionsMenu`) を削除した**。DPlayer の設定メニューに画質切替が統合済み (`BaseVideo.setPlaybackProfiles()` / `switchQuality()`) で、歯車が 2 つ並んでいた。メニュー内の「映像補正」「HDR」は `update:correction` / `update:hdrMode` を誰も受けておらず動作していなかった。設定は端末の設定画面 (設定 > 再生) に一本化する。
    - 使われなくなった `PlaybackOptionsMenu.vue` / `PlaybackQualitySheet.vue` は削除した (`PlaybackQualityList.vue` / `PlaybackQualityItem.vue` は残り、ダイアログ内のインライン一覧が使う)。
    - **DPlayer の設定メニューから画質を切り替えたら `qualitySwitched` を親へ通知する**ようにした。これまで `VideoContainer` は「自動画質のまま」と認識し続けるため、再生エラー時の自動 fallback がユーザーの明示的な選択を上書きしていた。**ただし親が起こした切替 (自動 fallback 自身) では通知しない** — 通知すると親が「ユーザーが選んだ」と誤認し、2 回目以降の fallback が止まる。`switchQuality()` が立てるフラグを、非同期の url 解決へ入る前に捕まえて判定する。
    - **DPlayer の画質メニューを後から作り直せるようにした** (`BaseVideo.refreshQualityMenu()` / `markCurrentQuality()`)。DPlayer は**生成時に一度だけ**設定メニューの DOM を組み立て、`switchQuality()` も**生成時に集めた `template.qualityItem`** しか見ない。playback-options は録画ファイルの解析を伴い応答まで数十秒かかることがあってプレイヤー生成に間に合わず、実測では旧 config 名 (`1080p(低遅延)`) のまま残り、切替後の選択状態も更新されなかった。届いた時点で項目を作り直し、`template.qualityItem` を繋ぎ直し、選択中の表示は自前で書き換える (チェックアイコンは既存項目の SVG を流用してスタイルを保つ)。
    - **画質一覧はその配信方式で `modes[<container>]` を持つプロファイルだけに絞る** (プレイヤー内の画質メニューと同じ規則)。mode を持たないプロファイル (config に対応する設定が無い Built-in カタログ由来のもの) は選んでも配信設定が変わらず、選択が黙って無視されていた。
    - **「既定の画質」が `auto` のときは配信設定を書き換えない**。開くたびにサーバの推奨で上書きすると、このダイアログで前回選んだ設定が毎回失われる。
    - **画質選択肢の取得はレースを潰す**。配信方式を続けて切り替えると古い応答が後から解決して新しい選択を上書きするため、ダイアログ側と `PlaybackOptionsState` (singleton) の両方に取得世代を持たせ、古い応答を捨てる。

- **端末の設定画面の再生設定 (映像補正 / HDR / モバイル回線) を実際に効かせるようにした**: 設定 > 再生の「既定の画質」だけが `playback-options` API へ渡っており、「映像補正」「HDR」「モバイル回線では画質を下げる」は保存されるだけで再生に影響していなかった。

    - `GET /streams/live/{channelId}/playback-options` と `GET /videos/{videoFileId}/playback-options` に `preferHdr` / `preferCorrection` / `saveData` を追加し (`api.yml`)、`parsePlaybackPreference()` で読み取って `PlaybackPolicyResolver.resolve()` の第 6 引数 `PlaybackPreference` として渡す。
    - **絞り込みではなく加減点**にした (`PlaybackPolicyResolver.preferenceScore()`)。設定に合う候補が 1 つも無い環境でも再生できる状態を保つため。HDR は素材が HDR のときだけ働き、`saveData` は端末の回線種別が `cellular` / `slow` のときだけ働く (回線種別が取れない端末では効かせない)。
    - **明示的なプリセット指定 (画質一覧での選択) は従来どおり最優先**で、端末設定はこれを上書きしない。
    - **fallback 候補の並びにも同じ設定を効かせる**。ここを常に高画質優先のままにすると、通信量を抑える設定で選んだ低画質から再生に失敗したときに高画質へ戻ってしまう。
    - クライアント側は `PlaybackOptionsState.getPreferenceQuery()` でクエリを組み立て、`getInitialPresetId()` が「既定の画質」がその入力で使えるならそれを選択済みとして扱う。
    - テストは `test/ut/playback-policy-resolver.test.js` に 5 件追加。

## 2026-09-01

- **ストリーミング刷新 Phase 16 で DPlayer と新画質 UI の対応を統一した**: `playbackProfiles` の添字を画質切替へ渡さず、`StreamPresetRegistry` の container 別 mode map を Playback API から返して preset id で解決するようにした。DPlayer の quality も同じ playback profile から作り、品質バケット名・順序・container ごとの絞り込みを新 UI と一致させた。旧 config 環境では従来の `StreamQualityUtil` quality を維持する。実装は `PlaybackApiModel` / `BaseVideo` / 各 video component、テストは `playback-api-model.test.js`。

- **ストリーミング刷新 Phase 15 のカスタムプリセット UI を追加した**: 設定画面の折り畳みセクションから Built-in を複製し、用途・解像度・Codec・Bit Depth・FPS・HDR・映像補正・エンコーダ・品質と上級者向け詳細、Raw Command を編集できる。保存先は config.yml ではなく `app_setting.config.stream.profiles` のオーバーレイ。Raw Command (`cmd`) は既存の自動コマンド生成より優先し、既存プリセット・録画後エンコード・既存 config は変更しない。実装は `CustomStreamPresetEditor` / `CustomStreamPresetUtil`。

- **ストリーミング刷新 Phase 12 で config プリセットを品質バケットへ対応付けた**: `encodePresets` や既存 `stream:` 由来のプリセットを削除せず、通常表示では各品質バケットの代表 1 件を Built-in の分かりやすい名前で表示する。再生に使う ID と cmd は従来のユーザー定義を維持し、同じバケットの残りと対応付けできないプリセットは「その他の画質」へ残す。代表は低遅延コンテナを優先し、通常表示は最大 7 件。実装は `PlaybackApiModel`、テストは `playback-api-model.test.js`。

- **ストリーミング刷新 Phase 11 の実機 E2E 欠陥を修正した**: 入力映像を超える解像度の config / legacy プリセットを候補と自動選択から除外し、config の video / cmd から判定できる HEVC・H.264 の端末非対応候補も除外する。Playback API に `builtin` / `legacy` を追加し、通常画面では Built-in を表示、その他を折り畳む。自動選択理由を実際の選択解像度に合わせ、配信選択ダイアログの操作領域を 44px 以上へ統一した。実装は `StreamPresetRegistry` / `PlaybackApiModel` / `PlaybackPolicyResolver` / 画質 UI。

- **ストリーミング刷新 Phase 10 の回帰テストと設計文書を是正した**: 既存 `stream:` 設定のみの環境で従来のプリセット順・cmd を維持する回帰、Original の video copy、BS4K 1080p HDR、iOS HDR 対応 / 非対応端末の選択をテストへ追加した。`PROJECT_OVERVIEW.md` に SourceAnalyzer / StreamPresetRegistry / PlaybackPolicyResolver / Command Builder / Playback API / 画質 UI の構成と、Transport・scan・fps・bit depth・HDR の分離規則を追記した。

- **ストリーミング刷新 Phase 6 の HDR / SDR 経路を分離した**: HDR の `tone-map` / `sdr` 指定時、HLG / PQ 入力だけ `zscale` → `tonemap=hable` → BT.709 `zscale` → 8bit `format` を通し、出力メタデータも BT.709 に修正する。rigaya 系は `--vpp-colorspace hdr2sdr=hable` を使う。`preserve` は BT.2020 / HLG・PQ / Main10 を維持し、SDR 入力へトーンマップを二重適用しない。映像補正は純粋関数へ分離し、`auto` は保守的に追加補正せず、ネイティブ HDR を明るくしない。実装は `src/util/StreamArgsUtil.ts` / `src/util/VideoCorrectionUtil.ts`。

- **ストリーミング刷新 Phase 5 の Command Builder を追加した**: `SourceCapabilities` の scan / frameRate / bitDepth / HDR と `StreamPreset.output`、利用可能エンコーダ能力からライブ・録画配信用 cmd を組み立てる。progressive source へデインターレースを付けず、Main10 非対応エンコーダへの黙った 8bit fallback も行わない。rigaya の録画ファイル入力だけ解析 fps 付き `--avsync forcecfr` を使い、HEVC 配信の `hvc1` タグを維持する。既存 `stream:` の手書き cmd と既存生成経路は変更しない。実装は `src/util/StreamArgsUtil.ts` / `src/model/stream/builder/`。

## 2026-08-31

- **ストリーミング刷新 Phase 4 の Preset Registry を追加した**: Built-in / Legacy / 既存 config / `encodePresets` の候補を統合し、映像特性とクライアント能力で利用可能な候補だけを返す。既存 config のプリセットと mode 添字の対応は維持し、既存 cmd 生成経路とクライアントは変更しない。実装は `BuiltinStreamPresets` / `StreamPresetRegistry`。

- **ストリーミング刷新 Phase 3b の Source Analyzer 基盤を追加した**: `VideoUtil.getDetailedInfo()` が ffprobe から `pix_fmt` / `profile` / `field_order` / フレームレート / 色特性 / ビット深度を取得し、既存の戻り値と呼び出しは維持する。`SourceAnalyzer` は解析済み録画の DB 情報を優先し、未解析時だけ ffprobe で `SourceCapabilities` を作る。ライブは BS4K と legacy-broadcast の仕様既定値を返し、録画・ライブそれぞれ TTL 付きメモリキャッシュを使う。実装は `src/model/stream/capability/SourceAnalyzer.ts` / `ISourceAnalyzer.ts` と DI 登録。録画後エンコード、既存のストリーム cmd 生成、クライアントは変更しない。

- **録画 TS 再解析を ARIB STD-B10 に照らして点検し、5 点の仕様逸脱を修正した**: 対象は `TsInfoAnalyzer` / `TsPlaybackTimeResolver` と、解析を呼ぶ `VideoFileAnalyzeModel` / `RecordedManageModel`。

    - **extended_event_descriptor (0x4E) を完全に解析するようにした**: 従来は `items` の `item_description` / `item` しか読んでおらず、**末尾の `text_char` (自由記述) を捨てていた**うえ、descriptor が複数に分割されているとき **`descriptor_number` で並べ替えず受信順のまま連結**していた (STD-B10 6.2.7)。1 番組の詳細情報が `descriptor_number` 0..`last_descriptor_number` に分割され、TS 上の到着順が保証されない以上、項目の順序と分割された項目値の連結先が入れ替わる。各 descriptor を `ExtendedEventPart` (descriptor_number / last_descriptor_number / ISO_639_language_code / items / text) として集めてから、`descriptor_number` 昇順で連結する `buildExtendedEvent()` を追加した。**言語が違う descriptor は同じ文章へ混ぜない** (jpn を優先し、無ければ最初の言語)。`item_description` が空の item が直前項目の続きである扱いは従来どおり。
    - **壊れた記述子が 1 つあると番組情報が丸ごと消える問題を直した**: `aribts` の `TsDescriptors.decode()` は予約タグ (0x00 / 0x01 / 0xDF) に対し `undefined` を返すため、`descriptor.decode()` が TypeError になる。従来は `setEventDescriptors()` 全体が例外で抜け、**EIT[p/f] の候補自体が登録されず番組名・開始時刻・ジャンルがすべて null になっていた**。記述子 1 つずつ try/catch で切り分けるようにした。
    - **録画対象サービスの決定を heuristic 主体にしないようにした**: 全サービス TS には本編・サブチャンネル・ワンセグ・データ放送が同居し、**TS だけからは「どれを録画したのか」を仕様上一意に決められない**。`TsInfoAnalyzeOption.expectedServiceId` を追加し、呼び出し側が知っている service_id があればそれを必ず採用する。`VideoFileAnalyzeModel.analyzeTsInfo()` は録画 → channel から、`RecordedManageModel` の取り込みは `option.channelId` から解決して渡す。TS 内に見つからない場合だけ `expected service id <n> was not found in TS; fallback service selection used` を warn へ出して従来の推定 (service_type → パケット数 → EIT の有無 → service_id 昇順) へ落ちる。**推定は fallback であって仕様上の根拠ではない**。アップロード TS の新規登録・取り込みスキャンは対象の放送局が未確定なので従来どおり推定を使う。
    - **音声は `main_component_flag` で主音声を選ぶようにした**: 従来は最初に見つかった `audio_component_descriptor` を代表にしていたため、**二か国語・解説音声が先に並ぶ番組で副音声の component_type / sampling_rate を記録していた**。STD-B10 の `main_component_flag = 1` を優先し、立っているものが無い場合だけ先頭を使う。
    - **EIT の component_tag で PMT の ES を引き当てるようにした**: 従来 `setStreamInfo()` は stream_type が一致する**先頭の** ES を代表映像・代表音声にしていた。STD-B10 では EIT の `component_descriptor` / `audio_component_descriptor` の `component_tag` と、PMT の `stream_identifier_descriptor` (0x52) の `component_tag` が対応する。まず component_tag で引き当て、引けない場合のみ従来の先頭採用へ落ちる。映像・音声が複数ある番組で代表 PID がずれなくなる (`videoPid` / `audioPid` は `TsPlaybackTimeResolver` の PTS 基準にも使われるため、ずれると実況同期もずれる)。EIT を PMT より先に反映する順序へ変えたのはこのため。
    - **PCR の不連続 (discontinuity_indicator) を扱うようにした**: 従来は wraparound しか見ておらず、**TS 連結・録画ドロップ・エンコーダ再起動で時間軸が切り替わった PCR を同じ軸として引き算していた**。`PcrSample` に epoch を持たせ、`adaptation_field.discontinuity_indicator = 1` で PID ごとに epoch を進める。`correctStartAtByPcr()` は起点と同じ epoch のサンプルだけを使い、`calcBytesPerMs()` は epoch ごとに区切って最長区間で測る。`TsPlaybackTimeResolver` も基準 PCR を取った後に不連続を見つけたら推測せず null を返す (呼び出し側が `firstTdtAt` へフォールバックする)。ファイル先頭 (基準 PCR より前) の不連続は開始点なので無視する。

    点検して**問題無しと判断した**もの: TDT/TOT の MJD + BCD 変換とタイムゾーン非依存 (`decodeJstDate`)、`ChannelUtil.isMediaService()` の service_type (0x01 / 0x02 / 0xA1 / 0xA2 / 0xA5 / 0xA6 / 0xAD。ワンセグは 0xA5、データ放送は 0xC0 で本編より下位に落ちる)、NIT/SDT の actual 限定 (0x40 / 0x42) と ONID + TSID + SID での放送局引き当て (`findNetworkIdAndServiceId`)、ARIB 文字列を `aribts.TsChar` に委譲していること。EIT[p/f] は `current_next_indicator = 1` の検証を追加したうえで**「解析区間で最初に受信した present を採る」設計は維持**した — 解析はファイル中央 (番組の途中) から読むため、区間内で後から届いた present へ乗り換えると番組境界をまたいだときに次番組を拾う。
    - **テスト**: `test/ut/ts-info-analyzer.test.js` に extended_event の分割・順序逆転・項目継続・text のみ・言語混在・壊れた記述子混在、main/sub 音声、component_tag による映像音声の引き当てとその fallback、PCR 不連続、`expectedServiceId` の優先・不在時 fallback を追加。`test/ut/ts-playback-time-resolver.test.js` に PCR 不連続の 2 件を追加。

## 2026-08-30

- **録画再生のデータ放送時刻を視聴位置へ同期**: 録画 TS の先読みで BML の TDT/TOT 時刻がエンコード位置へ進んでいたため、録画ファイル先頭の `startAt` と DPlayer の再生位置から時刻を求め、再生中・一時停止中・シーク時に BMLBrowser へ再注入する。ライブは TS の TDT/TOT を継続利用する。`BroadcastTimeExtractor` は B10 の JST_time に合わせ、BCD と MJD 日付の異常値を拒否する。

- **放送局ロゴの ARIB 経路を点検**: EPGStation は `logo_transmission_descriptor` や CDT を再解釈せず、Mirakurun が蓄積・PNG 化したロゴを API から転送する。B10 の 0x01/0x02 (CDT)・0x03 (簡易ロゴ) の意味を混同する処理は無く、404 は未受信局の正常な「ロゴ無し」として扱う。B21 の 6 種類の logotype に依存する固定サイズ変換も無く、表示は縦横比を維持する。

- **EIT[p/f] の規格解釈を修正**: `table_id=0x4E`、`section_syntax_indicator=1`、CRC、`current_next_indicator=1`、サービス/TS/ネットワーク識別子を検証し、section 番号を present/following の識別に使わないようにした。B10 の定義どおり section 内の時系列 event 先頭を present、次を following として複数 event を取り込む。start_time の未定値、duration の 0xFFFFFF、BCD 異常値を安全に扱い、`running_status=1/2` の present は放送中番組・録画開始判定へ採用しない。

- **録画中 EIT[p/f] と following を番組表・DB・予約へ反映**: `RecorderModel` の録画TS監視結果を IPC で Service と Operator の EITストアへ集約し、放映中APIは鮮度内の present/following の event_id・時刻を正とする。EIT確定時刻は `program` へ鮮度付きで保存し、`ProgramDB` が Mirakurun の `saveProgram()` 差分更新・`updateAll()` 全件置換の直前に再適用する。鮮度切れ後は通常のMirakurun値へ戻す。変更時は `ON_AIR_PROGRAM_UPDATED` / `PROGRAM_RANGE_UPDATED` と予約追従を即時発行する。実装は `EitPresentStore`、`RecorderModel`、`IPC*`、`ProgramDB`、`ScheduleApiModel`、`src/db/migrations/{sqlite,mysql}/1787542000000-AddProgramEitTime.ts`。

- **HEVC 配信の一番上の画質だけビットレートの削減をやめた**: HEVC は同画質を低いビットレートで出せるため `HEVC_BITRATE_RATE` (0.65) を掛けて帯域を削っていたが、画質一覧の先頭は「帯域を使ってでも綺麗に見たい」ときに選ぶものなので、**その配信設定の最高解像度だけ係数を掛けず H.264 と同じビットレートを使う** (1080p までなら 1080p が 5200 → 8000kbps、`2160p` を含むなら 2160p が 15600 → 24000kbps)。対象は `encodePresets.qualities` の内容から動的に決まり、下位の解像度と H.264 は従来どおり。`src/util/EncodePresets.ts` の `highestQualityOf()` / `videoBitrateOf()`。

- **Issue #30: エンコード済み MP4 の副音声切替を修正**: `NormalVideo` が `audioTracks` 1 本のステレオ AAC を
  音声切替対象外にしていたため、サーバーの音声トラック API と Web Audio API を使い、右チャンネルを左右へ
  複製する副音声 UI を追加。Web Audio 非対応時は通常再生を維持する。配信側は `%AUDIOFILTER%` へ pan と
  volume を統合し、encoded 入力の副音声だけ pan、TS 入力は従来の `-dual_mono_mode sub` を使う。

- **配信の音声が小さい問題に対し、音声ブースト `audioBoost` を追加**: ライブ・録画再生の配信で音声を `volume` フィルタで増幅する (既定 2.0 倍、`1.0`〜`4.0` に丸め、`1.0` でフィルタ無し)。KonomiTV が固定 2 倍を掛けているのに倣ったもの。**フィルタは音声を aac へ再エンコードする ffmpeg のコマンドへ入れる** — rigaya 系 (QSVEncC 等) を使うプリセットでも rigaya 側は `--audio-copy` のまま触らない。rigaya の `--audio-filter` は `--audio-codec` で再エンコードする場合にしか効かず `--audio-copy` と併用できないためで、EPGStation の rigaya プリセットは「rigaya が映像 → 後段 ffmpeg が音声を aac 化」というパイプラインなのでブーストは後段が担当する。音声コピーのみの経路と保存用 `encode` は対象外。手書きの配信用 cmd では `%AUDIOFILTER%` が使える (`%DUALMONOMODE%` / `%AUDIOMAP%` と同じ扱い。保存用 `encode` の cmd では展開されない)。倍率の丸めは `src/util/AudioBoostUtil.ts`、cmd の組み立ては `src/util/EncodePresets.ts`、置換は `src/model/service/stream/util/AudioTrackUtil.ts`。

- **Cloudflare 等で Mirakurun event stream が空になる環境へサービス単位 polling と Service 側 EIT[p/f] 正規化を追加**: 無イベント切断・接続失敗の連続を純粋関数で判定し、ライブ配信中・録画中・録画開始間近の局を上限付きで `networkId/serviceId` フィルタ取得する。event stream 復活時は polling を止める。ライブ TS の EIT[p/f] は `EitPresentStore` へ保持し、放映中 API の現在番組解決では鮮度2分以内の present を優先する。設定は `epgPolling`。

- **配信の音声が小さい問題に対し、音声ブースト `audioBoost` を追加**: ライブ・録画再生の配信で音声を `volume` フィルタで増幅する (既定 2.0 倍、`1.0`〜`4.0` に丸め、`1.0` でフィルタ無し)。KonomiTV が固定 2 倍を掛けているのに倣ったもの。**フィルタは音声を aac へ再エンコードする ffmpeg のコマンドへ入れる** — rigaya 系 (QSVEncC 等) を使うプリセットでも rigaya 側は `--audio-copy` のまま触らない。rigaya の `--audio-filter` は `--audio-codec` で再エンコードする場合にしか効かず `--audio-copy` と併用できないためで、EPGStation の rigaya プリセットは「rigaya が映像 → 後段 ffmpeg が音声を aac 化」というパイプラインなのでブーストは後段が担当する。音声コピーのみの経路と保存用 `encode` は対象外。手書きの配信用 cmd では `%AUDIOBOOST%` が使える (`%DUALMONOMODE%` / `%AUDIOMAP%` と同じ扱い。保存用 `encode` の cmd では展開されない)。倍率の丸めは `src/util/AudioBoostUtil.ts`、cmd の組み立ては `src/util/EncodePresets.ts`、置換は `src/model/service/stream/util/AudioTrackUtil.ts`。

- **匿名許可時に非adminの書き込み API まで実行できる問題を修正 (Issue #29)**: `auth.allowAnonymous` の設定値は維持しつつ、認証 payload が無い場合に通す HTTP メソッドを `GET` / `HEAD` / `OPTIONS` に限定した。録画削除などの `POST` / `PUT` / `PATCH` / `DELETE` は、admin API でなくても認証を要求する。media token は従来どおり再生用 `GET` / `HEAD` allowlist のみで認証し、セッション認証と admin API の保護も維持する。

- **再生専用 media token が録画・動画管理 API を認証してしまう問題を修正 (Issue #28)**: `AuthGuard` の media token 判定を method + 再生用 API の明示 allowlist に変更し、`GET`/`HEAD` の動画・IPTV・ライブ/録画ストリームだけを許可する。`/recorded` 配下や動画・ストリームの管理操作は対象外とする。allowlist への追記漏れで外部プレイヤーが 401 にならないよう、`test/ut/auth.test.js` が `/videos`・`/streams`・`/iptv` 配下の実ルートと突き合わせる。

- **タグリリースへ可変な Mirakurun branch HEAD が混入する問題を修正 (Issue #27)**: `release.yml` と `build-validation.yml` が共有する Mirakurun revision を `.github/mirakurun-revision` の commit SHA へ固定し、CI 上の EPGStation 側の依存導入を `npm ci` へ変更した (`npm run all-install` はワンクリック更新でも使うため `npm i` のまま残し、CI だけが `npm ci` を直接呼ぶ。Mirakurun は lockfile を持たないため `npm install` のまま)。配布する EPGStation には EPGStation/Mirakurun の commit と両 lockfile の SHA-256 を `build-manifest.txt` として同梱する。

- **録画削除時の DB 失敗による実ファイル欠損を防止**: 録画・サムネイル・動画・視聴履歴・シリーズ関連・ドロップログの DB 削除を 1 トランザクションへ統合し、実ファイルは同一 filesystem 内へ一時退避してから DB を削除する。DB 失敗時は退避ファイルを元へ戻し、成功イベントを発行しない。退避後の unlink 失敗は削除イベントを発行してから `RecordedDeleteCleanupRequired` として要清掃扱いにする (DB 上は消えているため画面へ反映させる)。動画ファイルのパスが解決できない壊れたレコードは、実ファイルを残したまま DB 側の削除を続行して消せなくならないようにする。中断で残った退避ファイル (`.<ファイル名>.deleting-<recordedId>-<n>`) は録画ファイルのクリーンアップが掃除する。Issue #26。

- **イベントリレー予約の並行処理で同一番組が二重予約される問題を修正**: `ReservationManageModel.addEventRelay()` の `programId` 重複確認を予約追加の実行権取得後へ移動し、確認・予約生成・競合確認・INSERTを同じロック内で直列化した。例外時も `try/finally` で実行権を解放する。Issue #25。

## 2026-08-24

- **サムネイル後処理の失敗で生成キューが停止する問題を修正**: thumbnail command 終了後の resize・wide DB 登録・meta 保存で発生した例外を `create()` の reject へ伝播し、`queuedRecordedIds` の解除と後続ジョブの実行を保証する。失敗時は新世代の DB 行・画像を除去し、旧世代の DB 行を復元する。

- **ffprobe の無期限ハングを防止**: `VideoUtil` のメタデータ・チャプター・音声トラック・旧動画情報取得を共通実行経路へ集約し、既定 30 秒 (設定 `ffprobeTimeout` で秒単位に変更可、下限 1 秒) の timeout と `SIGKILL` を設定。壊れた動画や応答しないストレージで 1 件が停止しても、API は reject し、一括解析は既存の失敗処理で後続ファイルへ進む。

- **VideoFile差替え後のサムネイル世代管理を追加**: Thumbnailへ生成元の`videoFileId`・ファイルサイズ・解析時刻を保存し、録画ごとに`encoded`を優先して代表VideoFileを再選択する。録画完了、VideoFile追加・サイズ更新、メタデータ解析後に録画単位でキューへ入れ、生成前に同一世代ならスキップ、世代が変わればposter/wideを置換する。サムネイルAPIは`Last-Modified`を返す。実装は`ThumbnailManageModel.ts`、`ThumbnailDB.ts`、`EventSetter.ts`、`src/db/migrations/{sqlite,mysql}/1787541900000-AddThumbnailVideoFileGeneration.ts`。

- **SNSリアクションのAPI仕様差異を修正**: Misskeyのリアクション作成・削除は204 No Contentを返すため、JSON本文なしのPOST処理を追加。別リアクションへの変更は削除後に追加する順序へ統一。Blueskyはタイムラインの`viewer.like`/`viewer.repost`のAT URIを共通型へ保持し、既存likeの解除に利用する。Blueskyの定期取得では既存ノートのリアクション数・自分のlike/repost状態も更新する。

- **長時間録画のサムネイル候補抽出を高速化**: balanced / quality が録画の5〜95%区間を先頭から連続デコードしていたため、長時間TS・HEVCでは候補生成が番組尺に比例して遅くなっていた。候補時刻ごとの FFmpeg input-side `-ss` + 1フレーム抽出へ変更し、ディスクI/O過負荷を避ける最大3並列で実行する。個別候補の失敗は成功候補を残し、全候補失敗だけ既存fallbackへ戻す。候補単位timeoutは120秒。APIでprofile未指定時は `thumbnailProfile` (未設定ならbalanced) を全分岐へ適用する。

- **サムネイル探索範囲を設定可能にした**: `thumbnailSearchDuration` (秒、既定1200=20分、0で全編) を追加。録画先頭から指定範囲の5〜95%を候補にし、短い録画は全体を使う。設定画面から再起動なしで変更可能。

- **同じ動画のサムネイル二重生成を防止**: 録画完了と定期掃除など複数経路から同じ `videoFileId` が近接して投入されると、同じ画像を二重生成していた。待機中・実行中のIDを `ThumbnailManageModel` で保持して重複投入を無視し、成功・失敗を問わず完了後に解除して再生成は妨げない。

- **エンコード済み動画のサムネイルからCMを除外**: 埋込またはsidecarチャプターのタイトルが `CM` で始まる区間と境界前後0.5秒を候補から除外する。全候補がCMなら非CMチャプター中央で補完し、補完不能時だけ通常候補へ戻す。生TSはチャプターを読まず、読取失敗も生成を継続する。全件・録画単位の再生成は最新IDのencoded動画を優先し、無ければ従来の先頭動画を使う。候補生成とFFmpeg抽出は同じ確定済み候補配列を共有する。

## 2026-08-23

- **長時間TSのサムネイル候補解析タイムアウトを延長**: インデックスのないHEVC TSで27分区間を解析すると120秒では不足するため、候補抽出・画像生成・リサイズのFFmpegタイムアウトを1時間へ統一。無限待機は避けつつ、通常の長時間録画をfallbackへ落とさない。

- **エンコード完了時のサムネイル更新を標準処理へ統一**: エンコード出力の登録後、録画にある既存サムネイルのDB行と画像を削除し、新しい `videoFileId` を明示してV1.7.1のThumbnailManageModelへ再生成を依頼する内部IPC経路を追加。単純なキュー追加では既存サムネイルが残り「更新」されなかった問題を修正した。指定動画が同じ録画に属することも削除前に検証する。設定した外部 `update_thumbnail` スクリプトに依存しないようにし、旧スクリプトのテンプレートと実装を削除した。

## 2026-08-22

- **短時間・duration誤推定録画のサムネイル候補を修正**: 実ファイルより長い duration で候補が空になる場合、先頭区間へ FFmpeg 抽出を再試行し、短時間動画は中央1候補へ縮退する。候補0件は `thumbnailPosition` → 中央 → 0秒付近の fallback を通る。

- **サムネイル V1.6 の実画像評価と実TS抽出を追加**: FFmpeg を候補区間で一度だけ起動し RGB24 フレームを抽出、brightness / contrast / sharpness / edge / blackRatio を解析して最高スコアを採用する。poster 保存幅設定 (`thumbnailPosterWidth`, 既定 1280)、wide 640px リサイズ、低品質・解析失敗時の legacy 位置 fallback、debug スコアログ、`meta/<recordedId>.json` を追加。FFmpeg timeout と解析失敗は録画処理へ伝播させない。

- **録画サムネイル V1 を拡張**: 候補時刻生成、差し替え可能な `ThumbnailScorer`、poster / wide variant、JPEG / WebP、幅・高さ・相対時刻・スコア・生成形式の保存、録画単位の非同期再生成 API (`POST /api/videos/{recordedId}/thumbnail/regenerate`) を追加。旧 `filePath` と JPEG 設定は維持。候補画像の高度な画像解析、永続ジョブ、AI は V2 以降。

- **tsreplace 出力の `video_file.startAt` が数分ずれることがあったのを直した (ファイル先頭時刻の採用条件)**: `TsInfoAnalyzer.resolveFileStartAt()` は 「先頭を読み直した TDT/TOT」と「中央から実測バイトレートで遡った見積もり」が 5 分以上食い違うと**見積もりの方を採って**いた。しかし見積もりは「ファイル全体が一定ビットレート」を前提にしているため、tsreplace の HEVC 出力のような VBR ファイルでは中央区間のビットレートを全体に外挿することになり大きく外れる。実測では head `08:29:41` / estimated `08:21:52` の **7 分 48 秒差**で、ファイル名の録画時刻 (17:30 JST) と突き合わせると head が正しかった。先頭で実際に読んだ値を常に優先し、見積もりは先頭が読めなかったときの代替に降格した。先頭の時刻が中央の時刻より後になる場合 (時系列としてあり得ない) だけ、壊れた TDT/TOT とみなして見積もりへ退避する。これは `TsPlaybackTimeResolver` の前提 (`firstTdtAt` = 対象サービスの先頭 PCR の実時刻) が成り立つのが先頭読み経路だけであることとも整合する — 見積もり経路ではアンカーが別物になり、PTS−PCR 差の補正が土台から狂っていた。

- **Web API の約 20 本のルートが登録されず 404 になっていたのを直した (ログ表示・録画詳細・シリーズ・予約・ルール・番組表詳細など)**: `api.yml` に `nullable: true` と `allOf: [$ref]` を持ち `type` を書いていないスキーマが 22 箇所あり、express-openapi が使う ajv が `"nullable" cannot be used without "type"` で例外を投げていた。`openapi.initialize()` は非同期にルートを登録するため、この例外で**登録が途中で打ち切られる**。さらに `ServiceExecutor` の `uncaughtException` ハンドラがプロセスを落とさずログだけ出すため、**サーバーは生きたまま一部のルートだけが未登録**という状態になり、`/api/logs/{logFileId}`・`/api/recorded/{recordedId}`・`/api/series/{seriesId}` などが Express 既定の `Cannot GET` (404) を返していた。express-openapi 自身が張る `/api/docs` も未登録だった。該当 22 箇所へ参照先スキーマの型 (`integer` / `object` / `string`) を明記して解消した。OpenAPI 3.0 の `nullable` は型に対する修飾なので、`allOf` の隣に単独で置くのは元々不正。静的パスのルートと `/api/streams`・`/api/videos` 系が動いていたため、**全体障害に見えず気付きにくい**壊れ方だった。

- **tsreplace 出力を含む録画の `video_file.startAt` を「再生位置 0 秒 = 最初の映像 PTS」の実時刻へ合わせ、ニコニコ実況の過去ログ同期を正確にした**: 従来の TDT/TOT + PCR 補正は TS 先頭付近の PCR の実時刻を求めるところまでは正しかったが、tsreplace 等で映像 PTS/PCR が再構成されると最初に表示される映像 PTS と先頭 PCR にオフセットが残り、コメントが数秒ずれる。対象サービスの PMT から PCR_PID を特定し、先頭 PCR と最初の映像 PTS (無ければ音声 PTS) の差を 27MHz 時間軸で求め、`startAt = firstTdtAt + (firstMediaPTS - firstPCR)` として保存する `TsPlaybackTimeResolver` を追加。33bit wrap に対応し、5 分超の不自然な差・必要情報不足時は従来の `firstTdtAt` へフォールバックする。さらに `EncodeFinishModel` で `addVideoFile()` 直後に `analyzeAll()` を実行し、tsreplace 出力も登録直後に TS/ffprobe を解析して `startAt` を埋める。外部で作った tsreplace の `.ts` を取り込む経路も、`fileType` ではなく拡張子で PSI/SI 解析の可否を判定するように直した。既存 tsreplace ファイルは TS 再解析で更新できる。

- **実機 (localhost:8888、実際の Misskey アカウント) で利用者から報告された 2 件の不具合・不満を直した (画像添付投稿の失敗 / 分割表示が既定 OFF で導線も遠い)**。
  **(1) 画像を添付すると投稿が必ず失敗するバグ**: 事前の仮説は `MisskeyClient.uploadFile()` が `new Blob([...])` に MIME type を渡していないこと (`application/octet-stream` として送られる) だったが、**実機で 1x1 の小さい PNG を実際に添付してみたところ普通に成功した** ため、この仮説は主原因ではないと判断し切り分けを続けた。次に**実際のキャプチャに近いサイズ (78KB 〜 160KB の JPEG) で試したところ、`POST /api/sns/post` が Misskey まで届く前に `413 Payload Too Large` (プレーンな HTML) を返すことを実機で確認した**。原因は `ServiceServer.ts` の `openapi.initialize()` に渡している `consumesMiddleware['application/json']` が `express.json()` を**オプション無しで**使っていたこと — **既定の上限は 100kb** で、SNS 投稿は画像を data URL (base64) のまま JSON ボディに乗せて送るため、`SnsCaptureAttachment.vue` の 1 枚の上限 (`TARGET_MAX_BYTES` = 1.9MB、base64 で約 2.5MB) は言うに及ばず、数十 KB の JPEG 1 枚でも確実に超過して 413 になる。**画像添付は原理的に一度も成功したことがなかった不具合**。修正は `ServiceServer.JSON_BODY_LIMIT` (`'20mb'`、4 枚 × 約 2.5MB + 本文の余裕を見た値) を定義し `express.json({ limit: ServiceServer.JSON_BODY_LIMIT })` として渡すだけ (この limit は全 JSON エンドポイント共通。他の JSON API のボディは全て数 KB 未満なので実害なし)。**実機で最終確認**: 修正前は 160KB の JPEG 添付で確実に 413、修正後は同じ画像で `POST /api/sns/post` が実際に Misskey へ投稿され `isSuccess:true` + 実在の note URL を返すことを確認した。**MIME type 未指定の Blob も (実害は確認できなかったが) 技術的には誤りなので合わせて直した**: `IMisskeyClient.uploadFile()` に `mimeType` 引数を追加し、`SnsApiModel.postToMisskey()` が data URL から取り出した実際の MIME type (`DecodedImage.mimeType`) をそのまま渡すようにした。**エラー文言の改善**: `SnsApiModel.describeError()` が Misskey のエラーで `message` (detail) だけを返し `code` を捨てていたため、`INVALID_PARAM` なのか容量超過なのか画面から判断できなかった。権限不足以外の `MisskeyApiError` も `` `${code}: ${detail}` `` の形で返すようにした (`test/ut/sns-api-model.test.js` の既存アサーションを新フォーマットに追随)。**回帰テスト**: `test/ut/misskey-client.test.js` (Blob の `type` が渡した mimeType になっていることを確認)、`test/ut/sns-api-model.test.js` (mime type がそのまま `uploadFile()` へ渡ること、エラー `detail` に `code` が含まれること)、`test/itb/service-server-json-body-limit.test.js` (新規。100kb を超える実際の JSON ボディが `ServiceServer.JSON_BODY_LIMIT` 込みの `express.json()` では通り、既定設定 (limit 未指定) では 413 になることを両方確認する回帰テスト。**`ServiceServer.js` は ut のカバレッジ計測対象に含めると 27% 前後の低いカバレッジで全体を 80% ゲート未満に落とすため、あえて itb に置いた** — ut に置いて実際に確認済み)。
  **(2) 投稿とタイムラインの同時表示が実質使われていない不満**: 設定 `snsUseSplitPanelView` の既定値が `false` (タブ切替) で、切り替え導線も設定画面の奥にしかなく「同時表示できることに気づけない」状態だった。**既定値を `true` (分割) に変更** (`SettingStorageModel.getDefaultValue()`)。**`SnsPostPanel.vue` のタブ行 (`v-btn-toggle` があった場所) にアイコンボタンを追加**し、パネルから直接「分割」⇔「タブ切替」を切り替えられるようにした (`mdi-view-split-horizontal` / `mdi-tab`、押すと `settingStorageModel.tmp.snsUseSplitPanelView` を反転して即 `save()` — `WatchSidePanel.selectTab()` と同じ「`tmp` を書き換えてその場で `save()`」パターンで、`Settings.vue` の未保存トラッキングとは別経路)。**狭い端末 (`isMobile === true`) ではボタン自体を出さない**: `isSplitView` が狭い端末では常に `false` 固定 (分割すると両方使えなくなるため) のため、そこで設定を切り替えても見た目が変わらず利用者を混乱させるだけと判断した (タブレットを横向きにして `smAndDown` を跨いだ場合は設定が効くが、その状態は元々ボタンを出していない画面幅からの操作ではないため実害なしと判断)。分割時の最小高さ・ドラッグ可動域 (20%〜80%) は既存実装のまま (壊れていなかったので変更なし)。**検証**: `cd client && npm run build` (vue-tsc + vite build) 通過。WebKit 実測は下記参照。

- **実機 (localhost:8888、実際の Misskey アカウント) で「投稿・リアクション・画像アップロードが全部失敗する」報告を受けて原因を切り分け、2 つの実バグを直した**。
  **(1) 投稿が必ず失敗するバグ**: `MisskeyClient.createNote()` / `renote()` が `/api/notes/create` の応答を `body.id` (直下) で読んでいたが、**実際の Misskey は応答を `{ createdNote: { id: ... } }` でラップして返す** (実機の misskey.io で確認。`POST /api/endpoint {"endpoint":"notes/create"}` で取れるパラメータ一覧に `noCreatedNote` フラグがあり、これを明示的に渡さない限り `createdNote` が付くことも裏付けとして確認した)。既存の単体テストは `{ id: 'note1' }` という**実機と食い違う形をモックしており**、この乖離に誰も気づけない状態だった。`extractNoteId()` を切り出し `body.createdNote?.id ?? body.id` (後方互換のためフラットな id も拾う) に変更。`test/ut/misskey-client.test.js` / `misskey-client-timeline.test.js` のモック応答を実機準拠 (`createdNote` ラップ) に修正し、ラップ無し (フラット) ・両方無しのケースを新規テストで追加。**実機で修正前後を確認**: 修正前は `POST /api/sns/post` が常に `{"isSuccess":false,"detail":"note id is missing"}` を返し (画像添付時も同じ)、修正後は同じアカウント・同じ入力で実際に Misskey へノートが作成され `isSuccess:true` + 実在の note URL が返ることを確認 (検証用に作った投稿は `notes/delete` で削除済み)。
  **(2) リアクションが必ず失敗するバグ / 権限不足の一般問題**: `MisskeyAuthModel.PERMISSIONS` に `write:reactions` が無く、`notes/reactions/create` が実機で **`403 { "error": { "code": "PERMISSION_DENIED", "message": "Your app does not have the necessary permissions to use this endpoint." } }`** を返すことを確認。`write:notes` / `write:drive` / `read:account` / `read:channels` は実機で単体動作確認済み (`notes/create` 200、`drive/files/create` 200、`i` 200、`notes/timeline` 系は permission 不要と確認) だったため、要求権限に `write:reactions` を追加するだけで直る。**ただし MiAuth は permission がトークン発行時に固定される仕様**のため、権限リストを直しただけでは**既に連携済みのアカウントのトークンは古い権限のまま**で直らない (再連携が必要)。「画像のアップロード権限がない」という 3 つ目の報告は、テスト用アカウント (write:drive を含む形で連携済み) では再現しなかったが、性質としては (2) と同じ「連携時点で要求していなかった権限が後から必要になった」クラスの不具合であり、将来 `write:drive` 等を新規追加したときにも同じ現象が起き得る。そのため**個別の場当たり対応ではなく、汎用の「連携時点の権限を記録し、現在の要求権限を満たさなければ再連携を促す」仕組み**を実装した:
  - `sns_account` に `grantedPermissions` (text, nullable。連携時点で実際に要求した permission の JSON 配列) を追加 (`src/db/migrations/{sqlite,mysql}/1785112*-AddSnsAccountGrantedPermissions.ts`)。`IMisskeyAuthModel.completeSession()` の戻り値に `grantedPermissions` を追加し、`SnsApiModel.completeMisskeyAuth()` が連携/再連携のたびにこのカラムへ書き込む。
  - `IMisskeyAuthModel.getRequiredPermissions()` で「現在アプリが要求している permission 一覧」を取得できるようにし、`SnsApiModel.getReauthReason(row)` が misskey アカウントについて `grantedPermissions ⊇ getRequiredPermissions()` を満たすか判定する。満たさない (このカラムが無かった頃に連携された `null` の行も含む) 場合は再連携対象にする。
  - 再連携の理由を `SnsAccountItem.needsReauthReason` (`'encryption' | 'permission' | null`、`api.yml` / `api.d.ts`) として追加。既存の `needsReauth` (credential が復号できない = 鍵ローテーション由来) と統合し、`needsReauth = (reason !== null)`。クライアント (`SnsAccounts.vue` の「要再連携」チップ、`SnsAccountSelector.vue` の警告アイコン) は既存の「要再連携」表示・再連携ボタン (MiAuth フローを開き直すだけで、連携済みなら上書き更新される) をそのまま使えたため、UI 側は理由に応じた tooltip 文言の追加のみで済んだ。
  - Misskey の権限不足エラー (`PERMISSION_DENIED` / `CREDENTIAL_REQUIRED` / `ACCESS_DENIED`) を検出したら、`SnsApiModel` の `describeError()` が「Misskey 側の権限が不足しています。アカウントの再連携が必要です (code: message)」という文言に変換して返すようにした (投稿・リアクション・リノートいずれの失敗パスも同じ関数を通る)。
  **最終的な要求権限**: `write:notes` (notes/create) / `write:drive` (drive/files/create) / `read:account` (i) / `read:channels` (channels/followed, channels/owned) / `write:reactions` (notes/reactions/create, notes/reactions/delete)。timeline 系 (`notes/timeline` / `notes/hybrid-timeline` / `notes/local-timeline` / `channels/timeline`) と `emojis` は実機で追加権限を要求しないことを確認済みなので含めない。
  **実機での最終確認**: 修正後のビルドで `POST /api/sns/post` (テキストのみ / 画像添付) が両方とも実際に Misskey へ投稿され成功することを確認。連携済みアカウントは `grantedPermissions` が未記録 (このカラム追加前の連携) のため `GET /api/sns/accounts` で `needsReauth: true, needsReauthReason: "permission"` と正しく表示されることを確認し、実際にリアクション (`POST /api/sns/reaction`) を試すと従来どおり `PERMISSION_DENIED` で失敗するが、返る `detail` が再連携を促す文言に変わったことを確認した。**再連携そのもの (MiAuth の承認画面でのクリック) は人間の操作が要るためこのセッションでは完了させられていない** — セッション作成 (`POST /api/sns/misskey/auth`) して認可 URL を作るところまでは実機で動作確認したが、承認後に `write:reactions` 込みの新トークンで実際にリアクションが成功することまでは未確認のまま (ユーザーが一度承認すれば、上記の仕組みにより自動的に `grantedPermissions` が更新され `needsReauth` が解消する設計)。
  **検証**: `npm run compile` / `npm test` (ut + ita 85 件 pass、行カバレッジ 80.59% で 80% ゲート通過)、`cd client && npm run build` 通過。

- **SNS 投稿パネルを実機 (localhost:8888、実際の Misskey アカウント) で使って出た 4 つの不満を直した**: 上の 3 エントリ (基礎投稿 + フェーズ 2 サーバー/クライアント) で作った機能を、実際に misskey.io の連携アカウントで使ってみて出た不具合・使いにくさの修正。
  **(1) タイムラインのリアクションが `:name:` のテキストのままで絵文字にならない不具合を修正**: 原因は `MisskeyTimelineConverter.convertMisskeyNoteToTimelineNote()` が `note.reactionEmojis` を**短縮名だけ**で引いていたこと。Misskey の実際のレスポンスでは `reactionEmojis` のキーが**リモート絵文字だと `name@host`**、**ローカルだと `name`** で揃っており (`reactions` 側のキーは `:name@host:` / `:name@.:` の形)、`@` 以降を落として引くとリモート絵文字が必ず外れて `url: null` になり、クライアントが `:name:` をそのまま表示していた。**解決順序を 3 段にした** (`MisskeyTimelineConverter.ts` の JSDoc に理由ごと明記): ① `reactionEmojis['name@host']` (host が `.` = ローカル慣習表記のときは対象外) → ② `reactionEmojis['name']` → ③ 呼び出し側が渡す `resolveEmojiUrl(name)` (インスタンス単位の絵文字キャッシュ、`MisskeyClient.getEmojis()`)。③ が要る理由は**WebSocket ストリーミング経由の note には `reactionEmojis` 自体が入っていないことがある**ため (`SnsTimelineRelayManageModel.onUpstreamMessage()` を async 化し、`misskeyClient.getEmojis(current.host)` (TTL 1h キャッシュ済みなので実質ローカル参照) で解決してから変換するようにした。DI 依存 `IMisskeyClient` をコンストラクタ**末尾** (非 DI の `reconnectDelayFn` の直前) に追加し、`test/ut/sns-timeline-relay-manage-model.test.js` の `makeModel()` にも `misskeyClient` スタブを追加した)。REST 版 (`SnsApiModel.getTimeline()`) も同様に `getTimeline()` と `getEmojis()` を `Promise.all` で並行取得し、絵文字名 → URL の `Map` を作って③のフォールバックに渡す。**Unicode 絵文字リアクション (`👍` 等) はそもそも `:name:` 形式にマッチしないため対象外** (これは正常動作で、文字そのままを表示する従来の挙動を維持)。クライアント側 (`SnsTimelineNoteCard.vue`) も、サーバーが `url: null` を返してきた場合に備えて**手元の `emojiMap` (本文の `:name:` 解決と同じもの) から名前で再解決を試み、それでも駄目なら `:` を外した短い名前 (host 部分も除く) を出す**ように `resolveReactionUrl()` / `reactionDisplayText()` を追加 (生の `:name@host:` をそのまま出さない)。絵文字ピッカーからのリアクション追加 (`SnsTimelinePanel.applyReactionOptimistic()`) は元々ローカルの `this.emojis` から `url` を引いて楽観更新していたため変更不要 (確認のみ)。**回帰テスト** (`test/ut/misskey-timeline-converter.test.js` に追加): リモート絵文字 (`name@host` キー)・ローカル絵文字 (`name` キー)・Unicode 絵文字 (url 常に null)・`reactionEmojis` が空でも `resolveEmojiUrl` で解決できる/できない場合の計 6 パターン。
  **(2) 絵文字ピッカー (`SnsEmojiPicker.vue`) のカテゴリ chip 行が数十〜数百件で画面を埋めて使い物にならないのを直した**: **検索を主役にする**方向で再設計。① 検索欄は `autofocus` HTML 属性 (v-menu のように動的にマウントされる要素では初回しか効かない実装がブラウザにあり、2 回目以降の open で効かなくなる) をやめ、`mounted()` で既存の `VuetifyUtil.focusTextFiled()` (`RecordedSearchMenu.vue` 等と同じ流儀) を呼ぶようにした。② カテゴリの chip 羅列を `v-autocomplete` (検索で絞り込めるドロップダウン) に変更。③ **「よく使う」を追加**: 選んだ絵文字の名前を `ISettingStorageModel` の新設定 `snsRecentEmojiNames` (新しい順、上限 30 件、直接使用箇所と同じ `.tmp` 書き換え + `save()` の即時反映パターン) に積み、検索していないときに先頭で表示する。④ 検索前の一覧は「よく使う」+ 先頭 40 件 (`PREVIEW_LIMIT`、旧 `DISPLAY_LIMIT=200` は検索中のみ適用) に絞り、「N 件。検索してください」の案内を出す。⑤ グリッドは `repeat(auto-fill, minmax(36px,1fr))` のままで狭い端末でも潰れない。**実機確認**: misskey.io の実アカウントで 13362 件の絵文字が返る状態でも、検索欄のオートフォーカス・「よく使う」への即時反映 (選択 → リロード後も保持)・カテゴリドロップダウンへの畳み込みを確認 (WebKit 実測は下記)。
  **(3) 投稿とタイムラインを同時に見たい (縦分割表示) を追加**: `SnsPostPanel.vue` の `activeTab` によるタブ排他切替に加え、設定 `snsUseSplitPanelView` (既定 false) が有効かつ **`$vuetify.display.smAndDown === false` (狭い端末では強制的にタブ切替のまま)** のときは投稿フォームとタイムラインを上下に同時マウントする。分割位置はドラッグで変えられる (`snsSplitPanelRatio`、可動域 20%〜80%)。**新規 npm 依存を足さず pointer イベントで実装**: divider の `pointerdown` で `setPointerCapture()` を取り (カーソルが divider の外へ出てもドラッグを継続できる)、`pointermove` で `(clientY 移動量) / (コンテナ高さ)` を比率へ変換して `settingStorageModel.tmp.snsSplitPanelRatio` に都度反映 (即座に再描画されるが `localStorage` への `save()` は `pointerup` まで待って 1 回だけ行う)。ハンドラは**すべてメソッドをテンプレートの `v-on` へ直接束縛** (フィールドの bind コールバックにしていない)。**投稿フォームはタブ切替中でも常にマウントしたまま `v-show` で出し分けるよう変更した** (以前は `v-if` で、タブを切り替えるだけで `SnsCaptureAttachment` が unmount され、内部で保持している「まだ添付/投稿していないキャプチャ」の一覧が消えてしまうバグを合わせて踏んでいた。分割表示の実装で「タブ状態に関わらず投稿フォームを裏で保持する」必要が生じたため、ついでに直した)。**タイムライン (`SnsTimelinePanel`) は表示されているときだけ `v-if` でマウントする** (同時表示では常時、タブ切替ではタブが `timeline` のときだけ) — WebSocket 購読 / ポーリングを止める既存の `unmounted()` の挙動をタブ切替時も維持するため。設定は `Settings.vue` の SNS 投稿セクションにスイッチを追加。
  **(4) 本文に `:name:` と書いたらライブプレビューする機能を追加**: `textarea` は contenteditable 化すると IME・カーソル管理が壊れるため、**`textarea` の直下に別領域**を設け、既存の `MfmText.vue` + `MfmRenderUtil.parseMfm()` (**`v-html` は使わない**、自前ノード描画) でリアルタイム描画する。本文が空、または設定 `snsEnableComposePreview` (既定 true、`Settings.vue` から切替可) が false なら非表示。**絵文字一覧は二重取得しない**: 元々「絵文字ピッカーを開いたタイミングで初めて `composerEmojis` を取得する」実装だったのを `fetchComposerEmojisIfNeeded()` に切り出し、**Misskey アカウントの選択が変わった時点で先に取得**し (プレビューはピッカーを開く前から必要なため)、ピッカーを開いたときは同じ関数を呼ぶだけ (取得済みならフェッチしない、`ISnsTimelineState` 側のアカウント単位キャッシュとは別に in-flight ガード `composerEmojisFetchingAccountId` で同時多重呼び出しも防ぐ)。
  **実機検証 (最重要)**: `node dist/index.js` を実 DB (sqlite、misskey.io と連携済みの実アカウント 1 件) で起動し、`GET /api/sns/timeline` を直接叩いて全リアクション (ローカル `:name@.:` 形式・リモート `:name@host:` 形式) の `url` が実在の画像 URL に解決されることを確認 (Unicode の `❤` だけ `null` のままで正常)。WebKit (Chromium ではなく実機と同じレンダリングエンジン) でライブ視聴画面 (`#/onair/watch?...`) から実際に SNS タブを開き、**タイムラインのリアクションが実際に画像として表示されるスクリーンショットを取得** (「おはよー!」等のカスタム絵文字が `:name:` テキストではなく画像で描画されている)。縦分割表示 (投稿フォーム + タイムラインが同一画面に同時に見える)・本文プレビュー (`:ohayoo: **強調**` → 絵文字画像 + 強調表示) も同様にスクリーンショットで確認。**WebKit 実測** (iPhone SE 320x568 / iPhone 14 Pro 393x660、実データ・実アカウントに対して実施): 絵文字ピッカーの検索欄・カテゴリドロップダウン・グリッド・絵文字セルがすべて `boundingBox()` でビューポート内に収まり `click()` できること、検索欄が実際にオートフォーカスされていること (`document.activeElement` で確認)、狭い端末では分割表示が有効にならずタブ切替のままであること、タイムラインのリアクション画像が狭い端末でも表示されることを確認。**検証**: `npm run compile` / `npm test` (ut + ita 84 件 pass、行カバレッジ 80.55% で 80% ゲート通過)、`cd client && npm run build` (vue-tsc + vite build) 通過。

- **SNS 投稿パネルにタイムライン表示・リアクション・カスタム絵文字のサーバー側を追加した**: 基礎の投稿機能 (前日分) に対する拡張フェーズ 2。クライアント側 (キャプチャ管理・TL 描画・MFM パーサ・装飾ピッカー) は別作業。**サーバー側の担当範囲は次の 4 つ**。
  (1) **`MisskeyClient` の拡張**: `getEmojis(host)` (`GET /api/emojis`、認証不要) は**インスタンス単位でメモリキャッシュ** (TTL 1 時間、host ごとに独立、TTL 判定用の `now` 引数はテスト用のオプション)。`getTimeline(host, token, option)` は `type` で `/api/notes/timeline` (home) / `/api/notes/hybrid-timeline` (social) / `/api/notes/local-timeline` (local) / `/api/channels/timeline` (channel、`channelId` 必須) を切り替え、`limit` は 1〜50 にクランプ。ノート応答は 1 件の欠損で全体を落とさないよう緩く変換する (`toNote()`)。`createReaction` / `deleteReaction` / `renote` (本文なしの `/api/notes/create` + `renoteId`) を追加。
  (2) **`BlueskyClient` の拡張**: `getTimeline` (`app.bsky.feed.getTimeline`)、`like` / `deleteLike`、`repost` / `deleteRepost` (`app.bsky.feed.like` / `app.bsky.feed.repost` への `createRecord` / `deleteRecord`)。**401 の再ログイン経路を `withBlueskyRetry()` として切り出し**、`createPost` を含むすべての Bluesky 呼び出しが同じ経路 (refresh → 失敗なら保存済み App Password で再ログイン) を通るようにリファクタした。
  (3) **provider の差を吸収した共通形 `SnsTimelineNote` / `SnsTimeline` を `api.d.ts` / `api.yml` に定義**し (仕様は指示元のフェーズ 2 仕様書)、変換は純粋関数 `src/model/sns/MisskeyTimelineConverter.ts` / `BlueskyTimelineConverter.ts` に切り出した (`SnsApiModel` と WebSocket 中継の両方から使う)。**割り切り**: Misskey の「本文もファイルも持たない純粋なリノート」は参照先の本文・添付・CW を借りて表示する (孫リノートは遡らない)。`isRenotedByMe` は Misskey 側に対応フィールドが無いため常に `false`。Bluesky は CW 相当の概念が無いため `cw` は常に `null`、センシティブ判定は `labels` の有無だけで見る (種別は区別しない)、reactions は like を 1 件 (`name: '❤'`) として詰める。API は `GET /api/sns/timeline` (`accountId` / `type` / `channelId` / `limit` / `cursor`)、`GET /api/sns/misskey/emojis` (`accountId`)、`POST`/`DELETE /api/sns/reaction`、`POST /api/sns/renote` の 5 本。**`SnsReactionOption` / `SnsRenoteOption` に `cid` (Bluesky の POST に必須。対象投稿の cid) と `reactionKey` (Bluesky の DELETE に必須) を追加した** — Bluesky の like/repost の取り消しは AT Protocol 上「作成したレコード自身の rkey」が要るため、`like()`/`repost()` の戻り値 (作成したレコードの at-uri) から抽出した rkey を POST のレスポンス (`SnsReactionResult.reactionKey`) でクライアントへ返し、DELETE のときにそのまま送り返してもらう設計にした (仕様書の簡略表には無い追加フィールドだが、AT Protocol の削除 API の要件上必須)。renote の URL はリノート/repost レコード自身の rkey ではなく**元投稿の at-uri から** `buildBlueskyPostUrl()` で組み立てる (repost レコードの rkey で URL を作ると存在しない投稿を指してしまう)。addReaction/removeReaction/renote は provider 側の失敗を例外にせず `{ isSuccess: false, detail }` で返す (クライアントの楽観更新の巻き戻し用)。**API は 5 本の追加のみで、Bluesky の repost 取り消し (unrenote) に対応する DELETE エンドポイントは今回スコープ外** (`IBlueskyClient.deleteRepost` 自体は仕様どおり実装・単体テスト済みだが呼び出し口が無い。必要になったらフェーズを切って追加する)。
  (4) **Misskey リアルタイムタイムラインの WebSocket 中継**: `src/model/service/sns/SnsTimelineWebSocketServer.ts` が既存の `DataBroadcastingWebSocketServer` と全く同じ流儀で、Web API の http/https サーバーの `upgrade` イベントへ `noServer: true` で相乗りする (パスが `<subDirectory>/api/sns/ws` と一致しないリクエストの socket には一切触れない)。認証は `auth.enabled` のときだけ Cookie を検証し、`isAnonymousAllowed()` が false かつ未ログインなら 401 で reject。ログイン中なら `userId` を解決してハンドシェイク後の中継 (`SnsTimelineRelayManageModel`) へ渡す。中継本体は WebSocket 接続 1 本 = 1 セッションとして管理し、クライアントの `{ type: 'subscribe', accountId, timelineType, channelId? }` を受けて対象アカウントの**所有者 (`userId`) と provider (misskey のみ) を検証**してから上流 (`wss://<host>/streaming?i=<token>`) へ接続する。上流には `{ type: 'connect', body: { channel, id: <uuid>, params } }` を送り (`channel` は `home→homeTimeline` / `social→hybridTimeline` / `local→localTimeline` / `channel→channel`)、届いた `{ type: 'channel', body: { id, type: 'note', body } }` のうち **id が一致するものだけ** `SnsTimelineNote` へ変換して `{ type: 'note', note }` で下流へ流す (生の Misskey note は渡さない)。**購読変更のたびに既存の上流を必ず閉じてから張り直す** (多重接続防止)。上流が意図せず切れた場合は指数バックオフ (1s → 上限 30s、最大 10 回) で再接続し、同じ `connectId` を使い回す。上限を超えたら `{ type: 'error', message: 'SnsTimelineWsReconnectGaveUp' }` を通知して諦める。クライアント切断・`unsubscribe` メッセージ・再購読のいずれでも上流を確実に閉じる (`closeUpstream()`)。上流接続の生成は `IMisskeyStreamConnector` (`new WebSocket('wss://...')` を返すだけの薄いファクトリ) に切り出し、テストではフェイクの WebSocket 実装 (EventEmitter) に差し替えて購読検証・再接続・後始末を実ネットワークなしで検証している。
  **DI 登録**: `IMisskeyStreamConnector` / `ISnsTimelineRelayManageModel` / `ISnsTimelineWebSocketServer` を `ModelContainerSetter.ts` に追加 (いずれも `inSingletonScope`)。`ServiceServer` のコンストラクタ引数**末尾**に `ISnsTimelineWebSocketServer` を追加し、`start()` の末尾で `initialize(appServers)` を呼ぶ (`socketIoManageModel` / `dataBroadcastingWebSocketServer` と同じ `appServers` を共有)。
  **テスト**: `test/ut/misskey-timeline-converter.test.js` / `bluesky-timeline-converter.test.js` (変換の純粋関数)、`misskey-client-timeline.test.js` (絵文字キャッシュの TTL・host 分離・型変換の欠損耐性、TL の type 別パス切り替え、リアクション/リノート)、`bluesky-client-timeline.test.js` (TL 取得・like/repost の作成/削除・401 エラー)、`sns-api-model-timeline.test.js` (provider 分岐・cid/reactionKey 必須チェック・401 リトライ)、`sns-timeline-relay-manage-model.test.js` (所有者/provider/再認証の検証、多重接続しないこと、再接続の指数バックオフと上限、クライアント切断時の後始末、note 変換の転送)。**検証**: `npm run compile` / `npm test` (ut 1272 件 pass、行カバレッジ 80.53% で 80% ゲート通過。ita 84 件 pass)

- **SNS 投稿パネルのタイムライン表示・リアクション・絵文字/MFM 装飾ピッカーのクライアント側を仕上げた**: 上のサーバー側エントリの続き (フェーズ 2 クライアント担当分)。TL 描画 (`MfmText.vue` / `SnsTimelineNoteCard.vue` / `SnsTimelinePanel.vue`)・MFM 自前パーサ (`MfmRenderUtil.ts`)・WebSocket クライアント (`SnsTimelineSocket.ts`)・絵文字/装飾ピッカーの UI 部品 (`SnsEmojiPicker.vue` / `SnsMfmPicker.vue`) 自体は前担当が作成済みで、**`SnsPostPanel.vue` へ統合するところまでが今回**。サブタブ「投稿」/「タイムライン」(`activeTab`) を追加し、`SnsEmojiPicker` / `SnsMfmPicker` / `SnsTimelinePanel` を `@Component` の `components` へ登録 (前担当はテンプレートで参照するだけで登録漏れがあり `vue-tsc` が通らない状態だった)。**絵文字挿入 (`onInsertEmoji`) は本文 textarea の `selectionStart`/`selectionEnd` の位置に `:name:` を差し込みカーソルを直後へ**、**MFM 装飾挿入 (`onInsertDecoration`) は選択範囲があればその文字列を `prefix`/`suffix` で包み (`$[jelly 選択文字]` 等)、選択が無ければ記法を挿入して placeholder 部分を選択状態のまま残す** (続けてそのまま書き換えられるように)。textarea の実体は Vuetify の `v-textarea` ラッパーの中にあるため `(this.$refs.bodyTextarea as ComponentPublicInstance).$el.querySelector('textarea')` で取得し (`VuetifyUtil.focusTextFiled` と同じ流儀)、`bodyText` 書き換え後の DOM 反映を待ってから `$nextTick()` 後に `focus()` + `setSelectionRange()` している。絵文字一覧は `ISnsTimelineState.getMisskeyEmojis()` (既存のアカウント単位メモリキャッシュ) をそのまま再利用し、絵文字ピッカーを開いたタイミングで先頭の選択中 Misskey アカウント分だけ取得する (選択アカウントの組み合わせが変わったら次に開いたときに取得し直す)。ピッカーは Misskey アカウントを 1 つも選んでいなければ出さない (元々テンプレート側で `v-if` 済み)。**Bluesky の repost 取り消しはサーバー API が無い**ため、`SnsTimelinePanel.onRenote()` は `note.isRenotedByMe === true` のボタンを `disabled` にして `title` で理由を出すだけに留める設計を維持し (サーバー側は触っていない)、取り消し操作自体は追加していない。ついでに `SnsTimelinePanel.vue` の型エラー (`selectedAccount` が `| null` のまま `.provider` へアクセス) も、ノート一覧の `v-else` 条件を `selectedAccountId === null` から `selectedAccount === null` へ変え TS の control-flow narrowing が効くようにして直した。**検証**: `cd client && npm run build` (vue-tsc + vite build) が通ることを確認。WebKit (iPhone SE 320x568 / iPhone 14 Pro 393x660) で実機の `node dist/index.js` + 実 DB (sqlite、連携済み Misskey アカウント 1 件) に対し `GET /api/sns/accounts` 等をモックして検証: 絵文字ピッカー (`.sns-emoji-picker`) ・MFM 装飾ピッカー (`.sns-mfm-picker`) とも `.menu-card`/`.menu-card-body` の効果でボタン・グリッドが画面内に収まり `click()` できること、絵文字選択で `:name:` が挿入されること、装飾ピッカーは選択あり (`"hello world"` の `"hello"` を選択して太字 → `"**hello** world"`) と選択なし (空文本で斜体 → `"*斜体*"` になりプレースホルダ部分が選択状態) の両方が期待どおりになること、タイムラインタブのリアクション chip・追加ボタン・そこから開く絵文字ピッカー (v-menu は overlay ルートへ teleport されるため DOM 上は note カードの外に出る) がいずれも画面内でクリックできることを確認した。

## 2026-08-21

- **視聴画面から Bluesky / Misskey へ投稿できるようにした**: KonomiTV の Twitter 実況パネルを移植し、Misskey の連携は手動トークン貼り付けをやめて MiAuth によるワンクリック認証にした (KonomiTV に前例が無いため新規実装)。**Twitter は移植しない** (KonomiTV の実装は Cookie インポート方式で移植価値が無い)、**リプライツリー実況モードも移植しない**、**Bluesky は AT Protocol OAuth ではなく App Password 方式** (LAN 運用では公開 HTTPS の client metadata が用意できない) の 3 点が上流との主な違い。サーバー: `sns_account` テーブル (`provider` / `userId` (ログインユーザーごとに分離、匿名時は null の共有枠) / `credential` (`ISecretCrypto` で暗号化した JSON))、`src/model/sns/` に `BlueskyClient` (`com.atproto.*` を素の `IProviderHttpClient` 経由で叩く。401 は refreshJwt → 保存済み App Password の順で再試行) / `MisskeyClient` / `MisskeyAuthModel` (MiAuth のセッションはメモリ Map に TTL 10 分で持つだけで DB へは入れない) を追加し、`BlueskyFacetUtil.ts` (KonomiTV `BlueskyAPI.py` の `_buildTextBuilder` 移植、URL・ハッシュタグを byte 単位のインデックスで facet 化) で post 本文からリンク/タグの位置情報を作る。API は `GET/PUT/DELETE /api/sns/accounts`、`POST /api/sns/bluesky/login`、`POST /api/sns/misskey/auth` → 返った `authUrl` へ `location.href` で遷移 → 承認後 `GET /api/sns/misskey/callback` が 302 で `#/settings/sns?misskey=success|error` へ戻す、`GET /api/sns/misskey/channels`、`POST /api/sns/post` (アカウントごとの結果配列を返し、片方が失敗しても他方は残す)。クライアント: `client/src/util/ChannelHashtagData.ts` (KonomiTV `ChannelUtils.ts` の局タグ表を前方一致・長いキー優先で移植。NW1〜NW40 はチャンネル名が通常の地方局名になるため `channelType` では分岐しない) と `client/src/util/ProgramHashtagUtil.ts` (局タグ解決 / 番組概要・詳細からの `#タグ` 抽出 (話数表記 `#1` や `#16星の渡り鳥` は除外)。**自動で追記するタグは全角英数字を半角へ揃える** (`＃ステップＴＵＦ` → `#ステップTUF`) — 実況で使われているのは半角表記で、全角のまま投稿すると SNS 側で別のハッシュタグになり輪に入れないため。局タグの引き当ても放送波由来の全角局名 (`ＢＳ日テレ`) を半角へ揃えてから行う。**ユーザーが手で入力したタグの表記は変換しない**が、重複判定だけは半角へ揃えるので `#ＡＢＣ` と `#ABC` が二重に並ぶことはない。カタカナ・ひらがな・漢字は意味が変わるため半角カナへは倒さない / 合成 / 本文への差し込み位置 / 入力正規化の純粋関数群)。設定画面 `Settings.vue` に表示・自動追加系のトグル、専用ページ `SnsAccounts.vue` (`/settings/sns`) にアカウント連携・既定値設定を置き、視聴画面 (`WatchOnAir` / `WatchRecorded` / `WatchRecordedStreaming`) の右パネルへ `sns` タブと `SnsPostPanel.vue` (`client/src/components/watch/sns/`) を追加した。**ハッシュタグの自動合成は「番組が切り替わった契機」だけ行う** (同じ番組内での再合成はユーザーが手で消したタグを足し戻してしまうため、チャンネル名+番組名から作った識別キーで重複合成を防いでいる)。**ライブでチャンネルが切り替わったときは旧チャンネルの局タグだけをハッシュタグ欄から取り除く**。**Misskey の投稿オプション (公開範囲・チャンネル・ローカルのみ・CW) は投稿のたびに切り替えられる** (`SnsMisskeyOptions.vue`。パネルが縦に伸びないよう既定は折りたたみ、Misskey アカウントを 1 つも選んでいなければ出さない)。初期値はアカウントごとの既定値 (`SnsAccounts.vue` で設定) から入れ、サーバー側の `postToMisskey()` がリクエストで未指定のフィールドをその既定値へフォールバックする。**チャンネルを選ぶと公開範囲は `public` に強制される** (Misskey の仕様) ため、UI でも公開範囲トグルを `disabled` にして理由を添える。**複数の Misskey アカウントを同時に選んだときはオプションを一括適用し、チャンネルだけは選択不可にする** (インスタンスが違うとチャンネル ID が通用しないため。この場合は `channelId` を送らずアカウントごとの既定値に任せる)。**キャプチャ添付は canvas → JPEG** で、Bluesky の 2MB 上限に収まるよう品質 (0.92 → 0.35) → それでも収まらなければ解像度 (75% ずつ) の順に下げて再試行する (`SnsCaptureAttachment.vue`)。ハッシュタグのプリセット並べ替えは新規依存を足さず上下ボタンで実装した (`SnsHashtagPresets.vue`)。**実機検証**: ローカルで `node dist/index.js` を起動し実 DB (sqlite) に対して確認。Misskey の MiAuth 開始 (`POST /api/sns/misskey/auth` → `location.href` で `https://misskey.io/miauth/<session>?...` へ実際に遷移すること) とコールバックの成功・失敗 (`?misskey=success` / `?misskey=error&reason=...`) 双方でスナックバー表示とクエリのクリアを確認、ダミーの連携アカウント行を DB に直接挿入して投稿パネル (アカウント選択・本文・ハッシュタグ・キャプチャ・投稿ボタン) の描画も確認した (Bluesky / Misskey の実アカウントが無いため実投稿そのものは未検証)。**WebKit 実測**: iPhone SE (320x568) / iPhone 14 Pro (393x660) で `/settings/sns` の連携ボタン・ダイアログ、視聴画面の SNS タブ・投稿パネル一式が画面内に収まり `click()` できることを確認 (パネルはモバイルでは動画の下に積まれる縦スクロールレイアウトのため、タブ自体は初期スクロール位置より下にあるが、他のタブと同じ既存の挙動でありクリックで自動スクロールされる)

- **スマホ表示の一斉点検で見つかった見切れを直した**: 全 23 画面と開けるダイアログを WebKit の iPhone SE (320x568) / iPhone 14 Pro (393x660) で実測し、横溢れ・入力欄の潰れ・省略テキスト・画面外のボタンを機械的に洗い出した。主な原因は 3 つ。(1) **Vuetify の `.v-input` は既定が `flex: 1 1 auto`** なので、`d-flex` で横に並べると狭い端末では入力側だけが縮み、ラベルや選択値が読めなくなる (サーバー設定のログレベルが「シ.」「ア.」、シリーズ絞り込みが「ク...」「放...」、エンコード追加の source が 25px、視聴ストリーム選択が「M2TS-...」)。折り返してほしいものは `flex: 1 1 <基準幅>`、縮ませたくないものは `flex: 0 0 auto` を与えた。設定画面は説明側の div が縮まずスイッチが画面外へ押し出されていたため、説明側を `flex: 1 1 auto; min-width: 0` にした。(2) **`v-date-picker` は固定幅 328px** で、番組表の日付選択 (v-menu) は `.menu-card` も付いていなかったため、iPhone SE では**土曜日の列が画面外に出て選べなかった**。`.menu-card` を付けたうえで `width: 100%` にし、日付セル (grid の 1fr) ごと縮むようにした。(3) **`v-list-item-title` / `v-card-title` は nowrap + ellipsis**。設定項目名とシリーズカードの作品名が読めなくなるため、設定行は折り返し、シリーズのグリッド表示は 2 行までのクランプにした。あわせて、説明をラベルに書いていた項目 (「タグ (子孫タグも含めて絞り込み)」「読み仮名 (あいうえお順の並べ替えに使用)」) は**ラベルを短くして説明を hint へ移した**。シリーズ詳細はタイトルバーにアイコンが 3 つ並び、375px でも作品名が省略されていたため、**狭い端末では一括編集・分割をケバブメニューへ畳む** (`$vuetify.display.smAndDown`)。本番環境 (実データあり) でも同じ点検を行い、**シリーズ未確定キューのページャが左右にはみ出して前後ページのボタンを押せない**のを見つけた (`v-pagination` は折り返さないので、`total-visible: 7` + 先頭/最終ボタンでは 320px に収まらない)。狭い端末では表示数を 3 に減らし、先頭/最終ボタンを省く。点検スクリプトの最終結果は、ページ側の指摘 0 件 (URL 入力欄の値が横スクロールで読める分だけ残る)、ダイアログ側 0 件

- **番組表の全件更新が主キー重複で落ちるのを直した (Issue #17)**: `epgRetentionTime` で過去の番組を残す設定にしていると、`updateAll()` が `QueryFailedError: Duplicate entry '...' for key 'PRIMARY'` で失敗し、`update programs error` → `InsertError` を延々と出していた (MariaDB 環境で頻発。録画自体には影響しないが全件更新は毎回ロールバックされる)。全件更新の削除条件は「`endAt >= now` (これから放送する分) か `endAt < 保存期間のしきい値` (期限切れ)」なので、**保存期間内に終了した番組だけが DB に残る**。ところが Mirakurun は終了直後の番組もしばらく `GET /programs` に含めて返すため、残した番組がそのまま再挿入され主キーが衝突していた。`ProgramDB.insert()` が削除の直後に、**これから挿入する番組のうち終了済みのもの (`endAt < now`) の id を消す**ようにした (挿入対象の全 id ではなく終了済みだけを見るので `IN` は小さく収まる。分割単位は既存の `FIND_IDS_CHUNK_SIZE`)。同じトランザクションの中で行うため、失敗時は従来どおりまとめてロールバックされる。回帰テストは `test/ut/program-db-keep-duplicate.test.js`

- **バージョン表記と番組表の日付が見切れるのを直した (Issue #18)**: 原因は 2 つある。(1) **Vuetify の `.v-toolbar-title` は `flex: 1 1` (basis 0)** なので、後ろに置いた `v-spacer` と余った幅を**等分**してしまう。右側のメニューアイコンが 1〜2 個しか無くてもタイトルは画面の半分ほどで ellipsis され、iPhone では「番組表 08/...」と日付が読めなくなっていた。グローバルクラス `.app-bar-title` (`flex: 0 1 auto`、`client/src/App.vue`) を追加して `TitleBar.vue` / `EditTitleBar.vue` の `v-toolbar-title` に付け、必要な幅を先に確保するようにした。(2) 表示していたバージョンが `git describe` そのもの (`2.15.0-stuayu-260809-68-g06f1494`) で、ナビゲーションドロワーの幅 (256px) に収まらなかった。`VersionState.getVersionString()` は semver のベース (`EPGStation v2.15.0`) だけを返すようにし、省略しない文字列は `getFullVersionString()` として残してドロワーの `title` 属性 (ホバー時のツールチップ) に出す。**完全なバージョンは従来どおり設定 > 更新 (`UpdatePanel`) で確認できる**。**WebKit で実測**: iPhone 14 Pro (393x660) の番組表タイトルは修正前 client=117px / scroll=152px (見切れ) → 修正後 152/152、ドロワーのバージョンは修正前 223/367 (見切れ) → 修正後 223/223。iPhone SE (320x568) / iPad Mini / デスクトップ 1440 でも見切れ無しを確認

## 2026-08-30

- **視聴画面のチャンネル一覧の放送時刻が更新されない問題を修正**: `WatchPanelChannels.vue` が socket.io の更新通知を購読しておらず、「現在番組の終了時刻に達したら取り直す」タイマーだけで動いていたため、放送時間の変更 (EIT[p/f] / EPG 追従) が次の番組境界まで画面へ出なかった。`updateOnAirProgram` / `updateProgram` / `updateStatus` を購読して取り直す。あわせて `OnAirState.getUpdateTime()` に下限 (1 秒) を設けた — 終了時刻が過ぎた番組が混ざると 0 を返し、API を叩き続けるループになるため。放映中ページ (`OnAir.vue`) は元から購読済み、番組情報タブと上部バーは `WatchOnAir.vue` 経由で更新されるため変更不要。

- **配信中の EIT[p/f] が取れていなかったのを直した**: 実機のライブ視聴で EIT[p/f] が反映されず調査したところ 3 つ問題があった。① **`EitPresentStore` が present と following を同じ入れ物へ入れていた** — EIT[p/f] は present と following が交互に流れてくるため、後から届いた following が present を上書きし、放送中判定 (present しか見ない) がほぼ常に成立しなくなっていた。別々に保持する。② **相乗りサービスの EIT で本編が上書きされていた** — 同じ TS にはワンセグ・サブチャンネル分の EIT も流れる (実測: NHK総合1・福島 の TS に serviceId 21504 と 21505 の EIT)。視聴中の serviceId と一致するものだけ採用する。③ **無変換配信 (エンコードプロセス無し) の経路で解析していなかった**。解析用の枝を 1 本生やして読む。**放送時刻そのものも放送波を正とする** — Mirakurun の EPG が終了時刻を確定値で持っていても、EIT が放送時間未定と言っているなら未定として返す (実機で、放送波が未定と言っている 12:00 のニュースを Mirakurun が 12:25 終了として持っていた)。duration が確定していれば EIT の値で終了時刻を出す。あわせて present が変わったときに info ログを出すようにした (受信できているかログから追えるようにするため)。

- **放送時間未定の番組と event stream 切断時の画面更新を修正**: `ScheduleApiModel` が未定番組を次番組の開始後も暫定3時間の `endAt` で放送中扱いしていたため、クランプ後の終了時刻で除外するようにした。`EPGUpdateManageModel.updateAll()` は前後の現在番組・次番組を放送局ごとに比較し、変化局だけ `ON_AIR_PROGRAM_UPDATED` を通知し、範囲不明の `PROGRAM_RANGE_UPDATED` も送る。これにより event stream のイベントが届かず全件更新だけが成功する環境でも番組表・視聴画面が再取得される。短時間の再接続では重い全件更新を60秒間隔で抑制し、接続後にイベントを1件も受けず切断した場合はリバースプロキシのバッファリング可能性を warn ログへ出す。回帰テストは `test/ut/on-air-program-snapshot.test.js` と `test/ut/full-update-decision.test.js`

## 2026-08-20

- **HLS 再生の実機テストで見つけた 2 件**: (1) `PUT /api/streams/{streamId}/keep` が**存在しないストリームに 500 を返していた**。シークや画質切替でストリームを作り直した直後は古い `streamId` への keep が飛ぶため必ず起きる。404 を返すようにし、クライアント側も keep はベストエフォートとして握り潰す (未処理の Promise 拒否が出ていた)。(2) 録画 HLS の `ss` に小数が渡っていた (実測 `ss=368.5977211683168`)。mp4 / webm は `RecordedStreamingVideo.createVideoSrc()`、HLS は `StreamApiModel.startRecordedHLS()` と経路が別で、後者を直し漏れていた

- **録画のストリーミング再生が「シークすると止まる」のを直した**: 実機のプレイヤーを WebKit / Chromium で操作して原因を 4 つ特定した。(1) **DPlayer インスタンスが Vue のリアクティブプロキシになっていた** — `DPlayer.play()` の mutex は `this !== instances[i]` で他インスタンスを止めるが、プロキシ経由だと `this` と配列内の生インスタンスが別オブジェクトになり判定が成立して**自分自身を pause** していた。`markRaw()` で包んで解消 (再生ボタン・ホットキー・シーク後の再開が軒並み効いていなかった根本原因)。(2) `VirtualTimeline` が `dp.video.pause()` / `dp.video.play()` を直接叩いており DPlayer 内部の `paused` フラグが同期しないため、`BaseVideo.paused()` が誤った値を返していた → `dp.pause()` / `dp.play()` 経由へ変更。(3) `onDragEnd` が `setCurrentTime()` を呼んだ**後**に再生状態を戻していたため、ストリーム作り直し実装が「ドラッグ中の一時停止」を意図した停止と誤認していた → 順序を入れ替え。(4) mousedown を止めてもその後の `click` は発火するため、DPlayer の再生トグルがシーク直後に走っていた → ドラッグ直後の `click` を 1 回だけ握り潰す。あわせて `ss` に小数が渡っていたのを整数へ丸め (サーバは `parseInt` で切るため同じ位置でも URL が一致しなかった)、`dummyPlayPosition` が `switchVideo` 例外時に解除されずシークバーが固まる経路を `finally` で塞いだ

- **実機の録画テストのログから 2 件修正**: (1) **視聴位置が保存されない**: ストリーミング再生でシークバーの端をつかむと `getCurrentTime()` が僅かに負を返し、`PUT /api/videos/{id}/playback-position` が `must be >= 0` で 400 になっていた (10 秒ごとの自動保存が失敗し続ける)。`VideoContainer` が `position` を `[0, duration]` へ丸める。あわせて `RecordedStreamingVideo.setCurrentTime()` も負のシーク目標を丸めるようにした — 負のまま進むと `basePlayPosition` が負になり、サーバへ負の `ss` を要求してしまう。**サーバ側でも防ぐ**: `api.yml` の `ss` は `minimum` を持たないため負値が届き、`RecordedStreamBaseModel` が `%SS%` へ素通し + `createReadStream` の `start` を負にしていたので 0 へ丸めて warn を出す。(2) **録画準備リトライのログが不足**: `preprec failed` と例外の 2 行しか出ず「何回目か・上限・次はいつか」が分からなかった (設計書 §8 の未実装項目)。試行回数 / 上限 / 次回までの秒数 / エラー内容を 1 行にまとめ、諦めたときは `gave up preparing recording` に programId・channelId・試行回数・最後のエラーを出す

- **番組表が増えなくなる問題への保険を入れた (Issue #6)**: Mirakurun の event stream は差分しか運ばないため、既存番組の `update` は届き続けるのに新規番組の `create` が届かないと DB が古いまま残り、再起動して `updateAll()` が走るまで番組表が増えない。既存のウォッチドッグ (`lastEventStreamUpdatedTime + updateInterval * 1.5`) は「イベントが来ないこと」しか見ておらず、**イベントが届き続けるとウォッチドッグが永久に発火しない**ためこのケースを検知できなかった。`epgFullRefreshIntervalTime` (既定 360 分、0 で無効) を追加し、event stream の状態に関わらず定期的に `getPrograms()` で全件突き合わせる。判定は `FullUpdateDecision.ts` の純粋関数へ切り出してテストで固定した (ウォッチドッグと定期突き合わせが同時に成立したらウォッチドッグ優先、全件取得が一度も成功していない間は定期突き合わせを走らせない)。あわせて 2 件修正: (1) `saveProgram()` のログの `insertValues` が常に 0 だった (`create` も `update` も `updateValues` へ入れていた) ため「新規番組のイベントが届いているか」を切り分けられなかったので、`create` / `update` を分けて数えるようにした。DB 側は upsert なので反映内容は変わらない。(2) `updateAll()` のタイムアウトが `setTimeout` のコールバック内で `throw` しており、呼び出し元の try/catch では捕まらず未捕捉例外になっていた (しかも `getPrograms()` を中断できず実質無効だった)。reject する Promise と `Promise.race` する形へ直した

- **スマホで検索メニューが見切れるのを直した (Issue #16)**: 録画済み・ルールタブの検索メニューは `v-menu` の中に固定幅の `v-card` (420 / 400px) を置いていた。`v-dialog` と違い `v-menu` のコンテンツはビューポートに丸められないため、幅の狭い端末で横にはみ出す。さらに中身が overlay の `max-height` を超えても `overflow-y: visible` のためスクロールできず、下部の「検索」「閉じる」が画面外のまま到達できなかった。グローバルクラス `.menu-card` (横は `max-width: calc(100vw - 32px)`、縦は flex column + 本文 `.menu-card-body` だけスクロール) を追加。**WebKit で実測**: iPhone 15 Pro 相当 (393x660) で修正前は横 39px はみ出し・検索ボタン y=685 (画面高 660 超) → 修正後は横収まり・検索ボタン y=604 でクリック可。iPhone SE (320x568) / iPad Mini でも確認、広い画面では希望幅 420px を維持

- **延長 (録画準備中の endAt 変更) の取りこぼしとブロックを直した**: `RecordingStreamCreator.changeEndAt()` は stream 未取得のとき `StreamChangeAtError` を投げていたため、`RecorderModel` は録画開始まで待ってから反映していた。張り付きを 2 分にすると予約更新が最大 2 分止まる。creator 側に保留 (`pendingEndAt`) を持たせ、`registerStream()` で新しい `endAt` を反映するようにして待ちを無くした。legacy program stream では何もせず投げない
- **チューナー再利用時に許容する末尾欠けを張り付き時間から切り離した**: `getTunerId()` の「末尾を削れる tuner を探す」判定が `IRecordingStreamCreator.PREP_TIME` を使っていたため、`prepRecSec` に連動させると張り付きを延ばした分だけ実行中の `allowEndLack` 録画の末尾を切り落としてしまう。閾値は固定 15 秒に戻した

- **録画のタイミングを設定できるようにした**: 「張り付き (`recording.prepRecSec`)」「開始マージン (`startMarginSec`)」「終了マージン (`endMarginSec`)」の 3 つ。**既定値は EDCB に合わせた** — 張り付き 2 分前 / 開始マージン 5 秒 / 終了マージン 5 秒 (マージン無しにしたい場合は 0 を明示する)。**開始ゲートの上限は「予約開始時刻 (開始マージン込み)」から数える**ため、張り付きを延ばしても soft / hard timeout が予定開始より前に発火して前番組を録り始めることはない。いずれも**負値は 0 に丸める**。張り付きは開始マージン + 5 秒を下限として自動で押し上げる (ストリームを開いた瞬間に開始判定が走って EIT を 1 度も読めないのを防ぐ)。既存の `timeSpecifiedStartMargin` / `timeSpecifiedEndMargin` とは大きい方を採るため、新設定を入れない限り従来の挙動は変わらない。programId 予約でも following の開始時刻判定に開始マージンが効く。判定は `RecordingTimingConfig.ts` の純粋関数。固定値だった `IRecordingStreamCreator.PREP_TIME` の参照箇所 (予約タイマー・チューナー再利用判定・endAt 変更待ち) をすべて設定値へ置き換えた
- **ディスク空き容量の取得をネイティブモジュールから Node.js 標準へ移した**: `diskusage-ng` (node-gyp ビルドが要るネイティブモジュール) をやめ、`fs.statfs` (Node 18.15 以降) を使う `src/util/DiskSpaceUtil.ts` に集約した。**Windows 実機で動作確認済み** (`Win32_LogicalDisk` の値と一致)。macOS でも確認。置き換え先は録画先の空き判定・ストレージ監視 (`StorageManageModel`)・ストレージ API (`StorageApiModel`) の 3 箇所で、`package.json` から `diskusage-ng` 依存を削除した

- **録画先の空き容量が足りない場合に次の保存先へ自動で振り替えるようにした**: 録画開始前に「番組長 × 放送種別ごとの想定ビットレート ÷ 8 + 余裕」で予想サイズを出し、`config.recorded` の順に空きを見て最初に収まる保存先を選ぶ。満杯になり次第、順次さらに次の候補へ送る。どこも足りない場合は最も空きが大きい保存先を使って error ログを出す (全損を避ける)。既定ビットレートは GR 19 / BS 26 / CS・SKY 20 / 4K 40 Mbps、余裕は 3072MB。設定は `recording.storageFallbackEnabled` / `storageFallbackMarginMB` / `storageFallbackBitrateMbps`。**背景**: 実機の第一保存先 (D:) が満杯だったとき、録画開始後に `ENOSPC` で落ちて 0 バイトのファイルと失敗した録画情報だけが残り、リトライしても同じディレクトリへ書きに行くため復旧しなかった。判定は `RecordedDirCapacity.ts` の純粋関数、空き容量の取得は `RecordingUtilModel` (既存依存の `diskusage-ng` を再利用)

## 2026-08-19

- **予約タイマーが setTimeout の 32bit 上限で即発火するのを直した**: Node.js の `setTimeout` は遅延が 2^31-1 ms (約 24.8 日) を超えると警告付きで 1ms へ丸めて即発火する。数週間先の時刻指定予約で録画準備 (`RecorderModel.setTimer`)、イベントリレー確認 (`setEventRelayTimer`)、service stream の予約終了ハードタイマー (`RecordingStreamCreator.setEndTimer`) がその場で走っていた。`src/util/LongTimer.ts` が上限以下のチャンクへ分割して再武装する
- **`RecordingStreamCreator` の timer 二重管理を解消**: `timerIndex` を廃止し、stream の寿命は `StreamSession` へ一本化した
- **programId 録画をサービスストリーム境界制御へ移行**: 既定の `recording.programStreamMode: service` で TS 到着と EIT[p/f] を分離し、present/following の対象 eventId、soft 60 秒 / hard 5 分の安全弁、最大 8 MiB (188-byte packet 単位) の開始待ちリングバッファ、present event 変更・終了タイマー・EPG endAt 更新を EPGStation 側で管理する。Mirakurun の共有 `priority` は変更せず各 stream request option へ明示する。stream 実体ごとに timer と正常終了理由を持たせ、古い再試行の終了通知が新しい stream を閉じないようにした。録画準備中 (stream 未登録) に EPG 追従で `endAt` が動いた場合は録画開始まで待ってからハードタイマーへ反映する — 待たずに諦めると `create()` へ渡した古い `endAt` のままタイマーが張られ、延長を追従したはずの録画が旧終了時刻で尻切れになる。`program` は Mirakurun の開始・終了境界をそのまま使う切り戻し用として残した

## 索引

### シリーズ管理・作品辞書

- シリーズの引き当てキー (`normalizedTitle`) に録画タイトルの余計な文字列が残っていたのを、メタデータ再取得で一括修正するようにした
- 録画が 1 件も無いシリーズが EPG 更新のたびに量産されるバグを修正した
- シリーズ詳細の上部に概要ヘッダを置き、アイキャッチ画像と作品情報を一目で分かるようにした
- しょぼいカレンダーのコメントを Wiki 記法として描画し、シリーズ画面の導線を整理した
- しょぼいカレンダーのコメントを同期し、画面から編集・削除できるようにした
- シリーズ名を外部辞書の正式タイトルへ同期するようにした (手動編集・解除つき)
- 話数マッピングの精度を上げた (しょぼいカレンダーの放送予定照会・話数表記の拡充・特番の除外)
- シリーズ周りの UI を改善した (外部サイトへのリンク・戻る操作での検索結果復元・ページ番号指定)
- LLM が誤学習したエイリアス辞書を設定画面から修正できるようにした
- 録画が 0 件のシリーズ (自動生成の抜け殻) を画面から削除できるようにした
- エイリアス辞書の画面から、同期済みマスタを横断検索してシリーズを作れるようにした
- 誤って作られたシリーズの掃除 (複数選択マージ・前方一致候補) と、話数・放送種別の一括編集を画面から行えるようにした
- Annict 公式 API を作品辞書として取り込み、シリーズ照合の精度をさらに引き上げた
- シリーズ一覧に並べ替え・クール絞り込み・3 種の表示形式・各種バッジを追加した
- Wikidata を 3 つ目の作品辞書として統合し、アニメ以外のジャンルを照合できるようにした
- シリーズ照合の LLM フォールバックをシリーズ単位へ拡張し、結果をマッチングルールとして蓄積するようにした
- シリーズ一覧にアイキャッチ画像を表示するようにした
- 放送枠の冠 (先頭ブロック) の除去規則を一般化し、確定率を 92.9% → 94.9% に改善
- しょぼいカレンダーのアニメ作品タイトルを一括取得し、シリーズ自動マッピングの「正解辞書」として使うようにした
- シリーズの欠番検出と放送種別 (初回 / 再放送 / 遅れ放送) の判定に外部システムのデータを使うようにした
- シリーズ単位で「録画をまとめて再問い合わせ」できるようにした
- 既存録画のシリーズ化バックフィルバッチを追加（S20、サーバ側のみ）
- シリーズ管理 (S8〜S11) の未確定キュー・マージ/分割・エイリアス・Undo API を追加
- シリーズ手動オーバーライドを追加（S11） / シリーズライブラリUIを追加（S10）
- シリーズ自動マッピングエンジンを追加（S9） / シリーズ管理のデータ基盤を追加（S8）
- 外部メタデータプロバイダー基盤を追加（S12）〜 Annict GraphQL連携を追加（S16）
- 番組表とシリーズの双方向連携を追加（S14） / 再放送・欠番・複数局録画の分析を追加（S15）
- Next Up パネルを追加（S17）

### EPG 追従・予約・録画実行

- 番組表の全件更新が主キー重複で落ちるのを直した (Issue #17)
- ARIB TR-B14 の EIT[p/f] 運用に合わせ、時刻指定予約の録画開始判定で following の start_time も利用し、present 更新前の録画開始遅延を防ぐようにした
- 録画開始判定用の EIT[p/f] で current_next_indicator と CRC-32 を検証し、未適用または破損したSIを開始判定に使わないようにした

- 前番組の放送時間が未定で EIT の更新を取りこぼした場合でも、開始ゲートの上限後に次番組の録画を開始して録り逃しを防ぐようにした

- 時刻指定予約の録画開始ゲートで、EIT を読めない場合の timeout が録画準備直後に発火しても、予約時刻の開始マージンより前に録画を開始しないようにした

- 録画開始ゲートを EDCB の事前チューナー準備・event_id 判定に合わせた
- `programId` 予約の録画開始判定を Mirakurun の `TSFilter(eventId)` と整合させた
- 前番組の延長中に録画が始まって前番組が録れてしまうのを防いだ (EIT[p/f] による録画開始ゲート)
- EIT[p/f] を視聴画面・番組表へ即時反映するようにした (+ 放送時間未定の番組の扱いを修正)
- EIT[p/f] の通知がクライアント画面に反映されていなかったのを直した
- EPG のリアルタイム同期を追加した (災害時の特番割り込み・番組延長を即時に DB へ反映する)
- EPG 追従 (EIT[p/f]) の経過を info ログに出し、予約画面にも状態を表示するようにした
- 放送時刻未定・番組延長で開始が遅れた場合の録画開始待ちを延ばし、設定可能にした

### 視聴・ストリーミング・データ放送

- 画質選択 UI を一般ユーザー・技術ユーザーの両方に分かるように改善した (`PlaybackLabelUtil` への表示ラベル一元化、HDR バッジ表示バグ修正、詳しく表示トグル、配信方式とのセレクタ相互追随)
- 録画の HLS 再生が 1〜2 分で止まったまま戻らなくなるのを直した (エンコード抑制のデッドロック)
- 録画の HLS 再生中に、エンコードの最新位置へ勝手に飛ばされていたのを直した
- 録画ファイルの配信で音ズレしていたのを直した (rigaya 系エンコーダのフレームレート誤検出)
- エンコードが進むとチャプターマーカーがシークバー上で動いていたのを直した
- tsreplace 出力 (.ts) のチャプターがシークバーに出なかったのを直した
- 録画ファイルのストリーミングが、ファイル名に空白や括弧を含むと必ず失敗していたのを直した
- 配信を画質優先へ調整し、音声トラック切り替え・チャプター表示・プレイヤー機能を追加した
- HLS 配信を LL-HLS (EXT-X-PART) にし、録画済み HLS も fMP4 化して HEVC / iOS で再生できるようにした
- 放送中画面でチャンネルを選んでも DPlayer の映像が切り替わらないバグを修正した
- 視聴画面 (放送中・録画再生) をダークモード・ライトモードの両方に対応させた
- 録画の再生速度がライブ視聴にも波及していたのを直した
- ライブ HLS の遅延を詰め、m2ts-ll (mpegts 配信) の ARIB 字幕が出ない問題を修正した
- 上記の低遅延化 (`-flags low_delay`) が QSV 実運用で「ずっとかくつく」不具合の原因だったため除去した
- ライブ視聴のニコニコ実況コメントを放送波の時刻 (TDT / TOT) で遅延補正するようにした
- 視聴画面 (ライブ / 録画) をテレビ風の全画面レイアウトにした
- 視聴画面で別の録画へ切り替えても再生が変わらない問題を修正した
- 視聴履歴の一覧画面を追加した / 視聴履歴の一覧から再生方法を選べるようにした
- データ放送 (BML) に対応した
- 視聴画面から Bluesky / Misskey へ投稿できるようにした (SNS 投稿パネル。Misskey は MiAuth によるワンクリック連携)
- SNS 投稿パネルにタイムライン表示・リアクション・カスタム絵文字のサーバー側を追加した (Misskey はリアルタイム WebSocket 中継)
- SNS 投稿パネルのタイムライン表示・リアクション・絵文字/MFM 装飾ピッカーのクライアント側を仕上げた
- SNS 投稿パネルを実機での利用フィードバックにもとづき改善した (リアクション絵文字が画像にならない不具合修正、絵文字ピッカーの検索主体化、投稿とタイムラインの縦分割同時表示、本文のライブプレビュー)
- 録画プレイヤーの視聴履歴 UI を追加（S2） / 視聴履歴のサーバー基盤を追加（S1）

### 録画ファイルの解析・取り込み

- tsreplace 出力で `video_file.startAt` が数分ずれる原因だった、ファイル先頭時刻の採用条件を直した
- tsreplace 出力を含む録画の `video_file.startAt` を最初の映像 PTS の実時刻へ補正し、ニコニコ実況と再生位置 0 秒を同期させた
- エンコード結果が壊れていても「成功」として登録され、元の TS が消えていたのを直した
- EDCB からの録画情報登録と TS ファイルのアップロードが失敗していたのを直した
- 録画 1 件だけ TS を再解析できるようにした (過去に取り込んだ録画の番組情報の補完)
- 取り込み・アップロードした TS でも、EPGStation で録画した番組と同じ項目を表示できるようにした
- 録画ファイルのアップロードで、TS ならファイルだけ上げれば番組情報をサーバー側で自動作成するようにした
- 「不明な放送局」と表示される録画を、TS 解析結果 (SDT) の局名で埋めるようにした
- 録画ファイルの一括解析をサーバー常駐ジョブにし、ffprobe メタデータも全件を強制再解析できるようにした
- 録画ファイルの TS (PSI/SI) を解析し、放送局・番組情報を DB に持つようにした
- `video_file.startAt` (TDT/TOT 由来) を PCR で補正し、録画詳細画面の開始・終了時刻のズレを解消した
- TS 解析の読み出し位置をファイル先頭からファイル中央へ変え、相乗りサービスの中から本編サービスを選ぶようにした
- tsreplace 系のエンコード出力を TS 解析の対象に含め、解析済みファイルも含めた強制再解析機能を追加した
- 録画の放送局名を TS 解析結果 (SDT) 優先で表示し、一覧のタイトル表示を切り替えられるようにした
- 外部録画ファイル (EDCB 等) の取り込み機能を追加・全面改修（S18）

### 設定・認証・更新・運用

- リバースプロキシ配下でログ画面の内容が表示できなかったのを直した (ログファイル id から "/" を排除)
- サーバー設定の「更新」タブから EPGStation を再起動できるようにした
- 新しいバージョンの公開を Web UI で知らせ、ワンクリックで更新できるようにした
- Web UI / API にログイン認証を追加した (既定は無効)
- SSO (Google / GitHub) ログインと権限管理を追加した
- 設定ファイルが無い場合に自動生成するようにした (ログ設定・enc.js)
- config.yml を画面から編集できるようにした (DB オーバーレイ方式)
- 設定項目の定義を一本化し、実効値の決まり方 (既定値 → config.yml → 画面) を出所ごとに表示できるようにした
- ログレベルを GUI から変更できるようにした / ログ画面をログの構造に沿って表示するようにした
- 秘密情報の暗号化鍵を `data/key/secret.key` へ自動生成するようにした
- 外部サービスのエンドポイント URL を設定画面から差し替え可能にした
- 機能フラグを opt-in (既定 OFF) から opt-out (既定 ON) へ切り替えた
- Amatsukaze のエンコードが成功しても録画として登録されないことがあったのを直した
- Amatsukaze から受け取った日本語が文字化けしていたのを直した
- Amatsukaze へのエンコードが投入直後にキャンセル扱いで失敗していたのを直した
- Amatsukaze へのエンコードが何も起きずに失敗していたのを直した (RPC メソッド ID のずれ)
- エンコード失敗時に原因が何もログに残らなかったのを直した
- 録画後エンコードを Amatsukaze に投げ、進捗・処理状況・失敗理由をエンコード画面へリアルタイム表示できるようにした
- DBベースのランタイム設定ストアを追加（S5） / サーバー設定GUIと秘密情報保護を追加（S6）
- Webhook / Discord 通知基盤を追加（S3） / 通知設定GUIを実配送へ統合（S7）
- ホームダッシュボード集約APIを追加（S4）
- 段階導入向けの開発・テスト基盤を追加（S0）

### UI・表示全般

- スマホ表示の一斉点検で見つかった見切れを直した
- バージョン表記と番組表の日付が見切れるのを直した (Issue #18)
- Amatsukaze のエンコードで進捗バーの値がおかしかったのを直した
- エンコード画面で進捗バーの上の状況表示が見切れていたのを直した
- 通知は届いているのに画面が更新されない原因 (socket.io のコールバックを Vue が追跡できていなかった) を直した
- 設定画面の不具合を直した (スナックバーの背景が透明・サーバー設定への導線が黙って消える・未保存かどうか分からない)
- システム全体のテーマカラーを設定画面から選べるようにした
- トグルスイッチとプログレスバーが白黒で表示され、オン / オフが分からなかったのを直した
- 放映中 (`/onair`) にピン留めタブを追加し、初期表示にした
- 系列局の一覧画面を追加した (選ぶと系列別の番組表へ遷移する)
- 録画済み一覧から複数選択してまとめてエンコードできるようにした
- サーバー設定画面を中心に、スマホ・タブレットでの表示崩れを直した（レスポンシブ対応 フェーズ1）
- 番組表以外の画面でもダーク/ライト両モードで色が破綻していた箇所を直した（レスポンシブ対応 フェーズ2）
- タグ管理・シリーズ統合ダイアログのセレクトボックスが選択肢を表示できない不具合を修正
- 高度タグ・全文検索・保存検索を追加（S19、サーバ側のみ）
- サーバー設定画面 (S6・S7) の欠陥修正・未実装機能の追加と、録画検索 UI の高度化

### 基盤・互換性

- `api.yml` の不正な `nullable` 指定で Web API の一部ルートが登録されず 404 になっていたのを直した
- 削除やエンコード進捗が画面に即時反映されない (socket.io がリバースプロキシ経由で繋がらない) のを直した
- EPG が取れていない放送局も放映中の一覧に出すようにした / リモコンキー順に並ばない原因を潰した
- 全サービスを列挙して返すチューナーサーバ (recisdb-proxy) で放映中・番組表が壊れるのを直した
- 新4K8K衛星放送 (BS4K / CS4K) に対応した
- 本家 Mirakurun / mirakc など他の Mirakurun 互換実装にも接続できるようにした
- DB 層 (`src/model/db/`) で例外を握り潰していた箇所にログを追加し、不具合調査を追いやすくした
- reasoning 系モデルで LLM の応答が空になる問題に、上限の自動引き上げで対処した
- Annict 接続テストのエラーメッセージが誤解を招く問題を修正
- Mirakurun / EPGStation 本体への変更 (末尾の 3 項目)

---

## 変更履歴 (新しい順)

- **tsreplace 出力を含む録画の `video_file.startAt` を最初の映像 PTS の実時刻へ補正し、ニコニコ実況の再生位置 0 秒と同期させた**
    - **背景**: 既存の TDT/TOT + PCR 補正は「ファイル先頭付近の PCR が実時間で何時か」を求めていたが、tsreplace 等で PTS/PCR が再構成されると最初に表示される映像 PTS と先頭 PCR の間に数秒の差が残り、`JikkyoKakologClient` の `startAt + currentTime` と実放送時刻がずれる
    - `TsPlaybackTimeResolver` が PMT から PCR_PID と映像/音声 PID を特定し、先頭 PCR と最初の映像 PTS (無ければ音声 PTS) を同じ 27MHz 時間軸へ載せ、`firstTdtAt + (firstMediaPts - firstPcr)` を playback 0 の実時刻として返す
    - 対象サービスの PMT が示す PCR_PID だけを使う。`TsInfoAnalyzer.scanHeadTime()` が TDT を「その PCR_PID の先頭 PCR」へ引き戻して `firstTdtAt` を作っているため、両者の基準点が一致する。別サービスの PCR からは推測しない
    - 33bit の PTS/PCR wrap に対応し、5 分を超える不自然な差や必要情報不足時は従来の `firstTdtAt` へフォールバックする
    - `EncodeFinishModel` は `addVideoFile()` の直後に `analyzeAll()` を呼び、tsreplace 出力も登録直後に TS/ffprobe 解析して `startAt` を保存する。既存ファイルも TS 再解析で更新できる
    - **外部取り込み経路も直した**: `RecordedManageModel.analyzeTsInfoForImport()` が `option.fileType !== 'ts'` で早期 return していたため、外部で作った tsreplace の `.ts` を `fileType: 'encoded'` で取り込むと PSI/SI 解析ごと飛ばされ `firstTdtAt` が取れず、startAt 補正も効かなかった。アップロード経路 (`createRecordedFromUploadedTsFile()`) と同じく実ファイルの拡張子で判定するようにした
    - テストは +2.5 秒オフセット、wrap、音声 PTS fallback、異常値拒否、エンコード完了後の自動解析、取り込み時の拡張子判定を固定した

- **録画開始ゲートを EDCB の事前チューナー準備・event_id 判定に合わせた**
    - EDCB は録画マージン前にチューナーを READY 化して対象チャンネルを開き、EIT[p/f] を取得する。ぴったり録画は present の event_id 一致で開始し、不一致の別番組を timeout で録画しない
    - EPGStation も programId 予約では event_id 不一致のまま開始せず、時刻指定予約だけを開始時刻・放送時間未定・timeout で判定する
    - 時刻指定予約は録画準備時にチャンネルストリームを開いたまま開始ゲートへ渡し、待機中から EIT[p/f] を解析する。予約時刻直前まで読み捨てる経路を廃止した
    - EIT を先に検出した場合も、実際の録画開始は `timeSpecifiedStartMargin` まで待つ。EDCB の「事前準備」と「実録画開始」の状態を分離した
    - EIT[p/f] が届かない場合に判定を進める独立タイマーと、予約側・on air 側 eventId のログは維持する
    - `programId` 予約では Mirakurun の `getProgramStream` / `TSFilter(eventId)` が対象 event_id の EIT[p/f] 一致まで出力を保留するため、EPGStation は最初のデータ到着を開始条件とする。EPGStation 側で EIT を二重に待って開始が遅れることを防ぎ、データ未到着時は従来どおりリトライする

- **録画の HLS 再生が 1〜2 分で止まったまま戻らなくなるのを直した (エンコード抑制のデッドロック)**
    - **症状**: 録画ファイルを HLS で再生していると 1〜2 分ほどで映像が止まり、そのまま復帰しない。
      サーバー側のストリームは生きたまま (`keep` は届き続ける) で、`stream.log` にもエラーが出ない
    - **原因**: 「エンコードが再生位置より先行しすぎたら止める」抑制 (`MAX_AHEAD_SEGMENT_NUM` = 60) が
      **エンコードを完全に止めていた**ため、プレイリストが一切更新されなくなっていた。
      LL-HLS のプレイヤー (特に iOS Safari のネイティブ HLS) はブロッキングプレイリスト要求
      (`?_HLS_msn=<次の seq>`) の応答が変化してから次のセグメントを取得するので、
      更新が止まると**新しいセグメントを取りに来なくなる**。すると先行量の基準である
      「クライアントが取得した最新 seq」(`lastServedSeq`) も進まないため、
      先行量が減らずエンコードも再開しない、という相互待ちになる。
      実際のアクセスログでは、クライアントが seq 118 まで取得した時点でエンコードが seq 179 まで先行し
      (先行 61 > 60)、以後は `?_HLS_msn=180` が 6 秒のブロッキングタイムアウトで繰り返されるだけで、
      セグメント取得が 1 本も発生していなかった
    - **対処**: 抑制を「完全停止」から**超過量に比例した短い停止**へ変えた
      (`RecordedStreamBaseModel.throttleEncodeIfTooFarAhead()`)。
      停止時間 = (先行量 - `MAX_AHEAD_SEGMENT_NUM`) × `PACE_INTERVAL_PER_SEGMENT` (100ms)、
      上限 `MAX_PACE_INTERVAL` (5 秒) で、**先行量が減っていなくても必ず再開する**。
      超過が小さいうちは 100ms 程度の細かい停止で済むので供給が滑らかに保たれ、
      超過が広がるほど停止が長くなって先行が抑えられる。プレイリストは常に更新され続ける
    - **経緯**: 最初は「1 秒止めて再開」の一定間隔 ON/OFF で実装したが、これだと
      **再生がとびとびになった**。停止中もエンコーダはパイプバッファへ書き込み続けるため、
      再開時に一気に流れ込み、配信が「バーストと空白の繰り返し」になるのが原因。
      比例制御へ変えて停止を細かくすることで解消した。
      同時に、保険として残していた完全停止 (`HARD_MAX_AHEAD_SEGMENT_NUM`) も廃止した
      (プレイヤーが一時停止していても、止めた瞬間にプレイリストが凍結する経路を残さないため)
    - **注意点**: 録画済み in-memory HLS では**エンコードを完全に止めてはいけない**し、
      **粗い ON/OFF で間引いてもいけない**。止めるとプレイリストが更新されず、
      プレイヤー側から見て「サーバーが停止した」状態になる。
      先行を抑えたいときは「止める」のではなく「滑らかに遅くする」こと
    - **検証**: `test/ut/recorded-hls-memory-stream.test.js` (超過が小さいときの短い停止・
      超過に比例した停止・上限での頭打ち・抑制不要時の 4 ケース)

- **Amatsukaze のエンコードが成功しても録画として登録されないことがあったのを直した**
    - **症状**: Amatsukaze 側ではエンコードが正常に終わっているのに、EPGStation では失敗になり
      録画ファイルが登録されない。ログには
      `EBUSY: resource busy or locked, rename ...` が出る
    - **原因**: Amatsukaze は**出力先ディレクトリしか受け付けず**、ファイル名は入力 TS から
      自分で決めて**同名があれば上書きする**。一方 EPGStation は `%OUTPUT%` を決めるときに
      重複を避けて `(1)` を付けるため、両者の名前が食い違うことがある。
      食い違った分を `%OUTPUT%` へ移動しようとするが、**タスク完了直後は Amatsukaze が
      まだ出力ファイルを掴んでいる**ため Windows では `EBUSY` になる
    - **対処**: 移動をやめ、**Amatsukaze が書いた場所をそのまま結果として使う**ようにした。
      エンコードコマンドが標準出力へ `{"type":"output","path":"..."}` を出すと、
      `EncoderModel` がそのパスを登録する (`reportedOutputFilePath`)。
      予約したパスの解放は従来どおり EPGStation が決めたパスに対して行う
    - **注意点**: 字幕 (`.ass`) やチャプター (`.chapter.txt`) は動画と同じベース名で
      並んでいるため、移動しなくなったことで**むしろ確実に対応が取れる**ようになった。
      `{"type":"output"}` は Amatsukaze 連携に限らず、出力先を自分で決めるコマンドなら使える
    - **検証**: `test/ut/encoder-reported-output.test.js`

- **Amatsukaze から受け取った日本語が文字化けしていたのを直した**
    - **症状**: エンコード画面の状況表示と `AmatsukazeAddTask` のログで日本語が
      `�G���R�[�_` のように化ける
    - **原因**: Amatsukaze と `AmatsukazeAddTask` は日本語 Windows の ANSI コードページ (cp932) で
      コンソール出力を吐くが、EPGStation 側は UTF-8 として読んでいた
      (`String(data)` / `Buffer.toString('utf8')`)
    - **対処**: `src/model/amatsukaze/AmatsukazeTextUtil.ts` を追加し、
      **UTF-8 として成立していればそのまま、崩れていれば Shift_JIS として読み直す**
      (環境によっては UTF-8 で出ることもあるため決め打ちにしない)。
      Node 24 は full ICU 同梱なので `TextDecoder('shift_jis')` がそのまま使える (追加依存なし)
    - **注意点**: 子プロセスの出力はチャンクが**文字の途中で切れる**ため、
      受け取るたびに変換すると分割位置の文字が化ける。`LineDecoder` がバイト列のまま溜めて
      改行で区切ってから変換する。RPC のコンソール出力 (base64) は 1 件で完結しているのでそのまま変換してよい
    - **検証**: `test/ut/amatsukaze-text-util.test.js`

- **Amatsukaze のエンコードで進捗バーの値がおかしかったのを直した**
    - **症状**: 進捗バーが飛んだり、途中で止まったまま動かなくなったりする
    - **原因 1 (関係ない百分率を拾う)**: 進捗は
      `[60.7%] 29701/48918 frames: 132.14 fps, ... GPU 21%, VD 58%` の**行頭の `[...%]` だけ**だが、
      行内の最初の百分率を拾う実装だったため、進捗行が出ない段階では
      `encode time 0:04:42, CPU: 10.8%` や `未出力フレーム: 43（0.050%）` を進捗として読んでいた
    - **原因 2 (CR で行を分けていなかった)**: エンコーダの進捗行は改行ではなく **CR で同じ行を上書き**する。
      分けていなかったため複数回分の進捗が 1 行に繋がり、最新ではなく**最初の値**を読んでいた
      (画面のログ表示も古い進捗が出続けていた)
    - **原因 3 (`State.Progress` を進捗として使っていた)**: これは**キュー全体**の進み具合
      (完了したアイテムの割合) で、個々のタスクの進捗ではない。実測でも実行中 20 秒間
      `0.8713826366559485` から動かなかった
    - **対処**: 進捗は自分のタスクのコンソール出力から、**行頭 `[n%]` の形のときだけ**拾う。
      コンソール出力は CR でも行に分ける。`State.Progress` は使わない。
      百分率が出ない段階 (`1066フレーム完了 125.36fps` のように総数が分からない出力) では
      **直前の値を保つ** (0% へ戻すとバーが行き来して読めなくなる)
    - **注意点**: Amatsukaze の処理は 解析 → ロゴ/CM 検出 → エンコード → mux と段階が分かれており、
      百分率が出るのはエンコード段階だけ。**全体を通した進捗を出す手段は無い**
    - **検証**: `test/ut/amatsukaze-task-watcher.test.js` (実データの進捗行で固定)。
      実行中のタスクに対して確認し、1.6% → 4.8% と単調に増えることを見ている

- **エンコード画面で進捗バーの上の状況表示が見切れていたのを直した**
    - **症状**: エンコードの状況 (Amatsukaze のコンソール出力など) が 1 行に収まらず、
      末尾が `…` で切られて失敗理由や進捗が読めない
    - **対処**: `EncodeSmallCard.vue` の状況表示 (`encodeInfo`) だけ折り返すようにした
      (`.encode-info`)。カード内の他の行 (番組名・放送局・日時) は 1 行のままにしてある
    - **注意点**: 行数は制限していない。途中で切ると失敗理由の肝心な部分が読めなくなるため。
      表示元の 1 行は `AmatsukazeTaskWatcher.MAX_LOG_LENGTH` (200 文字) で頭打ちになっている

- **Amatsukaze へのエンコードが投入直後にキャンセル扱いで失敗していたのを直した**
    - **症状**: 画面からエンコードを実行すると、Amatsukaze には正しくタスクが積まれて
      エンコードも走るのに、EPGStation 側は数秒で失敗になる。
      ログには `Amatsukaze から出力ファイルのパスを取得できませんでした` が出る
    - **原因 1 (投入前のタスクを掴む)**: `AmatsukazeTaskWatcher` は入力 TS のパスでタスクを識別するが、
      `start()` が `AmatsukazeAddTask` の実行より**前**に `requestAll()` を呼ぶため、
      その応答に含まれる**同じ録画の過去のタスク** (前回失敗した分など。Amatsukaze のキューは
      完了しても消えない) を自分のタスクと取り違えていた。過去のタスクは
      `Complete` / `Failed` / `Canceled` なので、投入した瞬間に終了通知が飛ぶ
    - **対処 1**: 探索はタスク投入が済んでから (`markTaskAdded()`) しか行わないようにし、
      投入前に見えていたアイテムの id は控えて候補から外す。
      投入したタスクが 60 秒経ってもキューに現れない場合はエラーにする
    - **原因 2 (出力パスが取れない)**: 現行の Amatsukaze は完了しても `ActualDstPath` を返さず
      `null` のままで、`DstPath` (**拡張子の付かないベース名**) しか得られない。
      実ファイルは `<DstPath>.hevc.ts` のように出る
    - **対処 2**: `ActualDstPath` が無ければ `DstPath` から実ファイルを探すようにした
      (`src/model/amatsukaze/AmatsukazeOutputUtil.ts` の `findOutputByBase()`)。
      出力先には同じベース名で字幕 (`.ass`) やチャプター (`.chapter.txt`) も並ぶため、
      それらを除いた上で最も大きいものを本編とみなす
    - **注意点**: 副産物は動画の**最後の拡張子を差し替えた**名前で出る
      (`foo.hevc.ts` に対して `foo.hevc.chapter.txt`)。`ChapterFileUtil` も同じ規則で探すので、
      出力を別名へ移動するときは `listSideCarFiles()` で副産物も一緒に運ぶこと
      (運ばないとチャプターがシークバーに出なくなる)
    - **検証**: `test/ut/amatsukaze-task-watcher.test.js` / `test/ut/amatsukaze-output-util.test.js`

- **録画の HLS 再生中に、エンコードの最新位置へ勝手に飛ばされていたのを直した**
    - **症状**: 録画ファイルを HLS で再生していると、しばらく (1〜2 分) おきに再生位置が
      エンコード済みの最新位置へ強制的に飛ばされる
    - **原因**: 録画ファイルのエンコードは実時間の数倍速で進むため、再生位置との差が
      再生時間の倍以上の速さで開いていく。in-memory ストアは録画済みでもセグメントを
      180 本 (約 3 分) しか保持せず古いものから捨てるので、**約 90 秒でプレイリストの先頭が
      再生位置を追い越す**。
      hls.js は録画済みのプレイリストも live 扱いで読む (成長し続ける = `#EXT-X-ENDLIST` が無い)
      ため、再生位置がプレイリストの範囲外になると `StreamController.synchronizeToLiveEdge()` が
      ライブエッジ = エンコード最新位置へ `media.currentTime` を書き換える。
      なお `liveMaxLatencyDurationCount` の既定は `Infinity` なので、
      発火しているのは遅延しきい値ではなく**「再生位置がスライディングウィンドウの外」**の条件
    - **対処**: エンコードが再生位置より一定以上先行したら止めるようにした。
      `HLSMemoryStoreModel` がクライアントの取得済みセグメント seq を覚え
      (`getAheadSegmentNum()`)、`RecordedStreamBaseModel` が先行 60 セグメント (約 60 秒) を超えたら
      エンコーダの標準出力の読み出しを止める。パイプが詰まってエンコーダ自身が書き込みで
      ブロックするため、追いつけば読み出しを再開するだけで戻る (0.5 秒間隔で確認)
    - **注意点**: 先行分はそのまま「シークに即応できる範囲」でもあるので、
      `MAX_AHEAD_SEGMENT_NUM` を短くしすぎないこと。保持数
      (`RECORDED_RETAIN_SEGMENT_NUM` = 180) より十分小さい値である必要がある
    - **その後の変更**: この「完全に止める」実装は、プレイリストの更新まで止めてしまうために
      再生が止まったまま戻らないデッドロックを起こしていた。現在は実時間ペースまで落とす方式に
      変えてある (索引の「録画の HLS 再生が 1〜2 分で止まったまま戻らなくなるのを直した」を参照)

- **Amatsukaze へのエンコードが何も起きずに失敗していたのを直した (RPC メソッド ID のずれ)**
    - **症状**: Amatsukaze 連携のエンコードプリセットを選ぶと、エンコードが 0.3 秒ほどで失敗する。
      Amatsukaze 側のキューには何も積まれず、`encode.log` には `exit code: 1` と
      `encode failed: <id>` しか残らないため、原因がまったく分からない状態だった
    - **原因**: `RPCMethodId.Request` の値が実際の Amatsukaze と 1 ずれていた (EPGStation 111 / 実際 112)。
      現行の Amatsukaze では `ChangeItem` (103) より後ろにメソッドが 1 つ増えており、
      `Request` 以降の ID が後ろへずれている。**知らない ID のフレームを受け取った AmatsukazeServer は
      エラーを返さずソケットを閉じる**ため、クライアント側には `read ECONNRESET` しか届かない。
      `AmatsukazeTaskWatcher.start()` はタスク投入より前に `requestAll()` を呼ぶので、
      `AmatsukazeAddTask` を実行する前に落ちていた (= キューに何も残らない)
    - **確認方法**: 32768 への通信を中継してダンプするプロキシを挟み、本物の Amatsukaze クライアント
      (`AmatsukazeGUI.exe -l client`) が送るフレームと突き合わせた。ヘッダ先頭 2 byte が
      `70 00` (= 112) で、EPGStation が送っていた `6f 00` (= 111) と食い違っていた。
      **ID を疑うときはこの方法で実機の通信を見る**こと。ソースからの推測では気づけない
    - **実装場所**: `src/model/amatsukaze/IAmatsukazeRpcClient.ts` の `RPCMethodId`
    - **注意点**: 実測で裏を取れたのは `AddQueue` = 102 / `ChangeItem` = 103 / `Request` = 112 と、
      受信側 (200 番台) が据え置きであること。`EndServer` を含む 110 以降の残りは未検証なので、
      新しく使うときは必ず実機で確かめる (`EndServer` は誤って呼ぶとサーバが止まる)。
      **Amatsukaze のバージョンを上げたときに再びずれる可能性がある**

- **エンコード失敗時に原因が何もログに残らなかったのを直した**
    - **症状**: エンコードが失敗しても `encode.log` には終了コードしか出ない。
      エンコーダが標準エラーへ出した失敗理由が消えてしまい、調査の取っ掛かりが無かった
    - **原因**: エンコードプロセスの標準エラーは `log.encode.debug` で書いていた。
      標準エラーには進捗表示が延々と流れてくるため debug に落とすのは妥当だが、
      既定のログレベル (info) では失敗理由まで一緒に捨てられていた
    - **対処**: 標準エラーの直近 20 行 (`EncoderModel.STDERR_LOG_LINES`) を控えておき、
      失敗したとき (終了コードが 0 以外 / 出力ファイルが壊れている) だけ error として出し直すようにした
      (`src/model/service/encode/EncoderModel.ts` の `addStderrLog()` / `logStderr()`)
    - **注意点**: 正常終了時とキャンセル時は従来どおり出さない (進捗表示でログが埋まるため)

- **録画ファイルの配信で音ズレしていたのを直した (rigaya 系エンコーダのフレームレート誤検出)**
    - **症状**: エンコード済み録画ファイルを HLS / mp4 で再生すると音と映像がずれる。
      しかも再生時間に比例してずれが開いていく。ライブ視聴と録画中ファイルの再生では起きない
    - **原因**: rigaya 系エンコーダ (QSVEncC / NVEncC / VCEEncC) は入力ファイル先頭付近の
      タイムスタンプからフレームレートを推定する。録画 TS (特に Amatsukaze の tsreplace 出力) は
      先頭のタイムスタンプが不揃いなため**推定を外す**。実測では 59.94fps のファイルを
      31.75fps (`4540/143`) や 44.96fps (`45000/1001`) と誤検出し、その速度で出力するため
      映像だけが実時間より遅れていく。音声は `--audio-copy` で元のタイムスタンプのまま流れるので、
      ずれは再生時間に比例して開く。**60 秒のソースで映像 51.59 秒 / 音声 58.75 秒 (7.2 秒差)** だった
    - **対処**: 入力がファイルの場合 (`--seek %SS% -i %INPUT%`) だけ
      `--avsync forcecfr --fps 30000/1001` を付けるようにした
      (`src/util/EncodePresets.ts` の `FILE_INPUT_SYNC_OPTIONS`)。
      `forcecfr` が入力 PTS を見てフレームを挿入・削除し実時間どおりの CFR に揃える (同期の本体)。
      `--fps` は出力レートを 29.97 に固定するためのもので、付けないと誤検出値がそのまま出力レートになり
      `--gop-len` で決まる LL-HLS のパート長がファイルごとに変わってしまう。
      `forcecfr` と併用する限り再生速度には影響しない (実測で映像 59.47 秒 / 音声 59.33 秒 = 1 フレーム差)
    - **注意点**: パイプ入力 (ライブ・録画中の TS) は放送 TS がそのまま流れてくるため対象外。
      判定は `buildRigayaPipelinePrefix()` が `inputSpec` に `%INPUT%` を含むかで行う。
      検証は `test/ut/encode-presets.test.js`

- **エンコードが進むとチャプターマーカーがシークバー上で動いていたのを直した**
    - **症状**: 録画のストリーミング再生中、シークバー上の白いチャプターマーカーが、
      エンコードの進行に合わせて少しずつ左へ動く。再生位置は正しいのにマーカーだけがずれる
    - **原因**: マーカーの位置は DPlayer が決めており、`durationchange` のたびに全マーカーを作り直して
      `left = time / video.duration * 100%` を設定する。ストリーミング再生の `video.duration` は
      動画全体の長さではなく**エンコードが済んだところまでの長さ**なので、エンコードが進むほど
      分母が大きくなり、同じ時刻のマーカーが左へ寄っていく。
      シークバー本体 (再生位置・バッファ位置・時刻表示) は `VirtualTimeline` が
      動画全体の長さで描き直していたが、**マーカーだけが DPlayer 任せのまま残っていた**
    - **対処**: `VirtualTimeline` がマーカーの描画も引き取るようにした
      (`client/src/components/video/VirtualTimeline.ts`)。生成時に `dp.options.highlight` を
      自分の側へ移して `undefined` にする (DPlayer の `durationchange` ハンドラは
      `options.highlight` が無ければマーカーに一切触らない) 。以後は
      シークバー更新と同じ 250ms 周期で、**動画全体の長さを分母**にして位置を書き換える
    - **副次的な修正**: DPlayer は `!time` で弾くため**開始位置 0 秒のチャプターがマーカーとして
      出ていなかった**。自前描画では出るようになる
    - **注意点**: ストリーミング再生 (`RecordedStreamingVideo` / `RecordedHLSStreamingVideo`) だけが
      `options.highlight` を使う。ファイルを直接再生する `NormalVideo` は `video.duration` が
      動画全体の長さと一致するため従来どおり自前でマーカーを描いている (こちらは触っていない)

- **tsreplace 出力 (.ts) のチャプターがシークバーに出なかったのを直した**
    - **症状**: Amatsukaze の tsreplace 出力 (`*.hevc.ts`) の横に `*.hevc.chapter.txt` があるのに、
      再生画面のシークバーにチャプターマーカーが 1 つも出ない。`GET /api/videos/{id}/chapters` は
      エラーにならず `{"chapters":[]}` を返す
    - **原因**: チャプターは要求のたびに ffprobe で読む設計だが、**MPEG-TS コンテナはチャプターを
      埋め込めない**。mkv / mp4 出力なら埋め込まれるので気付きにくい。tsreplace は `.ts` のまま
      PSI/SI を保持する出力なので、チャプターは別ファイルへ書き出される
    - **対処**: ffprobe が 0 件を返したときに、動画の横の `<動画ファイル名>.chapter.txt`
      (Ogg / Matroska の simple chapter format: `CHAPTER01=00:00:00.000` / `CHAPTER01NAME=A`)
      を読むフォールバックを足した (`src/util/ChapterFileUtil.ts`,
      `src/model/api/video/VideoUtil.ts`)。ファイル名は動画の**最後の拡張子だけ**を差し替える
      (`foo.hevc.ts` → `foo.hevc.chapter.txt`)
    - **注意点**: チャプターファイルには終了位置が無いため、`endAt` は次のチャプターの開始位置で
      埋める。最後の 1 件だけは動画全体の長さが要るので、ffprobe を `-show_chapters -show_format`
      の 1 回呼び出しにまとめて尺も一緒に取っている。検証は `test/ut/chapter-file-util.test.js`

- **エンコード結果が壊れていても「成功」として登録され、元の TS が消えていたのを直した**
    - **症状**: 保存先ドライブの空き容量が尽きると、エンコード結果が 0 バイト〜数百バイトの
      壊れたファイルになる。それが正常なエンコード済みファイルとして DB に登録され、
      `removeOriginal` (元ファイルを削除する設定) が有効な場合は**元の録画 TS まで削除される**。
      画面上は普通の録画に見えるが再生できず、`ffprobe` によるメタデータ解析だけが
      `video file metadata analysis failed` で失敗し続ける
    - **原因**: `EncoderModel.childEndProcessing()` が成否を**終了コードだけで判定**していた。
      Amatsukaze (tsreplace) のような外部エンコーダは、書き込みに失敗しても終了コード 0 で
      終わることがある。この環境では 2025-01 以降 56 件が壊れた状態で登録され、
      いずれも元 TS が残っていなかった
    - **対処**: 終了コード 0 でも出力ファイルを `stat` し、存在しない場合と
      `EncoderModel.MIN_OUTPUT_FILE_SIZE` (1MiB) 未満の場合はエンコード失敗として扱うようにした
      (`src/model/service/encode/EncoderModel.ts`)。失敗扱いになると既存の経路がそのまま働き、
      壊れた出力は削除され、DB 登録も元ファイル削除も行われない。ログには
      「保存先の空き容量を確認してください」を添えたエラーを出す
    - **注意点**: `EncodeFinishModel.finishEncode()` の元ファイル削除は
      「`isError === false` のときしか呼ばれない」という前提に依存している。
      `EncodeManageModel.onFinish()` の分岐を変えるときはこの前提を壊さないこと

- **録画ファイルのストリーミングが、ファイル名に空白や括弧を含むと必ず失敗していたのを直した**
    - **症状**: 録画済みファイルの HLS / mp4 配信を始めても映像が出ない。ログ (`logs/Service/stream.log`) には
      `start check stream file` までは出るが `enable stream` に到達せず、タイムアウトして
      `stop stream` になる。ライブ視聴は正常、同じ録画でもプロファイルによっては再生できる、という
      分かりにくい出方をする
    - **原因**: `EncodeProcessManageModel.buildProcess()` は cmd に `|` を含む場合だけシェル
      (Windows は cmd.exe) 経由で実行するが、そのとき `%INPUT%` / `%OUTPUT%` を**引用符無しのまま
      文字列置換**していた。録画ファイル名には空白・括弧が普通に入る
      (例: `202608151635_アニメ 魔入りました!入間くん4(18)…_NHKEテレ1福島.hevc.ts`) ため、
      シェルがそこでコマンドを分割し、エンコーダが壊れたパスを受け取って即座に終了していた。
      パイプを含まない cmd は `ProcessUtil.parseCmdStr()` が args 配列を組み立ててから置換するので
      引用の問題が起きず、**「rigaya 系エンコーダ (QSVEncC 等) → ffmpeg のパイプラインを使う
      プロファイルだけが壊れる」**という切り分けの難しい症状になっていた。
      HEVC 配信は fMP4 化や `-tag:v hvc1` 付与のために後段 ffmpeg へ繋ぐパイプライン構成が前提なので、
      HEVC 系プロファイルはほぼ全滅していた
    - **対処**: `ProcessUtil.quoteShellArg()` / `ProcessUtil.replaceShellPlaceholder()` を追加し、
      シェル経由のときは値を引用符で囲んでから埋め込むようにした
      (`src/util/ProcessUtil.ts`, `src/model/service/encode/EncodeProcessManageModel.ts`)。
      Windows は `"` で囲むだけでよい (ファイル名に `"` を使えないため)。sh は `"` 内でも `$` /
      バッククォートが展開されるためシングルクォート + `'\''` エスケープを使う。
      config.yml 側で既に `"%INPUT%"` と書かれている場合は二重に囲わない
    - **注意点**: シェル経由の cmd へ**パスを埋め込む処理を足すときは必ずこの置換関数を通す**こと。
      検証は `test/ut/process-shell-placeholder.test.js`

- **リバースプロキシ配下でログ画面の内容が表示できなかったのを直した**
    - **症状**: ログ一覧 (`GET /api/logs`) は取れるのに、内容取得 (`GET /api/logs/{logFileId}`) と
      ダウンロードが 404 になる。しかも express-openapi の JSON エラーではなく Express 標準の HTML
      (`Cannot GET /api/logs/Operator/system.log`) が返るため、**ルーティングにすら到達していなかった**。
      ローカルへ直接アクセスした場合は再現せず、リバースプロキシ経由の本番だけで起きる
    - **原因**: ログファイル id を `Operator/system.log` のように**プロセス名とファイル名を "/" で連結**して
      いた。クライアントは `encodeURIComponent()` で `%2F` に変換して送るが、nginx などのリバースプロキシは
      パスを正規化する過程で `%2F` を "/" へ戻して転送する。その結果 URL のセグメントが 1 つ増え、
      `logs/{logFileId}` にも `logs/{logFileId}/download` にも一致しなくなっていた
    - **対処**: 区切り文字を `LogApiModel.ID_SEPARATOR` (`__`) に変え、**id が URL パスの 1 セグメントで
      収まるようにした** (`src/model/api/log/LogApiModel.ts`)。`findLogFile()` は旧形式 ("/" 区切り) の id も
      受け付けるので、古い画面が開いたままでも 404 にはならない
    - **注意**: 列挙結果と id を突き合わせて解決する方式 (パストラバーサル対策) は変えていない。
      URL のパスに載せる識別子は、プロキシが "/" を復元することを前提に**セグメントをまたがない形**にすること
- **録画後エンコードを Amatsukaze に投げ、進捗・処理状況・失敗理由をエンコード画面へリアルタイム表示できるようにした**
    - **背景**: CM カット・ロゴ消しを [Amatsukaze](https://github.com/nekopanda/Amatsukaze) に任せたい場合、
      従来は同梱の `config/amatsukaze_addtask.bat.template` で `AmatsukazeAddTask` にキュー投入するだけだった。
      この方式は**出力ファイルの存在を 120 秒ごとに見に行くだけ**で、キュー待ちなのか処理中なのか、
      失敗した場合になぜ失敗したのかが EPGStation 側からはまったく分からなかった
    - **`AmatsukazeAddTask` は投入専用**: 状態取得の口を持たないため、バッチ方式のままでは進捗を拾えない。
      一方 `AmatsukazeServer` は TCP (既定 32768) でバイナリ RPC を公開しており、接続して `Request` を送るだけで
      キュー・状態・進捗が push されてくる (認証・ハンドシェイク無し)。**これを使えば追加のエージェント無しで
      進捗を取れる**と判断し、RPC クライアントを自前実装することにした
        - フレーム構造はヘッダ 6 byte (`int16 LE = RPCMethodId` + `int32 LE = ペイロード長`) +
          `[int32 len][本体]` のチャンク列。本体は DataContractSerializer 形式の XML。
          出典は nekopanda/Amatsukaze の
          `AmatsukazeServer/Server/{ServerInterface,ServerConnection,EncodeServerData}.cs`
        - `ServerRequest` は `[Flags]` enum だが、複数フラグをまとめた表記に依存しないよう
          Queue / State / Console を 1 つずつ送るようにした
        - XML のパース/ビルドは外部ライブラリを使わず `AmatsukazeXml.ts` に最小実装した
          (DataContractSerializer 形式は一般的な XML パーサの想定と噛み合わない癖があるため)
    - **タスクの特定は入力 TS のパスで行う**: `AmatsukazeAddTask` は `RequestId` を外へ返さないため、
      自分が投入したタスクをキューの中から見分ける手段が無い。`QueueItem.SrcPath` (入力 TS のフルパス) で
      照合し、同じ入力の古いタスクが残っている場合は**追加時刻が新しい方**を自分のタスクとみなす
        (`AmatsukazeTaskWatcher.ts`)
    - **進捗の算出**: エンコーダのコンソール出力から百分率を拾い、取れない場合はサーバ全体の進捗
      (`State.Progress`) で代用する。`{"type":"progress","percent":0〜1,"log":"..."}` を stdout へ出し、
      `EncoderModel` がそのまま読むので既存の進捗バー・状態表示に手を入れずに乗せられる。
      「ロゴ・プロファイル待ち」「Amatsukaze のキュー待ち (2 番目) profile:HEVC」
      「Amatsukaze でエンコード中: ...」のようなログも合わせて出す
    - **完了・失敗・キャンセル**: 完了したら Amatsukaze の出力ファイル (`ActualDstPath`) を EPGStation が
      期待する `%OUTPUT%` へ移動し、通常のエンコード結果として `video_file` に登録する。失敗時は Amatsukaze の
      失敗理由 (`FailReason`) を stderr に出して終了コード 1 で終える (エンコード画面にエラーとして出る)。
      EPGStation 側でキャンセル (SIGINT/SIGTERM) すると `ChangeItem` の `Cancel` で Amatsukaze のキューからも
      取り消す
    - **設定は `editable: 'ymlOnly'` (`notYetWired`) にした**: エンコードコマンド
      (`dist/AmatsukazeEncodeTool.js`) は録画エンコードとは独立したプロセスとして起動され、画面から変更した
      設定 (DB オーバーレイ) を読まずに config.yml だけを読む。GUI 編集を許すと
      「画面では変わっているのに実際のエンコードには反映されない」状態になるため、当面は config.yml の
      直接編集のみに限定した
    - **使い方**: config.yml の encode プリセットに
      `cmd: '%NODE% %ROOT%/dist/AmatsukazeEncodeTool.js <プロファイル名>'` と書き、接続先・投入方法・
      パス変換は新設の `amatsukaze` セクションで設定する。`pathMappings` は EPGStation と Amatsukaze が
      別マシンにある場合の入出力パス変換 (`local` → `remote` で送り、戻りは `remote` → `local`)
    - **旧方式は削除した**: `config/amatsukaze_addtask.bat.template` (Windows バッチ) は、
      進捗も失敗理由も分からず保守もしづらいため同梱をやめた。既に使っている場合は
      encode プリセットの cmd を `dist/AmatsukazeEncodeTool.js` に差し替える
    - **実装場所**: `src/AmatsukazeEncodeTool.ts` (エンコードコマンド本体),
      `src/model/amatsukaze/{AmatsukazeXml,AmatsukazeRpcClient,AmatsukazeTaskWatcher,AmatsukazeConfigResolver}.ts`,
      `src/model/IConfigFile.ts` (`AmatsukazeConfig` / `AmatsukazePathMapping`),
      `src/model/config/ConfigSchema.ts`, `config/config.yml.template`, `config/config-win.yml.template`
    - **テスト**: `test/ut/amatsukaze-{xml,config-resolver,task-watcher}.test.js` (単体),
      `test/itb/amatsukaze-rpc-client.test.js` (ローカル HTTP/TCP スタブによる RPC クライアントの結合テスト)

- **通知は届いているのに画面が更新されない原因 (socket.io のコールバックを Vue が追跡できていなかった) を直した**
    - **背景**: socket.io の接続を直した後も「削除しても消えない」「エンコード進捗が動かない」が続くという報告
      ([#11](https://github.com/stuayu/EPGStation/issues/11))。本番で実測したところ、
      **通知は届き、一覧 API も取り直され、応答にも新しい値が入っているのに画面だけが古いまま**で、
      再読み込みすると反映された
    - **原因**: 各画面が socket.io の通知を**クラスフィールドのコールバック**で受けていた
      (`private onUpdateStatusCallback = (async () => { ... }).bind(this)`)。
      `vue-facing-decorator` はフィールドの初期値を data 用の一時インスタンスから集めるため、
      **この `this` は Vue インスタンスではない**。結果 `this.recordedState` などが
      **Vue のリアクティブなプロキシではない素のインスタンス**になり、
      そこへ書き込んでも**再描画がトリガされない** (値は新しくなるので、再読み込みすると出てくる)
    - **直し方**: フィールドを挟まず**メソッドをそのまま渡す** (`onUpdateState(this.onUpdateStatus)`)。
      Vue のメソッドはコンポーネントへ束縛されているので `this` が正しくなる。
      **コールバックからメソッドを呼ぶだけでは直らない** (呼ばれた側の `this` も一時インスタンスのまま) —
      `WatchOnAir.vue` は実際にその書き方で、判定に使う `watchParam` が初期値のままになっていた
    - **対象**: 一覧・視聴・番組表など socket.io を購読している 17 ファイル
      (`Dashboard` / `Recorded` / `Rule` / `Encode` / `Reserves` / `Recording` / `OnAir` / `Guide` /
      `Search` / `Storages` / `ManualReserve` / `RecordedDetail` / `WatchOnAir` / `WatchRecorded` /
      `Navigation` / 録画配信の 2 コンポーネント)
    - **確認方法**: 本番 API に向けたクライアントで、録画 1 件を保護 → 再読み込みせずにメニューが
      `protect` から `unprotect` へ変わることを確認した (修正前は変わらず、再読み込みで変わる)
- **削除やエンコード進捗が画面に即時反映されない (socket.io がリバースプロキシ経由で繋がらない) のを直した**
    - **背景**: 「録画やルールを削除しても画面が変わらない」「エンコード進捗が更新されない」という報告
      ([#11](https://github.com/stuayu/EPGStation/issues/11))。画面の自動更新は socket.io の
      `updateStatus` / `updateEncode` 通知が全ての起点になっており、**接続できていないと一切反映されない**。
      ブラウザを再読み込みすれば見えるのは、そのとき HTTP で取り直しているから
    - **接続先の組み立てが間違っていた**: クライアントは接続先を
      `${location.protocol}//${location.hostname}:${config.socketIOPort}` と組み立てており、
      **`location.port` を無視していた**。`socketIOPort` はサーバが自分の待ち受けポート (既定 8888) を
      返すため、**リバースプロキシ経由 (443 → 8888 など) では存在しないポートへ繋ぎに行って必ず失敗する**
        - サーバが `GET /api/config` で `useDedicatedSocketIOPort` を返すようにした。
          `socketioPort` / `https.socketioPort` / `clientSocketioPort` のいずれも指定が無ければ
          socket.io は Web API と同じ待ち受けを共有しているので `false` になり、
          **クライアントは接続先を組み立てず `location.origin` へそのまま接続する** (ポート・経路をそのまま使う)。
          専用ポートを指定している場合だけ従来どおり組み立てる
    - **複数の経路から接続される前提にした**: 同じサーバーが「LAN から直アクセス」と
      「リバースプロキシ経由」の両方で使われることがあるため、**どの経路で来たかを接続ごとに判断する**
        - **サーバは常に Web API と同じ待ち受けでも socket.io を受ける**ようにした。専用ポートを
          指定している場合は「専用ポート + Web API のポート」の両方で受ける。プロキシ経由の
          クライアントは専用ポートに到達できないため、**どの経路から来ても必ず繋がる先が要る**
        - **`useDedicatedSocketIOPort` は接続ごとに決める**。`api.getAccessPort()` が
          `X-Forwarded-Host` / `Host` からクライアントが使ったポートを取り、自分の待ち受けポートと
          一致すれば直アクセス (専用ポートを教える)、違えばプロキシ経由 (アクセス中のオリジンへ繋がせる)
        - **クライアントは接続先の候補を順に試す**。`[専用ポート, location.origin]` (サーバの判断で順序が
          入れ替わる) を持ち、`connect_error` が 2 回続いたら次の候補へ切り替える。
          **接続先を切り替えると socket インスタンスが作り直される**ため、購読中のコールバックは
          `SocketIOModel` 側で保持して張り直す。`getIO()` に直接 `on` すると切替後に外れる
        - 接続失敗の通知は候補の切り替えで復旧しうるので、**8 秒待ってもまだ繋がっていないときだけ**出す
    - **プロキシが TLS を終端する構成で `/api/config` が 500 になっていた**: `X-Forwarded-Proto: https`
      で来ると https 扱いになるが、EPGStation 自身は http でしか待ち受けていないため
      `httpsConfigError` を投げていた (config が取れないので画面全体が動かない)。
      実際の待ち受け側の設定へフォールバックするようにした
    - **失敗が画面に出ていなかった**: 接続断は `disconnect` で通知されるが、**最初から繋がらない場合は
      `connect_error` で通知される**。これを誰も拾っていなかったため、自動更新が死んでいても無言だった。
      `ISocketIOModel.onConnectError()` を追加し、一度だけスナックバーで知らせるようにした
      (socket.io は再接続を試み続けるため、繰り返しは出さない)
    - **認証有効時に Cookie が飛ばない**: 専用ポートを使う構成は socket.io だけ別オリジンになるため、
      handshake にセッション Cookie が乗らず `Unauthorized` で弾かれていた。クライアントに
      `withCredentials: true` を付け、サーバの CORS を `origin: '*'` から
      **要求元の反射 + `credentials: true`** に変えた (`Access-Control-Allow-Origin: *` は
      credentials 付きの要求では**ブラウザに拒否される**ため、両者はセットで直す必要がある)
    - **自分の操作は socket.io を待たずに反映する**: 通知が届かない環境でも操作結果だけは見えるよう、
      `RepositoryModel` (axios 共通層) が **POST / PUT / DELETE の成功を `ApiMutationNotifier` へ流し**、
      `SocketIOModel` がそれを `updateStatus` / `updateEncode` と同じ扱いで購読中のコールバックへ配る。
      各画面は既存の購読のままで再取得されるので、**View 側の改修は不要**
        - 連続操作 (複数選択削除など) でまとめて再取得されるよう 300ms 待ってから配る
        - 視聴中に周期的に呼ばれる API (`/streams/{id}/keep`) と `/auth` は対象外。
          全画面の再取得を誘発させないため
    - **実装場所**: `src/model/api/config/ConfigApiModel.ts`, `src/model/service/api.ts` (`getAccessPort`),
      `src/model/service/api/config.ts`, `src/model/service/ServiceServer.ts`,
      `src/model/service/socketio/SocketIOManageModel.ts`, `client/src/model/socketio/SocketIOModel.ts`,
      `client/src/util/ApiMutationNotifier.ts`, `client/src/model/api/RepositoryModel.ts`,
      `client/src/views/AppContent.vue`, `api.yml`, `api.d.ts`
    - **ついでに直した**: `AppContent` の後始末が `io.on('connect')` で登録して `io.off('reconnect')` を
      呼んでおり、ハンドラが外れていなかった。https の socket.io 専用ポートの起動ログが
      http 側のポート (`config.socketioPort`) を出していたのも直した
    - **テスト**: `test/ut/config-api-socketio-port.test.js` (経路ごとの判定 10 パターン) と
      `test/ut/api-access-port.test.js` (`X-Forwarded-Host` の優先・多段プロキシ・IPv6 リテラル) を新規追加
- **配信を画質優先へ調整し、音声トラック切り替え・チャプター表示・プレイヤー機能を追加した**
    - **画質優先チューニング**: 配信のビットレートを引き上げ (1080p は H.264 で 5000 → 8000kbps)、
      **コーデック別に係数を掛ける**ようにした (HEVC は同画質を約 65% のビットレートで出せるため 5200kbps)。
      速度プリセットは用途で分ける: ライブ視聴は遅延が体感を損なうので従来どおり速度優先
      (`-preset veryfast` / `--quality faster`)、**録画済みファイルの配信は 1 段重いプリセット**
      (`-preset faster` / `--quality balanced` / NVENC は `p5`) にして、圧縮効率を落とす
      `-tune fastdecode,zerolatency` も外した。
        - 遅延の許容度と GOP 長は別物なので `StreamTuning` (`lowLatency` / `shortGop`) に分けた。
          録画済み HLS は「遅延は許容できるが LL-HLS のパート境界のため GOP は短くしたい」ケースにあたる
    - **音声トラックの切り替え**: 二か国語放送の副音声や複数音声 ES を再生中に切り替えられるようにした
        - **デュアルモノラルは `-map` では切り替えられない**。二か国語放送は「1 つのステレオ ES の左右に
          主音声・副音声」で送られるため、副音声の選択は `-dual_mono_mode sub` で行う。音声 ES が複数ある
          場合のみ `-map 0:a:<n>` で ES を選ぶ。この使い分けを `AudioTrackUtil` に閉じ込め、
          cmd のプレースホルダ `%DUALMONOMODE%` / `%AUDIOMAP%` として展開する
        - ストリーム API に `audioTrack` クエリ (`main` / `sub` / 音声 ES のインデックス) を追加した
        - 録画の一覧は `GET /api/videos/{videoFileId}/audio-tracks` (ffprobe)。**音声 ES が 1 本のステレオは
          主音声・副音声の 2 件へ展開する** (ただのステレオ放送か二か国語かを ffprobe からは判別できないため)。
          ライブは事前に構成が分からないのでクライアントが 2 択を常に出す
        - **UI は DPlayer の設定 > 音声パネルの DOM を流用**した。DPlayer 標準の実装は mpegts.js / hls.js の
          トラックを直接叩くもので、サーバー側でストリームを作り直す EPGStation の方式には使えないため、
          項目の生成とクリック時の動作だけを `DPlayerEnhancer` で差し替えている
        - **手書き cmd では効かない**: `-dual_mono_mode main` を直書きした既存の cmd はプレースホルダが
          無いため切り替わらない (再生自体は従来どおり)。両テンプレートには埋め込み済み
    - **チャプター表示**: エンコード済みファイルに埋め込まれたチャプターをシークバー上に表示し、
      `[` / `]` で前後のチャプターへ移動できるようにした
        - `GET /api/videos/{videoFileId}/chapters` が `ffprobe -show_chapters` の結果を返す (DB には持たない)
        - **DPlayer の `highlight` は生成時にしか読まれない**ため、チャプターはプレイヤーを作る前に取得する。
          ファイル直接再生 (`NormalVideo`) は動画長が `loadedmetadata` まで分からないので、読み込み後に
          マーカーを自前で描き足す
    - **プレイヤー機能の追加**: DPlayer が持っていて使っていなかった機能を有効化した
      (スクリーンショット / Picture-in-Picture / AirPlay)。再生速度は 0.25〜4.0 の 12 段階へ拡張。
      キーボードは `,` / `.` でコマ送り、`[` / `]` でチャプター移動、`c` で字幕、`i` で統計情報パネルを追加した
      (**プレイヤーにフォーカスがあるときだけ拾う**。画面全体で拾うと検索フォームの入力を奪う)
    - **実機確認**: ライブ視聴で LL-HLS のブロッキング要求 (`?_HLS_msn=14&_HLS_part=0`) とパート取得
      (`stream0-14.0.part.m4s`) が 200 で流れること、ARIB 字幕が出ること、設定 > 音声で副音声を選ぶと
      サーバー側の ffmpeg が `-dual_mono_mode sub` で起動し直すことを確認した
    - **実装場所**: `src/util/EncodePresets.ts`, `src/model/service/stream/util/AudioTrackUtil.ts`,
      `src/model/api/video/{VideoUtil,VideoApiModel}.ts`, `src/model/service/api/videos/{videoFileId}/{chapters,audio-tracks}.ts`,
      `client/src/util/DPlayerEnhancer.ts`, `client/src/components/video/*`
    - **テスト**: `test/ut/audio-track-util.test.js` / `test/ut/video-util-chapters.test.js` を新規追加。
      `test/ut/encode-presets.test.js` にコーデック別ビットレート・用途別プリセット・プレースホルダの検証を追加

- **HLS 配信を LL-HLS (EXT-X-PART) にし、録画済み HLS も fMP4 化して HEVC / iOS で再生できるようにした**
    - **背景**: HEVC を使いたいが iPhone / iPad で再生できない組み合わせが複数あった
        - **録画済み HLS が MPEG-TS セグメントだった**。Apple の HLS は **HEVC を fMP4 でしかサポートしない**ため、TS セグメントに HEVC を入れても iOS / Safari では再生できない
        - **rigaya 系エンコーダ (QSVEncC / NVEncC / VCEEncC) の HEVC に `hvc1` タグが付いていなかった**。rigaya 側の cmd は「rigaya でエンコード → ffmpeg で `-c:v copy` remux」の形だが、その remux に `-tag:v hvc1` が無く、既定の `hev1` タグのままだと iOS / Safari で映像が出ない。**ffmpeg 直接エンコード側 (`buildVideoCodecOptions`) には元から `-tag:v hvc1` が入っていたため、rigaya 経路だけが抜けていた**
        - ライブ HLS は in-memory fMP4 化済みだったが `#EXT-X-PART` が無く、hls.js 側も `lowLatencyMode: false` で運用していた
    - **LL-HLS を実装した**: `HLSMemoryStoreModel` にパート保持を足し、`#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES` / `#EXT-X-PART-INF` / `#EXT-X-PART` / `#EXT-X-PRELOAD-HINT` を出すようにした。`?_HLS_msn` / `?_HLS_part` 付きのブロッキングプレイリスト要求と、`PRELOAD-HINT` で先行要求された未生成パートへの要求は、該当パートが生成されるまでレスポンスを保留する (上限 6 秒)。パートの URL は `stream{id}-{seq}.{index}.part.m4s` でセグメントの `stream{id}-{seq}.m4s` と衝突しない
        - `Fmp4Packager` は元からパートを emit していたので、`partsPerSegment` を 1 → 2 にして「GOP 0.5 秒 = 1 パート、2 パート = 1 秒セグメント」にした (`#EXT-X-TARGETDURATION` は整数秒で 1 が下限のため、パート長のままセグメントにはできない)
        - **`emsg` (ARIB 字幕) をセグメント先頭からパート先頭へ移した**。LL-HLS ではパートが単独で配信されるため、セグメント確定を待って `emsg` を付けるとパート経由で再生しているプレイヤーに字幕が一切届かない。セグメントはパートの単純連結なので、パート側に載せれば両方に入る
        - `delete()` は待機中の要求を必ず解決する (解決せずにエントリを消すとレスポンスが返らなくなる)
    - **録画済み HLS を in-memory fMP4 (LL-HLS) 化した**: `EncodePresets.buildRecordedHlsCmd()` が生成する cmd を、ディスクへ TS セグメントを書き出す形 (`-f hls -hls_segment_filename %streamFileDir%/…`) から fragmented MP4 を `pipe:1` へ書き出す形へ変えた。`%streamFileDir%` を含まないことが in-memory モードの判定条件なので、これだけで `RecordedStreamBaseModel.isMemoryHLS()` が true になる (in-memory 配信の仕組み自体は実装済みだった)
        - ストアは `create(streamId, 'recorded')` で作る。プレイヤー内の巻き戻しに応えるため、ライブ (掲載 6 / 保持 12 セグメント) より多い 180 セグメント (1 秒セグメント換算で約 3 分) を保持しすべてプレイリストへ載せる
        - 保持範囲を超える巻き戻しは、従来どおりクライアントがストリームを作り直して対応する (シーク = ストリーム再生成の設計は変えていない)
        - ディスク方式も従来どおり動く。`stream.profiles.recorded.*` を手書きすれば TS セグメント方式のまま使える
    - **HEVC / H.264 のパラメータを iOS 互換に揃えた**:
        - rigaya 経路の後段 ffmpeg に `-tag:v hvc1` を追加 (ライブ HLS / 録画 mp4 / 録画 HLS の 3 経路すべて)
        - `buildRigayaArgs()` に `--profile` / `--level` / `--output-depth 8` を追加。HEVC は Main (8bit 4:2:0)、H.264 は 720p 以上で High
        - ffmpeg 直接エンコード側も HEVC に `-profile:v main -pix_fmt yuv420p` とレベル (`x265-params level-idc` / `-level`) を明示。vaapi にも profile を追加した
        - `config/enc.js.template` (録画エンコード) も同様に修正。**rigaya の HEVC は mp4 を直接書かず、mpegts を標準出力へ渡して ffmpeg で `-tag:v hvc1` 付き mp4 へ remux する** (rigaya 側にコーデックタグを指定するオプションが無いため)
    - **クライアント**: `LiveHLSVideo.vue` を `lowLatencyMode: true` に戻した (`maxLiveSyncPlaybackRate: 1` は維持。`LatencyController` の追いつき再生だけを止め、パート取得の利点は残す)。`RecordedHLSStreamingVideo.vue` は hls.js の設定を明示していなかった (既定は `lowLatencyMode: true`) ため、同じ方針で明示した
    - **実装場所**: `src/model/service/stream/util/{HLSMemoryStoreModel,IHLSMemoryStoreModel}.ts`, `src/model/service/stream/llhls/Fmp4Packager.ts`, `src/model/service/stream/base/{Live,Recorded}StreamBaseModel.ts`, `src/model/service/ServiceServer.ts`, `src/util/EncodePresets.ts`, `config/enc.js.template`, `client/src/components/video/{LiveHLSVideo,RecordedHLSStreamingVideo}.vue`
    - **テスト**: `test/ut/hls-memory-store-llhls.test.js` を新規追加 (プレイリストのタグ、未確定セグメントのパート掲載、パート待機、ブロッキング要求、破棄済みパート、`delete()` での待機解除、live/recorded モードの保持数)。`test/ut/encode-presets.test.js` に iOS 互換 (hvc1 / profile / level / 8bit) と録画済み HLS の fMP4 化を検証するケースを追加

- **EPG が取れていない放送局も放映中の一覧に出すようにした / リモコンキー順に並ばない原因を潰した**
    - **背景**: 放映中タブに出ていない放送局があり、番組表・放映中ともチャンネルがリモコンキー順に並んでいなかった。実データを調べたところ原因は別々の 2 つだった
        - **並び順**: サーバは既にリモコンキー昇順で返している (`ChannelDB.findChannleTypes()` / `findAll()` の ORDER BY)。ただし `remoteControlKeyId` が `null` の局は末尾へ回る仕様で、実機では地上波 183 局のうち **48 局が `null`** だった (テレ玉・とちぎテレビ・チバテレ・tvk・TOKYO MX・NHK 総合 (東京)・福島の民放 4 局など)。**EPGStation 側の不具合ではない**
        - **一覧から消えていた局**: `ScheduleApiModel.createSchedule()` が番組情報を 1 件も持たない放送局を落としていた。EPG が届いていない局は、視聴はできるのに放映中から消えていた
    - **`remoteControlKeyId` の欠損はチューナーサーバ側で直した**: 欠損していた行はいずれも `recisdb-proxy` に CSV インポート / `POST /api/channels` で手動登録した行で、その 2 経路は `remote_control_key` / `physical_ch` / `network_name` を NULL 固定で登録する (スキャン経由の行は NIT の TS情報記述子から埋まる)。共有チューナー (BonDriverProxyEx 経由) のようにスキャンを回さない構成だけが欠損する。**視聴・EPG 収集中の TS から NIT (PID 0x0010) を読み、NULL の列だけ埋める**コレクタを proxy 側に追加した (`tuner/nit_collector.rs` → `nit_writer.rs`)。既存値は上書きせず、照合は networkId 単位、衛星は対象外。**一度も選局していない局は埋まらない**ので、その分は末尾に残る
    - **EPG が無い放送局も放映中には出す**: `createSchedule()` に `includeEmptyChannels` を足し、**放映中 (`getBroadcastingSchedule`) のときだけ**番組が無い放送局を空の `programs` で返すようにした。**番組表 (`getSchedules`) は従来どおり出さない** (番組が 1 件も無い列が並ぶだけのため)
        - **出すのは親サービスだけ**: 全サービスを列挙して返すチューナーサーバでは未運用のサブチャンネル・データ放送・ワンセグまで並んでしまう。`getParentChannelIds()` が **映像・音声サービス (`ChannelUtil.isMediaService()`) かつ同一 networkId で serviceId 最小**のものに限る
        - クライアント側は `programs[0]` を前提にしていた箇所を直した。`OnAirState.createDisplayData()` は番組が無ければ番組名を「番組情報がありません」、時刻・説明を空にする。`getUpdateTime()` は番組の終了時刻から次の更新時刻を決めるため、番組が無い局を数えない。`OnAirCard.vue` は番組情報ダイアログの代わりにストリーム選択を開く
    - **確認**: 実機で放映中 253 局のうち **107 局が番組情報なしで新たに表示**されること、いずれも映像サービスの親サービスであること、番組表 API には出ないことを確認した
    - **テスト**: `test/ut/duplicate-sub-channel.test.js` に 3 ケース追加 (EPG ゼロなら親のみ / 映像サービス以外は出さない / 番組表には出さない)

- **全サービスを列挙して返すチューナーサーバ (recisdb-proxy) で放映中・番組表が壊れるのを直した**
    - **背景**: `recisdb-proxy` (BonDriver をそのまま並べる Mirakurun 互換実装) へ接続すると、放映中タブに何も表示されず、番組表には同じ番組の列が並んでいた。本家 Mirakurun (`stuayu/Mirakurun`) との API 応答の違いが原因で、実データを突き合わせたところ次の差があった
        - チューナ情報 (`/api/tuners`) の `types` が**空配列**で返る (Mirakurun は `["GR"]` のように埋まる)
        - サービス (`/api/services`) が **770 件** (Mirakurun は 573 件)。未運用のサブチャンネルや空きスロットまで列挙する
        - `remoteControlKeyId` が **1 件も無い** (Mirakurun は 573 件中 375 件にある)
        - `service_type` が `0` (未定義) のサービス、`serviceId` が `0` のサービスが混ざる
        - 番組情報の項目 (`description` / `extended` など) が値なしのとき **`undefined` ではなく `null`** で返る
        - `channel.type` が `GR` / `BS` / `CS` のみで、県外地上波の `NW1`〜`NW40` が付かない
    - **放映中タブが空だった**: 放送波の状態 (`GET /api/config` の `broadcast`) はチューナ情報の `types` から作っており、空配列だと全放送波が `false` になる。クライアントはこのフラグからタブを組み立てるため、**タブが 1 つも作られず画面が空**になっていた (番組表 API 自体は正常に返っていた)。`ReservationManageModel.getBroadcastStatus()` を、全放送波が `false` のときは**登録済みチャンネルの `channelType` から放送波を補う**ようにした (5 分キャッシュ)
        - 取得は `ChannelDB.findChannelTypeList()` (`channelType` の distinct) で、**待ち時間に 3 秒の上限**を設けている。`GET /api/config` は Service → Operator の IPC を挟むため、起動直後の一括同期などで DB が詰まっていると **API 全体が `IPCTimeout` で 500 になる**。上限を超えたときは古い値 (無ければチューナ由来の値) を返し、取得はそのまま裏で続ける
    - **EPG 更新が毎回落ちていた**: `ProgramDB.createProgramValue()` が `description` などを `typeof === 'undefined'` でしか判定しておらず、`null` が来ると `Cannot read properties of null (reading 'length')` で更新全体が失敗していた。`name` / `genres` / `description` / `extended` / `video` / `audio` / `audios` を `null` 許容にした
    - **番組表に同じ番組の列が並んでいた**: proxy は親チャンネルと同じ EIT をサブチャンネルにも載せる (実データでは「とちぎテレビ１/２/３」に同一の番組が入っていた)。Mirakurun はサブサービス自体を返さないため起きなかった。`ScheduleApiModel.createSchedule()` に、**同一 networkId 内で serviceId が最小のものを親とし、自身の番組がすべて親の同時刻・同名の番組に含まれるサブチャンネルだけを列から除外する**処理を入れた。サブチャンネルが別番組を放送している間は除外しない (設定 `isHideDuplicateSubChannel`、既定 有効)
    - **無効なサービスを取り込まないようにした**: `service_type` が `0`、または `serviceId` が `0` のサービスは放送されていない枠なので `EPGUpdateManageModel.updateChannels()` で除外する (実データで 21 件)。`ChannelDB.insert()` は受信できなくなった局を残す仕様で既存レコードを消さないため、**過去に取り込んでしまった分は `ChannelDB.deleteInvalidChannels()` が放送局更新のたびに掃除する** (実データで 11 件削除、719 局になった)
    - **県外地上波が全部 `GR` になる件は既存の地域別グルーピングで吸収する**: proxy は `channel.type` に `NW1`〜`NW40` を返さないため県外の局が `GR` に集まるが、番組表・放映中のグループは `BroadcastRegion` が networkId + serviceId から求める**地域**が軸 (既定 `channelGroupingType: 'region'`) なので、`GR` に集中しても地域ごとに分かれて表示される。EPGStation 側での NW 番号の自動採番は、既存の予約・ルールと不整合になるため行わない
    - **残る差 (proxy 側の対応が要るもの)**: `remoteControlKeyId` が無いためチャンネルの並びが id 順 (= networkId + serviceId 順) になる。`hasLogoData` が常に `false` のため局ロゴが出ない。どちらも放送波の NIT / ロゴ収集が要る情報で EPGStation 側では補えない
    - **テスト**: `test/ut/duplicate-sub-channel.test.js` (サブチャンネル除外の 4 ケースと無効サービス除外)

- **設定画面の不具合を直した (スナックバーの背景が透明・サーバー設定への導線が黙って消える・未保存かどうか分からない)**
    - **スナックバーの背景が出ていなかった**: 色の指定が Vuetify 2 のクラス名 (`success` / `grey darken-3`) のままで、Vuetify 3 以降の背景色ユーティリティ (`bg-success` / `bg-grey-darken-3`) と噛み合っていなかった。背景が透明のまま文字色だけ白が効くため、「保存されました」等が**まったく読めない**状態だった。`Snackbar.vue` が `bg-` を付けて class を組み立てるようにし、`SnackbarState.NROMAL_COLOR` も Vuetify 3 以降のパレット名 (`grey-darken-3`) へ直した
    - **サーバー設定への導線が黙って消えていた**: `GET /api/config` の取得は `main.ts` の起動時 1 回きりで、失敗すると `getConfig()` が `null` のままになる。`isFeatureEnabled()` は config 未取得でも `false` を返すため、**機能フラグで無効にしたときと区別が付かず**、設定画面上部の「サーバー設定を開く」が理由の説明なく消えていた (config を返す API は Operator への IPC を挟むため、Operator 側が応答できない状態だと 500 になる)。設定画面を開いた時点で config が未取得なら 1 度取り直し、それでも取れないときは「サーバーの設定情報を取得できていない」旨と再取得ボタンを出すようにした
        - `serverConfigModel` は DI のプレーンクラスでリアクティブではないため、再取得を画面へ伝える用の `serverConfigRevision` を getter から参照している
    - **未保存かどうか分からなかった**: 設定画面は編集内容を `tmp` に溜めて保存で確定する方式で、**保存せずにページを離れると破棄される**のに画面上に手掛かりが無かった。未保存のときだけページ**最上部**に警告バー (保存ボタン付き) を出し、**スクロールに追従させた** (`position: sticky`)。保存ボタンは設定項目の下端にあり、項目が多いと画面外に出てしまうため
        - sticky の `top` は `var(--v-layout-top, 64px)`。`0` にすると固定表示のヘッダー (`v-app-bar`) の裏へ潜って見えなくなる。Vuetify がレイアウトから算出している値なので、ヘッダーが低いモバイル幅でも追従する
        - 判定は保存済み内容の JSON 文字列 (`savedSnapshot`) と `tmp` の比較。localStorage を都度読み直さないのは、保存しても getter が再評価されず「未保存」が残るため
        - スナップショットは `created()` の**末尾**で取る。冒頭の `isForceDarkTheme` 代入で `tmp` が動くため、先に取ると OS テーマ連動時に常に未保存扱いになる
        - 画面下端の保存ボタン脇は「保存済みです」の表示だけを残した (未保存の告知は最上部のバーが担う)
    - **確認**: 実機で、保存時のスナックバーが緑背景 + 白文字で読めること、設定変更 → 未保存表示 → 保存 → 「保存済みです」に戻ること、`/api/config` を 500 に差し替えると警告と再取得ボタンが出て、再取得すると導線が復帰することを確認した

- **システム全体のテーマカラーを設定画面から選べるようにした**
    - **背景**: ヘッダーの色が `indigo` のハードコードで、他の画面要素も含めて色を変える手段が無かった。トグルスイッチ / プログレスバーの色抜け (下の項目) を直すにあたり、既定色を 1 箇所で決める仕組みが要ったため、そのまま利用者が選べる形にした
    - **仕組み**: Vuetify の theme に `appTheme` という独自の色を登録し (`client/src/plugins/vuetify.ts`)、その値を差し替えることで対象要素の色をまとめて変える。`bg-appTheme` / `text-appTheme` / `--v-theme-appTheme` として使える
    - **`primary` は差し替えない**: `primary` 自体を書き換えるとボタン・チップ・ダイアログなど `color="primary"` を明示している全箇所が連動して変わってしまう。テーマカラーの適用先はヘッダー (`TitleBar.vue`)・ナビゲーションドロワー (先頭のバージョン欄と選択中の項目)・トグルスイッチ・プログレスバーに限定している
    - **色の定義は `client/src/util/ThemeColorUtil.ts` の 1 箇所**。ブルー (既定、従来の indigo と同じ) / ライトブルー / ティール / グリーン / オレンジ / レッド / パープル / ブルーグレーの 8 色で、**ライト用とダーク用の 2 値を持つ** (暗い背景では濃い色が沈むため)。`apply()` はライト / ダーク両方の定義を同時に書き換える。表示中のテーマだけ更新すると、テーマを切り替えたときに古い色が残る
    - **設定は端末ごと** (`ISettingValue.themeColor`、localStorage)。ダーク / ライトの設定と同じ扱いで、設定 > 表示 に置いた。設定画面では選ぶと即座にプレビューされ、**保存せずページを離れると保存済みの色へ戻る** (`unmounted()` で `apply()` をやり直す)
    - **既存の localStorage には `themeColor` が無い**ため、読み出しは必ず `ThemeColorUtil.normalize()` を通して未知の値を既定色へ倒す
    - **ダークテーマのヘッダーは従来どおり色を敷かない** (既定の暗い背景のまま)。暗所での眩しさを増やさないため。ダークテーマでもスイッチ・プログレスバー・ドロワーの選択項目にはテーマカラーが乗る
    - **ナビゲーションの選択項目は Vuetify 標準の `active` + `color` で塗る**。独自クラス (`.selected`) への CSS では Vuetify 側の文字色指定に負けて色が乗らなかった
    - **確認**: 実機 (ローカル起動 + headless Chrome) で、既定 indigo → オレンジ選択 → 保存 → 再読込まで、ヘッダー / ドロワー / 選択項目 / プログレスバー / スイッチのすべてが追従することと、ダークテーマでダーク用の色が使われること、未保存で離脱すると元に戻ることを確認した

- **トグルスイッチとプログレスバーが白黒で表示され、オン / オフが分からなかったのを直した**
    - **背景**: 上流の Vuetify 2 では `v-switch` / `v-progress-linear` の既定色がテーマの `primary` (青) だったが、Vuetify 3 以降は既定色が無く `currentColor` で描画される。そのため `color` を明示していない箇所がすべて黒 (ダークテーマでは白) になり、ルール・設定画面のスイッチはオン / オフの区別が付かず、放映中・視聴履歴・エンコード・ストレージのプログレスバーも白黒になっていた ([#9](https://github.com/stuayu/EPGStation/issues/9))
    - **修正**: `client/src/plugins/vuetify.ts` の `createVuetify()` に `defaults` を追加し、`VSwitch` / `VProgressLinear` の既定色を `primary` にした。Vuetify の `defaults` はコンポーネント側で `color` を指定していない場合のみ適用されるため、`color="info"` などを明示している箇所 (シリーズ詳細の視聴率バー、ストレージ使用量の残量に応じた色分けなど) は従来どおりの色を保つ
    - **なぜ個別対応にしなかったか**: `v-switch` は 45 箇所、`v-progress-linear` は 20 箇所あり、今後の追加分でも同じ指定漏れが起きる。既定値を 1 箇所で決めるほうが漏れない

- **Mirakurun の `Service.channel` を配列 / 単一オブジェクトの両形式で正規化し、放送局索引の欠落を防いだ**
    - **背景**: `ChannelDB` では `physicalChannel` の存在だけを見て安全に DB へ格納していたが、`EPGUpdateManageModel.updateChannelIndex()` だけ `channel.channel` が未定義なら無効扱いしていた。Mirakurun 互換実装では「物理チャンネル情報はあるが channel 番号が `undefined` のサービス」が理論上あり、放送局索引だけ落ちていた
    - **修正**: `service.channel` を `mapid.Channel[] | mapid.Channel | undefined` で正規化し、`physicalChannel` が存在するかのみを見て索引へ登録するようにした。`service.channel === undefined` はそのまま skip し、`type` の未定義だけを invalid とみなして 1 件まとめて warn を出す
    - **ログ方針**: 破損した channel は例外的な値であるため、サマリ付きの `warn` を 1 件だけ出す。`undefined` の場合はノイズを出さずに skip し、EPG 更新のたびに大量ログが出ることを避ける
    - **テスト**: `test/ut/epg-channel-index.test.js` に「配列形式」「単一オブジェクト形式」「`service.channel` 未定義は skip」「不正な channel は warn 1 件のみ」ケースを追加した
    - 実装は `src/util/ChannelUtil.ts` の `resolvePhysicalChannel()` に共通化し、`ChannelDB` と `EPGUpdateManageModel` の正規化を揃えた

- **放映中 (`/onair`) にピン留めタブを追加し、初期表示にした**
    - **背景**: 視聴画面の右パネル (チャンネルタブ) にしかピン留めが無く、放映中の一覧では県外地上波 (NW1〜NW40) を含む多数の地域タブから毎回目的の局を探す必要があった
    - **タブ**: `OnAirState.getTabs()` の先頭にピン留めタブ (`pinned`) を返すようにした。**ピン留めが 1 件以上あるときだけ並べる**ため、Vuetify の `v-tabs` が先頭を自動選択する動きにそのまま乗って初期表示がピン留めタブになる (ピン留めが無い環境の見た目・初期タブは従来どおり)
    - ピン留めタブの中身は `OnAirState.getSchedules('pinned')` が返す。放送波・地域をまたいで**ピン留めした順**に並ぶ
    - **設定は視聴画面と共通** (`ISettingValue.pinnedChannelIds`)。放映中のカード右上にもピンアイコンを置き、その場でピン留め・解除ができる。まとめて編集するダイアログはタイトルバーの 📌 ボタンから開く (ピン留めが 0 件でタブが無い状態からでも登録できるようにするため、タブの中ではなくタイトルバーに置いた)
    - ダイアログは視聴画面と共用にするため `components/watch/WatchPinnedChannelsDialog.vue` → `components/channel/PinnedChannelsDialog.vue` へ移した。視聴画面側はタブの中に「ピン留めを編集」を持つため、`getTabs({ alwaysIncludePinned: true })` で空でもタブを出す
    - ピン留めタブの組み立て (タブ定義・ピン順の並べ替え) は `WatchPanelChannels.vue` から `OnAirState` へ移し、2 画面で同じ実装を通るようにした

- **シリーズの引き当てキー (`normalizedTitle`) に録画タイトルの余計な文字列が残っていたのを、メタデータ再取得で一括修正するようにした**
    - **背景**: シリーズは録画タイトルから作られるため、局が送出した編成枠名・サブタイトル・出演者・記号がそのまま引き当てキーに残ることがある。実データでは表示名「王様のブランチ」に対しキーが `王様のブランチ 日曜劇場「vivant」から堺雅人&阿部寛&ドラムがスタジオ生出演` になっていた。表示名は `SeriesMetadataFiller` が辞書の正式タイトルへ同期するが**キーは録画タイトル由来のまま据え置く仕様**だったため、同じ作品の次の録画がこのシリーズに当たらず、シリーズが際限なく増え続けていた
    - **修正**: `SeriesMetadataFiller.fill()` に引き当てキーの同期を追加した。シリーズ一覧右上の「作品辞書から再取得」ボタン (全件) とシリーズ詳細の「辞書から再取得」(1 件) の両方に効く
    - **別作品を巻き込まないための条件** (3 つすべてを満たす場合のみ寄せる):
        1. **作品辞書で作品が確定している** (`syobocalTid` / `annictId` / `wikidataQid` のいずれかを持つ)。外部 ID が無いシリーズはキーを触らない
        2. **表示名が手動設定でない** (`titleSource !== 'manual'`)。手動で付けた名前からキーを作らない
        3. **寄せた先のキーが他のシリーズと使われていない**。衝突する場合は見送り、件数だけ報告する (統合はシリーズ一覧のマージ操作の担当。特番と本編のように「同じ作品名だが別シリーズ」を自動で 1 つに潰さないための歯止め)
    - **実データでの効果**: 1082 シリーズのうちキーがずれていた 81 件中 **70 件が自動で寄り、11 件が衝突で見送り**。見送りは `「鬼滅の刃」シリーズ全編再放送` → `鬼滅の刃`、`「死滅回游」放送直前!『呪術廻戦』総復習スペシャル特番!` → `呪術廻戦` のように本編シリーズが別に存在するもので、いずれもマージの判断が要るケースだった
    - **結果の報告**: `RefreshSeriesMetadataResult` に `keySynced` (寄せた件数) と `keyConflicted` (衝突で見送った件数) を追加し、シリーズ一覧のスナックバーに「判定キー N 件を整理、M 件は既存シリーズと重複のため要マージ」と出す。Operator のログにも変更前後のキーを info で残す
    - 実装は `SeriesMetadataFiller.syncNormalizedTitle()`、衝突チェックは `ISeriesDB.findByNormalizedTitleExact()` (新規)。テストは `test/ut/series-metadata-filler.test.js` の 4 件 (寄せる / 衝突で見送る / 外部 ID 無しは触らない / 手動命名は触らない)

- **録画が 1 件も無いシリーズが EPG 更新のたびに量産されるバグを修正した**
    - **原因**: 番組表 ⇄ シリーズの事前マッピング (`ProgramSeriesApiModel.precompute()`) が、既存シリーズの候補が 1 件も無かった番組について**シリーズを新規作成**していた。録画側の `SeriesResolver` からコピーした「類似候補が無い = 明確な新規シリーズ」という判断だが、録画は実体があるのに対し EPG は録画と無関係な番組 (ニュース・天気予報・通販・単発特番・「サブチャンネル切り替え方法のご案内」など) を大量に含むため、`PROGRAM_UPDATED` が飛ぶたびに空シリーズが増え続けていた
    - シリーズ名も `program.name` の生値 (`Ａ－Ｓｔｕｄｉｏ＋【瀬戸康史】[解][字]` のような記号・出演者付き) をそのまま使っていた。録画側は `displaySeriesTitle()` で話数・記号を落とすため、両者が非対称だった。さらに作品辞書を引かないため辞書起点のシリーズとも二重化していた
    - 番組が過去になって `program` 行が消えると `program_series_link` も無くなるため、**シリーズだけが孤児として残る**。実データでは 1082 シリーズ中 80 件が録画 0 件で、作成時刻が同一秒に 15 件・13 件と固まっていた (= EPG 更新バッチ産)
    - **修正**: `precompute()` の候補 0 件分岐から `createSeries()` を削除し `skipped` として数えるだけにした。この API の目的は「番組表と**既存の**シリーズライブラリの対応付け」なのでシリーズの新設は不要で、シリーズを作るのは実体 (録画) がある `SeriesResolver` 側の責務に一本化した。回帰テストは `test/ut/program-series-api.test.js` の `precompute never creates a series when no candidate exists` (スタブの `createSeries` が呼ばれたら失敗する)
    - 既に作られてしまった空シリーズは**サーバー設定 > シリーズ管理タブの「空シリーズ」欄**から削除できる (`DELETE /api/series/empty`)

- **放送中画面でチャンネルを選んでも DPlayer の映像が切り替わらないバグを修正した**
    - **原因**: 右パネルのチャンネル一覧からの切り替えは `/onair/watch` の query だけが変わる遷移なので、Vue Router は同じコンポーネントを使い回す。`videoParam` は書き換わるが `VideoContainer` に `key` が無く `videoParam.type` も同じのため、`LiveMpegTsVideo` / `LiveHLSVideo` が再マウントされない。各 video コンポーネントは `mounted()` でしか DPlayer を生成せず props の変化を見ていないため、古いチャンネルの映像が流れ続けていた
    - **修正**: 録画視聴側 (`WatchRecorded.vue` / `WatchRecordedStreaming.vue`) と同じやり方に揃え、`WatchOnAir.vue` の `VideoContainer` にも `videoKey` (配信種別 + 放送局 + エンコード設定) を付けて作り直すようにした。あわせて route 変更時に `videoParam` と実況コメントをリセットするようにした
- **視聴画面 (放送中・録画再生) をダークモード・ライトモードの両方に対応させた**
    - 視聴画面の配色は `#15100f` や `rgba(255, 255, 255, ...)` のハードコードだったため、ライトモードでも常に黑背景のままだった
    - `WatchLayout.vue` で `--watch-bg` / `--watch-fg*` / `--watch-surface-*` / `--watch-border*` といった CSS 変数を一括定義し、`$vuetify.theme.global.current.dark` を見てルート要素に `is-light` クラスを付ける方式にした
        - CSS 変数は scoped style の影響を受けず DOM を辿って継承されるので、子コンポーネントの scoped style からもそのまま参照できる
        - 対応ファイル: `WatchLayout.vue`, `WatchTopBar.vue`, `WatchSideBar.vue`, `WatchSidePanel.vue`, `WatchPanelProgram.vue`, `WatchPanelComments.vue`, `WatchPanelChannels.vue`, `NextUpPanel.vue`
    - 実況コメントの既定色は白なので、ライトモードでは右パネルのコメントが白背景に埋もれて読めなくなるため、白系のときだけテーマ色を使うようにした (`getCommentColor()`)
    - 映像の上に重なるチャンネル切替ボタンと映像の黑帯は、両モードで成立するため黑背景・白文字のままにしている

- **EDCB からの録画情報登録と TS ファイルのアップロードが失敗していたのを直した**
    - **背景**: 「サーバー上のファイル指定 (`localFilePath`)」を `POST /api/videos/upload` に追加した際、multipart/form-data で届く**空文字**を考慮していなかった
    - **アップロードが壊れていた原因 (1)**: `ServiceServer.uploadFile()` が `req.body.recordedId` を無条件に `parseInt()` していたため、空文字や数値以外が届くと **`NaN`** になり、OpenAPI の `integer` 検証で 400 になっていた。これにより「`recordedId` を省略して TS から番組情報を自動作成する」経路が使えなくなっていた。空文字・数値以外は「未指定」としてキーごと落とすようにした
    - **アップロードが壊れていた原因 (2)**: `localFilePath` が空文字で届くと `typeof === 'string'` の判定を抜けてしまい、**ブラウザからの通常の TS アップロードなのに** `ImportPathValidator` の importDirs 検証に入り、`importDirs` 未設定の環境で `ImportDirsNotConfigured` で失敗していた。API 層 (`videos/upload.ts`) とモデル層 (`RecordedApiModel.addUploadedVideoFile`) の両方で**非空のときだけ**サーバー上のファイル指定とみなすようにした (`subDirectory` も同様に正規化)
    - **EDCB 取り込みが壊れていた原因**: `config.yml` に `importDirs` を書いていないと `importDirs` は空配列になるが、スキャンは `ImportDirNotFound` (= 名前違い) と区別がつかないエラーを返していた。**`importDirs` ごと未設定の場合は `ImportDirsNotConfigured`** を返し、設定漏れと名前違いを切り分けられるようにした
        - EDCB の録画を取り込むには `config.yml` の `importDirs` に録画フォルダを登録する必要がある (テンプレートではコメントアウトされている)
    - **テスト**: `test/ut/recorded-upload-local-file.test.js` に「空文字の `localFilePath` は未指定扱い」「`importDirs` 未設定時は `ImportDirsNotConfigured`」を追加

- **前番組の延長中に録画が始まって前番組が録れてしまうのを防いだ (EIT[p/f] による録画開始ゲート)**
    - **背景**: programId 予約は Mirakurun が EIT[p/f] で対象イベントが present になるまでデータを流さないため問題にならないが、**時刻指定予約はチャンネルストリームを使う**ので予定時刻から即データが流れる。前番組が「放送時間未定」(ARIB の duration = 0xFFFFFF) で延長していると、その前番組が録画ファイルとして残り、録画詳細も作られてしまっていた
    - **EIT[p/f] を録画側でも読む**: `EitPresentParser` (`src/model/operator/recording/`) が録画ストリームから EIT[p/f] present/following (PID 0x12 / table_id 0x4E / section 0/1) を取り出し、放送中の番組の `eventId` / 開始時刻 / 番組長を返す。`current_next_indicator` と CRC-32 も検証し、現在有効でない断片や破損した断片を開始判定に使わない
    - **開始判定**: `RecordingStartGate` (`decideRecordingStart()`) が「いま流れているのが予約した番組か」を判断する。programId 予約は `eventId` の一致、時刻指定予約はまず following の `start_time` を使い、following が未到着の場合だけ present の開始時刻をフォールバックとして使う (既定 2 分のマージン込み)。**放送時間未定の番組が流れている間は延長中とみなして待つ**
    - **待っている間のデータは捨てる**: `RecorderModel.doRecord()` はゲートを通るまで録画ファイルを作らず pipe もしない (ゲート通過までストリームは `pause()` しておく)。そのため前番組は録画ファイルにも録画一覧にも残らない
    - **録り逃さないための安全弁**: EIT[p/f] を読めないまま `startGateTimeoutMs` (既定 60 秒) を過ぎたら録画を開始する。予約終了時刻を過ぎても始まらない場合は `WaitingForEventStart` として従来の再試行 (最大 3 時間待ち) へ回す。待機中は予約の「追従中」表示が点く
    - **設定**: `config.yml` の `recording` に `startGateEnabled` (既定 true) / `startGateTimeoutMs` / `startGateStartMarginMs` を追加した
    - **テスト**: `test/ut/recording-start-gate.test.js` (判定の分岐、設定の丸め、EIT[p/f] セクションの解析)

- **録画の再生速度がライブ視聴にも波及していたのを直した**
    - **原因**: DPlayer は再生速度を localStorage (`dplayer-speed`) に保存し、次に生成したプレイヤーへ自動で適用する。録画とライブで同じ localStorage を共有しているため、録画を倍速で見た後にライブ視聴を開くとライブまで倍速で始まっていた
    - **対処**: `BaseVideo.createDPlayer()` を追加し、**ライブ (`options.live === true`) のときだけ**生成中に保存値を等速に見せ、生成後に元の値へ戻す。さらにライブ中に速度を変えても `user.set('speed')` を保存へ通さない (画面内では効くが録画側の設定を書き換えない)。録画側の速度設定は従来通り保持される

- **ログ画面をログの構造に沿って表示するようにした**
    - **背景**: ログを 1 行そのまま出し、行全体をレベルで色付けするだけだったため、時刻・レベル・カテゴリ・本文が読み分けられなかった
    - **実装**: `client/src/util/LogLineParser.ts` が log4js の既定パターン (`[時刻] [レベル] カテゴリ - 本文`) を分解する。パターンに合わない行 (スタックトレースの続きなど) は本文だけの行として扱う。画面では時刻・レベルバッジ・カテゴリ・本文を分けて描画し、ERROR / FATAL と WARN は背景色と左のラインで目立たせる。絞り込みキーワードは本文中で強調する (`v-html` は使わず分割して描画する)

- **系列局の一覧画面を追加した (選ぶと系列別の番組表へ遷移する)**
    - **系列別が機能していなかった原因**: サーバは `GET /api/channels` に系列 (`affiliation`) を付けていたが、クライアントの `ChannelModel.toChannel()` が `region` だけを写して **`affiliation` を落としていた**。そのため系列別のサイドメニュー・放映中のタブ・系列局一覧がすべて空になっていた (実データ 200 局で系列判定自体は正しく効いている: NHK総合 27 / Eテレ 32 / 日テレ系 27 / テレ朝系 31 / TBS系 30 / フジ系 20 / テレ東系 4 / 独立系 21 / 未分類 8)
    - **切り替え UI の集約**: 番組表・放映中の 3 点リーダーにあった「放送局のまとめ方 (地域別 / 系列別)」を削除し、**系列局の一覧画面 (`/affiliations`) へ遷移する導線**に置き換えた (`ChannelGroupingMenu.vue` は削除)。サイドメニュー・放映中タブを系列別にする切り替えは系列局ページのスイッチへ移した
    - **背景**: 系列別のまとめ方は番組表・放映中の 3 点リーダーとサイドメニューにしか無く、「どの系列にどの局があるか」を見る画面が無かった
    - **UI**: `/affiliations` (`client/src/views/Affiliations.vue`) を追加し、ナビゲーションに「系列局」を出す。系列ごとにカードで並べ、カードを選ぶと `/guide?affiliation={id}` (系列別の番組表) へ、局のチップを選ぶとその局の番組表へ移動する。系列の判定はサーバが `GET /api/channels` に付ける `channel.affiliation` をそのまま使うため、新しい API は増やしていない
    - **関東の独立局**: 東京MX・群馬テレビ・とちぎテレビ・テレビ埼玉・千葉テレビ・tvk は同梱データ (`BroadcastAffiliationData`) で系列識別 0x07 (独立系) にまとまる。県外地上波 (`NWxx`) でも同じ扱いになることを `test/ut/broadcast-affiliation.test.js` で固定した
    - **切り替えスイッチが保存されていなかったのを直した**: 「サイドメニューの番組表・放映中のタブを系列別にする」スイッチは `ISettingStorageModel.getSavedValue()` の戻り値 (localStorage から作り直した別オブジェクト) を書き換えてから `save()` を呼んでいた。`AbstractStorageBaseModel.save()` が保存するのは `tmp` なので変更が捨てられ、**スイッチを入れてもサイドメニュー・放映中のタブが地域別のままだった**。`resetTmpValue()` で保存値を `tmp` へ読み直してから 1 項目だけ書き換えて保存するようにした
    - **系列別番組表の並び順**: 系列で絞った番組表は**キー局を先頭に置き、それ以降は都道府県コード順**で並べる (`client/src/util/AffiliationChannelSort.ts` の `sortByKeyStationAndPrefecture()` を `GuideState.filterSchedules()` から使う)。キー局は関東広域の 7 局の `networkId` (32736〜32742 = NHK 総合 / NHK E テレ / 日テレ / TBS / フジ / テレ朝 / テレ東) で判定し、都道府県コードは `channel.region.order` (JIS X 0401。広域圏は最小の県コード、判定不能は 99) をそのまま使う

- **視聴履歴の一覧画面を追加した**
    - **背景**: 視聴履歴 (`watch_history`) は再生位置と視聴状態を持っていたが、録画一覧のバッジと再生時の続き再生に使うだけで、「最近見た番組」を一覧する画面が無かった
    - **API**: `GET /api/watch-history` (最後に見た順・`offset` / `limit` / `status` / `isHalfWidth`) と `DELETE /api/watch-history/{videoFileId}` を追加した。1 件ずつは `WatchHistoryRecord` (履歴 + 対象の `RecordedItem`) で返し、**録画が削除済みの履歴は `recorded: null` にして行だけ残す** (画面から履歴を消せるようにするため)。機能フラグ `watchHistory` が無効なら 404
    - **UI**: `/watch-history` (`client/src/views/WatchHistory.vue`) を追加し、ナビゲーションに「視聴履歴」を出す (機能フラグ有効時のみ)。サムネイル・放送局・最終視聴日時・再生位置の進捗バー・視聴状態を並べ、行をクリックすると続きから再生する。「すべて / 視聴中 / 視聴済み」で絞り込める
    - **テスト**: `test/ut/watch-history-api.test.js`

- **録画 1 件だけ TS を再解析できるようにした (過去に取り込んだ録画の番組情報の補完)**
    - **背景**: 取り込み時に番組情報が入らなかった録画や、解析ロジックを更新した後の録画を直す手段が「全件を強制再解析」しか無かった。件数が多い環境では 1 件直すために全件を舐めることになる
    - **API**: `POST /api/videos/analyze` の `StartVideoAnalyzeJobOption` に `recordedId` を追加した (省略時は従来通り全件)。指定した場合はその録画のビデオファイルだけを対象にし、**解析済みでも必ずやり直す** (`mode` は `all` 扱い)。対象ファイルが無ければ `VideoFileIsNotFound` (404)。`VideoAnalyzeJob` にも `recordedId` を載せ、進捗表示から対象が分かるようにした
    - **UI**: 録画詳細の 3 点リーダーに「TS を再解析」を追加した。サーバー設定の TS 解析パネルには、既存録画の空の項目が「全件を強制再解析」で埋まること (既存値は上書きしないこと) を明記した

- **シリーズ詳細の上部に概要ヘッダを置き、アイキャッチ画像と作品情報を一目で分かるようにした**
    - **背景**: シリーズ詳細 (`/series/{id}`) は上部が操作ボタンの列とアラートだけで、シリーズ一覧では見えていた**アイキャッチ画像・クール・録画件数・容量・視聴進捗・状態バッジが一切表示されていなかった**。どの作品を見ているのかがタイトル文字列だけになり、一覧から遷移した瞬間に情報量が落ちていた
    - **概要ヘッダ (`client/src/views/SeriesDetail.vue` の `series-hero`)**: 左にアイキャッチ画像 (幅 280px、無い作品は代替アイコン)、右に次を積む。600px 未満では画像を上に回して縦積みにする
        - タイトルと読み仮名
        - 状態チップ (放送中 / 出所 (辞書・ローカル) / メディア種別 / 未視聴 / 欠番 / 重複 / シリーズ名は手動設定)
        - 基本情報の 1 行 (クール・録画件数 / 全話数・容量・放送局数・初回 / 最新録画日)
        - 視聴進捗バーと「n/m 視聴 (x%)」
        - 外部辞書のタグ (`SeriesExternalLinks`) と操作ボタン (辞書から再取得 / 録画を再問い合わせ / Annict 同期)
        - 画像の出所 (録画サムネイル代用) と著作権表記
    - **表示ロジックを一覧と共通化した**: クール表記・視聴率・容量表記・シリーズの出所ラベルを `client/src/util/SeriesDisplay.ts` に切り出し、シリーズ一覧 (`Series.vue`) と詳細の両方から使う (同じ値が別実装で食い違わないようにするため)
    - **サーバ側**: `GET /api/series/{seriesId}` は `totalFileSize` / `unwatchedCount` を **0 固定で返していた** (一覧用のフィールドを詳細では埋めていなかった)。一覧と同じ集計を 1 件分だけ引く `ISeriesDB.querySummary(seriesId)` を追加し、実値を返すようにした。API のスキーマは変わらない
    - **アラートの整理**: 欠番・複数録画のアラートは `variant="tonal"` + `density="compact"` にして、概要ヘッダのバッジと二重にならない程度の主張に落とした (話数の一覧は引き続きアラート側に出す)

- **しょぼいカレンダーのコメントを Wiki 記法として描画し、シリーズ画面の導線を整理した**
    - **背景**: しょぼいカレンダー由来のコメントは独自の Wiki 記法 (`*見出し` / `-箇条書き` / `:項目:内容` / `[[ラベル URL]]` / `!注記`) で書かれているが、画面ではそのまま文字列として出していたため「\*リンク」「:監督:○○」のような生の記法が並んでいた
    - **レンダラ**: `client/src/util/SyobocalWiki.ts` が記法を解析してブロック (見出し・箇条書き・定義リスト・注記・段落) とインライン要素 (テキスト・リンク) の構造にする。描画は `client/src/components/series/SyobocalComment.vue` + `WikiInlineText.vue` が行い、**`v-html` は使わない** (解析済みの構造をテンプレートで描画するため、コメント本文から HTML が混入しない)。リンクは `http(s)` のみ許可し、別タブで開く (`rel="noopener noreferrer"`)
    - **適用箇所**: シリーズ詳細の作品コメント・放送回コメント、録画詳細のシリーズ情報欄の両方。長い作品コメントは既定で折りたたみ、「もっと見る」で展開する (従来の `-webkit-line-clamp` から、末尾をフェードさせる表示に変更)
    - **Wikidata のタグを表示・リンクした**: `SeriesDetail.externalIds` に `wikidataQid` を追加し (`api.d.ts` / `SeriesApiModel`)、外部辞書のタグを共通コンポーネント `client/src/components/series/SeriesExternalLinks.vue` に集約した。しょぼいカレンダー (`https://cal.syoboi.jp/tid/{tid}`)・Annict (`https://annict.com/works/{id}`)・**Wikidata (`https://www.wikidata.org/wiki/{QID}`)** の 3 つを、シリーズ詳細と録画詳細の両方で同じ見た目のリンク付きタグとして出す
    - **シリーズ詳細に「辞書から再取得」ボタンを追加した**: `POST /api/series/refresh-metadata` に `seriesId` を渡せるようにし (`ISeriesMetadataFiller.fill({ seriesIds, force })`)、そのシリーズだけメタデータを取り直せるようにした。1 件指定のときは `force` 扱いで**すでに埋まっている項目も辞書の値で引き直す** (表示名・クール・コメントの**手動設定は対象外**のまま)。従来はシリーズ一覧の全件再取得しか無く、1 作品だけ直す手段が無かった
    - **録画詳細からシリーズ詳細への導線**: シリーズ名リンクをリンク色 + 下線 + `chevron-right` にしたうえで、チップ列に埋もれない位置に「シリーズ詳細を開く」ボタンを独立して置いた
    - **スマホでのポップアップ崩れ**: シリーズ判定結果ダイアログ (`SeriesAnalyzeDialog.vue`) が「照会 / 入力 / 戻り値」の 3 列テーブル (セル幅 380px 固定) で横スクロールしていたため、**カードを縦に積むレイアウト**へ変更し、幅 600px 以下では項目名と値も縦積みにした。あわせて `smAndDown` では全画面ダイアログにする
    - **テスト**: `test/ut/series-metadata-filler.test.js` に `fill({ seriesIds })` の絞り込みと `force` の上書き / 手動設定の保護を追加

- **取り込み・アップロードした TS でも、EPGStation で録画した番組と同じ項目を表示できるようにした**
    - **背景**: EPGStation の録画は Mirakurun の番組情報から概要・詳細・ジャンル 3 組・映像音声情報まで入るのに対し、アップロードや API 経由で登録した録画は概要・ジャンル 1 組までしか入らず、映像音声情報は空のままだった。同じ TS を持っていても画面の情報量が大きく違っていた
    - **TS 解析の拡張**: `TsInfoAnalyzer` が EIT[p/f] の **component_descriptor (0x50)** と **audio_component_descriptor (0xC4)** を読むようにし、`TsInfo` に `videoType` / `videoResolution` / `videoStreamContent` / `videoComponentType` / `audioSamplingRate` / `audioComponentType` を追加した。`stream_content` → `mpeg2` / `h.264` / `h.265`、`component_type` → `1080i` 等の対応表は Mirakurun (`EPG.ts`) と同じ値を使う
    - **登録時に反映**: `CreateNewRecordedOption` に映像音声の項目を追加し、アップロード (`createRecordedFromUploadedTsFile`) と外部取り込み (`importExternalRecordedFiles`) の両方が同じ `applyTsInfoToCreateOption()` を通るようにした。**ジャンルも 1 組だけでなく EIT に載る 3 組すべて**を入れる (従来は `genre1` のみ)。画面から指定されたジャンルは TS 由来の値より優先する
    - **後から追加した動画ファイルでも補完**: API で録画情報だけ先に作り、後から動画ファイルを足す経路 (外部連携) では上の処理を通らないため、`VideoFileAnalyzeModel.saveTsInfo()` から `applyProgramInfo()` を呼び、**空の項目だけ** EIT の値で埋めるようにした (`IRecordedDB.updateProgramInfo()`)。すでに値が入っている項目は上書きしない。番組名は利用者が付けた名前を尊重して触らない
    - **既存の録画も直せる**: サーバー設定の解析ジョブ (`tsInfo`) を実行すると、既存の録画ファイルにも同じ補完が走る
    - **テスト**: `test/ut/video-file-analyze-model.test.js` に「空の番組情報を EIT で補完する」「入っている項目は上書きしない」を追加

- **録画ファイルのアップロードで、TS ならファイルだけ上げれば番組情報をサーバー側で自動作成するようにした**
    - **背景**: アップロード画面は放送局・日付・長さ・番組名の入力が必須だった。放送 TS の PSI/SI にはこれらがすべて入っているため、TS を上げるときにまで手入力させる必要が無い
    - **API**: `POST /api/videos/upload` の `recordedId` を任意にした。**省略しかつ拡張子が `.ts` の場合**、アップロードされたファイルを解析して番組情報を新規作成し、そこへ紐付ける。応答は `{ recordedId }` (自動作成した場合は新しい id)
        - **対象判定は `fileType` ではなく拡張子で行う**。tsreplace 系 (映像だけ差し替え済みで出力拡張子は `.ts` のまま) は `fileType` が `encoded` でも PSI/SI を保持しているため、番組情報を取り出せる。TS 解析 (`VideoFileAnalyzeModel.analyzeTsInfo`) と同じ方針
        - 放送局は **network id + service id で `channel` を引けた場合のみ**採用する (取り違えると実況や番組表がずれるため、引けなければ `ChannelIsNotFound` で拒否する)
        - 開始時刻は EIT[p/f] present、無ければ TDT/TOT。終了時刻は EIT の番組長、無ければ ffprobe の実測尺。番組名は EIT、無ければファイル名。概要・詳細・ジャンルは EIT の値をそのまま使う
        - 拡張子が `.ts` 以外 (完全な再マルチプレクスで PSI/SI を持たない `.mp4` など) で `recordedId` を省略した場合は `RecordedIdIsRequired` で拒否する。一時ファイルは削除する
        - 動画の登録に失敗した場合、自動作成した番組情報も削除する (中身の無い録画を残さない)
    - **UI (アップロード画面)**: 先頭に「TS ファイル (番組情報をサーバーで自動取得)」/「エンコード済みファイル (番組情報を入力する)」の切り替えを置いた。自動取得を選ぶと番組情報の入力欄は出さず、表示名はファイル選択時にファイル名で埋める。**ファイルタイプは自動取得でも選べる** (既定 `ts`。tsreplace 出力は `encoded` のまま登録できる)
    - **UI (録画詳細)**: 右上のメニューに **「ビデオファイルを追加」** を追加した。すでに番組情報が登録済みの録画に対して動画だけを追加する導線で、番組情報の入力欄は持たない (`recordedId` を指定してアップロードするだけ)。エンコード済みファイルを後から足す場合もこちらを使う
    - **アップロード / 取り込みの直後にシリーズ自動マッピングを走らせる**: TS 解析 (放送局・番組名・開始時刻の確定) が終わってから発行される `addUploadedVideoFile` イベントを受けて、`EventSetter` が `ISeriesResolver.resolve()` を呼ぶ。**録画完了時と同じ経路**なので、しょぼいカレンダーの放送予定照会 (`SyobocalProgramLookup`) → エイリアス → 作品辞書 → LLM → 類似度、の判定順もそのまま効く (予約が存在しないため `reserveId` だけ渡さない)。イベントは Operator 内部のもので、シリーズ判定に必要な `recordedId` を引数に持たせている。従来はアップロードした録画のシリーズ判定はバックフィルか録画詳細の 1 件実行を待つ必要があった
    - **サーバー上のファイルを指定してアップロードできる**: ビデオファイル欄で「この端末のファイルをアップロード」/「サーバー上のファイルを指定」を選べる。後者は `POST /api/videos/upload` の `localFilePath` を使い、**指定したファイルは録画ディレクトリへ移動される** (元の場所からは消える)
        - **許可範囲は `config.importDirs` 配下のみ**。`RecordedApiModel.addUploadedVideoFile()` が `ImportPathValidator.resolveImportTargetPath()` で realpath ベースに検証し、配下でなければ `ImportPathNotAllowed`、`importDirs` 未設定なら `ImportDirsNotConfigured` で拒否する (任意パスを許すと無関係なファイルを動かせてしまうため)
        - ファイル選択は `ServerFileSelectDialog.vue` から行う。一覧はディレクトリスキャン API を流用するが、選ぶだけの用途では番組情報の推定が要らないため `ImportScanOption.analyze: false` (既定 true) を付けて **TS 解析・重複判定を省いたファイル列挙**にしている

- **「不明な放送局」と表示される録画を、TS 解析結果 (SDT) の局名で埋めるようにした**
    - **背景**: 放送局の表示は「channel テーブル → 録画時点の局名 (`recorded.channelName`) → `不明な放送局 (NID: … / SID: …)`」の順で解決する (`client/src/util/ChannelNameUtil.ts`)。取り込み時に放送局を特定できなかった録画は channel も局名も持たないため、TS の SDT には局名が入っているのに画面では「不明な放送局」のままだった
    - **反映のしかた (`VideoFileAnalyzeModel.applyChannelInfo()`)**: TS 解析の保存時 (`saveTsInfo`) に、次の順で録画情報へ書き戻す
        1. TS の original_network_id + service_id で channel を引けたら、**その放送局へ紐付け直す** (`recorded.channelId` も直すので、実況チャンネルの解決や番組表との突き合わせも直る)
        2. channel テーブルに無い放送局 (受信できなくなった局・他地域の局) は、**表示名が空のときに限り** SDT の局名を `channelName` / `halfWidthChannelName` に入れる
    - **すでに channel を引ける録画には触らない**。正しく表示できているものを TS 由来の値で書き換えると、局名の表記ゆれ (「ＮＨＫ総合１・福島」など SDT 側の表記) が混ざるため
    - **既存録画への反映は 2 通り**: TS 解析ごとやり直す「全件を強制再解析」と、**保存済みの解析結果だけを使う「解析結果から放送局を反映」** (一括解析ジョブの `type: 'channel'`)。後者はファイルを読み直さないため、16000 件規模でも短時間で終わる。サーバー設定 > 基本タブの「録画ファイルの TS 解析」から実行する
    - 書き戻しに失敗しても TS 解析自体は成功扱いにする (解析結果は保存済みのため)

- **録画ファイルの一括解析をサーバー常駐ジョブにし、ffprobe メタデータも全件を強制再解析できるようにした**
    - **背景**: 一括解析はクライアントが 100 件ずつ API を呼び続ける方式だったため、**画面を閉じる・再読み込みするだけで処理が止まり、進捗も失われていた**。TS 解析の「全件を強制再解析」は 16000 件規模で数時間かかるので、実質最後まで流せなかった
    - **ジョブモデル (`src/model/video/VideoAnalyzeJobModel.ts`)**: Service プロセスに常駐する解析ジョブ。種別 (`metadata` = ffprobe / `tsInfo` = TS の PSI/SI) × 対象 (`unanalyzed` = 未解析のみ / `all` = 解析済みを含む全件) の 4 通りを扱い、進捗 (`total` / `processed` / `analyzed` / `failed`) を保持する。同時に走るジョブは 1 つだけ (実行中の開始要求は 409)。ジョブはプロセスが生きている間だけ保持し、EPGStation の再起動では失われる
    - **ffprobe メタデータの全件強制再解析を追加**: これまで「未解析ファイルのみ」しか対象にできず、解析ロジックを更新しても既存の録画ファイルへ反映できなかった。TS 解析と同じ「全件を強制再解析」をメタデータ側にも用意した (`IVideoFileDB.findAllPaged()` を追加)
    - **失敗し続けるファイルで無限ループしない**: 未解析のみのモードは「解析すると対象から外れる」前提で同じクエリを繰り返す。ファイル欠損などで失敗するとその行は残り続けるため、**失敗した件数だけ offset を進める** (`findWithoutMetadata` / `findWithoutTsInfo` に offset を追加)
    - **API**: `POST /api/videos/analyze` (開始) / `GET /api/videos/analyze` (進捗) / `DELETE /api/videos/analyze` (中断)。従来の `POST /api/videos/metadata`・`/api/videos/tsinfo`・`/api/videos/tsinfo/reanalyze` は単発バッチとしてそのまま残している
    - **UI**: サーバー設定 > 基本タブの 2 セクション (録画ファイルのメタデータ / TS 解析) を書き換え、進捗バーと「処理済み / 総数 (成功・失敗)」を表示して 2 秒間隔でポーリングする。画面を開き直したときは `GET /api/videos/analyze` でジョブ状態を復元するため、**別のブラウザ・別セッションからでも進捗の続きが見える**。中断ボタンは解析中の 1 件を終えてから止める

- **サーバー設定の「更新」タブから EPGStation を再起動できるようにした (更新を伴わない再起動 + 子プロセスの取り残し修正)**
    - **API**: `POST /api/update/restart`。応答 (`UpdateRestartResult`) は再起動を担う仕組み (`supervisor`)・その説明 (`note`)・プロセスを終了する予定時刻 (`restartAt`) を返す。処理自体は更新後の再起動と同じ `UpdateManageModel.restart()` を使うため、Docker / systemd / pm2 / Windows サービスの配下ならそれが起こし直し、検出できない環境では後継プロセスを detached で spawn してから終了する。実行は Operator (親) 側 (IPC `ModelName.update` の `restart`)
    - **更新との関係**: 更新が実行中 (`running` / `restarting`) のときは 409 を返して拒否する (checkout 済み・ビルド前のような中途半端な状態で上がってしまうため)。**git 管理下かどうかは問わない**ので、配布アーカイブ環境 (`canUpdate: false`) でも再起動だけは使える。再起動方法の説明は `UpdateStatus.restartNote` として常に返す (`updateNote` は更新可否に依存するため別項目にした)
    - **UI**: `UpdatePanel.vue` に「再起動」カードを追加。確認ダイアログで「実行中の録画・配信・エンコードは中断される」ことを明示し、実行後はプロセスの終了予定時刻 + 5 秒待ってから 3 秒間隔で `GET /api/update` を叩き、応答が戻ったら画面を読み込み直す (最大 3 分)。落ちている間の通信エラーは想定内なので無視する
    - **あわせて修正: 再起動で子プロセスが取り残される問題**: Operator (親) が `process.exit()` しても Service / EPGUpdater は道連れにならない。サービス管理下ではプロセスツリーごと止められるので表面化しないが、**手動起動 (`supervisor: 'none'`) では旧 Service が 8888 を握ったまま残り、後継プロセスの Service が待ち受けられなくなる** (実機で再現。更新後の再起動でも同じ事象が起きていた)。`src/util/ChildProcessRegistry.ts` に子プロセスの登録簿を作り、終了前に `killAllChildProcesses()` でまとめて止める。登録簿は「自分から止めた」フラグ (`isShuttingDown()`) も持ち、`index.ts` の Service 再起動と `EPGUpdateExecutorManageModel.restart()` がこれを見て**自分で止めた子を再起動し直さない**ようにしている

- **ライブ HLS の遅延を詰め、m2ts-ll (mpegts 配信) の ARIB 字幕が出ない問題を修正した**
    - **m2ts-ll で字幕が出なかった原因**: DPlayer は mpegts.js の `TIMED_ID3_METADATA_ARRIVED` イベント経由でしか aribb24 へ字幕を渡さない。TS に ARIB 字幕 ES が入っていてもそれだけでは表示されない。HLS 配信でのみ `arib-subtitle-timedmetadater` を通していたため、mpegts 配信には ID3 timed metadata が無く字幕が 1 つも出なかった
    - **修正**: `LiveStreamBaseModel` で配信種別によらず `arib-subtitle-timedmetadater` を通すようにした。m2ts-ll の自動生成コマンドは `-map 0 -c:s copy -c:d copy -ignore_unknown` を持つため、エンコード後も ID3 ES (`Data: timed_id3`) が残ることを実データで確認済み。in-memory HLS だけは従来どおり `AribId3Extractor` で ID3 を抜いて `emsg` box に載せ替える
    - **ライブ HLS の遅延短縮**: 遅延の主因は 2 つあった
        - **`-re`**: 入力をリアルタイム速度に制限するオプション。Mirakurun からの TS は元々リアルタイムなので二重の律速になり遅延だけが増える (m2ts-ll 側には元から付いていない)。ライブ HLS の cmd (テンプレート・自動生成プリセットの両方) から外し、代わりに `-fflags nobuffer -flags low_delay` を付けた
        - **セグメント長**: fMP4 のフラグメント境界はキーフレームなので、**セグメント長 = GOP 長**になる。`-g 30` (1 秒) から `-g 15` (0.5 秒) へ短縮した。実測でセグメントが 1.00 秒 → 0.50 秒になることを確認済み
    - **クライアント側**: hls.js に `lowLatencyMode: true` / `liveSyncDurationCount: 3` (0.5 秒 × 3 = 約 1.5 秒) / `maxLiveSyncPlaybackRate: 1.5` (遅れたら再生速度を上げて追いつく) を設定。プレイリストウィンドウは 8 セグメント (約 4 秒)、メモリ保持は 16 セグメントに調整した
    - **既存環境への反映**: `config/config.yml` は git 管理外のため、テンプレートを更新しても既存の設定ファイルには反映されない。既に運用している環境で遅延を詰めるには、`stream.profiles.live` の HLS プロファイルの cmd から `-re` を外し、`-g 30 -keyint_min 30` を `-g 15 -keyint_min 15` に変更する
    - **さらに詰めるなら**: 本来の LL-HLS (EXT-X-PART + ブロッキングなプレイリスト更新) が必要。`Fmp4Packager` は既にパート単位でデータを保持しているため実装の土台はある (未実装)

- **上記の低遅延化 (`-flags low_delay`) が QSV 実運用で「ずっとかくつく」不具合の原因だったため、`-flags low_delay` を除去した**
    - 実機 (Intel QSV, `hevc_qsv`) でこの設定を運用したところ、視聴中ずっと映像がかくつく不具合が発生した。サーバー側のエンコード速度・セグメントの `tfdt`/`trun` 連続性はいずれも問題なく、クライアント側の自動計測 (フレームドロップ数・画面録画のフリーズ検出) も食い違う結果になり長時間切り分けに苦戦した (詳細な調査経緯は `doc/streaming-refresh.md` の「実運用で発生した『ずっとかくつく』問題の調査経緯と真因」を参照)
    - 最終的にユーザーによる実機確認で特定できた真因は `-flags low_delay`。ffmpeg 入力側でデコーダの内部バッファ/フレーム並べ替え遅延を無効化するオプションで、放送波の MPEG-2 (インターレース) との相性が悪く再生タイミングが不安定になっていた。`-fflags nobuffer` のみを残し `-flags low_delay` を外すことで解消した
    - 併せて、これが原因で「QSV は 0.5 秒 GOP だと負荷が厳しい」と誤診断して `-g 24` まで戻していたが、`-flags low_delay` 除去後は `-g 8` (≒0.27 秒) まで詰めても安定して実時間に追いつくことを実機で確認した。QSV 自体の負荷が問題だったことは一度もなかった
    - クライアント側の `lowLatencyMode: true` (`LiveHLSVideo.vue`) も当初の有力な仮説だったが、実際には無関係だった。ただしこのサーバーは真の LL-HLS (`#EXT-X-PART`) を実装しておらず有効にする意味が無いため `lowLatencyMode: false` のまま残している
    - **既存環境への反映**: `stream.profiles.live` の HLS プロファイルの cmd から `-flags low_delay` を外し (`-fflags nobuffer` のみ残す)、`-g`/`-keyint_min` は環境の実測次第でさらに詰めてよい

- **ライブ視聴のニコニコ実況コメントを放送波の時刻 (TDT / TOT) で遅延補正するようにした**
    - **背景**: 実況コメントは実時間で届くのに対し、ライブ視聴の映像はチューナー → Mirakurun → エンコード → 配信 → 再生の分だけ遅れている。補正が無いとコメントが映像より先に流れ、実況として成立しなかった
    - **放送時刻の取得 (`src/model/service/stream/util/BroadcastTimeExtractor.ts`)**: エンコード前の TS から TDT / TOT (PID 0x14) を読み取る pass-through Transform。入力の TS は加工せず下流へ流すので配信自体には影響しない。`LiveStreamBaseModel` のパイプライン先頭 (ARIB 字幕変換の前) に挿入している
    - **配布**: `GET /api/streams` の `LiveStreamInfoItem` に `broadcastTime { time, receivedAt }` を追加した。`time` が放送時刻、`receivedAt` がサーバがそれを受け取った時刻で、差がチューナー → EPGStation の遅れにあたる
    - **クライアント側の補正 (`client/src/components/video/BaseVideo.ts`)**: ライブ実況が有効な間 15 秒間隔で放送時刻を取り直し、**サーバ遅延 (receivedAt − time) + 再生側の遅延 (受信済みバッファ末尾 − 再生位置) + 手動オフセット**の合計だけコメント描画を遅らせる。補正しすぎを防ぐため上限は 60 秒、プレイヤー破棄時には待機中のコメントを破棄する
    - **手動微調整**: 設定 > 「実況コメントの表示タイミング微調整」で ±秒を指定できる (`jikkyoLiveOffsetSec`)。環境ごとの配信遅延の差を詰めるためのもの
    - **過去ログ再生は対象外**: 録画の過去ログ実況は元から再生位置に同期しているため補正しない。ただし基準となる `video_file.startAt` は TS 解析で TDT / TOT が取れた場合そちらを使うようになったので、こちらも精度が上がっている

- **録画ファイルの TS (PSI/SI) を解析し、放送局・番組情報を DB に持つようにした**
    - **背景**: 外部ファイルの取り込みは、放送局や番組名をファイル名のパターンと `program.txt` から**推定**していた。ファイル名に放送局名が入っていない・表記が違うと放送局を特定できず、番組名も装飾付きのファイル名がそのまま入っていた。また取り込み時に ffprobe 解析すら行っておらず、尺・コーデック・解像度は再生時まで DB に入らなかった
    - **TS 解析器 (`src/model/recorded/ts/TsInfoAnalyzer.ts`)**: 既存の `DropCheckerModel` と同じ `aribts` のパイプライン (`TsReadableConnector` → `TsPacketParser` → `TsSectionParser`) で **PAT / SDT / NIT / PMT / EIT[p/f] / TDT / TOT** を解析する。[recisdb-proxy-rs](https://github.com/stuayu/recisdb-proxy-rs) の `ts_analyzer` に相当する。取得するのは以下
        - `original_network_id` / `transport_stream_id` / `service_id` / `service_type` / **放送局名 (service_descriptor)** / 事業者名 / ネットワーク名
        - `event_id` / 番組名 / 概要 (short_event) / 詳細 (extended_event) / 開始時刻 / 長さ / ジャンル (content_descriptor)
        - 映像・音声の `stream_type` と PID (PMT)
        - **ファイル先頭の TDT / TOT の放送時刻** = 録画開始時刻
    - **対象サービスの判定**: EIT[p/f] は同一 TS の全サービス分が流れてくるため、**PAT に載っているサービス以外の EIT は採用しない**。これが無いと、NHK 総合 1 を録画したファイルから NHK 総合 2 の番組情報を拾ってしまう (実データで再現した)。PAT に複数サービスが載っている (全サービス録画) 場合の選び方は後述の「TS 解析の読み出し位置をファイル中央へ変え〜」を参照
    - **時刻の扱い**: TS 上の時刻 (MJD + BCD) は日本標準時なので、サーバのタイムゾーンに関係なく JST として解釈して UNIX 時刻に直す。放送時間未定 (全ビット 1) は null にする
    - **読み込みは途中で打ち切る**: 対象サービスの局名・番組・時刻・ストリーム構成がそろった時点で読み込みを止める。そろわない場合の上限は既定 64MB / 60 秒
    - **保存先 (`video_file_ts_info` テーブル)**: `video_file` と 1:1 の別テーブルにした (`video_file` の列が 30 近くになるのを避けるため)。sqlite / mysql 両方のマイグレーションあり。`video_file` 削除時は ON DELETE CASCADE で消える
    - **取り込みへの反映**: 登録前に TS を解析し、**放送局を network id + service id で `channel` テーブルから厳密に引く**。番組名・開始時刻・長さは EIT[p/f] present から、概要・詳細・ジャンルは画面から入力できないため TS の値をそのまま使う。**画面で明示指定された値がある場合はそちらを優先する** (ユーザーがスキャン結果を確認・修正できる導線を潰さないため)
    - **ffprobe 解析も取り込み時に実行する**: 解析処理は `VideoFileAnalyzeModel` (`src/model/video/`) にまとめ、Operator (取り込み時) と Service (API 経由) の双方から使う。`VideoApiModel` の解析ロジックはこのモデルへ移して委譲にした
    - **録画開始時刻の精度**: `video_file.startAt` (ファイル先頭 = 再生位置 0 秒に対応する実時刻) は、これまで「ファイルの更新時刻 - 実測尺」で推定していた。**TDT / TOT が取れた場合はそちらを優先する**ため、ニコニコ実況の過去ログ再生の時刻合わせのズレが小さくなる

- **`video_file.startAt` (TDT/TOT 由来) を PCR で補正し、録画詳細画面の開始・終了時刻のズレを解消した**
    - **報告された症状**: 録画詳細画面の開始・終了時刻が実際の録画内容とズレて見える。調査の結果、画面には2行の時刻表示があり (1行目 = 予約時点の EPG 値 `recorded.startAt`/`endAt`、2行目 = 実測値 `videoFiles[].startAt` + `duration`)、実測値の方の基準である `video_file.startAt` (TDT/TOT ベース) 自体の計算に誤差があった
    - **原因**: `TsInfoAnalyzer.ts` は「ファイル先頭から順に読んで最初に見つかった1個の TDT/TOT の時刻を、そのままファイル先頭の時刻とみなす」実装だった。TDT/TOT (PID 0x14) は必ずしもファイル先頭にあるとは限らず、数百 ms 〜 数秒後に初めて出現することがあり、その分がそのまま `video_file.startAt` の誤差になっていた
    - **修正**: PCR (Program Clock Reference、PMT が示す `PCR_PID` の adaptation field に乗る 27MHz クロック) で「ファイル先頭付近の PCR」と「TDT/TOT が見つかった位置以前で最も近い PCR」の差分から実経過時間を測り、TDT/TOT の時刻からその分を差し引いてファイル先頭の時刻を逆算するようにした (`TsInfoAnalyzer.correctStartAtByPcr()`)。PCR は TDT/TOT よりずっと高頻度に送出されるため、これでファイル先頭からの誤差を数百 ms 未満まで縮められる
    - **PCR サンプリングの実装**: `tsPacketParser` の生パケットを (`tsSectionParser` へのパイプとは別に) 追加の `data` リスナーで覗き見て、`getPcrFlag() === 1` のパケットだけ `decode()` して PCR (33bit base × 300 + 9bit extension) を拾う。全パケットを毎回フルデコードすると遅いため、軽量な `getPcrFlag()` でまず絞り込んでから必要な分だけ `decode()` する
    - **ラップアラウンド対策**: PCR は約 26.5 時間周期でラップアラウンドするため、差分が負になった場合は周期分 (`2^33 * 300`) を足す
    - **安全弁**: 対象 PID の PCR サンプルが 2 点そろわない・`PCR_PID` が未割り当て (`0x1fff`)・補正量が 2 分を超える (壊れたストリーム等の誤検出とみなす) 場合は補正せず、従来どおり無補正の TDT/TOT 時刻を使う
    - **`aribts` の型定義追加**: `src/@types/types.d.ts` (手書きの最小限の型定義) に `TsPacket` / `AdaptationField` / `DecodedPacket` を追加した。33bit の PCR base は `aribts` の `TsReader.readBits()` が内部で `Math.pow` を使った桁上げで安全に読んでいる (32bit ビット演算に丸められる心配は無い) ことをソースで確認済み
    - **テスト**: `test/ut/ts-info-analyzer.test.js` に PCR 補正が効くケース (5 秒ズレを正しく補正)・PCR サンプル不足で補正しないケース・`PCR_PID` 不一致で補正しないケースを追加した
    - **既存録画への反映**: 既存の「TS 一括解析」機能 (サーバー設定 > 基本タブ) で再解析すれば、この補正が適用された `video_file.startAt` に更新できる

- **TS 解析の読み出し位置をファイル先頭からファイル中央へ変え、相乗りサービスの中から本編サービスを選ぶようにした**
    - **報告された症状**: 取り込み・アップロードした録画のジャンルがおかしい。番組名・概要も実際の番組と違うことがある
    - **原因 1 (前番組を読んでいた)**: `TsInfoAnalyzer` はファイル先頭から読み、最初に見つかった EIT[p/f] present をその録画の番組として採用していた。しかし録画開始直後のファイル先頭には **前番組の EIT[p/f] がまだ present として流れている** (EIT[p/f] の切り替わりは番組境界より遅れる)。加えて録画開始直後は TS 自体が壊れていることがあり、そこを読むと解析全体が不安定になる
    - **原因 2 (相乗りサービスを拾っていた)**: 全サービス録画の TS には主番組・サブチャンネル・**ワンセグ**・データ放送が同居している。旧実装は「最初に見つかった EIT[p/f] のサービス」、それも無ければ「PAT の先頭サービス」を対象にしていたため、ワンセグやサブチャンネルの**放送局名・番組名**を拾うことがあった (SDT からは複数のサービス名が取れる)
    - **修正 1: 既定でファイル中央から読む** (`TsInfoAnalyzer.decideStartPosition()`)。ファイルサイズが 64MB 以上なら中央 (`size / 2`) を読み出し開始位置にする。任意位置から読むと TS パケット境界がずれるため、`findPacketBoundary()` が sync_byte (`0x47`) が 188 byte 間隔で 3 つ並ぶ位置を探して境界に丸める。64MB 未満のファイルは中央から読むと残りが短くテーブルが一巡しないおそれがあるため従来どおり先頭から読む。`TsInfoAnalyzeOption.analyzeFromMiddle: false` で明示的に先頭からの解析に戻せる
    - **修正 2: `firstTdtAt` (ファイル先頭の放送時刻) だけは先頭を読み直して求める**。中央で得た TDT/TOT はファイル中央の時刻なので、そのまま `video_file.startAt` にすると実況コメントの時刻合わせが大きくずれる。`resolveFileStartAt()` が次の 2 通りで求め、突き合わせて採用する
        - ①ファイル先頭を読み直して TDT/TOT を 1 つ取り、従来どおり PCR で補正する (`scanHeadTime()`)。TDT は 5 秒以下の周期で流れるため、最初の 1 つが見つかった時点で読み込みを打ち切る (上限 32MB)
        - ②中央区間の PCR から**実測バイトレート** (`calcBytesPerMs()`) を求め、中央の時刻から「読み出し開始位置のバイト数 ÷ バイトレート」だけ遡って見積もる
        - ①と②が 5 分以上食い違う場合は、ファイル先頭が壊れている (または別番組の TS が連結されている) とみなして②を採る。①が読めなければ②、どちらも求まらなければ `null`
    - **修正 3: 対象サービスの選択を後回しにして、実データ量と service_type で選ぶ** (`TsInfoAnalyzer.selectServiceId()`)。EIT[p/f] は「最初に見つかったもの」で確定させず**サービスごとの候補として全部保持**し、読み終えた時点で対象サービスを選んでから SDT の局名・PMT のストリーム構成・EIT の番組情報をまとめて反映する。選択の優先順は次のとおり
        1. **service_type の格** — デジタルTVサービス (`0x01`) / 超高精細度4K専用TVサービス (`0xAD`) が最優先。臨時・プロモーション・音声サービス (`ChannelUtil.isMediaService()`) が次点。**ワンセグ・データ放送 (`0xC0` 等) は最下位**
        2. **実際に流れているパケット数** — PID ごとのパケット数を数え、PMT が指す ES と PCR の合計が多いサービスを採る。ワンセグは主番組の 1/10 程度しか流れないため確実に負ける
        3. EIT[p/f] を持つか → 4. service_id の小さい方 (地上波の主番組は最小の service_id)
        - PAT に載っているサービスを候補の正とし、PAT が読めない場合だけ PMT / EIT / SDT から候補を拾う。候補が 1 つ (= サービス指定で録画されたファイル) ならそのまま採る
    - **打ち切り条件の変更**: サービス選択がパケット数の偏りを見るため、**最低 20000 パケット (約 3.7MB) 読むまでは打ち切らない**。それ以降は「対象サービスの SDT・PMT・EIT[p/f] と TDT/TOT がそろった時点」で打ち切る (上限は従来どおり既定 64MB / 60 秒)
    - **テスト**: `test/ut/ts-info-analyzer.test.js` に、①ワンセグ・データ放送が相乗りした TS から本編サービスの局名と番組を採ること (PAT の先頭はワンセグ) ②中央の EIT[p/f] を採り先頭の前番組を採らないこと ③中央から解析しても `firstTdtAt` がファイル先頭の時刻になること ④`analyzeFromMiddle: false` で従来動作に戻ること、を追加した
    - **既存録画への反映 (番組情報の上書き)**: 旧実装で前番組の情報が入ってしまった録画は、空の項目を補うだけでは直らない。**明示的な再解析のときだけ既存値を上書きする**ようにした
        - `IVideoFileAnalyzeModel.analyzeTsInfo(videoFileId, { overwriteProgramInfo: true })` を追加し、`applyProgramInfo()` が概要・詳細・ジャンル 3 組・映像音声情報を TS の内容で置き換える。**TS 側の組数が減った場合は余ったジャンルの組を `null` で消す** (古い値が残らないよう `RecordedProgramUpdateValues` のジャンル列を `number | null` に広げた)
        - 上書きするのは**全件強制再解析 (`mode: 'all'` / `POST /api/videos/tsinfo/reanalyze`) と録画 1 件の再解析 (`recordedId` 指定)** のみ。取り込み・アップロード直後の解析と「未解析のみ」の一括解析は従来どおり**空の項目を補うだけ**で、画面から入力した内容や EPG 由来の値を壊さない
        - **番組名 (`recorded.name`) は上書きしない**。ファイル名由来のものや利用者が付けた名前が入っており、勝手に変えると取り返しがつかないため (従来と同じ方針)
        - TS 側が `null` の項目 (EIT[p/f] から取れなかった項目) は上書き時も触らない

- **tsreplace 系のエンコード出力を TS 解析の対象に含め、解析済みファイルも含めた強制再解析機能を追加した**
    - **背景**: `hevc_tsreplace` (Amatsukaze の tsreplace モード) のような、映像ストリームだけを差し替えて PSI/SI (TDT/TOT/PCR 等) やコンテナ構造をそのまま維持するエンコードプリセットがある。しかし `VideoFileAnalyzeModel`/`VideoFileTsInfoDB` は `video_file.type === 'ts'` のみを TS 解析の対象にしており、エンコード出力は (拡張子が `.ts` のままでも) 常に `type: 'encoded'` で登録されるため、tsreplace 出力は実際には PSI/SI を保持しているにもかかわらず解析対象から除外されていた
    - **`video_file.type` を書き換える案は却下**: 当初 `EncodeFinishModel.finishEncode()` で出力拡張子が `.ts` なら `type: 'ts'` として登録する案を実装したが、**`video_file.type` はストリーミングパイプラインの選択 (`StreamProfileManageModel.getRecordedProfiles('ts'|'encoded')`, `StreamApiModel.ts`) にも使われている**ことを見落としていた。`'ts'` は「生の放送 TS を前提にしたパイプ入力 + yadif 有りの変換経路」を意味するため、実体は既にエンコード済み・シーク可能なファイルである tsreplace 出力を `'ts'` にしてしまうと、誤ったストリーミングパイプラインが選ばれる (二重エンコードや不要な yadif 適用の恐れ) うえ、「TS ファイル ○件」の集計にも tsreplace 出力が二重に乗ってきて件数がおかしく見える不具合になった。**`type` は本来の意味 (ストリーミングパイプライン選択) のまま変更せず**、TS 解析の対象判定だけを別軸で行うよう修正した
    - **修正後の判定**: `video_file.type` ではなく**拡張子** (`.ts` かどうか) で TS 解析の対象を判定するようにした
        - `VideoFileAnalyzeModel.analyzeTsInfo()`: ゲート条件を `video.type !== 'ts'` から `path.extname(video.filePath).toLowerCase() !== '.ts'` に変更
        - `VideoFileTsInfoDB.ts` (`findWithoutTsInfo` / `countWithoutTsInfo` / `countAnalyzableVideoFiles` / `findAllAnalyzable`): SQL の絞り込みを `video_file.type = 'ts'` から `LOWER(video_file.filePath) LIKE '%.ts'` に変更
        - `EncodeFinishModel.finishEncode()` は元通り無条件で `type: 'encoded'` を登録する (変更なし)
    - **既存の解析済みファイルの再解析**: 前述の PCR 補正のように TS 解析ロジックを更新しても、既存の「TS 一括解析」(`POST /api/videos/tsinfo`) は `video_file_ts_info` が **まだ無い** ファイルしか対象にしないため、既に解析済みのファイルには新しいロジックが反映されない。解析済みかどうかに関わらず全件を id 昇順で強制的に再解析する `POST /api/videos/tsinfo/reanalyze` (`offset`/`limit` を受け取り `nextOffset` を返す、`null` になるまで呼び続けるページング方式) を追加した
        - サーバー: `IVideoFileTsInfoDB.findAllAnalyzable(limit, offset)` (拡張子が `.ts` のファイルを id 昇順・無条件で取得) → `VideoApiModel.reanalyzeAllTsInfo()` → ルート `src/model/service/api/videos/tsinfo/reanalyze.ts`
        - クライアント: サーバー設定 > 基本タブの「録画ファイルの TS 解析」に「全件を強制再解析」ボタンを追加 (`SystemSetting.vue`)。`nextOffset` が `null` になるまでクライアント側でループしてポーリング的に呼び続け、進捗 (`n / total 件`) を表示する。画面を離れた場合はループを止める
        - `analyzeTsInfo()`/`saveTsInfo()` (`VideoFileAnalyzeModel.ts`) はもともと UPSERT + 無条件の `startAt` 上書きなので、再解析ロジック自体に変更は不要だった
    - **教訓**: `video_file.type` のように複数の目的で参照されているフィールドを変更するときは、`grep` で全参照箇所を洗い出してから着手すること。今回は「PSI/SI 解析対象かどうか」だけを見て変更し、「ストリーミングパイプライン選択」という別の用途を見落としたため手戻りになった
    - **テスト**: `test/ut/encode-finish-model.test.js` (拡張子に関わらず `type: 'encoded'` のまま)、`test/ut/video-file-analyze-model.test.js` (拡張子ベースの対象判定)、`test/ut/video-metadata-api.test.js` (`reanalyzeAllTsInfo`)

- **視聴画面 (ライブ / 録画) をテレビ風の全画面レイアウトにした**
    - **背景**: 視聴画面は `TitleBar` + プレイヤー + 情報カードの縦積みで、番組情報を見るにもチャンネルを変えるにも画面を離れる必要があった。KonomiTV のような「映像 + 右の情報パネル」の形に寄せて、視聴したまま番組情報・チャンネル・コメントを追えるようにした
    - **レイアウト** (`client/src/components/watch/WatchLayout.vue`): `position: fixed` の全画面ダークレイアウト。左に**アイコンだけのナビゲーション** (`WatchSideBar.vue`、項目はグローバルナビゲーションの `INavigationState` と共有)、上に**放送局ロゴ + 番組名 + 放送時間 + 時計**のバー (`WatchTopBar.vue`)、右に**情報パネル**を置く。映像は 16:9 を保ったまま縦にも横にも収まる最大サイズにする (`max-width: calc((100vh - 64px) * 16 / 9)`)
        - **視聴中はグローバルナビゲーション (drawer) を畳む**。左のアイコン列が役割を兼ねるため二重に出さない。画面を離れるときに元の開閉状態へ戻す
        - 画面幅 1024px 以下では縦積み (左ナビは上部の横並びツールバー、パネルは映像の下) に切り替わる
    - **右パネル** (`WatchSidePanel.vue`): 下部のタブで中身を切り替える。中身は名前付きスロット (`program` / `channel` / `nextup` / `comment`) で受け取るため、画面ごとに使うタブを選べる (ライブは 番組情報・チャンネル・コメント、録画は 番組情報・次の話・コメント)
        - **番組情報** (`WatchPanelProgram.vue`): 放送局名・放送時間・番組名・概要・詳細。録画視聴では `actions` スロットに「視聴済みにする」ボタンを差す
        - **チャンネル** (`WatchPanelChannels.vue`): 放送中の番組を **ピン留め / 地デジ (地域別) / BS / CS** のタブで並べる。各行は現在番組・**NEXT (次の番組)**・番組の進捗バーを持ち、クリックでその放送局の視聴へ切り替える (配信種別・エンコード設定は今の視聴から引き継ぐ)。ピン留めは localStorage (`pinnedChannelIds`) に保存する
            - **ピン留めはまとめて設定できる** (`PinnedChannelsDialog.vue`、放映中画面との共用): ピン留めタブの「ピン留めを編集」から開く。上段でピン留め済みの並べ替え (↑↓) と解除、下段で全放送局 (地上波系は地域名、BS / CS は放送波種別でグルーピング) をキーワード検索しながらチェックで追加する。一覧の各行にあるピンアイコンと同じ設定を編集する
            - **設定の参照は `ISettingStorageModel.tmp` を使う**。`getSavedValue()` は localStorage の直読みで Vue のリアクティブ依存が張られないため、これで組み立てた表示は設定を変えても再描画されない
        - **次の話** (`NextUpPanel.vue`): パネル内に収まる高さ (縦 flex) にして、タブ・カウントダウンは固定、**リスト部だけをスクロール**させる。以前は一覧が長いとパネルからはみ出して下の項目を見られなかった
            - **サムネイルを出すため `GET /api/recorded/{recordedId}/next-up` はサムネイル情報を返す** (`RecordedApiModel.getNextUp()` の `isNeedThumbnails` を `true` にした)。以前は取得していなかったため、パネルの一覧は全件が代替画像 (`./img/noimg.png`) になっていた
            - **見た目は番組情報タブに揃えている**。`v-card` / `v-list` (Vuetify のテーマ色) をやめ、暗色パネル上で読める配色 (`rgba(255,255,255,*)`) の自前リストにした。各行はサムネイル + 番組名 + 放送局・日時 + 視聴状態で、**行全体のクリックでも再生**できる。「最新 / シリーズ」の切り替えは `v-tabs` ではなくチップ状のスイッチ。パネルのタブで開閉できるため、パネル自体の折り畳みボタン (設定 `isNextUpPanelOpen`) は廃止した
        - **コメント** (`WatchPanelComments.vue`): 映像に流れている実況コメントを時系列で並べる。末尾付近にいるときだけ自動追従し、上へスクロールしている間は追従しない (「最新のコメントへ」ボタンで戻る)
    - **実況コメントの受け渡し**: `BaseVideo.drawJikkyoComment()` が弾幕を描くタイミングで `jikkyoComment` イベントを上げ、`VideoContainer` が視聴画面へ中継する。**遅延補正後のタイミングで流すため、パネルの表示と弾幕の表示が揃う**。保持数は 500 件で、超えた分は古いものから捨てる
    - **チャンネル切り替え**: 映像の右端に前後のチャンネルへ移動するボタンを重ねた (放送中一覧の並び順で循環する)
    - **API**: NEXT を出すため `GET /api/schedules/broadcasting` に **`includeNextProgram`** を追加した。指定したときだけ放送局ごとに「放送中 + 次」の 2 件を返す (既定は従来どおり 1 件)。`ProgramDB.findBroadcasting()` は次の番組を拾うため、このとき `startAt` の上限を 4 時間先まで広げる
    - **削除したもの**: 役目を終えた `WatchOnAirInfoCard.vue` / `WatchRecordedInfoCard.vue`。番組情報の取得と視聴済み切り替えは各視聴画面 (`WatchOnAir.vue` / `WatchRecorded.vue` / `WatchRecordedStreaming.vue`) へ移した
    - **保存する設定** (`ISettingValue`): `isOpenWatchSidePanel` (パネルの開閉)、`watchSidePanelTab` (選択タブ)、`pinnedChannelIds` (ピン留めした放送局)
    - **未対応**: 下部の再生コントロールと設定ポップアップ (画質・音声・コメント表示・透明度・キーボードショートカット) は DPlayer 標準のものをそのまま使っている

- **視聴画面で別の録画へ切り替えても再生が変わらない問題を修正した**
    - **原因**: 各 video コンポーネント (`NormalVideo.vue` / `RecordedStreamingVideo.vue` など) は `mounted()` のときにしか DPlayer を作らない。「次の話」パネルの再生ボタンで同じ画面 (`/recorded/watch` の query 違い、`/recorded/streaming/:id`) へ遷移すると、Vue が同じコンポーネントを使い回して props だけ差し替えるため、**プレイヤーは前の動画のまま**だった (シークバーの長さ・再生位置も前のもの)
    - **修正**: `WatchRecorded.vue` / `WatchRecordedStreaming.vue` が `VideoContainer` に**再生対象から作ったキー** (`videoKey`: 直接再生は `normal-<videoFileId>`、ストリーミングは `<streamingType>-<videoFileId>-<mode>`) を付け、再生対象が変わったら `VideoContainer` ごと作り直す。URL 変更時は `videoParam` を一度 `null` に戻し、再生対象の無い URL で前の動画が鳴り続けないようにする
    - **併せて修正**: `VideoContainer` は再生位置の保存・復元に使うビデオファイル ID を**生成時に固定する** (`playingVideoFileId`)。以前は `videoParam` を都度参照していたため、切り替え時に親が `videoParam` を差し替えてから破棄される順序の関係で、**古い再生位置を新しいビデオファイルの視聴履歴へ書き込んでいた**。作り直しでレジューム状態 (`resumeApplied` / `resumeReady`) もリセットされるので、切り替え後は「前回再生位置、無ければ先頭」から始まる
    - 「次の話」からの遷移は**今の配信設定 (`streamingType` / `mode`) を踏襲する**。ストリーミング視聴中はストリーミング再生画面へ同じパラメータで、直接再生中はエンコード済みファイルの直接再生へ遷移する (従来どおり)

- **視聴履歴の一覧から再生方法を選べるようにした**
    - **原因**: 一覧の行クリックは常に `/recorded/watch?videoId=&recordedId=` へ送っていたが、この画面はファイルを直接再生するもので、**TS ファイルはブラウザで再生できない** (配信設定 `streamingType` / `mode` が要る)
    - **修正**: 行をクリックすると**再生方法を選ぶポップアップ** (`client/src/components/watchHistory/WatchHistoryPlayDialog.vue`) を出す。「そのまま再生」(ブラウザで直接再生、`/recorded/watch`) と「ストリーミング」(配信種別・画質を選んで `/recorded/streaming/:videoFileId`) を選べる。配信設定の選択肢の組み立てには録画詳細と同じ `IRecordedDetailSelectStreamState` を使う (選んだ設定は録画詳細と同じ localStorage に保存される)
        - 「そのまま再生」はエンコード済みファイルで出す。TS は直接再生できないため通常は出さないが、**配信設定が用意されていない場合 (`isEnableTSRecordedStream` が false など) だけは最後の手段として出す**
        - 録画ファイルが既に無い履歴 (履歴だけ残っている) は録画詳細画面へ逃がす
    - **ついでに直した**: `RecordedDetailSelectStreamState.open()` が `streamTypeItems` を作り直しておらず、同じ画面で 2 回開くと選択肢が重複していた。加えて ts ⇔ encoded で前回選んだ配信種別が今回の選択肢に無い場合は選び直すようにした (存在しない種別のまま開くと視聴設定が空になる)

- **録画済み一覧から複数選択してまとめてエンコードできるようにした**
    - **背景**: 複数選択 (編集モード) は削除にしか使えず、まとめてエンコードするには録画を 1 件ずつ開いて「エンコード」を実行する必要があった
    - **UI**: 編集モードのツールバー (`EditTitleBar.vue`) に歯車アイコンのエンコードボタンを追加した。`EditTitleBar` は予約・ルール・録画中・エンコード画面でも共用しているため、表示は **`showEncode` prop の opt-in** (既定 `false`) にして録画済み一覧だけで出す
    - **ダイアログ** (`RecordedMultipleEncodeDialog.vue`): エンコード元の種別 (TS / エンコード済み)・プリセット・保存先 (親ディレクトリ + サブディレクトリ、元ファイルと同じ場所に保存するか)・元ファイルを削除するかを指定する。プリセットと保存先の初期値は単体エンコードのダイアログと同じ `IAddEncodeSettingStorageModel` (localStorage) を共有するので、普段使う設定がそのまま出る
    - **実行** (`RecordedState.multipleEncode()`): 選択中の録画から指定種別のビデオファイルを 1 件ずつ選び、`POST /api/encode` (`IEncodeApiModel.addEncode()`) を順に呼ぶ。**指定した種別のファイルを持たない録画は飛ばす** (TS を選んだのに TS 削除済み等)。結果は「追加した件数 / 対象ファイルが無く飛ばした件数 / 失敗した件数」で返し、スナックバーに出す。一部が失敗しても残りは続行する
    - サーバー側の変更は無い (既存の単体エンコード追加 API を件数分呼ぶだけ)

- **録画の放送局名を TS 解析結果 (SDT) 優先で表示し、一覧のタイトル表示を切り替えられるようにした + 録画詳細にコメントを表示した**
    - **放送局名は TS 解析の局名を最優先にした**: `ChannelNameUtil.getRecordedChannelName()` の解決順を「TS 解析 (SDT) の局名 → 現在の channel 情報 → 録画時点の局名 → networkId/serviceId 表記」に変更した。実際に録画されたストリーム自身が名乗っている名前なので、チャンネル情報の変更・引っ越し・NW 局の取り違えがあっても録画の実体と一致する
        - 一覧に載せるため `RecordedItem.tsChannelName` を追加した。`IVideoFileTsInfoDB.findServiceNamesByRecordedIds()` で **1 クエリ**にまとめて引く (件数が増えても N+1 にならない)。同じ録画に複数ファイルがある場合は最初に解析されたものを採る
    - **一覧のタイトル表示を 3 点リーダーで切り替えられるようにした**: 録画済み一覧の 3 点リーダー (`RecordedMainMenu.vue`) に「作品名 + 話数で表示」/「録画タイトルで表示」を追加した。設定はシリーズ詳細の切り替えと**同じ `useDictionaryEpisodeTitle`** なので、どこで変えても全画面に反映される (ダッシュボードの録画カードも同じ表示名を使うため連動する)
        - 表示名の組み立ては `RecordedUtil.convertRecordedItemToDisplayData()` の 1 箇所に集約した。ここが `display.name` を作るため、録画済み一覧・ダッシュボード・検索結果など経由するすべての画面に効く
        - そのため `RecordedItem.series` (作品名・話数・サブタイトル・放送回コメント) を API に追加した。こちらも `ISeriesDB.findSeriesInfoByRecordedIds()` で 1 クエリにまとめている。`featureFlags.seriesLibrary` が無効なら問い合わせ自体を行わない
    - **録画詳細にコメントを表示した**: 録画詳細のシリーズ情報欄 (`RecordedDetailSeries.vue`) に「この回のコメント」(放送回コメント) と「作品コメント」(既定 5 行で折りたたみ) を追加した。放送回コメントを載せるため `SeriesMappingValue` に `episodeTitle` / `episodeComment` / `episodeCommentSource` を追加している (編集はシリーズ詳細から行う)
    - **テスト**: `test/ita/recorded-watch-history.test.js` (シリーズ情報・TS 局名の一括付与、機能フラグ無効時に問い合わせない)

- **しょぼいカレンダーのコメントを同期し、画面から編集・削除できるようにした**
    - **2 種類のコメントを扱う**
        - **作品コメント** (`TitleItem.Comment`) — シリーズ単位。公式リンク・スタッフ・主題歌などが Wiki 記法で書かれた数 KB の長文。`series.comment` / `series.commentSource` に保存する
        - **放送回コメント** (`ProgItem.ProgComment`) — エピソード単位。「定刻放送」「30 分繰り下げ」等の短いメモ。`series_episode.comment` / `commentSource` に保存する
    - **作品コメントは辞書の全件同期に含めない**: 1 作品あたり数 KB あり、`TitleLookup` の `Fields` に `Comment` を足すと同期する XML が 9.5MB → 24MB に膨らむ。代わりに `ISyobocalTitleDictionary.fetchComment(tid)` で**シリーズになっている作品だけを TID 指定で個別に取得**し、`SeriesMetadataFiller.fill()` (Operator 起動 10 分後 + 設定画面の「メタデータ再取得」) で埋める。1 回の実行あたり 100 件までに制限し、溢れた分は次回へ回す
    - **コメントだけが未取得のシリーズでは作品辞書を引き直さない**: コメントは辞書本体に無いため、`SeriesMetadataFiller` の「辞書から埋めるものが残っているか」の判定 (`needsDictionary`) にコメントを含めていない
    - **放送回コメントは追加の通信を伴わない**: 話数・サブタイトルと同じ `ProgLookup` のレスポンスに含まれるため、`SyobocalProgramLookup` が一緒に返し `SeriesResolver` がエピソードへ保存する
    - **手動編集は自動同期で上書きしない**: 画面から編集・削除すると出所が `manual` になり、以降の自動取得の対象から外れる (削除した場合も `manual` が残るので辞書の値が戻ってこない)。辞書由来の値は `dictionary`
    - **API**: 作品コメントは既存の `PUT /api/series/{seriesId}/metadata` に `comment` を追加した (null / 空文字で削除)。放送回コメントは `PUT /api/series/episodes/{episodeId}/comment` を新設した。取得は `GET /api/series/{seriesId}` のレスポンスに `comment` / `commentSource` と、各録画行の `episodeComment` / `episodeCommentSource` として載る
    - **UI (シリーズ詳細)**: 作品コメントはカードで表示し、長文なので既定は 5 行で折りたたむ (「もっと見る」で展開)。鉛筆アイコンから編集ダイアログ、ゴミ箱アイコンから削除 (確認あり)。放送回コメントは各録画行の下に小さく表示し、行のコメントアイコンから編集する (話数が未確定で `episodeId` が無い行にはボタンを出さない)。出所が `manual` の場合はバッジで示す
    - **DB**: `series` と `series_episode` に `comment` / `commentSource` を追加 (マイグレーションは mysql / sqlite 両方)。**`typeorm migration:generate` の出力は使えなかった** — 既存 DB との差分を全て拾って無関係なテーブルまで作り直し、`IDX_series_season` を復元しないなど破壊的だったため、`ALTER TABLE ... ADD COLUMN` だけの手書きに差し替えている
    - **テスト**: `test/ut/series-metadata-filler.test.js` (コメント取得・手動編集の保護・コメントだけ未取得のときに辞書を引かない)、`test/ut/series-resolver.test.js` (放送回コメントの保存・既存エピソードへの補完・手動編集の保護)

- **シリーズ名を外部辞書の正式タイトルへ同期するようにした (手動編集・解除つき)**
    - **背景**: シリーズは録画タイトルから作られることがあり (辞書に当たらなかった場合)、その後に外部 ID が埋まっても表示名は録画由来のゆらいだ名前のまま残っていた。しょぼいカレンダー / Annict / Wikidata 側の表示名と食い違うため、一覧で同じ作品と分かりづらい
    - **再取得で直す**: `SeriesMetadataFiller.fill()` (Operator 起動 10 分後 + 設定画面の「メタデータ再取得」) が作品辞書を引き、`WorkMatch.title` と表示名が違えば上書きする。結果は `titleSynced` として返し、画面のスナックバーと Operator ログ (`series title synced: seriesId=... "旧" -> "新"`) に出す
    - **引き当てキーは変えない**: 更新するのは表示名 (`series.title`) だけで、自動判定に使う `normalizedTitle` は録画タイトル由来のまま残す。既存の紐付け・エイリアス・マージ候補の前方一致を壊さないため
    - **出所で保護する**: `series.titleSource` を追加 (`dictionary` / `manual` / null)。手動で付けた名前 (`manual`) は再取得で上書きしない。辞書名と一致しているものは `dictionary` を記録する。辞書経由で新規作成したシリーズ (`SeriesResolver`) は最初から `dictionary`
    - **手動編集 UI**: シリーズ一覧の編集ダイアログに「シリーズ名 (表示名)」欄を追加した。手動設定済みの場合は「辞書名に戻す」ボタンが出て、押して保存すると `titleSource` が消えて次回の再取得で辞書名へ戻る
    - **API**: `PUT /api/series/{seriesId}/metadata` に `title` を追加 (文字列で手動設定 = `manual`、`null` で手動設定の解除)。`SeriesListItem` に `titleSource` を追加
    - **DB**: `series.titleSource` を追加 (mysql / sqlite 両マイグレーション。`ALTER TABLE ... ADD COLUMN` の手書き)
    - **テスト**: `test/ut/series-metadata-filler.test.js` (辞書名への上書き・手動設定の保護)、`test/ut/series-maintenance-api.test.js` (手動設定・解除・空文字の拒否)

- **話数マッピングの精度を上げた (しょぼいカレンダーの放送予定照会・話数表記の拡充・特番の除外) + エピソード名の表示切り替えを追加した**
    - **背景**: 話数の判定は「録画タイトルの表記 (第 1 話 / #1 / break1 …)」と「しょぼいカレンダーのサブタイトル一覧との照合」の 2 本だけで、**どちらも持たないタイトル** (局が話数もサブタイトルも送出せず作品名だけを流す番組) では話数が付かなかった。[rigaya/SCRenamePy](https://github.com/rigaya/SCRenamePy) が「放送局 + 放送日時」でしょぼいカレンダーの放送予定を引いて話数・サブタイトルを確定させているのを参考に、同じ経路を追加した
    - **放送予定照会 (`SyobocalProgramLookup`, `src/model/metadata/syobocal/`)**: 録画の `channelId` / `startAt` から `Command=ProgLookup&ChID=&Range=` を引き、`TID` / `Count` (通し話数) / `SubTitle` を得る。**タイトルの表記に一切依存しない**ため、話数表記もサブタイトルも無い録画で話数が確定し、辞書キーに当たらないタイトルでも作品自体を特定できる
        - 局の対応付けは既存の `SyobocalChannelMap` (networkId + serviceId → ChID) を使う
        - **未登録局は系列のキー局で代用する**: しょぼいカレンダーに放送データが無い地方局は、その局が属する系列 (`BroadcastAffiliation`、BIT の系列識別) のキー局の ChID へフォールバックして引く (日テレ系 → 日本テレビ ChID 3 など)。同時ネットの番組であれば同じ時刻に同じ作品が並ぶため、地方局の録画でも作品・話数が引ける。系列が分からない局 (BIT 未受信) と独立系はキー局が無いので問い合わせない
        - **キー局で代用した結果には `viaKeyStation: true` を付ける**: 遅れ放送では同時刻に別番組が並ぶため、この結果は**作品の確定には使わず**、作品が既に確定していて `TID` が一致する場合の話数・サブタイトルにのみ使う。一致判定も「開始時刻がほぼ一致 (= 同時ネットとみなせる)」に限り、時間帯の包含では拾わない
        - 取得は**放送日 1 日分をまとめて** (境界は JST 5 時、深夜番組を前日扱いにするため) 行い、`ChID + 放送日` 単位でメモリキャッシュする (TTL 6 時間・最大 256 件)。同じ局・同じ日の録画が続いても外部への問い合わせは 1 回で済む
        - 一致判定は開始時刻の差 5 分以内を最優先し、外れた場合のみ「放送時間帯に含まれる番組」を採る (録画開始が番組途中になっている場合の救済。キー局で代用した場合は行わない)
        - 失敗・連携無効・該当なしはすべて `null` を返し、従来の経路へ委ねる (放送予定が引けなくてもシリーズ化自体は成立する)
    - **`SeriesResolver` は放送予定を最優先で引く**。「その時間にその局で何が放送されていたか」は事実なので、タイトル文字列の照合 (含有・前方一致を許すため誤爆しうる) より確度が高い。**話数表記の有無にかかわらず必ず引く**。問い合わせは放送日 1 日分がキャッシュされるので局・日ごとに 1 回で済む
        - 判定の順序: ①**放送予定 (`resolveByProgram`)** → ②エイリアス辞書 → ③作品辞書 (タイトル照合) → ④LLM → ⑤既存シリーズとの類似度スコアリング。**エイリアス辞書 (手動修正から学習した対応) よりも放送予定が優先される**
        - **手動確定 (`manualLock`) だけは放送予定より強い**。`resolve()` の冒頭で返すため、利用者が直した割当を自動判定で覆さない
        - 確度は録画が番組の頭から始まっている場合 (`exactStart`) が 0.98、放送時間帯の包含で拾った場合 (録画開始が番組途中) が 0.92。後者は隣の番組を指す可能性が残るぶん下げている
        - **しょぼいカレンダー未登録の地方局は系列キー局の放送予定で代用したものも使う** (同時ネットなら同じ時刻に同じ作品が並ぶ)。遅れ放送では別番組を指しうるため確度は 0.9 と最も低くし、代用時は開始時刻がほぼ一致した放送しか拾わない (時間帯の包含では拾わない)
        - **返ってきた作品名が録画タイトルと共通部分を持たない場合はスキップする** (`isPlausibleProgramTitle()`)。時刻ずれ・キー局の代用で隣の番組や別番組を拾った場合の安全弁で、弾いた録画は後続の判定 (エイリアス → 作品辞書 → …) へ委ねる。局の独自表記も救うのが放送予定照会の目的なので完全一致は求めず、「作品名が録画タイトルに含まれる / 録画タイトルが略称になっている / 2-gram 類似度が 0.25 以上」のいずれかを満たせば通す
        - 話数の優先順位: ①放送予定の `Count` (タイトルの話数表記より優先) → ②タイトルの話数表記 → ③サブタイトル一覧との照合による逆引き (総集編・一挙放送では行わない)。放送予定の内容は**確定した作品と同じ `TID` を指している場合のみ**採用するので、別作品の話数を持ち込むことがない
        - **バックフィルのドライラン (`SeriesBackfillManageModel.decide()`) も同じ順序で判定する**。ここは `resolve()` とは別実装なので、判定順を変えたら両方直すこと (揃っていないとプレビューの「未確定」が実行では確定してしまい結果が食い違う)
    - **エピソード名 (`series_episode.title`) を埋めるようにした**: これまで常に `null` で作られていた。放送予定から取れたサブタイトルを優先し、無ければローカルの `syobocal_title_episode` から話数で引く (`IWorkDictionary.lookupEpisodeTitle()`、外部通信なし)。既存のエピソード行にも後から補完するが、**手動で付け直した値は上書きしない** (`SeriesDB.fillEpisodeTitle()` は `title IS NULL` の行のみ更新する)
    - **話数表記の拡充 (`SeriesNormalizer`)**: `Part2` / `vol.3` / `No.5` / `その 7` / `その十二` を話数として認識するようにした
    - **話数は括弧の外を優先して探す**: 従来はタイトル全体を走査していたため、サブタイトル中の数字を話数と誤読しうる。`「」『』` の中を潰した文字列を先に走査し、見つからない場合だけ全文へフォールバックする (SCRename が話数走査を括弧の手前で打ち切るのと同じ考え方)
    - **特番の除外 (`SeriesParseResult.isSpecial`)**: 総集編・傑作選・一挙放送・放送直前特番などは通し話数を持たないため、**タイトルに明示的な話数表記が無い場合の逆引き (放送予定・サブタイトル照合) を行わない**。明示表記があるときはそちらを尊重する
    - **エピソード名の表示切り替え (クライアント)**: シリーズ詳細 (`/series/{id}`) の 3 点リーダー (`client/src/components/series/SeriesTitleDisplayMenu.vue`) から「辞書のエピソード名を使う」/「録画タイトルを使う」を切り替えられるようにした。設定は localStorage の共通設定 (`ISettingValue.useDictionaryEpisodeTitle`、既定 有効) なので、一度切り替えればどの画面でも同じ値になる
        - 設定の保存は `ISettingStorageModel.tmp` を書き換えてから `save()` を呼ぶこと。`save()` が書き出すのは `tmp` で、`getSavedValue()` は localStorage を読み直した**別オブジェクト**を返すため、そちらを書き換えても保存されない (既存の `ChannelGroupingMenu.vue` / `GuideMainMenu.vue` はこの書き方になっており、設定がリロードで元に戻る)
    - **テスト**: `test/ut/syobocal-program-lookup.test.js` (放送予定照会。一致判定・日付境界・キャッシュ・キー局フォールバック・無効時の挙動)、`test/ut/series-resolver.test.js` (放送予定経由の確定・話数表記があっても放送予定を優先する・別作品を指す放送予定を無視する・キー局代用では作品を確定しない・特番の除外)、`test/ut/series-normalizer.test.js` (新しい話数表記・括弧外優先・特番判定)

- **シリーズ周りの UI を改善した (外部サイトへのリンク・戻る操作での検索結果復元・ページ番号指定)**
    - **録画詳細のシリーズタグから外部サイトへ飛べるようにした**: 録画詳細のシリーズ情報欄にある「Annict」「しょぼいカレンダー」のタグを、それぞれ `https://annict.com/works/{annictId}` / `https://cal.syoboi.jp/tid/{syobocalTid}` へのリンクにした (別タブで開く、`rel="noopener noreferrer"`)。外部 ID を持たないシリーズではこれまで通りタグ自体を出さない (`client/src/components/recorded/detail/RecordedDetailSeries.vue`)
    - **シリーズ一覧の検索条件・ページ位置を URL query に載せた**: シリーズ一覧 (`client/src/views/Series.vue`) はキーワード・並べ替え・クール・放送状態・出所・欠番絞り込み・ページをコンポーネントのローカル状態で持っていたため、シリーズ詳細へ遷移してブラウザバックすると検索結果もページ位置も失われていた。録画済み一覧と同じ方式に揃え、これらを `?keyword=&sort=&order=&season=&status=&origin=&hasMissing=&page=` として URL に持たせ、`$route` の変化 (条件変更・ページ移動・ブラウザバック) を watch して取得し直すようにした。既定値の項目は query に載せない
    - **スクロール位置の復元**: 取得完了後に `IScrollPositionState.emitDoneGetData()` を呼ぶようにした。router の `scrollBehavior` はこの通知を待ってから位置を戻すため、これが無いと一覧が描画される前にスクロール復元が走って先頭に戻ってしまう
    - **ページャをページ番号指定にした**: 「前へ / 次へ」だけだった画面下部のページャを、ページ番号を直接選べる `v-pagination` に置き換えた。シリーズ一覧は URL query 駆動の共通コンポーネント `Pagination.vue` を使い、シリーズ未確定キュー (`SeriesPending.vue`) と録画済み一覧のシリーズ表示 (`Recorded.vue`) はローカル状態のまま `v-pagination` にした。件数表記 (`1–30 / 983`) はページャの上に残している。あわせて録画済み一覧のシリーズ表示でキーワード検索したときに 1 ページ目へ戻るようにした (従来はページ位置が残ったままだった)
    - **先頭・最終ページへ飛ぶボタンを付けた**: ページ数が多い画面で端まで移動しづらかったため、共通コンポーネント `Pagination.vue` / `MobilePagination.vue` に `showFirstLastPage` prop (既定 `false` のオプトイン) を追加し、シリーズ一覧で有効にした。ローカル状態で `v-pagination` を直接使っているシリーズ未確定キュー (`SeriesPending.vue`) と視聴履歴 (`WatchHistory.vue`) にも `show-first-last-page` を付けている
    - **検索結果にページネーションを付けた**: 番組検索 (`client/src/components/search/SearchResult.vue`) は最大 `searchLength` 件 (既定 300) をすべて一度に並べていた。検索 API (`POST /api/schedules/search`) は `limit` のみで offset を持たないため、取得済みの結果をクライアント側で 50 件ずつに区切って表示する方式にした。検索し直したら 1 ページ目へ戻し、ページ移動時は結果の先頭へスクロールする

- **新しいバージョンの公開を Web UI で知らせ、ワンクリックで更新できるようにした**
    - **更新チェック**: Operator が GitHub Releases API (`https://api.github.com/repos/<owner>/<repo>/releases`) を起動 3 分後 + 既定 6 時間間隔で見に行き、最新の正式リリースとプレリリースをそれぞれ保持する (`UpdateManageModel`, `src/model/update/`)。取得に失敗しても前回のキャッシュを使い続け、理由だけを `checkError` で返す
    - **バージョン比較 (フォーク特有の落とし穴)**: 本フォークのリリースタグは `2.14.0-stuayu-260727` だが `package.json` の version は `2.14.0-stuayu` で、素の semver 比較では**自分自身のリリースが常に「新しい」と判定されて更新案内が消えなくなる**。`src/util/VersionUtil.ts` で末尾 6 桁の日付サフィックスを識別子から切り離して扱い、片方に日付が無い場合は「同じリリースの別表記」として同値にする。加えて git 管理下では `git describe --tags` の結果を現在バージョンとして優先し、チェックアウト中のタグと正確に突き合わせる。この解決は `src/util/CurrentVersion.ts` に切り出し、**ナビゲーション左上の表記 (`GET /api/version`) も同じ値を返す**ようにした (更新タブの「現在のバージョン」と食い違わないようにするため)
    - **プレリリースは色を変えて通知**: 正式リリースは青 (`primary`)、プレリリース (GitHub の prerelease フラグ) は紫 (`deep-purple`) のトーストで出し、ダイアログにも「プレリリース」チップと不安定な可能性がある旨の警告を出す。`updateChecker.includePrerelease: false` でプレリリースを通知対象から外せる (既定は通知する)
    - **ワンクリック更新 (リリース版 / 開発版の 2 系統)**: `POST /api/update/run` で `git status --porcelain` (ローカル変更が無いことの確認) → `git fetch --tags` → チェックアウト → `npm run all-install` → `npm run compile` → クライアントビルド、の順で実行する。進捗とコマンド出力は `GET /api/update/job` で取れ、画面は 2 秒間隔でポーリングして表示する
        - **リリース版**: `refType: 'tag'` (既定)。`git checkout --force <tag>` で detached HEAD にする
        - **開発版 (main ブランチの最新)**: `refType: 'branch'`。`git checkout -B <branch> origin/<branch>` でローカルブランチをリモートの最新に合わせる。追従先は `updateChecker.branch` (既定 `main`) で変えられる。GitHub の `/repos/{repo}/commits/{branch}` から先頭コミットを取り、ローカル HEAD (`git rev-parse HEAD`) と比べて `upToDate` を返すので、追従済みかどうかが画面で分かる
    - **UI の置き場所**: 実際の更新操作は共通コンポーネント `UpdatePanel.vue` にまとめ、**サーバー設定画面の「更新」タブ**と更新通知トーストのダイアログの両方から使う。設定画面ではリリース版カードと開発版カードが並び、それぞれのボタンから更新できる
    - **`npm run build` を使わない理由**: `build` は `lint --fix` と `prettier --write` を含み作業ツリーを書き換えるため、次回の更新時に「ローカル変更あり」で止まってしまう。更新では `compile` + クライアントビルドのみを実行する
    - **どのプラットフォーム・サービス管理下でも動く再起動**: Operator (親) を終了させれば Service (子) も落ちるので、サービス管理下ならそれだけで新しいコードで起動し直される。Docker (`/.dockerenv`) / systemd (`INVOCATION_ID`・`JOURNAL_STREAM`) / pm2 (`pm_id`・`PM2_HOME`) / Windows サービス (win32 かつ対話コンソールなし) を環境変数から判定し (`src/model/update/UpdateEnvironment.ts`)、**どれにも当てはまらない手動起動の場合のみ後継プロセスを detached で spawn してから終了する**。判定結果は `updateNote` として画面に出し、「更新したら上がってこない」事故を防ぐ
    - **更新は Operator 側で実行する**: git 操作・ビルド・プロセス再起動は親プロセスの責務なので、Service (Web API) からは IPC (`ModelName.update`) 経由で呼ぶ
    - **安全策**: タグは `^[A-Za-z0-9._-]{1,100}$`、ブランチ名は `/` のみ追加で許す書式に制限し、先頭が `-` のものは弾く (`git checkout --upload-pack=...` のようなオプション注入外部コマンドは `shell: false` で起動する。監視リポジトリの設定は `owner/repo` 形式、ブランチ設定も同じ書式検証を通したものだけ受け付ける。作業ツリーに未コミットの変更がある場合は更新を中断する
    - **対応する導入形態**: git clone した環境のみワンクリック更新できる (`installationType: 'git'`)。配布アーカイブ (7z) を展開しただけの環境は `canUpdate: false` を返し、リリースページへの導線だけを出す
    - **API**: `GET /api/update` (状況) / `POST /api/update/check` (再チェック) / `POST /api/update/run` (実行) / `GET /api/update/job` (進捗) / `POST /api/update/restart` (更新を伴わない再起動)。機能フラグ `updateNotification` (既定有効) と `config.yml` の `updateChecker` で制御する
    - **Windows サービスとして動かしている場合の対応 (実機で全く動いていなかった)**: winser (nssm) が作るサービスは既定で **LocalSystem・セッション 0** で動くため、git も npm も実行できていなかった。原因は 3 つあり、いずれも `src/util/GitCommand.ts` と `scripts/win-service.js` で手当てした
        - **git が PATH に無い**: Git for Windows を「現在のユーザーのみ」でインストールするとユーザースコープの PATH にしか入らず、サービスからは見えない (`spawn git ENOENT`)。`findGitExecutable()` が `%ProgramFiles%\Git\cmd\git.exe` 等の既定インストール先を探し、サービス登録スクリプトはサービス専用の環境変数 `Path` に node / git / (config.yml に絶対パスで書かれた) ffmpeg・tsreadex のディレクトリを追加する
        - **git の所有者チェックで全コマンドが失敗する**: リポジトリの所有者 (インストールしたユーザー) と実行アカウント (SYSTEM) が違うため Git 2.35.2 以降が `fatal: detected dubious ownership in repository` を返す。`buildGitArgs()` が **コマンド単位で `-c safe.directory=<repo>`** を渡す (設定ファイルを書き換えないので実行アカウントを変えても副作用が残らない)。登録スクリプトは `git config --system --add safe.directory` も入れる
        - **`npm.cmd` が起動できない**: Node 20 以降は `shell: false` で `.cmd` を spawn できない (EINVAL、CVE-2024-27980 の対策)。コメントには「shell 経由で起動する必要がある」と書かれていたのに `shell: false` のままだったため、`npm run all-install` が必ず失敗していた。`resolveNpmCommand()` が Windows のみ `shell: true` を返す (渡す引数は固定文字列だけなのでシェル解釈の余地は無い)
        - **更新後にサービスが起き上がらない**: node-windows の wrapper は子プロセスが終了すると自動で起動し直すため (`abortOnError: false`)、更新の `process.exit(0)` でそのまま新しいコードに入れ替わる。`UpdateManageModel` 側でも保険としてプロセスから切り離した `cmd.exe` に遅延させた `sc start` を投げる (既に起動していれば何もしない)
        - **サービス管理の判定を明示できるようにした**: Windows サービスの自動判定は「win32 かつ対話コンソールなし」というヒューリスティックで、`npm start > log.txt` のようなリダイレクト起動でも真になる。登録スクリプトが node-windows の `env` としてサービスの環境変数へ `EPGSTATION_SERVICE_MANAGER=windows-service` / `EPGSTATION_WIN_SERVICE_NAME=<サービス名>` を書き込み、`detectSupervisor()` はこれを自動判定より優先する
        - **サービスラッパを winser (nssm) から node-windows へ移行した**: `winser` は 2016 年で更新が止まり同梱の nssm も 2014 年版で、グローバルインストール (`npm install winser -g`) が前提だった。`node-windows` (winsw + wrapper 構成) は **グローバルインストール + `npm link node-windows`** で使う (実環境ではローカル依存として入れたものでは動かないため、依存には含めない。link し忘れても動くよう `npm root -g` からの読み込みにフォールバックする)。**環境変数・作業ディレクトリ・実行アカウント・再起動ポリシーを登録時に宣言的に指定できる**。サービス名は表示名 `EPGStation` を node-windows が正規化した `epgstation` で winser 時代と同じなので `net start epgstation` はそのまま使える
        - **サービスの実体 (winsw の exe / 設定) はリポジトリ直下の `daemon/` に置く**。node-windows は既定で「サービスとして起動するスクリプトのディレクトリ + `/daemon`」へ置くため、script が `dist/index.js` だと `dist/daemon/` になる。すると **ワンクリック更新の `npm run compile` (= `clean` + `tsc`) が実行中のサービス本体を消そうとして `EPERM` で失敗する**。`svc.directory(root)` で `dist` の外へ出した。あわせて `npm run clean` を `scripts/clean-dist.js` に置き換え、`dist` ディレクトリ自体は残して中身だけ消す・消せないものは警告にとどめる形にした (ウイルス対策ソフトがファイルを掴んでいる場合にも効く)
        - **`npm run install-win-service` の中身を差し替えた**: `winser -i -a` 直呼びから `node scripts/win-service.js install` に変更した。登録状況・実行アカウント・サービスから見える node / git / PATH を表示する `npm run status-win-service` も追加した。**winser で登録済みの環境は先に `winser -r -x` で解除する必要がある** (サービス名が同じため衝突する。`sc.exe qc` の出力から nssm 由来かを判定して案内する)。手順は `doc/windows-setup.md` を参照 **サービスの表示名は `--name` で変えられる** (1 台で複数動かす場合向け。`uninstall` / `status` にも同じ `--name` を渡す)
        - **既定でログオン中のユーザーアカウントとしてサービスを動かす** (KonomiTV の Windows サービス化と同じ方式)。登録時にユーザー名 (既定はログオン中のユーザー) とパスワードを対話で聞き、`node-windows` の `logOnAs` に渡す。パスワードは伏せ字で入力し、`mungeCredentialsAfterInstall` により登録後は winsw の設定ファイルから削除される。「サービスとしてログオン」権限は `allowServiceLogon` で自動付与する。**LocalSystem を避ける理由**は、録画先のネットワーク共有 (UNC パス) やユーザー環境に置いた設定・実行ファイルへ手が届かず、git もリポジトリの所有者と一致しないため。Microsoft アカウントでパスワードを持たない場合はローカルアカウントへの切り替えを案内し、`--system` を付けたときだけ従来どおり LocalSystem で登録する

- **Web UI / API にログイン認証を追加した (既定は無効)**
    - **背景**: EPGStation 自体は無認証で、リバースプロキシ側で認証する前提だった。設定を画面から書き換えられるようにするにあたり、まず認証の土台を用意した
    - **有効化**: **既定で有効** (`auth.enabled` 未指定 = 有効の opt-out)。初回アクセス時に管理ユーザーの作成画面が出る (ユーザーが 0 人のときだけ `POST /api/auth/setup` が通る)。リバースプロキシ側で認証している等で不要なら `auth.enabled: false` を書く
    - **匿名利用 (`auth.allowAnonymous`, 既定 有効)**: **未ログインでも一般ユーザーと同じ操作**ができ、システム管理者向けの API (`/settings` `/auth/users` `/update` `/logs`) だけがログインを要求する。家庭内 LAN 想定の既定値で、**認証導入前と同じ感覚で使えるまま設定だけが保護される** (アップグレードで日常操作がログイン待ちになるのを避ける狙いもある)。インターネットに公開する場合は `false` にすること。socket.io も同様に通す。クライアントは未ログインでも通常画面を出し、管理者向け操作で 401 になったときだけ `?login=1` を付けてログイン画面へ切り替える (単純な再読み込みだと匿名のまま同じ画面に戻り堂々巡りになるため)。設定画面にログイン状態とログイン / ログアウトの導線を追加した
    - **外部プレイヤー・IPTV 対応 (認証を既定 ON にするための必須対応)**: 動画配信 URL は `/api` 配下にあるため、認証を必須にすると **VLC / Infuse などの外部プレイヤーと IPTV クライアントが Cookie を送れず 401 になる**。そこで `/videos` `/streams` `/iptv` `/recorded` 配下に限り、クエリの `?token=` でも認証できるようにした (`isMediaApiPath`)。トークンは `GET /api/auth/media-token` が発行し、**セッションとは別の署名鍵**を使うので取り違えられない。既定の有効期間は 365 日で、パスワード変更・ユーザー削除で失効する。Web UI は起動時に取得して URL 組み立て時に自動付与する (`client/src/util/MediaToken.ts`)
    - **パスワード**: 依存を増やさず Node 標準の `scrypt` でソルト付きハッシュにする (`src/model/auth/PasswordHash.ts`)。保存形式は `scrypt$N$r$p$salt$hash` と自己記述的にし、将来パラメータを変えても既存ハッシュを読める。照合は `timingSafeEqual`
    - **セッション**: サーバー側にセッションストアを持たない HMAC 署名付きトークン (`src/model/auth/SessionToken.ts`) を **HttpOnly / SameSite=Lax の Cookie** に入れる。再起動でログアウトさせず、`<video>` や `<img>` からのリクエストにも自動で付くのでサムネイル・配信も保護できる。署名鍵は `data/key/secret.key` から用途別に導出する (`ISecretCrypto.getSigningKey()`)
    - **失効**: `user.tokenVersion` をトークンに埋め、パスワード変更で加算することで発行済みセッションを一括無効化する。ユーザー削除も同様に即時失効する
    - **保護範囲**: API・`/thumbnail`・`/streamfiles` は未認証で 401。クライアントの静的ファイルだけは素通しする (ログイン画面自体を出せなくなるため)。素通しする API は `/api/auth/*` と `/api/version` のみ (`src/model/auth/AuthGuard.ts`)。socket.io も handshake の Cookie を検証する
    - **クライアント**: 未ログイン時は `main.ts` がログイン画面だけを mount し、config / channels の取得 (認証必須) を走らせない。セッション切れ (401) は `RepositoryModel` の共通インターセプタが検知して画面を読み込み直す。ユーザーの追加・削除・パスワード変更はサーバー設定の「アカウント」タブから行える
    - DB は `user` テーブルを追加 (sqlite / mysql 両マイグレーションあり)

- **放送時刻未定・番組延長で開始が遅れた場合の録画開始待ちを延ばし、設定可能にした**
    - **前提 (調査結果)**: programId 予約は `mirakurun.getProgramStream()` を使い、Mirakurun は `eventId` + `parseEIT` で TSFilter を作る。TSFilter は **EIT[p/f] actual (`table_id` 0x4E, `section_number` 0 = present)** を監視し、対象の `event_id` が現在番組になるまでデータを流さず、別の `event_id` が present になったら閉じる。つまり**開始・終了ともイベント単位で追従する ARIB 準拠の仕組みが Mirakurun 側にある**。EPGStation は `stream.finished` で録画を終えるため、programId 予約では `reserve.endAt` を録画停止に使っていない
    - **問題**: EPGStation はストリーム開始後 5 秒データが来ないと失敗扱いにし、リトライは「5 秒 × 3 回 → 60 秒 × 27 回」の**共通枠**だった。前番組が放送時刻未定で延長している間は Mirakurun が正常にデータを流さないだけなのに、**約 27 分で諦めてしまう**。野球中継の延長では足りない
    - **失敗理由を 2 つに分けた** (`src/model/operator/recording/RecordingRetryPolicy.ts`):
        - `waitingForEvent` (最初のデータが来ない = まだ番組が始まっていない) → **既定 3 時間**まで 60 秒間隔で待ち続ける
        - `error` (チューナーが開けない・ソケット断など) → 従来どおり回数で見切る (5 秒 × 3 回 → 60 秒 × 27 回)
          分けたことで、**延長待ちがチューナー異常用の再試行回数を食い潰さない**
    - **設定で外出し**: `config.yml` の `recording` (`startWaitLimitMs` / `startWaitIntervalMs` / `firstDataTimeoutMs` / `errorFastRetryCount` / `errorFastRetryIntervalMs` / `errorRetryCount` / `errorRetryIntervalMs`)。サーバー設定 > 設定ファイルタブの「録画開始のリトライ」からも編集できる。`RecorderModel` は予約ごとに生成され都度 config を読むため**再起動不要**。`startWaitLimitMs: 0` で従来相当の挙動に戻せる
    - **あわせて判明した既存不具合 (修正済み)**: 放送時刻未定の番組**自体を予約**した場合、`endAt = startAt + 1ms` のため `setTimer()` の `now >= reserve.endAt` が成立し、**タイマーを張らずに録画されなかった**。`resolveEndAt` の導入 (暫定 3 時間) で解消済み

- **Issue #13 の再修正: 前番組追従中の録画取りこぼしと programId の開始遅延を解消した**
    - **症状**: 録画準備の再試行待ち中に予約が EIT[p/f] 追従で更新されると、キャンセルが `CANCEL_EVENT` を待ったまま固まり、60 秒後に `isStopPrepRec` が残って録画を開始しないことがあった。また programId 予約は最初のデータを 5 秒で捨て、次の試行まで 60 秒待つため、正常な番組でも先頭を取り逃していた
    - **対処**: `RecorderModel` が再試行 timer を保持してキャンセル時に破棄し、再試行待ちと非同期準備中を分離した。再スケジュール時は stop 状態・エラー回数・待機起点を初期化する。準備チェーンを世代管理し、キャンセルや再スケジュール後に古いチェーンが再試行・失敗通知・エラー回数更新を行わないよう無効化する。programId 予約は Mirakurun の `TSFilter(eventId)` が対象 event_id まで出力を止める仕様に合わせ、ストリームを予約終了時刻または開始待ち上限まで保持する。時刻指定予約を含むすべての予約で `close` / `end` / `error` を検知し、待機中のストリーム断を既存の再試行へ回す
    - **併修**: Mirakurun の 10 進桁連結による program id から event_id を `% 100000` で取り出すよう修正し、DB 上で番組情報が一時的に消えた場合も「後で再試行」する経路へ戻した

- **設定ファイルが無い場合に自動生成するようにした (ログ設定・enc.js)**
    - **これまでの状態**: `config.yml` は `Configuration.ensureConfigFile()` がテンプレートから自動生成していたが、**ログ設定 (`operatorLogConfig.yml` / `serviceLogConfig.yml` / `epgUpdaterLogConfig.yml`) は自動生成されず、無いと `process.exit(1)` で起動できなかった** (`log file is not found`)。手順書の `cp` を 1 つ忘れただけで起動しない、非対称な状態だった
    - **ログ設定の自動生成**: `LoggerModel` が `<name>.yml` を探し、無ければ同梱の `<name>.sample.yml` からコピーする。Operator / Service / EPGUpdater が同時に起動しても壊れないよう、`config.yml` と同じく排他作成 (`COPYFILE_EXCL`) を使い `EEXIST` は正常として扱う
    - **sample も無い場合は落とさない**: 従来は `process.exit(1)` だったが、**コンソール出力にフォールバックして起動を続ける**ようにした (ログ設定が無いだけで EPGStation 全体が起動できないのは割に合わない)。YAML の構文エラーは従来どおり終了させる (書き間違いは気づけたほうがよい)
    - **enc.js も自動生成**: 自動生成した `config.yml` の既定のエンコード設定が `config/enc.js` を参照しているため、これも `enc.js.template` から用意する。無くても起動はできる (エンコード実行時に失敗する) ので、生成に失敗しても警告に留める
    - **ログ出力先ディレクトリ**: log4js の file appender が自動で作るため追加対応は不要 (実機で確認済み)
    - セットアップ手順書の設定ファイル作成は「省略可能」と明記した

- **config.yml を画面から編集できるようにした (DB オーバーレイ方式)**
    - **yml へは書き戻さない**: 書き戻すとコメントや書式が失われ、さらに `Configuration` が `fs.watchFile` で監視しているため書き込みがリロードを誘発する。代わりに **GUI で変更した値だけを DB (`app_setting` の `config` キー) に持ち、読み込み時に「config.yml → DB の差分」の順で重ねて実効値を作る**。手編集派の config.yml はそのまま残り、GUI 派は画面だけで完結できる
    - **マージ規則** (`src/model/config/ConfigOverlay.ts`): オブジェクトはキー単位で再帰マージ、**配列は丸ごと置き換え** (録画ディレクトリやエンコード設定は「一覧そのもの」を編集するため)。値を `null` にすると差分が消えて config.yml の値に戻る
    - **DB 接続設定は編集させない**: `dbtype` / `mysql` / `sqlite` / `postgres` はオーバーレイ対象外。**オーバーレイ自体を DB から読むため、誤った接続設定を保存すると次回起動時に値を読み出せず復旧できなくなる** (自己参照の詰み)。認証設定 (`auth`) も画面へ入る手段そのものなので config.yml 専用にしている
    - **適用タイミング**: 多くのモデルはコンストラクタで config を読むため、Operator / Service / EPGUpdater の**各プロセスで DB 接続直後・モデル構築前**に `ConfigOverlayLoader` が差分を適用する。設定変更時は既存の設定変更 IPC (`appSetting.notifyChanged`) を受けて再読み込みする
    - **再起動要否をキーごとに判定**: 起動時にしか読まれない項目 (`port` / `recorded` / `thumbnail` など) は `requiresRestart: true` として定義し、**「実際に config.yml と値が変わったキー」だけ**を対象に再起動案内を出す (同じ値を送り直しても案内は出ない)
    - **API / UI**: `GET /api/settings/config` が「実効値 / config.yml の値 / 差分 / 編集可能キーと再起動要否」を返す。保存は既存の `PUT /api/settings/system` の `config` キーで行い、変更履歴・ロールバックの仕組みにそのまま乗る。サーバー設定画面に「設定ファイル」タブを追加し、項目名での検索、画面で変更した項目のバッジ表示、「config.yml の値に戻す」ボタン、録画ディレクトリとエンコード設定の一覧編集に対応した
    - **配信プロファイル**: `stream` も画面から編集できる。スコープ (ライブ / 録画済み TS / 録画済みエンコード済み) とコンテナを選んで一覧を編集し、**新形式 (`stream.profiles`) と旧形式 (`stream.live.ts.<container>` 等) の両方**に対応する。新形式では id・コンテナ・無変換フラグ・映像/音声パラメータも指定でき、cmd を省略すると自動生成される。`StreamProfileManageModel` は呼び出しのたびに config を読むため**再起動不要**
    - **外部コマンド実行**: `recordingStartCommand` などの 9 個も編集できる。`ExternalCommandManageModel` はコンストラクタで config を読むため**要再起動**として扱う
    - **一覧項目は差分になるときだけ保存する**: 録画ディレクトリ・エンコード設定・配信プロファイルは実効値を読み込んで編集するため、そのまま保存すると触っていなくても差分として固定され、以後 config.yml 側の変更が反映されなくなる。**config.yml と値が違うときだけ**差分へ入れる
    - **未対応**: DB 接続設定と認証設定のみ (上記の理由により意図的に対象外)

- **EIT[p/f] を視聴画面・番組表へ即時反映するようにした (+ 放送時間未定の番組の扱いを修正)**
    - **背景**: 現在放送中/次の番組 (EIT[p/f]) は 10 秒周期の短サイクルで DB へ保存されているが、クライアントへの通知は `epgUpdateIntervalTime` (既定 10 分) の長サイクルでしか飛んでいなかった。そのため延長・繰り上げが起きても視聴中の番組情報や番組表が最大 10 分古いままだった
    - **専用の通知イベント**: 全体更新 (`updateStatus`) とは別に socket.io の `updateOnAirProgram` を追加し、**更新があった放送局 id を添えて**配る。10 秒周期で飛びうるため、視聴画面は「自分が見ている局のときだけ」番組情報を取り直す。経路は EPGUpdater (子) → Operator → IPC → Service → socket.io
    - **対象の絞り込み**: `detectOnAirChannelIds` (`src/model/epgUpdater/OnAirProgramDetector.ts`) が、更新された番組のうち現在放送中か 10 分以内に始まるものだけを抽出する。番組表は現在時刻を表示しているときだけ、スクロール位置を保ったまま 30 秒に 1 回を上限に取り直す
    - **放送時間未定 (ARIB の duration = 0xFFFFFF) の修正**: Mirakurun はこれを `duration: 1` (1ms) で返す。従来は `endAt = startAt + duration` としていたため、**放送開始 1ms 後に「終了済み」となり放送中一覧・視聴画面・番組表から即座に消えていた** (実データでも NHK 総合/Eテレ/BS のニュース枠 6 件で発生を確認)。`src/util/ProgramDuration.ts` を追加し、未定の場合は暫定 3 時間の終了時刻を入れる
    - **番組表のレイアウト崩れ対策**: 暫定 3 時間のままだと次の番組に食い込むため、番組表 API (`ScheduleApiModel`) で**同じ放送局の次の番組の開始時刻まで切り詰める** (`clampUndefinedDuration`)。実データ (NHK Eテレ1福島) で 16:37:31 開始の未定番組が次の 17:00 番組の直前まで正しく詰まり、重なり 0 件を確認済み
    - **表示**: `LiveStreamInfoItem` / `ScheduleProgramItem` に `isDurationUndefined` を追加し、視聴画面の番組情報カードと番組表のダイアログでは終了時刻の代わりに「(終了時刻未定)」と出す (暫定値を本当の終了時刻のように見せない)
    - **予約も EIT[p/f] で即時に追従させる**: 上記の通知はクライアントへの反映だけで、**予約の再スケジュールは `epgUpdateIntervalTime` (既定 10 分) 周期の `updateAll()` 任せ**だった。緊急地震速報や前番組の延長・繰り上げで開始時刻が変わっても予約側の反映が最大 10 分遅れ、録画開始に間に合わないことがある。`EventSetter` が `onAirProgramUpdated` を受けたときに `ReservationManageModel.updateOnAirReserves(channelIds)` を呼び、**その放送局の「現在時刻〜15 分先に重なる programId 予約」だけ**を `update()` で追従させるようにした (時刻指定予約は番組情報を持たないため対象外、スキップ済みの予約も対象外)。対象が数件に限られるので 10 秒周期で呼ばれても負荷は小さく、変更が無ければ `update()` 内の `programUpdateTime` 比較で即 return する。追従の結果は従来どおり `reserveEvent` 経由で `RecorderModel.update()` へ流れ、録画中の終了時刻変更にも反映される。テストは `test/ut/reservation-on-air-follow.test.js`
    - **残っていた遅延は後述の「EPG のリアルタイム同期」で解消した**: `EPGUpdateManageModel.saveProgram()` は「更新イベントの中に 5 分以内に始まる番組がある」ときだけ DB へ書き込む (`needToSave`) 仕様で、`remove` / `redefine` だけが溜まった回は書き込まれず、番組が消えた場合の反映が次の全体更新まで遅れていた。なお 10 秒周期の tick が `updateAll` と直列 (`runExclusiveUpdateTask`) である点は変わらないため、全件更新に時間がかかる環境では**その間だけ** EIT[p/f] の反映が待たされる

- **EIT[p/f] の通知がクライアント画面に反映されていなかったのを直した**
    - **症状**: 本番環境で EIT[p/f] の更新ログが出て socket.io の `updateOnAirProgram` / `updateProgram` もブラウザまで届いているのに、視聴画面の番組情報も番組表も書き換わらなかった (実ブラウザで socket.io フレームと API リクエストを突き合わせて確認。番組情報が切り替わっていたのは番組終了時刻に合わせた再取得タイマーによるもので、EIT[p/f] の通知では 1 度も再取得が走っていなかった)
    - **原因 1 (視聴画面)**: `vue-facing-decorator` はクラスフィールドの初期値を **data 用の一時インスタンス** (`new cons()` した結果) から集めて data にコピーする。このとき Vue インスタンスへ束縛されるのは**メソッドだけ**で、クラスフィールドとして書いたコールバック (`private xxxCallback = ((): void => { ... }).bind(this)`) の `this` は一時インスタンスのままになる。そのためコールバックの中から `this.watchParam` のような**データを直接読むと初期値 (null) しか見えず**、`WatchOnAir` の「視聴中の放送局か」の判定が常に成立せず即 return していた。判定はメソッド (`onUpdateOnAirProgram()` / `onUpdateProgram()`) 側へ移した。**socket.io などのコールバックをクラスフィールドで持つときは、中でメソッドを呼ぶだけにしてデータを直接参照しないこと** (メソッド内であれば `this` は Vue インスタンス)
    - **原因 2 (番組表)**: `Guide.refreshGuide()` が `fetchGuide()` と `createProgramDoms()` は呼ぶのに `renderProgramDoms()` を呼んでいなかった。番組表のセルは Vue のテンプレートではなく**手組みの DOM を `content` へ流し込む**方式のため、これを呼ばないとデータだけ新しくなり画面は古いままになる (`updateVisible()` も `renderProgramDoms()` の末尾で呼ばれるため、可視判定も更新されない)
    - **削除通知が範囲不明で全画面を叩いていたのも直した**: `buildProgramUpdateNotice()` は削除された番組を「放送局・時間帯が分からない」として id だけ載せていたため、削除だけの更新が `{ channelIds: [], startAt: null, endAt: null }` として飛び、受け取った番組表・視聴画面が毎回取り直していた (実測で 10〜20 秒おきに発生していた)。`EPGUpdateManageModel` が **DB から消える前に** `IProgramDB.findIds()` で放送局・時間帯を控え (`getDeletedProgramRanges()`、`PROGRAM_ID_NOTICE_LIMIT` 件まで)、通知の範囲に混ぜるようにした
    - **通知の到達をログで追えるようにした**: Operator 側は `EventSetter` が `send onAirProgramUpdated to client: channels: [...]` / `send programUpdated to client: channels: [...] range: ... programs: N` を、Service 側は `SocketIOManageModel` が `notify updateOnAirProgram: channels: [...] clients: N` / `notify updateProgram: channels: [...] range: ... clients: N` を info で出す。**接続中のクライアント数**も併記するので、「サーバは配ったが画面が動かない」のか「そもそも配っていない」のかを Operator / Service のログだけで切り分けられる (時間帯の整形は `src/util/ProgramTimeLog.ts` の `formatLogTimeRange()`)
    - **併せて直したもの**: 番組表の取り直しの最小間隔を 30 秒 → 10 秒に縮め、**間隔内に来た通知を破棄せず繰り越す** (従来は破棄していたため、次の通知が来るまで古い表示のままになりえた)。視聴画面は `updateOnAirProgram` に加えて **`updateProgram` も購読**し、EIT[p/f] の窓 (現在〜10 分先) の外で確定した延長・繰り上げにも追従する

- **EPG のリアルタイム同期を追加した (災害時の特番割り込み・番組延長を即時に DB へ反映する)**
    - **背景**: Mirakurun / recisdb-proxy の event stream (`/events`) 自体はリアルタイムに届いているのに、DB への反映は「10 秒周期の tick」+「`saveProgram(now + 5 分)` の足切り」を通るため、**5 分より先に始まる番組の変更は `epgUpdateIntervalTime` (既定 10 分) まで反映されなかった**。災害発生時の特別番組への差し替えや、当日夕方以降の編成変更がこれに該当する。周期そのものを縮める案は `updateAll()` が program の全削除 + 全挿入で重いため採らず、**緊急度の高いイベントだけを先行して書き込む経路を別に生やす**方針にした
    - **緊急度の判定 (`src/model/epgUpdater/ProgramUpdatePriority.ts`)**: event stream から受け取ったイベントを `immediate` / `normal` に分類する。判定はキューへ積む時点で行うため **DB 参照を伴わない同期処理だけ**で完結させている (「DB の現在値と時刻が変わったか」は判定できないので、代わりに「近い時間帯の番組の更新か」で拾う)
        - `remove` / `redefine` — 番組の消滅・付け替え (特番割り込みで飛んだ場合を含む)
        - 放送時間未定 (ARIB の `duration = 0xFFFFFF`、Mirakurun では `1`) — 放送時刻に関わらず即時。延長・特番編成の典型
        - `urgentWindowMinutes` (既定 180 分) 以内に始まる、または放送中の番組の更新
        - 予約済みの番組 (`isReservedProgramId`。判定関数を差し込める形にしてあるが、EPGUpdater は別プロセスで予約情報を持たないため現時点では未使用)
    - **先行フラッシュ**: `immediate` を受信すると `EPGUpdateEvent.URGENT_ENQUEUED` が飛び、`EPGUpdater` が `debounceMs` (既定 500ms) 待ってから `saveProgram(0, { urgentOnly: true })` を呼ぶ。event stream は 1 つの編成変更につき複数イベントを連続で送ってくるため、デバウンスで 1 回の DB 更新にまとめる。`minIntervalMs` (既定 500ms) で先行フラッシュ同士の間隔も絞る。実行は既存の `runExclusiveUpdateTask()` に乗せるので `updateAll` とは競合しない
    - **部分フラッシュ**: 従来の `saveProgram()` は「キュー全体を書く or 全部キューへ戻す」の二値だった。`urgentOnly` 指定時は `splitUrgentProgramEvents()` が緊急分だけを取り出し、残りは従来どおり周期反映に回す。**同じ番組に対するイベントの追い越しを防ぐため、`immediate` と判定された番組 id に属するイベントはまとめて取り出す** (後続の update だけ先に書いて、キューに残った古い create が後から書かれ時刻が巻き戻る事故を防ぐ)。この不変条件は `test/ut/program-update-priority.test.js` が固定している
    - **通常の EPG 更新の負荷は変わらない**: 先の日付の番組情報 (`normal`) は従来どおり 10 秒 tick + 5 分ウィンドウ + `epgUpdateIntervalTime` のままで、DB への書き込み回数が増えるのは緊急イベントを受信したときだけ
    - **予約・画面への波及は既存経路をそのまま使う**: 先行フラッシュでも `PROGRAM_UPDATED` / `ON_AIR_PROGRAM_UPDATED` は同じように emit されるため、socket.io の `updateOnAirProgram` と `ReservationManageModel.updateOnAirReserves()` がそのまま動く。ただし `notify()` (予約の全体 `updateAll`) は呼ばない (重いので従来の周期のまま)
    - **予約は番組 id 単位でも追従する**: `updateOnAirReserves()` は「現在時刻〜15 分先」の窓に入る予約しか見ないため、数時間先の番組が延長・繰り上げ・消滅しても反映は `epgUpdateIntervalTime` 周期の `updateAll()` 待ちだった。`saveProgram()` が **変更・削除のあった番組 id** を通知に載せ、`ReservationManageModel.updateReservesByProgramIds()` が `IReserveDB.findProgramIds()` (500 件ずつ分割して `IN` で引く) で一致する予約だけを更新する。放送時刻に関わらず追従できる。除外済み (`isSkip`) の予約は対象外。番組 id が 1000 件 (`PROGRAM_ID_NOTICE_LIMIT`) を超える更新では id を載せず、周期的な全体更新に任せる (件数が多いときは 1 件ずつ追従するより全体更新のほうが安い)
    - **番組表は変更のあった時間帯だけで反応する**: 従来の `updateOnAirProgram` は EIT[p/f] の窓 (現在〜10 分先) しか対象にしておらず、番組表も「現在時刻を表示中のときだけ」取り直していた。新しい socket.io イベント **`updateProgram`** で `{ channelIds, startAt, endAt }` (変更のあった番組の時間帯の全体) を配り、番組表は**表示中の時間帯・放送局と重なるときだけ**取り直す (`Guide.vue` の `isOverlappedWithDisplay()`)。時刻指定で先の時間帯を見ている場合もこちらは反応する。取り直しは 10 秒に 1 回を上限にスクロール位置を保ったまま行う (間隔内の通知は繰り越す)。通知の組み立ては `src/model/epgUpdater/ProgramUpdateNotice.ts` (放送時間未定の番組は暫定の終了時刻で範囲に含める。**削除される番組は DB から消える前に `IProgramDB.findIds()` で放送局・時間帯を控えて通知へ載せる**)
    - **通知の経路**: `EPGUpdateManageModel` (`PROGRAM_RANGE_UPDATED`) → `EPGUpdater` (`process.send`) → `EPGUpdateExecutorManageModel` → `IEPGUpdateEvent.emitProgramUpdated()` → `EventSetter` で 2 つに分岐し、①`IIPCServer.notifyProgramUpdatedClient()` → Service → socket.io `updateProgram` (画面)、②`updateReservesByProgramIds()` (予約) へ流れる。番組 id はクライアントへは送らない (予約追従にしか使わないため)
    - **設定**: 有効・無効は機能フラグ `featureFlags.epgRealtimeSync` (opt-out、未指定なら有効)。チューニングは `config.yml` の `epgRealtime` (`debounceMs` / `minIntervalMs` / `urgentWindowMinutes`)。解決と値の丸めは `src/model/epgUpdater/EPGRealtimeConfig.ts` に集約し、config はホットリロードされるため実行時に毎回読み直す
    - **mirakc は対象外**: mirakc 経路 (`/events` の SSE) は `programQueue` を使わず serviceId 単位で更新するため、この先行フラッシュは発火しない (`saveOnAirServices()` が元々 10 秒ごとに放映中を更新している)
    - **recisdb-proxy を使う場合の注意**: `checkTunerServerType()` は `getServerConfig()` (`/api/config/server`) の成否で mirakurun / mirakc を判定する。互換実装がこのエンドポイントを返さないと mirakc と誤判定して `/events` の SSE を叩き続けるため、`config.yml` の `tunerServerType: mirakurun` で固定すること

    - **DB 反映フローの全体像**:

        ```mermaid
        flowchart TD
            MIRA["Mirakurun / recisdb-proxy<br/>GET /events (chunked JSON)"] -->|program event| ENQ["EPGUpdateManageModel<br/>enqueueProgramEvent()"]
            ENQ --> QUEUE[("programQueue<br/>(メモリ)")]
            ENQ --> CLS{"classifyProgramEvent()<br/>緊急度判定"}

            CLS -->|"immediate<br/>(remove / redefine /<br/>放送時間未定 /<br/>urgentWindow 以内)"| URGENT["URGENT_ENQUEUED"]
            CLS -->|normal| WAIT["周期反映に任せる"]

            URGENT --> DEB["EPGUpdater<br/>debounceMs (既定 500ms) 待機<br/>+ minIntervalMs で間隔制限"]
            DEB --> LOCK

            TICK["setInterval 10 秒"] --> LOCK["runExclusiveUpdateTask()<br/>EPG 更新系タスクの直列化"]

            LOCK -->|"先行フラッシュ<br/>saveProgram(0, urgentOnly)"| SPLIT["splitUrgentProgramEvents()<br/>緊急分だけ取り出す<br/>(同一 programId はまとめて)"]
            LOCK -->|"通常 tick<br/>saveProgram(now + 5 分)"| THRESH{"5 分以内に始まる<br/>番組の更新がある?"}
            LOCK -->|"epgUpdateIntervalTime 経過 /<br/>event stream 断"| ALL["updateAll()<br/>全件取得 → 全削除 + 全挿入"]

            SPLIT --> UPD
            THRESH -->|Yes| UPD["ProgramDB.update()<br/>insert / update / delete"]
            THRESH -->|No| REQ["キューへ戻す"]
            REQ --> QUEUE
            SPLIT -.->|"残り (normal)"| QUEUE
            QUEUE -.->|取り出し| SPLIT
            QUEUE -.->|取り出し| THRESH

            ALL --> DB[("program テーブル")]
            UPD --> DB
            UPD --> DETECT["detectOnAirPrograms()<br/>EIT[p/f] 相当の抽出"]
            UPD --> NOTICE["buildProgramUpdateNotice()<br/>変更のあった番組 id /<br/>放送局 / 時間帯"]
            DETECT --> EV1["PROGRAM_UPDATED<br/>(programIds)"]
            DETECT --> EV2["ON_AIR_PROGRAM_UPDATED<br/>(channelIds)"]
            NOTICE --> EV3["PROGRAM_RANGE_UPDATED<br/>(programIds / channelIds /<br/>startAt / endAt)"]

            EV2 --> IPC["EPGUpdater (子) → Operator<br/>process.send"]
            EV3 --> IPC
            IPC --> RES["ReservationManageModel<br/>updateOnAirReserves()<br/>= 放送中〜15 分先の予約"]
            IPC --> RES2["ReservationManageModel<br/>updateReservesByProgramIds()<br/>= 番組 id 一致の予約<br/>(放送時刻に関わらず)"]
            IPC --> SIO["Service → socket.io<br/>updateOnAirProgram<br/>= 視聴画面 / 放映中一覧"]
            IPC --> SIO2["Service → socket.io<br/>updateProgram<br/>= 番組表 (表示中の<br/>時間帯と重なる場合のみ)"]
        ```

- **EPG 追従 (EIT[p/f]) の経過を info ログに出し、予約画面にも状態を表示するようにした**
    - **背景**: 番組の延長・繰り上げが起きたとき、何がどう動いたのかがログから追えなかった (`update program db done` のような件数だけ)。時刻がずれた録画を後から検証できるよう、**変更前 → 変更後の時刻を併記**して残す
    - **EIT[p/f] の受信ログ**: `EPGUpdateManageModel.saveProgram()` が、更新された番組のうち現在放送中 (present) / 直後に始まる (following) ものを `detectOnAirPrograms()` で抽出し、**DB 更新前に旧値を引いてから** 1 行ずつ info で出す。内容は `EIT[p/f] present: channel: <局名> (<channelId>) programId: ... eventId: ... name: ... start: <旧> -> <新> (+Ns) end: <旧> -> <新> duration: ...`。放送時間未定になった / 確定したときは `end time became pending` / `end time has been fixed` を末尾に添える。全件更新直後などで対象が 30 件 (`ON_AIR_LOG_LIMIT`) を超える場合は件数だけに落とす
    - **予約の再スケジュールログ**: `ReservationManageModel.update()` が予約時刻の変化を `reschedule reservation: <id> ... start: <旧> -> <新> end: <旧> -> <新>` で出す。`RecorderModel.update()` も `reschedule recording:` を出し、そのとき録画中 / 準備中 / 待機中のどれだったかを添える
    - **開始待ちのログ**: 前番組の延長で EIT[p/f] がまだ present にならない間に出る `waiting for the program to start` に、予定開始・終了時刻を追加した
    - **整形の共通化**: 時刻と番組長の表記は `src/util/ProgramTimeLog.ts` (`formatTimeChange` / `formatLogDuration` / `formatDurationUndefinedChange`) に集約している
    - **画面表示**: `reserve` テーブルに `isTimeUndefined` (放送終了時刻が未定) と `isFollowingSchedule` (前番組の延長などで開始待ち) を追加し、`ReserveItem` で配る。予約一覧 (カード / テーブル) とダッシュボードで、終了時刻を赤字にし「終了時刻未定」「前番組延長のため追従中」のチップを出す (`client/src/components/reserves/ReserveScheduleStatus.vue`)
    - **状態の更新経路**: `RecorderModel` が開始待ちに入った時点で `IReserveDB.updateFollowingSchedule()` を呼び、`IReserveEvent` 経由で `notifyClient()` が飛ぶため画面はすぐ追随する。録画開始・キャンセル・待機打ち切りで解除する

- **SSO (Google / GitHub) ログインと権限管理を追加した**
    - **サインアップの流れ**: **最初にサインアップした人が自動でシステム管理者 (`admin`)** になり、以降にサインアップした人は一般権限 (`user`) になる。管理者は「アカウント」タブから他の人へ随時管理者権限を付与・剥奪できる。管理者が 0 人になる降格・削除は拒否する
    - **OAuth 2.0 認可コードフロー**: `GET /api/auth/oauth/{provider}` で認可画面へ 302、`GET /api/auth/oauth/{provider}/callback` でコードをトークンに交換してログインする。依存ライブラリは足さず、URL 組み立てと state の署名だけ自前で持つ (`src/model/auth/OAuthProviders.ts`)、通信は `fetch`
    - **CSRF 対策**: state は HMAC 署名 + 有効期限 10 分 + **発行時のプロバイダを埋め込んで**検証する (別プロバイダのコールバックへ持ち込めない)。署名鍵は `data/key/secret.key` からセッションとは別用途として導出する
    - **プロバイダ差の吸収**: Google は OpenID Connect の `sub`/`email`/`name`、GitHub は `id`/`login`/`email`。GitHub はメール非公開設定だとプロフィールに載らないため `/user/emails` の primary を追加取得する。メールが取れなくてもログインは可能 (識別子はあくまでプロバイダ側のユーザー ID)
    - **設定場所**: クライアント ID / シークレットは**ログイン前に必要**なので `config.yml` の `auth.providers.google` / `auth.providers.github` に置く (DB は認証後でないと読めないため)。コールバック URL は `X-Forwarded-Proto`/`X-Forwarded-Host` を見てアクセス元から自動生成し、合わない構成では `redirectUri` で明示できる
    - **サインアップの開放/制限**: `auth.allowSignUp` (既定 true) で 2 人目以降のサインアップを止められる。インターネットに公開している場合は false にして管理者が招待する運用を推奨。**1 人目だけは許可する** (誰も居ないと管理者を作れないため)
    - **権限の反映**: 権限はトークンに載せるが、検証時に DB の現在値で上書きする。付与・剥奪が**再ログインなしで最大 30 秒 (権限キャッシュの保持時間) で反映**される
    - **管理者限定 API**: `/api/settings`・`/api/auth/users`・`/api/update`・`/api/logs` は一般ユーザーには 403 を返す (`isAdminApiPath`)。画面側もサーバー設定への導線を隠し、URL 直打ちでも弾く
    - **パスワードと SSO の併存**: SSO だけで作られたユーザーは `passwordHash` が空でパスワードログインできない。既存のパスワードユーザーはそのまま使える。DB は `user.role` 列と `user_identity` テーブルを追加 (sqlite / mysql 両マイグレーションあり。**移行時、既存ユーザーは管理者に引き上げる**)

- **ログレベルを GUI から変更できるようにした**
    - **yml と DB のどちらを正にするか**: 既存の `app_setting` テーブル (JSON Schema 検証・変更履歴・ロールバック・秘密情報の暗号化・ホットリロード通知が実装済み) に相乗りする方式にした。**ログ設定ファイル (`config/*LogConfig.yml`) がベースで、DB の値はその上に被せる差分**として扱う。yml へ書き戻さないのでコメントや書式が壊れず、二重管理にもならない
    - **設定キー**: `logging.levels.{system,access,stream,encode}`。未指定のカテゴリはファイルの設定をそのまま使う。値は log4js のレベル (`trace`〜`fatal` と `off`)
    - **反映は再起動不要**: log4js のロガーは `level` を代入するだけで切り替わるため、`LogLevelApplier` が該当カテゴリだけを書き換える。Operator / Service / EPGUpdater の 3 プロセスすべてが起動時に適用し、Service は自身の API 経由の変更を即時反映、Operator は既存の設定変更 IPC (`appSetting.notifyChanged`) を受けて再適用する
    - **壊れた設定でログを止めない**: 未知のカテゴリ・不正なレベルは黙って捨て、DB が読めない場合は何もしない (ファイル設定のまま動作を継続する)
    - UI はサーバー設定の「基本」タブに追加した

- **reasoning 系モデルで LLM の応答が空になる問題に、上限の自動引き上げで対処した**
    - **症状**: `llm title extraction failed: llm response has no content (finish_reason: length, completion_tokens: 2000)`。思考 (reasoning) にトークンを使い切り、本文 (`content`) を 1 文字も出さないまま `max_tokens` で打ち切られる。以前 `maxTokens` の既定を 200 → 2000 に上げたが、モデル・入力によっては 2000 でも足りない
    - **固定値を上げ続けない**: 思考量はモデルと入力で大きく振れるため、既定値を上げるだけでは追いつかない。`finish_reason: 'length'` かつ本文が空のときだけ **上限を 4 倍にして 1 度だけやり直し、成功した値をプロセス内で覚える** ようにした (`LlmTitleExtractor`)。2 本目以降のタイトルは最初から引き上げ後の上限で問い合わせるので、往復が無駄になるのは最初の 1 回だけ。引き上げの天井は `seriesLlm.maxTokensLimit` (既定 16000)
    - **思考を切れるモデルでは切る**: リクエストに `reasoning: { enabled: false }` を付ける。OpenRouter 等はこれを解釈して思考を止め、解釈しないサーバーは未知のキーとして無視するため、ローカル LLM (Ollama / llama.cpp) でも害はない
    - **思考欄に答えを書くモデルへの対応**: `message.content` が空でも `message.reasoning` に JSON があればそこから拾う (本文を出さず思考欄にだけ答えを書くモデルが実在する)。抽出結果は従来どおり作品辞書で引き直して検証するため、ここを緩めてもハルシネーションは通らない
    - テストは `test/itb/llm-title-extractor.test.js` (ローカル HTTP スタブサーバで LLM API を模擬) に追加した

- **LLM が誤学習したエイリアス辞書を設定画面から修正できるようにした**
    - **背景**: `SeriesResolver` は LLM が抽出した番組名が作品辞書と完全一致したとき「正規化タイトル → シリーズ」を `series_alias` へ自動学習する。この規則は以後 LLM も作品辞書も引かずに確度 1.0 で確定させるため、**誤学習が 1 件あると以降の録画が延々と間違ったシリーズへ吸われる**。従来の設定画面では削除しかできず、正しいシリーズへ付け替える導線が無かった
    - **API**: `PUT /api/series/aliases/{aliasId}` (1 件の付け替え) と `POST /api/series/aliases/bulk` (一括の付け替え / 削除) を追加した。付け替え先は `seriesId` 優先で、`seriesTitle` を渡した場合は正規化タイトルが一致する既存シリーズを再利用し、無ければ新規作成する
    - **付け替えは手動修正扱いになる**: 更新した辞書は `source` を `'manual'` にするため、以後の LLM 自動学習で上書きされない (`SeriesResolver` の学習は既存エイリアスを上書きしない実装のため、これで固定される)
    - **正規化タイトルは変更しない**: `normalizedTitle` は辞書の引き当てキーそのものなので、付け替え API では変更させない (別の表記を足したい場合は手動マッピングから新規学習させる)
    - **UI (サーバー設定 > シリーズ管理タブ)**: エイリアス表を編集可能にした。行ごとのシリーズ選択はサーバ検索付きオートコンプリート (300ms デバウンス)、チェックボックスで複数選択して「まとめて付け替える先」を適用・「選択を削除対象にする」ができる。編集はバッファに溜めて「辞書の変更を保存」で一括送信し、変更した行は学習元バッジがその場で「手動」に変わる。学習元フィルタに加えてキーワード絞り込みも追加した
    - **一括保存の挙動**: 1 件失敗しても残りは反映し、失敗分は `failed[]` に理由付きで返す (上限 500 件)
    - **既存の録画は付け替わらない**: 辞書の修正は以後の判定に効くもので、すでに誤ったシリーズへ紐づいた録画はそのまま残る。溜まった分はシリーズ一覧の複数選択マージで正しいシリーズへ寄せる

- **録画が 0 件のシリーズ (自動生成の抜け殻) を画面から削除できるようにした**
    - **背景**: マージで統合元が消える一方で、分割のやり直し・録画の削除・バックフィルのドライラン後の付け替えなどで、**録画が 1 件も紐づいていないシリーズ**が残る。これらは一覧・マージ候補・オートコンプリートのノイズになるが、従来は削除手段がなかった (マージは寄せ先が必要だった)
    - **API**: `GET /api/series/empty` (録画 0 件のシリーズ一覧。エイリアス件数・エピソード数・出所付き) と `DELETE /api/series/empty` (body: `DeleteEmptySeriesOption { seriesIds? }`、省略時は全件削除) を追加した。他の series 系と同じく `featureFlags.seriesLibrary` が無効なら 404
    - **誤削除防止**: 削除は `SeriesDB.deleteSeriesByIds()` のトランザクション内で行い、**実行直前に `recorded_series_link` を再確認して録画が紐づいたシリーズを対象外にする** (一覧取得から削除までの間に録画が完了しても消さない)。API 層でも `seriesIds` に録画ありのシリーズが混ざっていたら `SeriesIsNotEmpty` (400) で**一件も削除せず**に弾く
    - **連鎖削除**: シリーズ本体に加えて `series_episode` / `series_alias` / `series_reservation_hint` を削除する。**録画ファイルは一切削除しない** (そもそも録画が紐づいていないシリーズが対象)。消えるエイリアス・エピソードの件数は一覧と削除結果に返すので、学習済みの辞書ごと消してしまう場合は削除前に気付ける
    - **UI**: サーバー設定 > シリーズ管理タブの末尾に「録画 0 件のシリーズの掃除」を追加。チェックボックスで選んで削除するか、一括削除する (いずれも確認ダイアログあり)。削除後はエイリアス辞書表も再読み込みする

- **エイリアス辞書の画面から、同期済みマスタ (しょぼいカレンダー / Annict / Wikidata) を横断検索してシリーズを作れるようにした**
    - **背景**: エイリアスの付け替え先の検索は、これまで **ローカルの `series` テーブルだけ**を見ていた。そのため「まだ 1 件も録画が無い作品」や「録画タイトルが崩れていて辞書で引けなかった作品」は候補に現れず、付け替え先を手で作るしかなかった (しかも手作りのシリーズは外部 ID が空のままになる)
    - **API**: `GET /api/series/dictionary?keyword=&limit=` (作品辞書の横断検索) と `POST /api/series/dictionary` (body: `CreateSeriesFromDictionaryOption { syobocalTid? / annictId? / wikidataQid? }`) を追加した。検索結果にはすでにローカルにあるシリーズの `seriesId` を付けて返すので、画面で「登録済み / 未登録」を区別できる
    - **検索の仕組み**: マッチングで使っている `WorkDictionary` の統合索引をそのまま引く (`search()`)。しょぼいカレンダー + Annict の統合索引を含有一致で引き、Wikidata 単独の番組は厳密キー索引から引く。同一作品は外部 ID の組で重複を落とし、照合キーが短い (= キーワードに近い) 順に返す
    - **作成時の重複防止**: クライアントから受け取った ID を信用せず `WorkDictionary.findByIds()` で引き直してから作る。同じ外部 ID のシリーズがあればそれを返し (`created: false`)、外部 ID が空のまま自動生成された同名シリーズがある場合も正規化タイトルで拾って再利用する。辞書に無い ID は `DictionaryWorkIsNotFound` (404)
    - **UI**: サーバー設定 > シリーズ管理タブのエイリアス辞書の下に「作品辞書から探して登録」を追加。作品名で検索し、辞書・クール・話数・外部 ID を見て「シリーズを作成」できる。作成したシリーズは辞書の読み仮名・クール・総話数・外部 ID を持った状態でできるので、欠番検出やメタデータ補完の対象にもなる

- **誤って作られたシリーズの掃除 (複数選択マージ・前方一致候補) と、話数・放送種別の一括編集を画面から行えるようにした**
    - **背景**: 作品辞書で引けなかった録画は録画タイトルからシリーズが作られるため、同じ作品が副題や話数付きで複数のシリーズに分裂することがある。従来のマージ UI は「統合元を 1 件選び、統合先をキーワードで探す」形で、分裂した数件をまとめる用途には手数が多すぎた
    - **シリーズの出所 (`origin`)**: `syobocalTid` / `annictId` / `wikidataQid` を 1 つでも持つシリーズを `dictionary` (辞書起点)、どれも無いものを `local` (録画タイトルから作られた) として `SeriesListItem` / `SeriesDetail` に載せた (`src/model/series/SeriesOrigin.ts`)。誤生成は `local` 側に偏るため、シリーズ一覧に「出所」の絞り込み (`GET /api/series?origin=dictionary|local`) とカード/リスト/表のバッジを追加した
    - **チェックボックスでの複数選択マージ**: シリーズ一覧に選択モード (ツールバーの ☑ ボタン) を追加し、グリッド/リスト/コンパクトのいずれの表示形式でもチェックして複数選択できるようにした。`POST /api/series/merge` は `fromSeriesIds` (配列) を受けるようにし、統合元をまとめて 1 つのシリーズへ寄せる (旧来の `fromSeriesId` 単体指定も引き続き受け付ける)。結果は `movedLinkCount` に加えて `mergedSeriesCount` を返す。統合先が統合元リストに混ざっていても、サーバ側で取り除いてから処理する
    - **統合先の自動セット**: マージダイアログを開くと、選択したシリーズと**その前方一致候補**の中から**辞書起点 (しょぼいカレンダー / Annict / Wikidata) のシリーズを既定の統合先に選ぶ** (同条件なら録画件数が多い方)。辞書起点へ寄せておくと以降の自動判定もそのシリーズへ集まるため。既定が `local` のときは警告を出す。統合先はセレクトボックスで変更でき、候補に無いシリーズはダイアログ内のキーワード検索で追加できる
    - **前方一致でのマージ候補**: `GET /api/series/{seriesId}/merge-candidates` を追加。正規化タイトルの先頭 2 文字で DB を引き、`rankMergeCandidates()` (`src/model/series/SeriesMergeCandidates.ts`) が一致種別 (`exact` 完全一致 → `prefix` 候補が対象で始まる → `contained` 対象が候補で始まる → `partial` 先頭の一部のみ) と共通接頭辞長で並べ替える。先頭 1 文字しか共通しない組は候補から落とす。DB 側は `SeriesDB.findByNormalizedTitlePrefix()` (LIKE のワイルドカードはエスケープ済み)
    - **話数・放送種別の一括編集**: シリーズ詳細に一括編集モード (ツールバーの ✎ ボタン) を追加した。録画を表形式で並べ、行ごとに話数を直接入力できるほか、選択した録画へ「放送日時順に開始話数からの連番を振る」「放送種別 (初回 / 再放送 / **遅れ放送** / 不明) をまとめて設定する」操作ができる。変更した行だけを `POST /api/series/mappings/bulk` へ送る
    - **一括更新 API の挙動**: 既存の割当シリーズを引き継ぎ、**省略した項目は現在値を維持する** (放送種別だけ変えても話数が消えない)。1 件失敗しても残りは反映し、失敗分は `failed[]` に理由付きで返す。手動更新扱いなので `matchMethod: 'manual'` / `manualLock: true` になるが、話数の付け直しでタイトル辞書を汚さないよう**エイリアス学習は既定で行わない** (`learnAlias: true` を明示したときのみ)。1 リクエストの上限は 500 件
    - シリーズ詳細の通常表示にも「遅れ放送」バッジを追加した

- **Annict 公式 API を作品辞書として取り込み、シリーズ照合の精度をさらに引き上げた (+ 既存 Annict 連携の実行時バグ 2 件を修正)**
    - **既存実装のバグ修正 (実 API で確認済み)**: `AnnictProvider` が使っていた `Query.works` は**現行の Annict GraphQL API に存在しない** (`Field 'works' doesn't exist on type 'Query'`)。`get()` と `pushWatchRecord()` が常に失敗しており、Annict のメタデータ取得と視聴記録同期は実質まったく動いていなかった。`searchWorks(annictIds:)` へ修正した。あわせて `Episode.airedAt` も存在しない (要求するとクエリ全体がエラーになる) ため削除し、話数は `number` → `sortNumber` の順に解決して昇順へ並べ替えるようにした。ユニットテストのモックが壊れた API 形状 (`{ works: ... }`) を模していたためテストは通り続けていたので、モックも実 API と同じ `searchWorks` に修正した
    - **作品辞書の一括取り込み**: `AnnictWorkDictionary` (`src/model/metadata/annict/`) が `searchWorks` のページング (1 ページ 500 件 × 約 35 ページ、実測 19 秒) で全 **17,437 作品**を取得し、`annict_work` / `annict_work_alias` へ保存する (sqlite/mysql 両方のマイグレーションあり)。Annict は差分取得の手段を提供していないため常に全件取得となる。既定の自動同期間隔は 7 日 (`metadataDefaults.annict.workSyncIntervalMs` / 設定画面で変更可、0 で停止)
    - **しょぼいカレンダー辞書との補完関係**: Annict は収録作品数が多く (1.7 万件 vs しょぼいカレンダー 8 千件)、英題 (`titleEn`)・ローマ字 (`titleRo`)・かな (`titleKana`) を持ち、さらに **`syobocalTid` を保持している** (実測 6,378 作品、TV 作品では 5,139/7,945)。この `syobocalTid` が 2 つの辞書を結ぶ厳密な結合キーになる
    - **統合辞書 `WorkDictionary` (`src/model/series/`)**: 2 つの辞書を**1 つのメモリ索引にまとめて**引く。片方ずつ引くのではなく統合するのは、含有マッチの「最長の辞書キーを採る」判定を辞書をまたいで正しく効かせるため。`syobocalTid` が一致する Annict 作品は同一エントリへ統合するので、「しょぼいカレンダーの正式タイトル + Annict の英題/ローマ字/かな」がすべて同じ作品の照合キーになる。`SeriesResolver` と `SeriesBackfillManageModel` の参照先を `ISyobocalTitleDictionary` からこの `IWorkDictionary` へ移した (しょぼいカレンダー側クラスは取り込み専用になった)
    - **前方一致マッチを追加**: EPG の文字数制限で末尾が切れた録画タイトル (`SAKAMOTO` → `SAKAMOTO DAYS`、`ギルドの受付嬢ですが、残業は嫌なのでボスをソロ討伐` → `〜しようと思います`) を、録画キーが辞書キーの前方一致になるケースとして拾う (確度 0.9、長さ比 0.6 以上を要求)
    - **末尾の放送枠名を除去**: 括弧で囲まれずタイトル末尾に連結される枠名 (`FRIDAY ANIME NIGHT` `ANiMAZiNG!!!` `スーパーアニメイズムTURBO` `アニメシャワー` `ノイタミナ` 等) を `SeriesNormalizer` で除去するようにした。実データでは `FRIDAY ANIME NIGHT` だけで約 210 件が枠ごとに別シリーズへ分裂していた。あわせてアポストロフィ・プライム記号のバリアント (`’` `‘` `′`) も照合キーから除去する
    - **`Series` への外部 ID 自動補完**: 辞書で確定した作品の `syobocalTid` / `annictId` をシリーズへ書き込む。既存シリーズに片方しか無い場合は解決時に補完する。これにより Annict 視聴記録の同期がタイトル類似度検索 (`AnnictSyncQueueModel.resolveAnnictId`) に頼らず確実に作品を引き当てられる。しょぼいカレンダー未収録の作品は `annictId` をキーにシリーズを寄せる
    - **実データでの検証 (169 シリーズ、`inclusionai/ling-3.0-flash:free`)**: 外部 ID が空の 169 シリーズ (紐づく録画 384 件) を解析したところ、番組名を抽出できたのが 125 件、うち作品辞書に当たったのが 22 件 (妥当性検証を通るのは 18 件、録画 35 件)、既存シリーズへ束ねられたのが 1 件。残り 102 件は「番組名は抽出できたが辞書にも既存シリーズにも束ね先が無い」もの (福島ローカルの情報番組など)、44 件は単発特番として null 判定。なお通過分には作品本編ではなく**番宣・特番**が含まれる (「ガンダム×ZIP!…SP」→「ガンダム」、「佐久間大介のキルアオを100倍楽しむ夜」→「キルアオ」等)。プロンプトでは null を指示しているが完全には従わないため、作品シリーズ配下に番宣が混じりうる点は許容している
    - **実データでの効果**: 録画 16,049 件に対する作品確定率は **89.6% → 92.9% (14,916 件)**。内訳は完全一致 13,128 / 含有一致 1,723 / 前方一致 65、確定元はしょぼいカレンダー 14,775・Annict 単独 141。778 作品へ集約され、うち 677 作品が表記ゆれを吸収して 1 シリーズに統合された。照合は 16,049 件で約 1.3 秒
    - **API / UI**: `GET`/`POST /api/settings/system/annict/works` (`AnnictWorkDictionaryStatus` / `AnnictWorkSyncResult`) を追加し、サーバー設定画面の連携タブに登録作品数・しょぼいカレンダーとの結合済件数の表示、「作品辞書を同期」ボタン、自動同期間隔の入力欄を追加した
    - **未検証事項**: `pushWatchRecord()` (視聴記録の書き込み) は実行すると Annict アカウントに実際の視聴記録が作成されるため、実 API での動作確認は行っていない。修正したのは参照クエリと同じ `works` → `searchWorks` の置換であり、読み取り側は実 API で確認済み

- **シリーズ一覧に並べ替え・クール絞り込み・3 種の表示形式・各種バッジを追加した**
    - **並べ替え**: 更新順 (既定) / あいうえお順 / 放送開始日 / 最終放送日 / 録画件数 / 保存容量。昇順・降順を切り替えられる。あいうえお順は しょぼいカレンダーの `TitleYomi` (無ければ Annict の `titleKana`) を `series.titleKana` へ保持して並べる
    - **クール絞り込み**: Annict の `seasonYear`/`seasonName` を、無ければ しょぼいカレンダーの初回放送年月 (1-3 冬 / 4-6 春 / 7-9 夏 / 10-12 秋) から導出して `series.seasonYear`/`seasonName` に保持し、「2025年春 (12)」形式で選択できるようにした (シリーズにはアニメ以外も含まれるためジャンル名は付けない) (`GET /api/series/seasons`)
    - **放送状態の絞り込み**: 最終録画から 45 日以内なら「放送中」、それ以外を「完結」として扱う
    - **欠番での絞り込み**: 話数の連続性判定 (`SeriesContinuity`) は SQL で表現できないため、この絞り込み指定時のみ全件を取得してから JS 側で絞り込みページングし直す
    - **表示形式 3 種**: グリッド (16:9 カード) / リスト (左サムネイル + 右情報) / コンパクト (画像無しの高密度テーブル)。選択は localStorage に保存する
    - **バッジ**: 放送中 / 未視聴件数 / 欠番数 / 重複数 と、視聴進捗バー・録画件数・保存容量。未視聴数は `watch_history` の `status='watched'` を録画 ID 単位で DISTINCT 集計して差し引く
    - **集計は 1 クエリ**: 録画件数・合計サイズ・初回/最終放送日時・視聴済み件数を LEFT JOIN + GROUP BY でまとめて取得し、一覧で N+1 にしない。総件数は放送状態の絞り込みが無い場合に限り集計を伴わない COUNT で求める (実データ 983 シリーズで約 620ms → 数 ms)
    - **クールの決定は 3 段構え**: (1) 作品辞書 (`seasonSource: 'dictionary'`) → (2) **最古の録画日時からの推測** (`'estimated'`、1-3 冬 / 4-6 春 / 7-9 夏 / 10-12 秋) → (3) **手動設定** (`'manual'`)。実データ 983 シリーズで辞書が 814 件 (82.8%)、残り 169 件を録画から推測して **100% にクールが入る**ことを確認済み。手動設定したクールは自動補完で上書きしない
    - **手動編集**: `PUT /api/series/{seriesId}/metadata` でクール・読み仮名・総話数を設定できる。一覧の各カード/行の鉛筆アイコンからダイアログを開く。推測値の場合は「保存すると手動設定として固定される」旨をダイアログに表示する。年と季節は片方だけでは絞り込みに使えないためセットでのみ受け付ける
    - **自動実行**: クール等は辞書の導入前に作られたシリーズには入っていないため、`SeriesMetadataFiller` が Operator 起動 10 分後 (作品辞書の同期完了後) に一度だけ自動で埋める。`POST /api/series/refresh-metadata` と一覧ツールバーの更新ボタンからも手動実行できる。全項目そろっているシリーズは辞書を引かないため繰り返し実行しても安い
    - クール情報が空のときは一覧に理由と対処を示す案内を表示する (空のドロップダウンだけが出る状態にしない)
    - `SeriesListItem` に `titleKana` / `seasonYear` / `seasonName` / `recordedCount` / `totalFileSize` / `firstAiredAt` / `lastAiredAt` / `unwatchedCount` / `totalEpisodes` / `missingEpisodeCount` / `duplicateEpisodeCount` / `isOnAir` を追加。`GET /api/series` に `sort` / `order` / `seasonYear` / `seasonName` / `status` / `hasMissing` クエリを追加した

- **機能フラグを opt-in (既定 OFF) から opt-out (既定 ON) へ切り替えた**
    - フラグ付きで追加してきた機能が出そろい、既定動作として扱える段階になったため、`resolveFeatureFlags()` / `isFeatureEnabled()` (`src/model/FeatureFlags.ts`) の判定を **`=== true`** から **`!== false`** へ変更した。`featureFlags` 自体を省略した場合も全機能が有効になる
    - **無効化は明示的な `false` でのみ行う**。`featureFlags: {}` は「全部無効」ではなく「全部有効」を意味するようになったので、フラグを絞っていた環境は該当キーに `false` を書く必要がある
    - `config/config.yml.template` / `config-win.yml.template` の `featureFlags` ブロックは既定でコメントアウトした (書かなければ全機能が有効)
    - クライアント側の `isFeatureEnabled()` (`client/src/util/FeatureFlags.ts`) も同じ判定に揃えた。サーバは `resolveFeatureFlags()` で全キーを解決済みの boolean にして配信するため、通常はそのまま読むだけになる (config 未取得時のみ false)
    - Wikidata 辞書 (`metadataDefaults.wikidata.enabled`) も既定 ON にした。API キー不要・無料で、アニメ以外のジャンルを照合できる唯一の辞書のため

- **Wikidata を 3 つ目の作品辞書として統合し、アニメ以外のジャンルを照合できるようにした**
    - **背景**: しょぼいカレンダー・Annict はどちらも**アニメ専門**のため、ドラマ・バラエティ・情報番組・ニュースには束ね先が存在しなかった。実データでは外部 ID の空いた 169 シリーズのうち 102 件が「番組名は抽出できたが束ね先が無い」状態で、その主成分は福島・岩手などのローカル情報番組だった
    - **Wikidata の採用理由 (実測)**: 日本語ラベルを持つテレビ番組が **53,577 件** (原産国=日本 31,698 件)、日本語別名 16,844 件。API キー不要・無料。`ふくしまSHOW` `じゃじゃじゃTV` `イチモニ!` のような**ローカル局の番組まで収録されている**のが決め手。TMDB はバラエティ/ローカルが弱く、TVDB は API が有料化、Gガイド/Yahoo!テレビ/TVer は公開 API 無し。自前の EPG (`program` テーブル) は直近 1 週間のローリングウィンドウなので週次番組が 1 回しか出てこず辞書にならない
    - **既存辞書との重複排除**: Wikidata の **P11648「しょぼいカレンダーのシリーズID」**を取り込み、これを厳密な結合キーにする。索引構築時 (`WorkDictionary.ensureIndex()`) に P11648 が既存エントリの `syobocalTid` と一致した項目は**新しい作品として増やさず、既存エントリへ `wikidataQid` を併記するだけ**にする。投入順は しょぼいカレンダー → Annict → Wikidata なので、アニメの照合品質は現状から劣化しない。実データでの照合キーの重複はわずか 2.3% (1,095 / 48,096) で、残りは純増
    - **照合は厳密キーの完全一致のみ**: 一般番組は「パラダイス」「わっち!!」のような短く一般的なタイトルが多く、アニメ辞書と同じ含有一致を許すと誤爆する (実測で「ゲームパラダイス」→「パラダイス」)。さらに既存の `syobocalLookupKey()` は長音符を落とすため「あそビバ」と「あそビーバー」が同じキーになる。そこで長音符・波ダッシュ・中黒を保持する `strictProgramKey()` を追加し、Wikidata 由来のエントリは**この厳密キーの完全一致でのみ**引く (`strictIndex`)。実データの未マッチ 169 シリーズに対し、緩い照合では 29 件ヒットするが 3 件が誤り、厳密キー + 完全一致では **17 件ヒットで誤り 0**。装飾の除去は `SeriesNormalizer` / LLM 抽出の役目とし、辞書は「正解の集合」に徹する
    - **構成**: `WikidataProgramDictionary` (`src/model/metadata/wikidata/`) が SPARQL エンドポイントから一括取得し、`wikidata_program` / `wikidata_program_alias` の 2 テーブルへ保存する (sqlite / mysql 両マイグレーションあり)。`WorkDictionary` が 3 辞書を 1 つの索引へ統合する構造は既存のまま。同期は Operator 起動 8 分後 + 7 日間隔 (`metadataDefaults.wikidata` で設定、**既定 ON**。API キー不要で費用も発生しないため)
    - **SPARQL の実装上の注意**: `?item wdt:P31/wdt:P279* wd:Q15416` のようなサブクラス再帰は公開エンドポイントでタイムアウトする (実測で 504)。主要クラス (`Q15416` テレビ番組 / `Q5398426` テレビシリーズ / `Q506240` テレビ映画 / `Q1261214` テレビスペシャル) を直接指定して `LIMIT`/`OFFSET` でページングする (1 ページ 5,000 件で約 2.4 秒)。エピソード単位の `Q21191270` は辞書に入れない
    - **`Series` への反映**: `wikidataQid` 列を追加し、Wikidata 単独の番組はこれをキーにシリーズを寄せる。あわせて**これまで一度も書かれていなかった `tmdbId` 列**を Wikidata の P4983 経由で初めて埋められるようになった。`matchMethod` に `'wikidata'` を追加

- **シリーズ照合の LLM フォールバックをシリーズ単位へ拡張し、結果をマッチングルールとして蓄積するようにした**
    - **背景**: LLM フォールバック (`LlmTitleExtractor`, `config.yml` の `seriesLlm`) は録画単位の `SeriesResolver` にしか入っておらず、`SeriesMetadataFiller` は `WorkDictionary.lookup(series.title)` を 1 回引いて外したら諦めていた。実データでは 983 シリーズ中 **169 件 (17%) が `syobocalTid` / `annictId` 両方とも空**で、そのうち 124 件は録画 1 件のみ。シリーズ単位なら呼び出し回数が録画単位より 2 桁少なく、1 件当たれば配下の全録画へ話数逆引き・クール・画像が波及する
    - **シリーズ単位の LLM 照合**: `SeriesMetadataFiller.fill()` に、辞書で引けず外部 ID も空のシリーズだけを LLM へ回すステップを追加した (1 回の実行につき最大 200 件)。抽出結果は必ず作品辞書で引き直すため、LLM の誤生成だけで外部 ID が入ることはない。結果は `SeriesMetadataFillResult.llmAnalyzed` / `llmResolved` として API・シリーズ一覧のスナックバーに出る
    - **マッチングルールの蓄積 (エイリアス辞書への自動学習)**: LLM 経由で確定した「正規化タイトル → シリーズ」の対応を `series_alias` へ書き込む。`SeriesResolver.resolve()` はエイリアス辞書を最優先で引くため、2 回目以降は LLM も作品辞書も引かずに確度 1.0 で確定する。誤った規則を固定しないよう、**LLM の抽出結果が辞書キーと完全一致 (`matchType: 'exact'`) した場合のみ**学習し、手動修正で作られた既存のエイリアスは上書きしない
    - **アニメ以外のジャンルの束ね**: 作品辞書はアニメのみのため、ドラマ・バラエティ・情報番組は検証先が無い。そこで `SeriesResolver` に**既存シリーズを検証先に使う**ステップ (`resolveByLlmGrouping`、作品辞書フォールバックの後・類似度スコアリングの前) を追加した。LLM が抽出した番組名を正規化したキーが既存シリーズの `normalizedTitle` と完全一致したときだけ、確度 0.9・`matchMethod: 'llm'` でリンクし、同時にエイリアスを学習する。LLM のシステムプロンプトも「アニメの作品名」から「全ジャンルのシリーズ名 (毎回変わるゲスト・特集・SP 表記を除去)」へ広げた
    - **DB / 画面**: `series_alias` に `source` 列 (`'manual'` / `'llm'`、既定 `'manual'`) を追加 (sqlite / mysql 両マイグレーションあり)。サーバー設定 > シリーズ管理タブのエイリアス辞書表に学習元バッジ・登録日時・学習元での絞り込み (すべて / LLM 学習 / 手動) を追加し、自動学習された規則を画面から確認・削除できるようにした
    - **OpenRouter 等のホスティング API 対応**: `seriesLlm.minIntervalMs` (リクエスト間隔の下限) と `seriesLlm.maxTokens` (応答の上限トークン数、既定 2000) を追加し、429 応答時は失敗回数ではなく `Retry-After` に従って休止するようにした。フリーモデルは分あたり上限があるため `minIntervalMs: 3500` 程度が必要
    - **プロンプトの修正 (実 API で判明)**: 出力書式を `{"title":"シリーズ名"}` のように例示していたため、**プレースホルダの文字列をそのまま値として返すモデルがあった** (`nvidia/nemotron-3-ultra-550b-a55b:free` が `{"title":"シリーズ名"}` を返す)。書式は文章で説明し、具体形は末尾の入出力例 4 件だけで示す形に変更した。また **OpenRouter のフリーモデルはほぼ reasoning 系**で、本文の前に思考へ 200〜250 トークン使うため、当初の `max_tokens: 200` では `content` が空のまま `finish_reason: 'length'` で切れて必ず失敗する。`maxTokens` を設定可能にしたうえで既定を 2000 に引き上げた (非 reasoning モデルは JSON を出した時点で停止するので実コストは増えない)。失敗時のログには `finish_reason` と応答冒頭を載せ、「プロンプト無視」と「途中切れ」をログだけで切り分けられるようにした
    - **抽出結果の妥当性検証 (実測で判明した誤リンク対策)**: 「抽出結果を作品辞書で引き直す」だけでは、**実在する別作品の名前を返した場合に素通りしてしまう**。169 シリーズの実解析で「あそビバ (福島の情報番組)」→「あそびにいくヨ!」(録画 6 件)、「TUF新春ロードショー」→「THE UNLIMITED -兵部京介-」、「プロフェッショナルランキング★日曜劇場名場面ランキングBEST10」→「プロフェッショナル 仕事の流儀」の 3 件が誤って辞書に当たっていた。`isDerivedFromTitle()` (`SeriesNormalizer`) を追加し、**元タイトルの照合キーが抽出結果の照合キーを含むこと**を要求する。実データでは誤り 3 件を全て阻止し、正しい 18 件を維持、取りこぼしは 1 件 (「アニメ魔入りました!入間くん4 …」→「魔入りました!入間くん 第4シリーズ」、LLM が「第4シリーズ」を補ったため含有にならない) のみ。なお類似度は判別に使えない (誤り 0.36 > 正しい 0.16〜0.17)
    - **バッチ処理と休止の相互作用 (実測で判明)**: レート制限や連続失敗で休止 (`suspendedUntil`) に入ると `extractWorkTitle()` は問い合わせをせず即 null を返す。169 シリーズの一括解析で 24 件目に 429 を踏んだ結果、**残り 145 件が休止時間内に一瞬で「抽出できず」として消化された**。`ILlmTitleExtractor.isSuspended()` を追加し、`SeriesMetadataFiller` は休止を検知したら以降の LLM 呼び出しを止めて次回実行へ回すようにした (永続キャッシュがあるため次回は続きから進む)
    - **モデル選定 (2026-07 時点の実測)**: `inclusionai/ling-3.0-flash:free` が抽出精度と応答速度 (2〜6 秒) ともに良好で推奨。`openai/gpt-oss-20b:free` も正しく動く。`nvidia/nemotron-3-ultra-550b-a55b:free` は書式指示に従わないことがあり非推奨。**推奨モデルを含め OpenRouter のフリーモデルはほぼ reasoning 系**なので、`maxTokens` は既定 (2000) のままにすること
    - **精度メトリクスとの関係**: サーバー設定 > シリーズ管理タブの「精度メトリクス」は**番組表 (EPG) ⇄ シリーズの事前マッピング (`ProgramSeriesApiModel.precompute`) の直近バッチ**の集計であり、録画のシリーズ照合率とは別物。詳細な注意点は下記の「精度メトリクスの読み方」を参照

- **外部サービスのエンドポイント URL を設定画面から差し替え可能にした**
    - Cloudflare Workers などのキャッシュ/プロキシを手前に置いて運用できるようにするため、ハードコードしていた 4 つの外部 URL (しょぼいカレンダー DB API / Annict GraphQL API / fxtwitter JSON API / 共有静的データ URL) を設定値にした
    - 解決は `MetadataEndpointResolver` に一元化し、優先順位は他の設定と同じく **DB (設定画面) > config.yml (`metadataDefaults.endpoints`) > 同梱既定値**。従来の `metadataSharedDataUrl` は引き続き有効で、`endpoints.sharedData` があればそちらが優先される
    - 値は http/https の URL としてのみ受け付け、不正な値 (`file://` や URL として解釈できない文字列) は無視して既定値へフォールバックする
    - 利用側 (`SyobocalProvider` / `SyobocalTitleDictionary` / `AnnictProvider` / `AnnictWorkDictionary` / `SeriesImageModel` / `SharedDataFetcher`) はすべてこのリゾルバ経由に統一した。**プロキシ側は元サービスと同じパス・クエリ・レスポンス形式をそのまま返す必要がある** (呼び出し側の組み立て方は変えていないため)
    - `SharedDataFetcher.startAutoUpdate()` は URL 未設定時に自動更新を開始しない実装だったが、設定画面から後で URL を入れられるようになったため、起動時に打ち切らず実行のたびに解決するよう変更した

- **シリーズ一覧にアイキャッチ画像を表示するようにした**
    - **画像の出所**: 提供しているのは **Annict のみ**。しょぼいカレンダーは画像を持っていない (`TitleLookup` に画像フィールドが無く `/img/{TID}.jpg` も 404) ことを実 API で確認済み。Annict の `Work.image` から `recommendedImageUrl` → `facebookOgImageUrl` の順に採用し、`copyright` をクレジット表示用に保存する (`annict_work.imageUrl` / `imageCopyright`、sqlite/mysql 両方のマイグレーションあり)
    - **Twitter アバターは fxtwitter 経由で解決する**: `twitterBiggerAvatarUrl` は充足率 84% と高いが、実体は `twitter.com/{account}/profile_image?size=bigger` で、x.com への移行により**そのままでは画像を返さない** (認証必須になり `text/html` が返る)。`SeriesImageModel` が取得時に `https://api.fxtwitter.com/{account}` の JSON API から `avatar_url` を得て実画像へ解決する。既定の `_normal` は 48px 相当と小さいため `_400x400` を優先し、その版が無いアカウントには元サイズをフォールバックとして試す。削除済みアカウントは fxtwitter が **HTTP 200 + `{ code: 404 }`** を返すため body 側も判定し、解決できなかった場合は画像を返さないと分かっている元 URL を叩かない。これにより画像 URL を持つ作品が 34.2% → **40.6%**、実取得成功率が 78.8% → **93.8%** に向上した
    - **直リンクせずサーバ側でキャッシュして配信する**: Annict が返す URL は Annict の CDN ではなく**作品公式サイトの OGP 画像**を指す (`https://www.madoka-magica.com/tv/ogp.png` など)。そのままクライアントから直リンクすると (1) `http://` の URL が 1,375 件あり https 運用時に mixed content でブロックされる、(2) 公式サイトへの hotlink になる、(3) サイト改修で 404 になると表示が壊れる、という問題があるため、`SeriesImageModel` がサーバ側で一度だけ取得して `data/seriesImage/{annictId}.{ext}` にキャッシュし、`GET /api/series/{seriesId}/image` から配信する。Content-Type と最大サイズ (8MB) を検証し、取得失敗は 24 時間再取得しない
    - **録画サムネイルへのフォールバック**: 画像 URL を持たない作品や公式サイトが 404 になっている作品が残るため、Annict 画像が無い/取れないシリーズは**既存の録画サムネイル**をアイキャッチとして代用する。一覧では N+1 を避けるため `SeriesDB.findThumbnailPaths()` が 1 クエリでまとめて解決する
    - **どこからも画像が取れない場合は録画ファイルから生成する**: 外部画像もサムネイルも無いシリーズは、紐づく録画の動画ファイル (`ts` を優先) を対象に `ipc.thumbnail.add()` で Operator へサムネイル生成を依頼する。生成は Operator のキューで非同期に走るためその回は画像なしを返し、次に開いたときから表示される。ffmpeg を連打しないよう、同一シリーズへの再依頼は 10 分間隔、一覧 1 回の取得あたりの依頼は 5 件までに制限しているので、一覧を開くたびに少しずつ埋まっていく
    - **API / UI**: `GET /api/series/{seriesId}/image` を追加し、`SeriesListItem` / `SeriesDetail` に `hasImage` / `imageSource` (`annict` | `thumbnail`) / `imageCopyright` を追加した。シリーズ一覧のカード上部に 16:9 で画像を表示し、画像が無いシリーズはアイコンのプレースホルダを出す。Annict 由来の画像にはカード下部に著作権表記を、サムネイル代替には録画アイコンを表示する
    - **既存環境への反映**: `annict_work` に列を追加するだけのマイグレーションなので、既存の取り込み済み作品は `imageUrl` が NULL のまま。画像を出すには設定画面の「作品辞書を同期」を 1 度実行する (自動同期は 7 日間隔)

- **Annict 接続テストのエラーメッセージが誤解を招く問題を修正**
    - `AnnictProvider.testConnection()` は Annict 連携が無効なときに `AnnictSyncFeatureIsDisabled` を返していたが、これは**視聴記録の自動同期** (`featureFlags.annictSync` / `metadata.annict.syncEnabled`) を指すコードで、実際の条件 (`metadata.annict.enabled` が false) とは別の設定を指していた。連携無効を表す `AnnictIsDisabled` を返すよう変更した
    - 設定画面がエラーコードをそのまま表示していたため、コードごとに「次に何をすればよいか」が分かる日本語へ変換するようにした (連携が無効 / トークン未設定 / トークンが無効 / 機能フラグが無効)。接続テストが**保存済みの設定**に対して行われる旨の注意書きも、保存が必要であることが分かる文面へ改めた

- **放送枠の冠 (先頭ブロック) の除去規則を一般化し、確定率を 92.9% → 94.9% に改善**
    - 局ごとの枠名を列挙するのではなく、未ヒット録画から**一般化できる規則**に落とした
    - **「アニメ」を含む冠の条件を緩和**: 従来は「空白を含まない 10 文字以内 + アニメ + 区切り」しか除去できず、`SEIBU TRAIN アニメスペシャル・` (冠の中に空白がある) や `水曜アニメ<水もん>` (区切りが括弧) を落とせなかった。冠の前半は空白を含んでよく、区切りは「・」「空白」に加えて**直後が括弧の場合**も許すようにした
    - **括弧内の作品名を候補キーに追加**: `日5「ウィッチウォッチ」` `映画「五等分の花嫁」` `テレビアニメ「鬼滅の刃」シリーズ全編再放送` のように枠名と作品名が併記される形では、括弧の中だけが作品名になる。サブタイトルを作品名と誤認しうるため**他の候補がすべて外れた場合の最終手段**として引く (`精霊幻想記「祭りの夜」` は先に `精霊幻想記` で当たるのでこの候補まで到達しない)
    - **実写ドラマのガード**: 括弧の直前が `ドラマ` / `主演` / `実写` の場合はこの候補を使わない。実データで実写ドラマ「gift」がアニメ『Gift ～ギフト～ eternal rainbow』へ誤って寄る例が 1 件確認できたため
    - **末尾の読み仮名括弧を除いた候補を追加**: `羅小黒戦記(ロシャオヘイセンキ)`。丸括弧は `(HDマスター版)` のような版の区別に使うため本体からは除去せず、別候補として持つ
    - **ラテン文字の発音記号を畳む**: `Übel Blatt` と `Ubel Blatt` を同一視する。NFD で分解して U+0300〜U+036F のみ除去し **NFC へ戻す** (戻さないと日本語の濁点が分解形のまま残り、`ざつ旅` のようなキーが一致しなくなる。濁点・半濁点は U+3099/U+309A で除去範囲の外)
    - **末尾の装飾記号**を除去 (`凍牌▼` `〜 ★` など)。`[解]` も括弧マーカーに追加
    - **効果と誤爆確認**: 確定率 92.9% → **94.9% (15,234 件)**、814 作品。追加候補キーでのみ当たった録画を全件目視したところ、ガード追加後は 7 種すべて正しい対応 (`鬼滅の刃` `暗殺教室` `鬼太郎誕生 ゲゲゲの謎` など)。一致度が最も低いマッチ 25 件も確認し誤爆なし (`ベヒ猫` は正式な略称、`名探偵コナン` 劇場版シリーズなど)
    - 残る未ヒット 815 件は `ふくしまSHOW` `日曜劇場` `仙台市青葉区かのおが便利軒` などアニメ以外が大半

- **秘密情報の暗号化鍵を `data/key/secret.key` へ自動生成するようにした (config.yml の `secretKey` は廃止)**
    - 従来は config.yml の `secretKey` を手で設定しないと通知先 URL や Annict トークンの暗号化が一切機能しなかった (未設定のまま運用され、設定画面からの保存が `AppSettingSecretKeyIsNotConfigured` で失敗する事故につながっていた)。`SecretCrypto` が起動時に鍵ファイルを読み、無ければランダム鍵 (48 バイト base64url) を `mode 0o600` で生成して保存する
    - 旧バージョンで `secretKey` を設定していた環境では、鍵ファイルが無いときに限りその値を種として鍵ファイルを作成し、既存の暗号文をそのまま復号できるように移行する
    - Operator / Service / EPGUpdater が同時に初回起動しうるため、`fs.writeFileSync` の `wx` フラグによる排他作成 + `EEXIST` 時の再読み込みで競合を回避する
    - 鍵ファイルのパスは環境変数 `EPGSTATION_SECRET_KEY_FILE` で上書きできる (Docker 等でボリュームを分けたい場合向け)

- **タグ管理・シリーズ統合ダイアログのセレクトボックスが選択肢を表示できない不具合を修正**
    - Vuetify 4 の `v-select` は `:items` にオブジェクト配列を渡す場合 `item-title` の明示が必要 (既定値が Vuetify 2 と異なる)。`TagManageDialog.vue` の親タグ選択と `Series.vue` の統合元/統合先シリーズ選択に `item-title="title"` を追加した (当時は `plugins/vuetify.ts` が `itemTitle: 'text'` を全体既定にしていたための明示。後にその既定を削除したので、以後は `item-title` を書かなくても `title` が使われる)

- **しょぼいカレンダーのアニメ作品タイトルを一括取得し、シリーズ自動マッピングの「正解辞書」として使うようにした**
    - **背景 (何が壊れていたか)**: 従来の `SeriesResolver` は「録画タイトル同士の類似度 (bigram) が しきい値 0.8 以上か」だけでシリーズを判定していたため、放送局ごとの表記ゆれで同一作品が大量に別シリーズへ分裂していた。実データ (録画 16,049 件) で確認できた分裂要因は、漢数字の話数 (`第壱話` `漆話`)、英字の話数 (`break1` `days.1` `Turn19` `request 1.` `EPISODE08`)、括弧付き作品名 (`TVアニメ『MFゴースト』2nd Season`)、編成ブロック冠 (`アニメ　` `水曜アニメ・水もん　` `メディアβ・` `＋Ultra・`)、ダッシュ/引用符の字種違い (`-` `―` `～` `'` `’`)、末尾の枠名ブロック (`【スーパーアニメイズムTURBO】`) など。`SeriesNormalizer` はこれらをほとんど除去できていなかった
    - **一括取得**: `SyobocalTitleDictionary` (`src/model/metadata/syobocal/`) が しょぼいカレンダーの `TitleLookup&TID=*` を叩き、全アニメ作品 (約 8,000 件) のタイトル・略称・英題・別名 (Keywords)・サブタイトル一覧をローカル DB へ取り込む。`Fields` で必要な列だけ指定して転送量を 24MB → 9.5MB に削減し、2 回目以降は `LastUpdate` カーソルによる差分取得のみ行う。テーブルは `syobocal_title` / `syobocal_title_alias` / `syobocal_title_episode` の 3 つ (sqlite/mysql 両方のマイグレーションあり)
    - **照合方式**: 記号・空白・長音/ダッシュ/引用符をすべて落とした「骨格キー」(`syobocalLookupKey()`) で突き合わせる。完全一致で引けない場合は「辞書キーが録画キーに含まれる最長のもの」を採用し、短い辞書キーが長いタイトルに偶然含まれる誤爆を防ぐため長さ比 0.5 以上を要求する。先頭ブロック除去は強度違いの 2 パターン (STRICT / LOOSE) でキーを作って順に引くため、`メディアβ・ぼさにまる` のような冠付きと `ライアー・ライアー` のような作品名を両立できる
    - **シリーズ解決への接続**: `SeriesResolver.resolve()` にエイリアス辞書の次・類似度スコアリングの手前として辞書照合ステップを追加した。確定した TID は `Series.syobocalTid` をキーに既存シリーズへ寄せ、無ければ**しょぼいカレンダーの正式タイトル**でシリーズを新規作成する (録画タイトル由来のゆらいだ名前にならない)。`matchMethod` は既存の `'syobocal'` を使う。辞書が未取得・機能無効・該当なしの場合は従来どおり類似度判定へフォールバックするため、既存挙動は壊れない
    - **話数の復元**: 話数表記が無い録画については、しょぼいカレンダーのサブタイトルが録画タイトルに含まれるかで話数を逆引きする (`lookupEpisodeNumber()`)。欠番検出の総話数も `syobocal_title.totalEpisodes` をローカル参照するようにし (`MissingEpisodeApiModel.externalTotals()`)、シリーズごとの外部 API 問い合わせを不要にした
    - **実データでの効果**: 手元の録画 16,049 件に対し **89.1% (14,301 件) が作品として確定** (完全一致 12,642 / 含有一致 1,659)、728 作品に集約され、そのうち **647 作品が表記ゆれを吸収して 1 シリーズに統合**された。話数表記の無い録画 635 件でサブタイトルから話数を復元。未ヒットの大半はバラエティ・ドラマなどアニメ以外で、想定通り作品化されない。照合は 16,049 件で約 0.5 秒 (索引はメモリ常駐)
    - **同期のタイミング**: Operator 起動 60 秒後 + 既定 24 時間間隔で自動同期する (`runOperator()` から `startAutoSync()`)。間隔は `metadataDefaults.syobocal.titleSyncIntervalMs` (config.yml) と設定画面 (`metadata.syobocal.titleSyncIntervalMs`) で変更でき、0 で自動同期を止められる。`featureFlags.metadataProviders` + しょぼいカレンダー連携が有効な場合のみ通信が発生する
    - **API / UI**: `GET`/`POST /api/settings/system/syobocal/titles` (`SyobocalTitleDictionaryStatus` / `SyobocalTitleSyncResult`) を追加し、サーバー設定画面の連携タブに登録作品数・最終更新日時の表示と「差分同期」「全件取り直し」ボタン、自動同期間隔の入力欄を追加した
    - **プロセス間の反映**: 辞書は Operator の自動同期と Service の「今すぐ同期」の双方から更新されうるため、メモリ上の照合索引は 5 分間隔で DB の署名 (件数:最終更新日時) を確認し、変化していれば作り直す (IPC は追加していない)
    - **`SeriesNormalizer` の強化 (辞書と併せて単体でも効く)**: 漢数字話数のパース (`第壱話` → 1)、`話` 以外の助数詞 (`幕` `旅` `夜` `章` `回` 等)、英字話数語 (`ep` `turn` `break` `days` `mission` `request` `stage` 等)、`（8）` 形式、末尾の枠名ブロック・サブタイトル、括弧付き作品名の展開、`2nd Season` / `3期` からのシーズン番号抽出に対応した。バックフィルのドライラン (`SeriesBackfillManageModel.decide()`) も辞書照合を通すようにし、プレビューと実行結果が食い違わないようにした

- サーバー設定画面 (S6・S7・§6.2) の欠陥修正・未実装機能の追加と、録画検索 UI (S19・§2.2) の高度化（クライアント側のみ、サーバ変更なし）
    - **サーバー設定画面 (`client/src/views/SystemSetting.vue`) の重大バグ修正**: 通知タブが `targets[0]` へ直接 `v-model` していたため、DB に `targets: []` が保存されていると描画時に例外になり画面が開けなくなっていた。配信先を配列として一覧・追加・削除・編集できる UI に全面書き換え。配信先名を変更した場合、サーバー側はシークレットを名前で突き合わせる実装 (`AppSettingApiModel.matchArrayItems()`) のため URL・署名シークレットが引き継がれない旨を warning で表示する
    - `testNotification()` が送信前に必ず `save()` していたため、テストしただけで未保存の設定が永続化される不具合を修正 (テストは配信先ごとに独立して実行、保存とは分離)。`save()` / `testNotification()` / 各 API 呼び出しは try/catch で `ISnackbarState` にエラーを通知するよう統一
    - タブ構成を **基本 (変更履歴・ロールバック) / 連携 (Annict・しょぼいカレンダー・共有静的データ・メタデータキャッシュ) / 通知 (Webhook・Discord) / シリーズ管理** に再編。シリーズ管理タブの既存機能 (バックフィル・エイリアス辞書) はそのまま維持。「録画・エンコード」タブは WebUI から変更可能な設定項目が無いまま空タブとして残っていたため撤去した (エンコード関連の実行時設定は現状 config.yml 以外に持たせる予定がないため)
    - 画面上部に `requiresRestartKeys` (更新・ロールバック API レスポンス) に基づく「再起動が必要」バナーを常駐表示 (セッション内)。現状 `AppSettingSchema.ts` で `requiresRestart: true` を宣言している項目は無いため、通常は表示されない
    - `GET /api/settings/system/history` / `POST /api/settings/system/rollback` を使った変更履歴一覧・ロールバック UI (基本タブ) と、`GET /api/settings/system/notifications/failures` を使った通知失敗履歴一覧 (通知タブ) を追加
    - **Annict 接続テスト専用 API を追加 (§6.2)**: `POST /api/settings/system/test/annict` (`src/model/service/api/settings/system/test/annict.ts`)。`IMetadataProvider` にオプショナルな `testConnection()` を追加し、`AnnictProvider.testConnection()` が `viewer { username }` クエリで疎通とトークンの有効性を確認する (`AnnictConnectionTestResult`)。従来の「専用 API が無いため検索 API を流用する簡易確認」を廃止し、画面の注意書きも削除した
    - **Annict 視聴記録の自動同期を設定画面 (DB) から ON/OFF できるようにした (§5.5・§6.2、二重ゲート)**: `AppSettingSchema.ts` に `metadata.annict.syncEnabled` を追加し、`AnnictSyncQueueModel.enabled()` が `featureFlags.annictSync` (config.yml, 必須の opt-in) と `metadata.annict.syncEnabled` (DB, 設定画面から変更可能・未設定時は既定 `true`) の両方を満たす場合のみ同期する。`featureFlags.annictSync` が OFF の場合は画面のスイッチを ON にしても動作しないことを画面上に明記する
    - **しょぼいカレンダー チャンネルマッピング表の編集 UI を追加 (§5.3・§6.2)**: `GET`/`PUT /api/settings/system/syobocal/channels` (`src/model/service/api/settings/system/syobocal/channels.ts`、実体は `IAppSettingApiModel` の `syobocalChannelMap` キーの薄いラッパー) を追加し、`AppSettingSchema.ts` に `syobocalChannelMap` (chId/networkId/serviceId/`syobocal` 未登録局フラグの配列) を追加した。`SyobocalChannelMap` の解決順を「同梱データ → 共有静的データ → ローカルファイル (`metadataChannelMappingPath`) → **DB 設定 (最優先)**」に変更し、起動時 + 60 秒間隔で DB 設定を読み直す (`refreshFromDb()`、保存直後の反映は IPC 等での即時通知はせず最大 60 秒の遅延を許容する eventual consistency)。画面では `GET /api/channels` から放送局を選択すると networkId/serviceId を自動補完できる
    - **共有静的データの自動更新 ON/OFF と「今すぐ同期」ボタンを追加 (§5.7・§5.8・§6.2)**: `AppSettingSchema.ts` に `metadata.sharedData.autoUpdate` を追加し、`SharedDataFetcher.startAutoUpdate()` が定期実行の都度 DB 設定 (未設定時は既定 `true`) を確認してスキップ可否を判定するようにした。`ISharedDataFetcher.syncNow()` を追加し、自動更新の ON/OFF に関わらず即座に取得して `startAutoUpdate()` 登録済みコールバックへ反映する。専用 API `POST /api/settings/system/shared-data/sync` (`SharedDataSyncResult`) を追加
    - `GET /api/schedules/series-metrics` を使った精度メトリクス (未マッチ番組率・confidence 分布) 表示をシリーズ管理タブに追加 (`client/src/model/api/series/ISeriesApiModel.ts` に `getMetrics()` を追加)
    - `client/src/views/Settings.vue` の「サーバー設定を開く」ボタンを `featureFlags.systemSettings` でゲート (無効時は非表示)。`SystemSetting.vue` 側でも直接 URL アクセス時に同フラグを見て `/settings` へリダイレクトする防御を追加
    - **録画検索の高度化 (`advancedSearch` フラグ有効時のみ表示。無効時は改修前と同じ見た目)**
        - `client/src/components/recorded/RecordedSearchMenu.vue` にキーワード欄の高度検索構文ヒント (ツールチップ: AND/OR/除外/フレーズ/フィールド指定) を追加
        - 階層タグ (`RecordedTag.parentId`) 対応: タグ選択 (子孫タグも含めて絞り込み、`GetRecordedOption.tagId` 経由でサーバーの子孫展開ロジックをそのまま利用) と、新規タグ管理ダイアログ `client/src/components/recorded/TagManageDialog.vue` (追加・編集・削除・親タグ選択・階層インデント表示) を追加。クライアント側にタグ関連 API を呼ぶコードが一切無かったため `client/src/model/api/recordedTag/{IRecordedTagApiModel,RecordedTagApiModel}.ts` を新規追加 (DI 登録は `ModelContainerSetter.ts`)
        - 保存検索: 現在の検索条件を名前を付けて保存・一覧表示・実行・リネーム・ピン留め・削除できる UI を検索メニュー内に追加。`client/src/model/api/savedSearch/{ISavedSearchApiModel,SavedSearchApiModel}.ts` を新規追加 (`/api/searches` 系 CRUD)
        - `client/src/model/state/recorded/search/{IRecordedSearchState,RecordedSearchState}.ts` に `tagId` / `tagItems` (親→子の順を保った階層表示用リスト) / `fetchTagItems()` を追加。`client/src/views/Recorded.vue` の `createFetchDataOption()` で route query の `tagId` を読み取るよう対応
    - 視聴体験まわり (S2・S4・S17) の欠陥修正と未実装機能を追加（クライアント側のみ、サーバ変更なし）
    - **機能フラグ未ゲートの導線を全面ゲート**: ダッシュボードの新規カード (ストレージ使用状況・録り逃しアラート)、Next Up パネル、Settings の Next Up 関連設定を `isFeatureEnabled()` (`client/src/util/FeatureFlags.ts`) で判定して表示するよう統一。全フラグ既定 OFF の環境では追加した導線は一切表示されない (※後に機能フラグは opt-out へ変更。上記「機能フラグを opt-in から opt-out へ切り替えた」を参照)
    - **S2 視聴履歴・未視聴バッジ**
        - `RecordedUtil.convertRecordedItemToDisplayData()` が `watchHistory` フラグ有効時に「未視聴 (履歴なし)/視聴中 (進捗バー付き)/視聴済み」の 3 状態を正しく出し分けるよう修正 (`display.watchStatus`)。`RecordedSmallCard.vue` / `RecordedLargeCard.vue` のバッジ表示・色分けは共通ユーティリティ `client/src/util/WatchStatusUtil.ts` に集約
        - `VideoContainer.vue`: レジューム位置適用 (`applyResumePosition()`, GET 待ち) が完了するまで `resumeReady` フラグで再生位置保存 (`onTimeupdate`/`savePlaybackPosition`) を抑止し、最初の timeupdate が position≈0 を PUT して履歴を上書きするレースを解消
        - `VideoContainer.vue`: `pagehide` / `visibilitychange` (hidden 時) にも `savePlaybackPositionWithBeacon()` を紐付け、タブを閉じる・リロード・バックグラウンド化時にも再生位置が保存されるように変更 (登録した listener は `beforeUnmount` で解除)
        - `WatchRecordedInfoCard.vue` の `toggleWatched()` に try/catch と `duration<=0` の事前ガードを追加し、`ISnackbarState` でエラーを通知するよう修正 (従来は未処理の Promise rejection になっていた)
    - **S4 ホームダッシュボード**
        - `DashboardState.fetchData()` が `isHalfWidth` を送るよう修正 (`/dashboard` が常に 400 になっていた不具合)
        - `featureFlags.dashboard` が無効、もしくは集約 API 呼び出しが失敗した場合は `IReservesApiModel.getCnts()` による個別取得へ自動フォールバックし、`Dashboard.vue` 側の後続処理 (録画中/録画済み/予約の個別 API 取得) が確実に実行されるよう修正 (従来は catch 漏れで後続処理が止まっていた)
        - `featureFlags.dashboard` 有効時は `/dashboard` の結果 (`recording`/`recentlyRecorded`/`upcomingReserves`) を `IRecordingState`/`IRecordedState`/`IReservesState` に追加した `setData()` へそのまま反映し、個別 API への重複リクエストを排除 (真に 1 リクエスト集約になった)
        - ダッシュボードに新規カードを追加: ストレージ使用状況 (`DashboardStorageCard.vue`, 既存 `IStorageApiModel` を利用) / 録り逃しアラート (`DashboardMissingEpisodeCard.vue`, 直近更新シリーズ上位 15 件を対象に `GET /api/series/{id}/missing-episodes/proposals` をスキャンする軽量実装。シリーズ横断の欠番一覧 API がサーバに無いため全件走査ではない点に留意)。いずれも `featureFlags.dashboard` (欠番アラートは追加で `seriesLibrary` も) 連動で表示
    - **S17 Next Up パネル**
        - 連続再生を実装: `VideoContainer.vue` が残り再生時間 (`remainingTime`) と再生終了 (`ended`) を親へ emit し、`WatchRecorded.vue` が `NextUpPanel` へ中継。シリーズタブ選択時は常時、新着タブ選択時は設定 (`isEnableNextUpAutoPlayForLatestTab`, 既定 OFF、`Settings.vue` の Next Up パネル欄で ON 可) で有効な場合、再生終了 8 秒前に「次: 第 n 話」カウントダウンカードを表示し (キャンセルボタンあり)、カウント 0 で自動的に次話を再生する。次に再生する録画はシリーズタブでは話数昇順で現在より後の最小話数、無ければ未視聴優先、新着タブでは未視聴優先で解決
        - パネルにも視聴進捗バー・未視聴/視聴中/視聴済みバッジを表示 (`WatchStatusUtil` を再利用)
        - パネルの開閉状態・選択タブを `ISettingStorageModel` (`isNextUpPanelOpen` / `nextUpPanelTab`) に保存し次回視聴時に復元。既定タブが録画 ID 変更のたびにシリーズタブへ強制切替されていた不具合を修正 (ユーザー選択を尊重し、上書きしない)
        - キーボードショートカット `N` キーで次の録画を再生 (`document` レベルの keydown リスナー、input/textarea/contenteditable にフォーカス中は無視。将来のリモコン操作を見据えた設計)
        - `data === null` (ロード中/404) のとき「シリーズへ」ボタンが誤って表示される不具合を修正 (`data !== null && data.currentSeriesId !== null`)
        - `WatchRecorded.vue` が `featureFlags.nextUpPanel` を見ずにパネルを常時表示していた回帰を修正 (無効時はパネル自体を描画しない)
        - 録画詳細レスポンス自体には `seriesId`/`episodeNo` が無いため、シリーズタブ選択時に `ISeriesApiModel.get(seriesId)` (既存 API) から話数マップを解決して表示・連続再生の順序判定に使用 (サーバ側変更なし)
        - **一覧は無限スクロールで、上限は 8 件固定から撤廃した**: `GET /api/recorded/{recordedId}/next-up` に `limit` (既定 20 / 上限 100)・`offset`・`target` (`all` / `latest` / `series`) を追加し、レスポンスに `hasMoreLatest` / `hasMoreSeries` を返す。従来は新着・シリーズとも `.slice(0, 8)` で切り捨てていたため、9 話目以降がそもそも取得できていなかった
            - **追加読み込みは表示中のタブだけを引く** (`target`)。全件を一度に返さないのは、スマートフォンで DOM とレスポンスが一度に膨らむのを避けるため
            - クライアント (`NextUpPanel.vue`) は**スクロールイベントではなく `IntersectionObserver`** で末尾の番兵要素を監視する (スクロールのたびにハンドラを走らせない)。監視するのは表示中タブの番兵 1 つだけで、パネルを畳んでいる間・続きが無い場合・読み込み失敗時は監視自体を止める
            - 追加分は id で重複を除いてから追記する (ページ境界で同じ録画が二重に並ばないようにする)

- システム設定 (S5/S6) の残作業を実装し、通知イベント種別を拡充（S1〜S7、サーバ側のみ）
    - **DI 登録漏れの修正**: `IAppSettingHistoryDB` / `INotificationQueueDB` が `ModelContainerSetter.ts` に未登録だったため起動時に DI 解決で落ちる不具合を修正
    - **`AppSettingApiModel` を全面改修**:
        - `AppSettingSchema.ts` の `validateAppSettingValue` による JSON Schema 検証を実際に適用
        - **マスク値の復元を配列インデックスから安定した識別子 (`name`) 突き合わせへ変更**。`notifications.targets` のようにインデックスがずれる (並べ替え・中間削除・先頭挿入) 操作をしてもシークレットが別ターゲットへ付け替わらないようにした。両配列の要素が一意な文字列 `name` を持つ場合のみ `name` で突き合わせ、持たない場合は従来通りインデックスにフォールバックする
        - **Discord Webhook URL 等の `url` も秘密情報として暗号化・マスク対象に追加** (`notifications.targets` 配下限定)。`NotificationDispatcher.getConfig()` も `url` を復号するよう追随
        - **復号失敗時のフォールバック**: secretKey 未設定・鍵ローテーション後で既存の暗号文が復号できない場合、`GET /api/settings/system` は 500 にせず、当該項目だけ `********(復号不可)` プレースホルダに差し替えて返す (画面は開ける)。secretKey 未設定時の更新失敗は `AppSettingSecretKeyIsNotConfigured` として 400 で返す
        - **マスク値の誤認防止**: マスク文字列 (`********...`) が来たのに対応する既存の暗号文が無い場合はエラーにし、マスク文字列自体を本物のシークレットとして保存してしまうバグを防ぐ
        - **v1→v2 鍵移行**: マスク値のまま更新された既存の v1 形式暗号文は、その更新のタイミングで v2 (scrypt + ソルト) へ再暗号化する
        - **変更履歴とロールバック**: `AppSettingHistory` に変更前値を記録し、`GET /api/settings/system/history?key=` (履歴一覧) / `POST /api/settings/system/rollback` (直前の状態への 1 回限りの undo) を追加
        - **requiresRestart**: 更新・ロールバック応答に `requiresRestart` / `requiresRestartKeys` を含め、変更されたキーが Operator の再初期化を要するかを返す (`AppSettingSchema.ts` の `requiresRestart` 宣言に追随。メタデータ/通知プロバイダはいずれも DB を都度読み直す実装のため、現行スキーマでは全キー `false`)
        - `AppSettingDB.getAll()` は行の JSON が壊れていても例外を投げず、その行だけ無視してログに残すよう修正 (壊れた 1 行で設定画面・ダッシュボード・通知が全滅するのを防ぐ)
    - **設定のホットリロード IPC (§6.3)**: 設定更新・ロールバック成功時に Service プロセスから Operator プロセスへ IPC で通知する仕組みを追加 (`ModelName.appSetting` / `AppSettingFunctions.notifyChanged`、`IAppSettingChangeEvent` / `AppSettingChangeEvent`)。対象モジュール (メタデータプロバイダー・通知) はいずれも DB 設定を都度読み直す実装のため、現時点では明示的な再初期化処理は不要だが、将来キャッシュを持つモジュールが増えた場合のフック地点として用意した。録画中の処理には一切影響しない fire-and-forget 通知
    - **通知イベント種別を追加し、実際に発火**: `recording.dropped` (ドロップ検出、`RecorderModel.updateDropFileLog()` でドロップ数 > 0 のとき)・`recording.missed` (録り逃し検出、`EventSetter` の録画リトライオーバー時)・`series.newEpisode` (シリーズ新話追加、`SeriesResolver.linkTo()` で新規エピソード行かつ初回放送と判定できた場合)・`storage.lowSpace` (ディスク残量低下、`StorageManageModel` で閾値を下回った時、同一ディレクトリへの連投を 30 分間隔で抑制)
    - **視聴履歴の孤児レコード対策**: `WatchHistoryDB.deleteByVideoFileId` / `deleteByRecordedId` を、録画削除・ビデオファイル個別削除の両方 (`RecordedManageModel.delete` / `deleteVideoFile`) から呼び出すようにした
    - **WatchHistory の status カラム整合**: mysql 用マイグレーション (`FixWatchHistoryStatusColumn`, varchar(20) 化) に対応する sqlite 側マイグレーションが無かったため追加 (テーブル再作成による移行、既存データは保持)
    - `api.yml` に `AppSettingValue` / `AppSettingUpdateResult` / `AppSettingHistoryItem` / `NotificationTestResult` / `NotificationFailureHistoryItem` のスキーマを追加し、同じ型を `api.d.ts` にも追加。`GET /api/settings/system/notifications/failures` (通知の失敗履歴取得、`INotificationDispatcher.getFailureHistory()` を公開) を新規追加
    - クライアント UI (変更履歴・ロールバック・requiresRestart の表示、失敗履歴一覧) は別ステップで対応予定

- 既存録画のシリーズ化バックフィルバッチを追加（S20、サーバ側のみ）
    - 提案書 §11.1 に対応。`seriesLibrary` 機能導入前から存在する既存録画に対し、`SeriesResolver.resolve()` を録画 id 昇順でチャンク分割しながら順次適用し、シリーズへのリンク付け・未確定キューへの積み込みを行うバックグラウンドジョブ (`ISeriesBackfillManageModel` / `SeriesBackfillManageModel`, `src/model/operator/series/`)。ジョブは Operator プロセスで実行し、他の recorded 系ジョブ (S18 の `ImportJobManageModel`) と同様に Service プロセスからは IPC (`ModelName.series` / `SeriesFunctions.startBackfill` / `getBackfillStatus` / `cancelBackfill`) 経由で操作する
    - **チャンク分割・低優先度**: 1 チャンクあたり既定 50 件 (`chunkSize` で変更可、1〜500 にクランプ) を `IRecordedDB.findForSeriesBackfill(afterId, limit)` (id 昇順・録画中を除く) で取得して処理し、チャンク間に既定 500ms (`intervalMs` で調整可、テスト用) の待機を挟むことで SQLite への録画書き込みと継続的に競合しないようにする。各チャンクは独立した小さな DB 呼び出しの集合であり、バックフィル全体を単一の長時間トランザクションにはしない
    - **中断・再開が自由**: 進捗 (状態・カウンタ・再開カーソル `lastRecordedId`) を `IAppSettingDB` (キー `seriesBackfill`) へチャンク完了毎に永続化する。`DELETE /api/series/backfill` でのキャンセルはもちろん、Operator プロセスが異常終了して `state: 'running'` のまま保存されていた場合も次回起動時に読み込むタイミングで `canceled` 扱いへ補正し、次の `start()` 呼び出しで `lastRecordedId` の続きから再開する (処理は `SeriesResolver.resolve()` 側が manualLock を除き冪等なため、万一同じ録画を再処理しても結果は変わらない)
    - **manualLock はスキップ**: 録画に既存の手動確定リンク (`manualLock: true`) がある場合は `SeriesResolver.resolve()` を呼ばずスキップ件数としてカウントする
    - **進捗取得**: 総件数 (処理済み + 残件数として都度再計算)・処理済み・リンク作成数・未確定キュー行き数・スキップ数・失敗数・状態 (`idle`/`running`/`completed`/`canceled`/`failed`) を返す
    - **ドライラン**: `dryRun: true` を指定すると、`SeriesResolver` のエイリアス優先→類似度スコアリングの判定ロジックのみを (DB 書き込みなしで) 再現し、録画ごとに確定シリーズ (または新規作成予定) か未確定候補 (上位 3 件) かをプレビューとして返す (`previewItems`、上限 2000 件を超えた分は `previewTruncated: true`)。ドライランは実バックフィルの再開カーソルに影響を与えないよう常にカーソル 0 から独立実行し、`IAppSettingDB` への永続化も行わない
    - API: `POST /api/series/backfill` (開始、body: `SeriesBackfillOption { dryRun?, chunkSize? }`)・`GET /api/series/backfill/status` (進捗取得)・`DELETE /api/series/backfill` (キャンセル)。機能フラグ `seriesLibrary` が無効な場合は他の series 系エンドポイントと同様に 404 を返す
    - `api.yml` に `SeriesBackfillOption` / `SeriesBackfillState` / `SeriesBackfillPreviewCandidate` / `SeriesBackfillPreviewItem` / `SeriesBackfillResult` のスキーマを追加し、同じ型を `api.d.ts` にも追加
    - `IRecordedDB` に `findForSeriesBackfill` / `countForSeriesBackfill` (id 昇順チャンク取得・残件数取得、録画中は対象外) を追加。`ISeriesDB` に `findPendingMatchByRecordedId` (未確定キューの存在確認用) を追加。いずれも既存メソッドの挙動には影響しない追加のみ
    - クライアント UI (バックフィル開始・進捗表示・ドライランプレビュー画面) は別ステップで対応予定

- 高度タグ・全文検索・保存検索を追加（S19、サーバ側のみ）
    - 録画全文検索エンジン `RecordedKeywordSearch` を追加。AND / OR (`OR` / `|`) / 除外 (`-` / `!`) / `title:` `desc:` `ext:` `tag:` `ch:` のフィールド指定 / `"フレーズ"` 検索に対応し、`featureFlags.advancedSearch` が無効なときは従来と完全に同一の where 句 (name/description の AND OR) を返す
    - `RecordedTag` に `parentId` (階層タグ) を追加。`advancedSearch` 有効時は録画一覧のタグ絞り込み (`GET /api/recorded?tagId=`) で子孫タグの録画も含めるようにし、タグの親子付け替え時は自分自身・子孫を親にできないよう循環参照を防止 (`RecordedTagDB.getDescendantIds` / `updateOnce`)
    - 保存検索 (`SavedSearch`) を追加。名前・検索条件 (JSON 文字列)・ピン留めを保持し、`GET/POST /api/searches`・`GET/PUT/DELETE /api/searches/{searchId}` で CRUD 可能。`featureFlags.advancedSearch` が無効なときは 404 を返して機能を無効化 (Dashboard/AppSetting と同じ流儀)
    - DB マイグレーション (sqlite/mysql 両対応): `AddRecordedTagParent` (`recorded_tag.parentId` 列 + インデックス追加)、`AddSavedSearch` (`saved_search` テーブル新規追加)
    - クライアント UI (検索バーの高度構文入力、階層タグ選択 UI、保存検索の一覧・保存操作) は別ステップで対応予定

- 外部録画ファイル (EDCB 等) の取り込み機能を追加・全面改修（S18）
    - **セキュリティ修正**: 初期実装 (`3f3e9c1d`) はクライアントから渡された任意の絶対パスをそのまま扱っており、サーバ上の任意ファイルの読み取り・移動・削除が可能だった。以下の対策を実施
        - `config.importDirs` (`IConfigFile.ImportDirInfo[]`) で明示的に許可したディレクトリ以外は一切取り込めない。未設定 (既定 `[]`) の場合は機能自体が無効
        - パス検証は `fs.realpath` でシンボリックリンクを解決したうえで `importDirs` の実ディレクトリ配下かどうかを `path.relative` ベースで判定 (`src/model/recorded/import/ImportPathValidator.ts`)。Windows のドライブレター・UNC パス・大文字小文字/区切り文字の差異にも対応し、シンボリックリンク経由の脱出を防ぐ
        - `subDirectory` / スキャン時の `subPath` にも `..` トラバーサル検査を追加
        - 書き込み処理 (登録・移動) は他の recorded 系操作と同様に **IPC 経由で Operator プロセスが実行** するよう修正 (以前は Service プロセスの `RecordedApiModel` が Operator 用の `RecordedManageModel` インスタンスを直接呼び出しており、サムネイル生成・自動エンコード・socket.io 通知が発火しない不具合があった)
    - **取り込みモードを 2 種類に対応**: `register` (既定。元ファイルを一切移動・削除せず、`importDirs` のディレクトリ名をそのまま `parentDirectoryName` としてそのまま登録する) / `move` (録画ディレクトリへ移動する、従来の挙動)
        - `register` モードで追加した `VideoFile` には `isExternalFile` フラグを立て (マイグレーション `AddVideoFileIsExternal`)、EPGStation から削除しても DB の登録解除のみで元ファイルには一切触れないようにした
    - **EDCB メタデータ推定**: ファイル名パターン (プリセット + `config.importFileNamePatterns` によるカスタム正規表現) と `<ファイル名>.program.txt` / `<ファイル名>.err` の解析を純粋関数として実装 (`src/model/recorded/import/EDCBFileNameParser.ts` / `EDCBProgramTxtParser.ts` / `EDCBErrParser.ts`)。チャンネル名は `ChannelDB` の放送局一覧と突き合わせて `channelId` に変換
    - **重複検出**: `channelId` + 開始時刻 (±5分) が一致する既存 `Recorded` を検出し (`IRecordedDB.findDuplicateCandidates`)、スキャン結果に警告として返す。登録時は `skip` (取り込まない) / `add` (既存 recorded に video file を追加) / `newRecorded` (別録画として新規登録) を選択可能
    - **API を全面刷新**: `POST /api/recorded/import/scan` (ディレクトリスキャン・推定結果と重複警告を返す、副作用なし) → `POST /api/recorded/import` (登録をバックグラウンドジョブとして開始し jobId を返す) → `GET /api/recorded/import/status/{jobId}` (進捗取得) / `POST /api/recorded/import/status/{jobId}/retry` (失敗ファイルのみ再実行)。旧 `POST /api/recorded/import-external` (一括同期処理・脆弱) は廃止
    - **バックグラウンドジョブ**: `ImportJobManageModel` (Operator 側) が 1 件ずつ順次取り込み、進捗 (総数・完了数・成功/失敗数・結果一覧) をメモリ上に保持しポーリング可能にした。ffprobe 等の重い処理で API リクエストがブロックされないようにするため
    - **監視フォルダ (既定 OFF)**: `config.importWatch: true` にすると `ImportWatchManageModel` が `importWatchIntervalSec` 間隔で `importDirs` を走査し、チャンネル・時刻が推定でき重複が無いファイルを自動で取り込む (`register` モード既定)。処理済みファイルは `data/importWatchSeen.json` に永続化し再起動後も再取り込みしない
    - **機能フラグをクライアントに公開**: `GET /api/config` のレスポンスに `featureFlags` (段階導入フラグ一式) と `importDirs` (許可ディレクトリ名一覧) を追加し、クライアントはこれを見て `externalFileImport` が無効なら取り込み UI 自体を表示しない (`client/src/util/FeatureFlags.ts` の `isFeatureEnabled()` を他の機能フラグでも再利用可能な共通ヘルパーとして追加)
    - **クライアント UI**: アップロード画面のテキストエリア方式を廃止し、取り込み元ディレクトリ選択 → スキャン → 候補一覧 (推定番組名・放送局の編集、重複警告、モード/重複時挙動の選択) → 登録 → 進捗表示・失敗分再実行のウィザードに変更 (`RecordedUploadForm.vue` / `RecordedUploadState.ts`)
    - DB マイグレーション (sqlite/mysql 両対応): `AddVideoFileIsExternal` (`video_file.isExternalFile` 列追加)

- Next Up パネルを追加（S17）
    - 録画視聴画面の右側に最新録画 / 同シリーズのタブ切替パネルを追加
    - 同シリーズが判定済みの場合はシリーズ一覧への導線も表示
    - 既存の視聴履歴を流用し、視聴済み / 視聴中ラベルを表示
    - ストリーミング視聴中は現在の配信方式・画質モードを引き継いで次の録画を再生

- Annict GraphQL連携を追加（S16）
    - GUI保存済みトークンを実行時だけ復号し、Bearer認証で作品・エピソード情報を取得
    - Annict IDとsyobocalTidをシリーズへ同期するAPI・UIを追加
    - GraphQLエラー、認証エラー、無効設定、キャッシュ基盤に対応

- 再放送・欠番・複数局録画の分析を追加（S15）
    - シーズン別の欠番、同一話数の複数録画、話数不明録画をシリーズAPIで返却
    - 同一エピソードの既存録画がある場合は、再放送表記がなくても自動的にrerunへ分類
    - シリーズ詳細画面に欠番警告と複数録画表示を追加

- 番組表とシリーズの双方向連携を追加（S14）
    - EPG番組を正規化タイトル・シーズン・話数から遅延マッピングし、結果を永続化
    - 番組ダイアログの「シリーズ」ボタンから録画済みシリーズへ移動
    - EPG情報を地方局・未登録番組の補完ソースとして利用

- しょぼいカレンダープロバイダーを追加（S13）
    - TitleLookup / ProgLookup XMLを共通メタデータ形式へ変換
    - 設定GUIの有効化状態に連動し、作品・話数・サブタイトル・放送日時を取得
    - 地方局データがない場合もtitle-onlyとして作品情報を保持し、EPG側補完を妨げない

- 外部メタデータプロバイダー基盤を追加（S12）
    - 共通検索・詳細契約、レジストリ、横断検索、失敗分離、HTTP再試行・レート制御を追加
    - 24時間キャッシュとSQLite/MySQL/PostgreSQLマイグレーションを追加
    - プロバイダー一覧・横断検索APIを追加

- S12〜S16 の残作業 (Annict 双方向同期・共有静的データ・欠番判定強化・XML パーサ堅牢化) を追加
    - **Annict 視聴記録の双方向同期 (§5.5・S16)**: `IMetadataProvider` にオプショナルな `pushWatchRecord()` を追加し、`AnnictProvider` に `createRecord` / `updateStatus` mutation を実装した。トリガーは `WatchHistory` が `watched` へ遷移した瞬間 (`WatchHistoryApiModel.update()`、直前が `watched` でない場合のみ) で、`opt-in` の `featureFlags.annictSync` (既定 OFF、既存フラグを利用) が無効なら DB 書き込み・通信とも一切発生しない。引き当ては `RecordedSeriesLink.episodeId` (話数キー) を使い、`Series.annictId` が未確定なら `syobocalTid` 一意確定検索で自動解決を試みる (`AnnictSyncQueueModel.resolveAnnictId`)。送信はキュー化 (`AnnictWatchSync` テーブル、sqlite/mysql マイグレーションあり) して指数バックオフでリトライ (1分→最大6時間、最大8回、`AnnictSyncQueueModel`) し、Annict 障害時も視聴履歴の更新自体は失敗させない (障害分離)。二重送信は `(seriesId, seriesEpisodeId)` の一意制約 + 送信済み行の保持で防止する。手動同期 API `POST /api/series/{seriesId}/metadata/annict-watch` を追加 (`IAnnictSyncApiModel.syncWatchRecords`)
    - **共有静的データの自動取得 (§5.1)**: `ISharedDataFetcher` / `SharedDataFetcher` を追加。`config.metadataSharedDataUrl` から起動時 + `metadataSharedDataUpdateIntervalMs` (既定24時間、0で無効) 間隔でチャンネルマッピング表 JSON を取得し `data/metadataSharedData.json` にキャッシュする。オフライン/取得失敗時は前回キャッシュ→同梱データの順にフォールバックする。`SyobocalChannelMap` は「同梱データ→共有静的データ (自動取得)→`metadataChannelMappingPath` のローカル上書き」の優先順で合成するよう変更 (優先度が最も低いものから上書き)
    - **欠番検出の強化・補完予約提案 (§4.7・S15)**: `SeriesContinuity.analyzeSeriesContinuity()` が `totalEpisodesBySeason` (外部メタデータの放送予定総話数) と放送ペース補正 (録画実績のある局の隣接話数間隔から「現時点までに放送されているはずの話数」を推定) の両方を考慮するよう拡張し、観測済み最大話数だけでなく末尾側の未録画も検出できるようにした (未登録局でのみ視聴している作品の疎らな実績も、実績のある局のペースで補正することで過検出を防ぐ)。新設の `IMissingEpisodeApiModel` (`GET /api/series/{seriesId}/missing-episodes/proposals` / `POST /api/series/{seriesId}/missing-episodes/reserve`) が欠番話数について EPG (Program テーブル) の未来分から再放送候補を検索して提案し、提案から予約を作成すると `SeriesReservationHint` テーブル (sqlite/mysql マイグレーションあり) に `airType: rerun` を事前登録する。録画完了時に `SeriesResolver.resolve()` がこのヒントを最優先で参照し (`reserveId` 経由)、通常のスコアリングより優先して episode/airType を確定させ使用後に削除する (欠番の初回埋め合わせ録画が誤って `first` 扱いになるのを防ぐ)
    - **しょぼいカレンダー XML パーサの堅牢化 (§5.6)**: 正規表現ベースの `SyobocalXml.xmlItems()` を `fast-xml-parser` (DOM ベース) に置き換えた。ネストタグ・同名タグ・属性混在・CDATA を正しく扱え、不正な XML でも例外を投げず空/部分的な結果を返す (新規依存 `fast-xml-parser` を追加、Windows ビルドへの影響なし)
    - **既知の未実装・簡易実装 (継続課題)**: §5.4 の「EPG のイベント名/詳細から話数マスタと突合」は、既存の `parseSeriesInfo` (第n話/#n パース) を EPG 側 (`ProgramSeriesApiModel`) でも話数キーとして使う既存実装に留まり、サブタイトルのみで話数表記が無い番組向けの専用パーサは追加していない。欠番の外部メタデータ総話数はシーズン区分が無い Annict/しょぼいカレンダーの制約上 season 1 にのみ適用する簡易実装。補完予約提案の候補検索は EPG (Program テーブル) ベースのみで、しょぼいカレンダー ProgLookup 側の未来検索には対応していない。`AnnictWatchSync` / `SeriesReservationHint` はいずれも一時的なキュー/ヒントデータのため `DBTools` のバックアップ/リストア対象には含めていない

- S12〜S16 (外部メタデータ連携基盤) のレビュー指摘対応
    - **プロバイダーチェーン (S12)**: `MetadataService.search()` を syobocal → annict の順で直列実行するチェーンに変更。前段 (syobocal) が確定させた `syobocalTid` を後段 (annict) の `MetadataSearchContext.syobocalTid` へ引き継ぐ。チェーン対象外の追加プロバイダーは従来通り並列実行
    - **キャッシュ経由の全外部照会 (S12)**: `search()` も `MetadataProviderCacheDB` を経由するようにし (`provider` カラムに `search:<provider名>` のキーで保存)、UI からの検索連打が API 連打にならないようにした。TTL は `AppSetting` の `metadata.cacheTtlMs` で変更可能 (既定 24h)。期限切れキャッシュは `MetadataService` が 1 時間間隔で `deleteExpired()` を自動実行するようにした (今まで呼び出し元が無く無限に増え続けていた)
    - **ETag 差分取得の下地 (S12)**: `IMetadataProvider.get()` が `{ etag }` オプションを受け取り `METADATA_NOT_MODIFIED` センチネルを返せるように拡張 (304 相当の場合はキャッシュの有効期限のみ延長)。実際の外部 API 側が ETag を返すかはプロバイダー依存
    - **HTTP クライアントの直列化・429 対応 (S12)**: `ProviderHttpClient` をホスト単位のキューで直列化し、同時リクエストが重ならないようにした。`429` は `Retry-After` (秒 / HTTP-date) を尊重してリトライする
    - **しょぼいカレンダー チャンネルマッピング表 (S13)**: `ISyobocalChannelMap` / `SyobocalChannelMap` を追加。同梱データ (`SyobocalChannelMapData.ts`、主要地上波キー局のみのスケルトン) をベースに、config.yml の `metadataChannelMappingPath` で外部 JSON を指定すると上書き/追加できる (オフライン/読み込み失敗時は同梱データにフォールバック)
    - **確定系マッチ・未登録局スキップ (S13)**: `SyobocalProvider.search()` が `context.channelId`/`context.startAt` を使い、ChID + 放送開始時刻 (±5分) から `ProgLookup` で PID→TID を確定するようにした。マッピング表に `syobocal: false` (未登録局) と登録されている局は `ProgLookup` を最初から呼ばずスキップする。`GET /api/metadata/search` に `channelId`/`startAt` クエリを追加しこの経路を呼び出せるようにした
    - **精度メトリクスの読み方 (注意点)**: シリーズ管理タブの「精度メトリクス」は `ProgramSeriesApiModel.precompute()` が **EPG 更新の差分 programIds を処理した直近 1 バッチ**の集計を `app_setting.programSeriesMetrics` へ上書き保存したもの。以下の性質があるため、シリーズ照合の精度そのものとしては読めない
        - 対象は**番組表 (EPG) の番組**であり、録画のシリーズ照合率 (`RecordedSeriesLink`) とは別物
        - `matched` には「既にリンク済みの番組」と「類似候補が 0 件で新規シリーズを自動作成した番組 (confidence 1.0)」が含まれる。後者は照合できたわけではないので、**未マッチ率は構造的に低め・ヒストグラムは 0.8-1.0 に寄る**
        - 累積ではなく毎バッチ上書きのため、数件しか更新されなかった回では `totalPrograms` が極端に小さくなる。時系列も残らない
        - しきい値 (`settings.series.matchThreshold`、既定 0.8) が効くのは**類似度スコアリングの経路のみ**。作品辞書・エイリアス辞書で確定した分はしきい値を通らない
    - **番組表⇄シリーズの事前マッピングバッチ化 (S14)**: `ProgramSeriesApiModel.get()` を DB 書き込みの無い参照専用メソッドに変更 (番組ダイアログを開くだけではレコードが増えなくなった)。マッピングの確定は新設の `precompute(programIds)` が担い、EPG 更新 (`EPGUpdateManageModel.saveProgram` → `PROGRAM_UPDATED` イベント) をトリガーに実行される。判定は録画側の `SeriesResolver`/`scoreCandidate` と同じしきい値 (`settings.series.matchThreshold`、既定 0.8) を再利用し、しきい値未満は確定させない。`GET /api/schedules/series-metrics` を追加し、直近バッチの未マッチ番組率・confidence 分布 (5 バケット) を取得できるようにした。機能フラグ OFF 時は 500 ではなく 404 を返すよう統一
    - **Annict の syobocalTid 一意確定 (S16)**: `AnnictProvider.search()` が `context.syobocalTid` を受け取ると検索件数を増やし、`syobocalTid` が完全一致する作品を文字列一致より優先して一意確定する。`AnnictSyncApiModel.sync()` はシリーズに `syobocalTid` が既にあればそれを検索コンテキストへ渡し、一致した作品のみを採用する (タイトル類似度のしきい値をバイパス)。同期処理も `MetadataService.search()` 経由になったためキャッシュが効くようになった。`AnnictTokenIsNotConfigured` を 500 ではなく 400 で返すよう修正
    - api.yml / api.d.ts に `MetadataProviders` / `MetadataSearchResult(s)` / `ProgramSeriesMetrics` のレスポンススキーマを追加
    - **既知の未実装 (継続課題)**: `IMetadataProvider` のメソッド名は `search`/`get` のまま (`resolveSeries`/`getSeriesInfo`/`listEpisodes`/`pushWatchRecord` への全面改名は見送り、動作的に同等なチェーン/キャッシュ機構のみ追加)。Annict の視聴記録双方向同期 (`pushWatchRecord`、`WatchHistory` 連動) は未着手。GitHub 上の共有静的データ (チャンネルマッピング/エイリアス辞書) のオンライン取得は未実装 (同梱データ + config 上書きのみ)。しょぼいカレンダー XML パーサーの堅牢化 (非正規表現ベース化) は未着手。未登録局向けの話数マスタ突合・遅延放送対応 (§5.4 補完策) は未着手。欠番の「放送予定総話数」ベース検出・補完予約提案 (S15 §4.7) は未着手。すべて feature flag でゲートされており、無効化すれば既存動作に影響しない (フラグの既定値は後に ON へ変更した)

- シリーズ管理 (S8〜S11) の未確定キュー・マージ/分割・エイリアス・Undo API を追加
    - 未確定キュー: `GET /api/series/pending` (一覧)・`PUT /api/series/pending/{pendingId}` (候補から確定、既存の手動割当ロジックを再利用)・`DELETE /api/series/pending/{pendingId}` (この録画はシリーズ化しない、キューから除外のみで再発防止フラグは持たない)
    - マージ: `POST /api/series/merge` (`fromSeriesId`→`toSeriesId` へリンク・エピソード・エイリアスを統合し `fromSeriesId` を削除)
    - 分割: `POST /api/series/{seriesId}/split` (指定した録画群を新シリーズへ分離。episodeId は分割後クリアされ再解決に委ねる)
    - Undo: `POST /api/series/mappings/{recordedId}/undo` (`SeriesChangeHistory` の直前の未 undo 履歴から復元。履歴が無ければ 404)
    - エイリアス辞書: `GET /api/series/aliases` (`seriesId` で絞り込み可)・`DELETE /api/series/aliases/{aliasId}`
    - 上記追加に伴い `ISeriesPendingApiModel` / `ISeriesMaintenanceApiModel` / `ISeriesAliasApiModel` (+実装) を新規追加し `ModelContainerSetter.ts` に登録
    - `GET /api/series`・`GET /api/series/{seriesId}`・`POST /api/series/{seriesId}/metadata/annict` が機能フラグ無効時に例外を投げっぱなしで 500 になっていたのを他の series 系エンドポイントと同様に 404 へ統一
    - api.yml に `SeriesListItem` / `SeriesDetail` / `SeriesMappingValue` / `SeriesPendingMatchItem` / `MergeSeriesOption` / `SplitSeriesOption` / `SeriesAliasItem` 等のスキーマと `QuerySeriesId` / `PathPendingId` / `PathAliasId` パラメータを追加 (このリポジトリは `paths` を api.yml に静的定義せず express-openapi の fs-routes が各ルートファイルの `apiDoc` から動的に組み立てる方式のため、api.yml 側は components (schemas/parameters) のみを追加する)。同じ型を `api.d.ts` にも追加し、サーバ (`src/model/api/series/*`) とクライアント (`client/src/model/api/series/*`) の重複していたローカル型定義を `apid.*` の re-export に統一
    - クライアント `SeriesApiModel` に `listPending` / `confirmPending` / `rejectPending` / `merge` / `split` / `undoMapping` / `listAliases` / `removeAlias` / `startBackfill` / `getBackfillStatus` / `cancelBackfill` / `reserveMissingEpisode` を追加
    - `RecordedDB.deleteOnce()` / `restore()` で `recorded_series_link` / `series_pending_match` の孤立行が残っていた問題を修正 (録画削除・バックアップ復元時にあわせて削除)
    - `DBTools.ts` のバックアップ/リストア対象に `Series` / `SeriesEpisode` / `RecordedSeriesLink` / `SeriesAlias` / `SeriesPendingMatch` / `SeriesChangeHistory` を追加 (`ISeriesDB` に `findAll*`/`restore*` を追加)。旧バックアップファイル (これらのキー未定義) からのリストアも空配列扱いで後方互換

- シリーズ管理 (S10・S11・S14・S15) のクライアント UI を追加 (上記 API に対応する画面群、サーバ側は変更なし)
    - **未確定キュー画面** (`client/src/views/SeriesPending.vue`, route `/series/pending`): confidence が低い/複数候補の録画をページング一覧表示し、候補上位 3 件からワンクリック割当 (`confirmPending`)・「このシリーズにしない」(`rejectPending`)・手動割当画面への導線を提供。「再マッチ」は専用の再判定 API がサーバに無いため一覧再読込として実装 (簡易対応)。`Series.vue` のタイトルバーからアイコンで遷移
    - **マージ UI** (`Series.vue`): タイトルバーのアイコンからダイアログを開き、統合元/統合先シリーズを選択 → 確認ダイアログ (取り消せない旨を明記) → `merge` 実行
    - **分割 UI** (`SeriesDetail.vue`): タイトルバーのアイコンで分割モードに入り、録画一覧をチェックボックス選択 → 新シリーズ名を入力 → 確認ダイアログ → `split` 実行
    - **Undo 導線**: `ISnackbarState`/`SnackbarState`/`Snackbar.vue` にアクションボタン (`SnackbarActionOption`) を追加し、手動割当の保存・解除・未確定キューからの割当直後に「元に戻す」ボタン付きスナックバーを表示 (`undoMapping` を呼ぶ)。マージ・分割はサーバに undo API が無いため対象外 (確認ダイアログで代替)
    - **録画一覧のシリーズ表示トグル** (`Recorded.vue`): タイトルバーのアイコンでシリーズ単位表示 (`ISeriesApiModel.list` によるシリーズカード一覧) ⇔ 従来のフラット表示を切り替え。既定は従来表示 (`ISettingValue.isShowRecordedAsSeries`, 既定 `false`) で、切替状態は次回表示にも反映される。`Settings.vue` にも同設定の直接切替を追加
    - **バックフィル UI** (`SystemSetting.vue` シリーズ管理タブ): ドライラン/本実行の開始・2 秒間隔ポーリングでの進捗表示 (処理数/確定/未確定/スキップ/失敗)・キャンセル・ドライラン結果 (`previewItems`) のプレビュー表を追加。同タブにエイリアス辞書の一覧・削除も配置
    - **番組表⇄シリーズ連携 UI**: `ProgramDialog.vue` の「シリーズ」ボタンを `featureFlags.programSeriesMapping` でゲート (OFF 環境で 404 エラートーストが出ていた回帰を修正)。番組表セルに簡易的な「追いかけ中」インジケータ (`GuideState.ts`) を追加: `featureFlags.seriesLibrary` + `programSeriesMapping` + 設定 (`isShowFollowingIndicatorInGuide`, 既定 ON) が揃った場合のみ、番組表読み込み時にシリーズ一覧 (最大 500 件) の `normalizedTitle` を取得し、番組名を簡易正規化 (`client/src/util/SeriesTitleNormalizer.ts`, サーバ `SeriesNormalizer.normalizeSeriesTitle` の軽量移植・非同期版) して一致すれば `.following` クラスを付与し「追」マークを表示するベストエフォート実装 (番組表 API に seriesId が同梱されておらず番組ごとの厳密判定は不可のため、正確な判定は各シリーズ詳細画面の API 呼び出し結果を参照すること)。`SeriesDetail.vue` に「今後の放送予定・欠番補完」欄を追加し、`missing-episodes/proposals` → `missing-episodes/reserve` で予約可能に
    - **機能フラグゲート**: `NavigationState.ts` の「シリーズ」項目、`RecordedDetailMoreButton.vue` の「シリーズ割当を修正」、上記で追加した未確定キュー画面・録画一覧のシリーズ表示トグル・バックフィル UI・番組表インジケータをすべて `featureFlags.seriesLibrary` (番組表連携は追加で `programSeriesMapping`) でゲートし、OFF 時は改修前と同じ見た目・導線になることを確認済み

- シリーズ手動オーバーライドを追加（S11）
    - 録画詳細メニューから既存シリーズへの再割当、新規シリーズ作成、シーズン・話数・放送種別修正が可能
    - 手動割当はconfidence=1とmanualLockで自動判定から保護
    - 誤割当の解除にも対応

- シリーズライブラリUIを追加（S10）
    - シリーズ一覧・検索・ページング、シリーズ詳細、録画エピソード一覧を追加
    - 詳細画面は放送局フィルターと再放送表示に対応
    - ナビゲーションからシリーズ画面へ移動可能

- シリーズ自動マッピングエンジンを追加（S9）
    - 正規化タイトル類似度、放送局、しきい値を使って既存シリーズを選択
    - 複数局放送を同一シリーズへ集約し、再放送は既存エピソードへ再利用
    - 録画完了時に自動実行し、手動ロック済み対応は変更しない

- シリーズ管理のデータ基盤を追加（S8）
    - Series / SeriesEpisode / RecordedSeriesLinkと3 DBマイグレーションを追加
    - NFKC、放送枠プレフィックス、再放送記号、話数・サブタイトルを考慮する正規化・話数解析を追加

- 通知設定GUIを実配送へ統合（S7）
    - AppSettingの通知先を録画イベント配送に反映し、暗号化済み署名シークレットを復号して使用
    - Discord/汎用Webhookの配信先編集とテスト通知API・ボタンを追加

- サーバー設定GUIと秘密情報保護を追加（S6）
    - Annict・しょぼいカレンダー・通知・シリーズ設定をWeb UIから編集
    - token/apiKey/secret/passwordをAES-256-GCMで暗号化し、APIでは末尾4文字のみ表示
    - `secretKey`を暗号鍵として使用し、マスク値の再保存では既存暗号文を維持

- DBベースのランタイム設定ストアを追加（S5）
    - `AppSetting`、3 DBマイグレーション、`GET/PUT /api/settings/system`を追加
    - 設定セクションを検証し、`featureFlags.systemSettings`で既定無効化

- ホームダッシュボード集約APIを追加（S4）
    - 録画中・新着録画・今後の予約・競合件数を `GET /api/dashboard` で並列集約
    - 取得件数を1〜50件に制限し、`featureFlags.dashboard` で既定無効化
    - 既存ダッシュボードの予約件数取得を集約APIへ切り替え

- Webhook / Discord 通知基盤を追加（S3）
    - 録画開始・完了・失敗イベントを通知し、イベント単位で配信先を選択
    - Webhook は HMAC-SHA256 署名、Discord は embed 形式
    - 最大5回の指数バックオフ再試行、タイムアウト、機能フラグによる既定無効化

- 録画プレイヤーの視聴履歴 UI を追加（S2）
    - 10 秒間隔・一時停止・終了・画面離脱時に再生位置を保存し、再訪時にレジューム
    - 録画カードへ視聴中/視聴済みバッジと進捗バーを表示
    - 再生画面から視聴済み/未視聴を手動切り替え

- 視聴履歴のサーバー基盤を追加（S1）
    - `WatchHistory` と SQLite / MySQL / PostgreSQL 用マイグレーションを追加
    - `GET/PUT /api/videos/{videoFileId}/playback-position` を追加
    - 90% 視聴済み判定、冪等 upsert、`featureFlags.watchHistory` による既定無効化

- 段階導入向けの開発・テスト基盤を追加（S0）
    - 全新機能を既定無効にする `featureFlags` と型安全な判定ヘルパーを追加
    - UT / ITA / ITB の実行スクリプト、外部 API スタブ、CI ジョブを追加
    - UT は新規ロジックの line coverage 80% をマージゲートに設定
    - ITB は毎日 03:00 JST と手動実行時に動作し、実サービスへ接続しない
    - 詳細は [doc/testing.md](testing.md) を参照

- **Mirakurun/EPGStation**
    - 県境でよくある複数の県外地上波を扱うことができるようにGR/BS/CS/SKYを拡張し、新たにNW1~NW40まで追加
    - Node.js 24 系 (LTS) でのインストール対応 (v18/v20 系のサポートは終了)
    - 各フォーク版MirakurunとEPGStationのビルドが成功するかどうか確認するためのワークフローをActionsに追加
    - タグを push すると GitHub Release を自動作成するワークフローを追加 (`.github/workflows/release.yml`)
        - 3 OS (ubuntu / windows / macOS) × Node 24 でビルドし、`EPGStation-<os>.7z` と `Mirakurun-<os>.7z` をリリースアセットとして添付する (`.git` は除外)
        - リリースノートは `generate_release_notes` で前タグからのコミット/PR から自動生成。タグ名に `rc` / `beta` / `alpha` を含む場合はプレリリース扱い
        - タグ push では `build-validation.yml` は走らないようにした (同一内容のビルドが二重に走るのを防ぐため `tags-ignore` を指定)
    - 各種パッケージの更新
- **Mirakurun**
    - Windowsでlocalhost:40772または、[::1]:40772でアクセスできない問題の修正
    - `0.0.0.0`と`::`をリッスンするオプションの追加
    - EPG取得間隔を放送波ごとに指定できるように変更
    - サービスストリームAPI指定時に物理チャンネルやチューナーグループが異なる場合でも、NIDとSIDが同じ場合はチューナーを利用できるように改変(効率よく選局が可能)
- **EPGStation**
    - 本家EPGStationへのプルリクエストとissueで報告されていたバグ修正のマージ
        - Hotfix: IPTV Simple Client is very slow. l3tnun/EPGStation#614
        - ドロップログ上のパケット数が m2ts ファイル上での実際の数よりも少ない l3tnun/EPGStation#603
        - 定期的に本家の変更に追従
    - dev版Mirakurunとの接続に対応
    - 動画プレイヤーを [DPlayer (tsukumijima フォーク)](https://github.com/tsukumijima/DPlayer) に置き換え
        - ライブ視聴 (HLS / MPEG-TS 低遅延)・録画再生・録画ストリーミングのすべてが DPlayer 標準 UI で再生される
        - ARIB 字幕・文字スーパーは DPlayer 内蔵の aribb24.js で描画 (従来の手動 PES パース実装は削除)
    - Mirakurun に接続できなくても EPGStation が起動できるように変更
        - 起動時の Mirakurun 疎通確認は有限回リトライで打ち切り、未接続でも Web UI が利用可能
        - チューナー情報はバックグラウンドで 30 秒間隔で再取得し、Mirakurun 復旧時に自動反映
        - 接続状態を返す `GET /api/status` を追加。Web UI は未接続時に画面右上へ警告トースト (`ServerStatusToast.vue`) と解決策 (サービス起動確認・mirakurunPath 確認) を表示 (レイアウトを押し下げないポップアップ形式。旧実装はページ上部に領域を確保するバナー方式だった)
    - 配信用エンコードと録画エンコードが互いのプロセスを kill し合うプリエンプション機構を廃止 (`src/model/service/encode/EncodeProcessManageModel.ts`)
        - 従来は `encodeProcessNum` の上限に達したとき、priority の高い要求が低い要求のプロセスを kill して枠を奪っていた。優先度の設定次第で「エンコード投入により視聴中の配信が落ちる」「配信開始により実行中のエンコード成果が破棄される (出力ファイル削除・再実行なし)」のどちらかが必ず起こる問題があったため、kill による横取りをやめ、枠が無ければ双方とも穏当に失敗する方式に変更
        - 枠不足時は `EncodeProcessManageModelCreateError` を reject するのみとなり、`EncodeManageModel` 側は従来通りこのエラーを枠不足として識別して待ちキューに戻す (録画エンコードは自動リトライされる)
        - 配信開始 API (`/api/streams/live/**`, `/api/streams/recorded/**`) は枠不足時に `500 Internal Server Error` ではなく `503 Service Unavailable` (「同時配信数の上限に達しています」) を返すように変更
        - `ENCODE_PROCESS_PRIORITY` (配信) / `ENCODE_PRIPORITY` (録画エンコード) の値自体は将来のポリシー再導入に備えて変更していないが、現在は比較に使用されない
    - 通常エンコードと視聴用ストリーミングのプロセス枠を分離
        - `encodeProcessNum` は録画ファイルのバックグラウンドエンコード専用、`streamProcessNum` はライブ視聴・録画再生ストリーミング専用の上限として独立
        - バックグラウンドエンコードが上限に達しても視聴開始を妨げず、視聴中ストリームが通常エンコードの枠を消費することもない
    - Mirakurun クライアントの HTTPS 接続対応 (`stuayu/Mirakurun` の `client.ts` に追加された `Client.https` プロパティとセット)
        - `mirakurunPath` に `https://` の URL を指定可能に (WHATWG `URL` でホスト・ポート・パスを解釈し直し、ポート省略時も http/https に応じた既定ポートを正しく補完)
        - API エンドポイントのベースパスを変更できる任意設定 `mirakurunAPIPath` を追加 (省略時 `/api`)
    - ニコニコ実況コメントの弾幕表示機能を追加 (KonomiTV 互換)
        - ライブ視聴では [NX-Jikkyo](https://nx-jikkyo.tsukumijima.net) に旧ニコ生互換 API (視聴セッション → コメントセッションの 2 段階 WebSocket) で接続し、受信コメントを DPlayer の弾幕として描画 (`client/src/util/JikkyoCommentClient.ts`)
        - 録画再生 (`./api/videos/{id}` 再生時) では[ニコニコ実況 過去ログ API](https://jikkyo.tsukumijima.net) から録画時間帯のコメントを取得し、再生位置に同期して描画 (`client/src/util/JikkyoKakologClient.ts`)
        - 実況チャンネルの解決は KonomiTV と同じ NicoJK 由来の対照表 (jikkyo_channels.json) を用いた networkId + serviceId ベース (`client/src/util/JikkyoUtil.ts`)。チャンネル名でのあいまい一致ではないため、県外地上波 (NW1〜NW40) を含む全国の地上波局・BS/CS を正しく解決できる
        - 設定ページに「ニコニコ実況コメントを表示する」スイッチと NX-Jikkyo サーバー URL 設定を追加 (localStorage 保存。サーバー側の config 変更は不要)
    - macOS 26 (Safari 26) 以降でライブ視聴の映像が停止する問題を修正
        - 従来は iOS 判定時のみストリーミング設定を調整していたため、macOS の Safari では mpegts.js (M2TS-LL) が既定のままだった。Safari (iOS / macOS) 判定に変更し、Safari ではライブ視聴の選択肢を HLS のみに絞る (`client/src/model/serverConfig/ServerConfigModel.ts`)
        - Safari のライブ HLS 再生は hls.js を経由せずネイティブ HLS (`<video>` 直接) で行い、自動再生ポリシーに合わせて autoplay を無効化 (`client/src/components/video/LiveHLSVideo.vue`)
        - ライブストリーム API (`m2ts` / `m2tsll` / `mp4` / `webm`) のストリーム停止判定を `req` の close から `res` の close へ変更 (Safari のプリフライト的な接続切断で即座にストリームが停止するのを防止)
    - Vuetify 2 → 4 移行漏れによるアイコンボタンの表示崩れを修正
        - Vuetify 3 以降で `v-btn` の既定 `variant` が `elevated` になったため、`variant` 未指定の `<v-btn icon>` が「白い円 + 影」で描画され、録画済みカード等の上で浮いて見えていた。メニュー/ツールバー用のアイコンボタンに `variant="text"` を明示 (FAB は `elevated` のままが正しいため除外)
        - Vuetify 3 以降でタイポグラフィ用 class が `subtitle-1` / `subtitle-2` → `text-subtitle-1` / `text-subtitle-2` に改名されたため、旧名の class とそれを指す scoped sass セレクタが全く効かなくなっていた。クライアント全体 (17 ファイル) で新名に統一 (`RecordedSmallCard.vue` は小カードのタイトルがメニューボタンの下に潜り込む不具合も解消)
    - 「放映中」ページで放送波タブを押すと画面が真っ白になる不具合を修正 (`client/src/views/OnAir.vue`)
        - Vuetify 2 の `v-tab` は `href="#GR"` 形式でタブ値を指定できたが、Vuetify 3 以降ではこの指定が単なるアンカーリンクとして扱われる。ハッシュ履歴 (`createWebHashHistory`) を使っているため URL が `#/GR` に書き換わり、未定義ルートに遷移して描画が空になっていた。`:value` によるタブ値指定に変更
        - あわせて `v-progress-linear` の進捗指定が Vuetify 3 以降で `value` → `model-value` に変更されていた件を修正 (`OnAirCard.vue` の番組進行度、`EncodeSmallCard.vue` のエンコード進捗が常に 0 表示だった)
    - ライブ HLS の in-memory 配信 (低遅延・ディスク書き込みなし) を追加
        - `stream.live.ts.hls` の cmd が `%streamFileDir%` を含まない場合、fragmented MP4 を標準出力へ書き出すコマンドとみなし、セグメントを `HLSMemoryStoreModel` でメモリ上にのみ保持して配信する (`/streamfiles/` はメモリ→ディスクの順で応答)。tmpfs など OS 依存の仕組みを使わないため Windows でも動作
        - 1 秒固定 GOP + プレイリストウィンドウ 6 で実測遅延 2〜4 秒程度 (従来の hls_time 3 × 17 は 10 秒以上)。in-memory モードは字幕 (ARIB → ID3) 非対応。従来のディスク方式 cmd もそのまま利用可能 (詳細は `doc/streaming-refresh.md`)
    - エンコード設定のチューニングと HEVC 対応例の追加
        - テンプレートのライブ HLS コマンドを VBV 制約 (`-maxrate` / `-bufsize`) + profile/level 指定付きの低遅延 fMP4 版に刷新 (1080p/720p/480p)
        - HEVC (libx265, `-tag:v hvc1`) のコマンド例をコメントで同梱 (`-tag:v hvc1` は Safari / iOS 再生に必須)
    - エンコードコマンドのシェルパイプライン対応 (tsreadex 前処理)
        - cmd に `|` を含む場合はシェル経由 (Windows: cmd.exe / その他: /bin/sh) で実行される (`src/model/service/encode/EncodeProcessManageModel.ts`)
        - `%TSREADEX%` 変数を追加。config の `tsreadex` で実行パスを指定 (省略時は PATH 上の tsreadex)
    - 転居などで放送局情報が失われた過去の録画番組の表示名が壊れる問題を修正
        - 従来は表示用の放送局名を現在の `channel` テーブルから引くだけだったため、受信環境が変わって放送局が無くなると `3231128728` のような channelId がそのまま表示されていた
        - `recorded` に **録画時点の放送局名** (`channelName` / `halfWidthChannelName`) を保持するカラムを追加 (mysql / sqlite 両方のマイグレーションあり)。既存データはマイグレーション時に現在の `channel` テーブルから復元する
        - 録画開始時 (`RecorderModel.createRecorded()`) とアップロード時 (`RecordedManageModel.createNewRecorded()`) に放送局名を保存し、`GET /api/recorded` 等の `RecordedItem.channelName` で返す
        - クライアントは `ChannelNameUtil.getRecordedChannelName()` で「現在の放送局情報 → 録画時点の保存名 → `不明な放送局 (NID: x / SID: y)`」の順に解決する (録画済み一覧・ダッシュボード・視聴画面・エンコード一覧で共通)
        - すでに放送局情報が失われている録画番組向けに復元ツール `npm run recover-channel-name` を追加。`channel` テーブルと録画ファイル名 (`%CHNAME%` / `%HALF_WIDTH_CHNAME%` を含む命名規則) から放送局名を復元する。既定は変更内容の表示のみで、`--apply` 指定時に DB を更新する。録画当時の命名規則が現在の `recordedFormat` と異なる場合は `--format` で指定する
    - Mirakurun のサービス一覧に物理チャンネル情報を持たないサービスが含まれると、それ以降の放送局が DB に登録されない不具合を修正 (`ChannelDB.insert()` の `return` → `continue`)
    - エンコードキューを永続化し、Service プロセスの再起動でキューが消えないように変更
        - 未完了のエンコード情報 (実行中 + 待機中) を `data/encodeQueue.json` に保存する `EncodeQueueStoreModel` を追加。一時ファイルへ書いてから rename するため書き込み途中のファイルが残らない
        - Service プロセス起動時に `EncodeManageModel.restore()` で復元する (`ServiceExecutor.ts`)。実行中だったエンコードはプロセスごと失われているため待機中として積み直し、`encodeId` を引き継いだうえで払い出しカウンタを衝突しない値まで進める
        - 復元完了後に Web API の待ち受けを開始する (復元前に push されると encodeId が衝突するため)
        - 保存タイミングは push / 完了 / キャンセル時。保存に失敗してもエンコード自体は継続する (ログのみ)
    - エンコードが空き枠を残したまま開始されない不具合を修正
        - `ExecutionManagementModel.getExecution()` がタイムアウトした際、実行権待ちキューに自分の要素を残していたため、その要素へ実行権が渡ると誰も `unLockExecution()` を呼べず**ロックが永久に解放されなくなっていた**。以降のエンコード追加・キューチェック・終了処理がすべてタイムアウトし続けるため、「並列実行されるはずのエンコードが動かない」状態になる。タイムアウト時にキューから確実に取り除くよう修正
        - `EncodeManageModel.checkQueue()` は 1 回の呼び出しで 1 件しか起動しないため、同時実行枠が複数空いていても次の終了通知まで次のエンコードが始まらなかった。起動に成功したら続けてキューをチェックするよう変更 (復元時に複数件を一度に起動できるようになる)
        - `checkQueue()` の実行権取得失敗を捕捉し、一定時間後に再チェックするよう変更 (従来は unhandledRejection となりキューが放置されていた)
    - ダッシュボードの録画済みカードの表示崩れを修正
        - Vuetify 3 以降で `v-img` の既定が `cover` から `contain` に変わったため、サムネイルが上下に余白の付いた縮小表示になっていた。`cover` を明示 (`RecordedSmallCard.vue` / `RecordedLargeCard.vue` / `EncodeSmallCard.vue` / `RecordedDetail.vue`)
        - `RecordedSmallCard` の高さが `100px` 固定だったが、Vuetify 3 以降のタイポグラフィでは 4 行分が収まらず説明文が上下で切れてカードからはみ出していた (実測 116px)。`min-height` に変更
    - サムネイルファイルが存在しない場合に `GET /api/thumbnails/{id}` が 500 を返していたのを 404 に修正 (DB には登録があるがファイルが無いケース)
    - **サムネイル生成の失敗が永久にリトライされ、原因も分からなかったのを直した** (`ThumbnailManageModel`)
        - 定期クリーンアップが「サムネイルの無い録画」を毎回拾って再生成を依頼するため、壊れた動画ファイルが 1 件あると 10 分おきに `create thumbnail cmd error` が出続けていた (本番ログで 3 件が延々と失敗していた)。**同じ videoFileId が 3 回失敗したら諦める** ようにし、諦めたことを warn で 1 度だけ残す (カウンタはメモリ保持なので Operator 再起動でやり直せる)
        - 失敗理由が ffmpeg の stderr (debug ログ) にしか出ず追えなかったため、**異常終了時は入力ファイルのパスと stderr の末尾 10 行を error ログに出す**ようにした
    - DPlayer の画質切替をライブ HLS / 録画再生にも対応 (従来は M2TS-LL のみ)
        - 対象は ライブ HLS (`LiveHLSVideo.vue`)・録画 HLS (`RecordedHLSStreamingVideo.vue`)・録画 mp4/webm ストリーミング (`RecordedStreamingVideo.vue`)。DPlayer 標準の設定メニュー (歯車 → 画質) から `config.yml` の視聴設定 (mode) を切り替えられる
        - HLS は切替時に m3u8 の URL が変わるため、`BaseVideo.setupQualitySwitch()` で `dp.switchQuality` をラップし「ストリームセッション停止 → 新 mode で再作成 → 有効化待ち → URL 差し替え」を非同期で行う。失敗時は notice を出すだけで再生は継続
        - 録画系は現在の再生位置でストリームを作り直すため、DPlayer が行う切替前位置への seek を抑止して先頭から再生する (`resetCurrentTime`)
        - 視聴設定一覧の取得は `client/src/util/StreamQualityUtil.ts` に集約。録画は `videoFile.type` (ts / encoded) に応じた設定を参照する (`IRecordedStreamingVideoState.getVideoFileType()` を追加)
        - ライブの m2ts / mp4 / webm 直接再生 (`NormalVideo.vue`) は切替非対応 (詳細と制限は `doc/streaming-refresh.md`)
    - ストリーミング API に文字列の mode を渡すと 400 になる問題を修正
        - express-openapi が OpenAPI スキーマに従い `req.query` を数値へ型変換するため、文字列前提のパース (`src/model/service/api.ts`) が失敗していた
    - ログファイルを Web UI 上から確認できる機能を追加 (`/logs` ページ)
        - `config/{operator,service,epgUpdater}LogConfig.yml` を解析して実際に出力されているログファイル (Operator/Service/EPGUpdater × system/access/stream/encode、ローテーション済みファイル含む) を列挙する `GET /api/logs`、末尾から指定行数を取得しキーワード絞り込みできる `GET /api/logs/{logFileId}`、ファイルそのものを取得する `GET /api/logs/{logFileId}/download` を追加 (`src/model/api/log/LogApiModel.ts`)
        - クライアントはプロセス→カテゴリ→ファイルのタブ切り替え UI で該当ログを表示し、表示行数・キーワードで絞り込み可能 (`client/src/views/Logs.vue`, `client/src/model/state/log/LogState.ts`)。詳細な出力レベルの設定方法は従来通り [doc/log-manual.md](log-manual.md) を参照
    - 録画再生時のニコニコ実況過去ログ取得処理を改善 (`client/src/util/JikkyoKakologClient.ts`)
        - 従来は取得上限 (3 日分) を超える録画では先頭 3 日分しか取得できなかったが、期間をチャンク分割 (最大 16 回) して順次取得するように変更。最初のチャンクが届いた時点で描画を開始し、残りはバックグラウンドで追加していく
        - DPlayer の弾幕インスタンス生成が完了する前にコメントが届くケースに対応するため、`BaseVideo.ts` に一時キュー (最大 100 件) を追加し、インスタンス生成後にまとめて描画する
    - 録画ファイルのメタデータ (実尺・開始位置・コーデック・解像度) を DB に保存するように変更
        - `video_file` テーブルに `duration` / `startTime` / `startAt` / `videoCodec` / `audioCodec` / `width` / `height` / `bitRate` / `analyzedAt` を追加 (`src/db/entities/VideoFile.ts`、sqlite / postgres / mysql の `AddVideoFileMetadata` マイグレーションを同時に追加し、起動時に自動適用される)
        - ffprobe を `-show_format -show_streams` で実行する `IVideoUtil.getDetailedInfo()` を追加し、`VideoApiModel` に `getMetadata()` / `analyzeMetadata()` / `analyzeAllMetadata()` / `getMetadataStatus()` を実装 (`GET|POST /api/videos/{videoFileId}/metadata`、`GET|POST /api/videos/metadata`)
        - 録画完了ファイルは「ファイル最終更新時刻 − 実測尺」をファイル先頭の実時刻 (`startAt`) として推定して保存する。新規録画は `RecorderModel.addRecorded()` で録画開始時刻をそのまま記録する。録画中は推定しない
        - 過去分はサーバー起動時にバックグラウンドで順次解析され (`ServiceServer.analyzeVideoFileMetadata()`、20 件ずつ)、サーバー設定 > 基本タブの「録画ファイルのメタデータ」から手動一括取得もできる。未解析のファイルは再生時にオンデマンドでも解析される
        - ニコニコ実況の過去ログは番組開始時刻ではなく `videoFile.startAt` を基準に取得するように変更し、録画マージン分のコメントズレを解消
            - 解決処理は `client/src/util/JikkyoKakologParam.ts` に集約し、**直接再生 (`WatchRecorded.vue`) とストリーミング再生 (`WatchRecordedStreaming.vue`) の両方**が同じ基準時刻を使う (以前はストリーミング側が番組開始時刻のままだった)
            - 録画ファイルが未解析で `startAt` を持たない場合は `GET /api/videos/{videoFileId}/metadata` を叩いてその場で解析させ、それでも取れないときだけ番組開始時刻へフォールバックする
            - 取得範囲の終端は実尺 (`videoFile.duration`) から求め、実尺が無い場合は番組の長さで代用する
            - コメントの表示時刻は `jikkyoStartAt + 再生位置` で決まる (`JikkyoKakologClient`)。基準時刻を変えるときはこの前提を壊さないこと
        - 録画一覧・録画詳細に**実測の長さ**を表示するようにした (`RecordedUtil` の `display.durationText` / `display.fileDuration`)
            - 表示は `30 m` (番組の長さ)、実測値があり番組の長さと異なる場合のみ `30 m → 実 32 m` と併記する。録画ファイルが複数ある場合は最も長いものを採用 (TS とエンコード済みで尺が異なるため)
            - 反映されるのはメタデータ解析済みの録画のみ。未解析なら従来どおり番組の長さだけを出す
        - 一括解析の失敗理由をログに出すようにした (`VideoApiModel.analyzeAllMetadata()` は例外を握り潰して件数だけ数えていたため、`ffprobe` のパス誤りや **config.yml の `recorded` に無いディレクトリ名を DB が指している**ケースで全件失敗しても原因が分からなかった)。ログ量を抑えるため先頭 3 件のみ warn で出す
    - 録画再生画面のシークは DPlayer 標準のコントローラ (プレーヤー内のシークバー) に一本化した
        - 一時的に独自の外付けシークバー (`VideoSeekBar.vue`) をプレーヤー下へ表示していたが、DPlayer 内蔵のシークバーと二重になるため撤去した。`VideoContainer.vue` 側の再生位置ポーリング (1 秒間隔) も不要になったため削除
        - **ストリーミング再生 (mp4 / webm / HLS) は video 要素が「再生位置から作り直したストリームの断片」しか持たない**ため、そのままでは DPlayer のシークバーに断片の長さしか出ず、断片の外へシークできない。`client/src/components/video/VirtualTimeline.ts` を追加し、DPlayer の表示更新とシーク操作を動画全体の時間軸へ差し替えた
            - 総尺 (`dplayer-dtime`)・再生位置 (`dplayer-ptime`)・再生位置バーは `BaseVideo.getDuration()` / `getCurrentTime()` の値で毎回上書きする (DPlayer 自身の `timeupdate` / `durationchange` / `progress` の後に走らせ、加えて 250ms 間隔でも更新してストリーム作り直し中も追従させる)
            - 白い読み込み済みバーは新設の `BaseVideo.getEncodedTime()` (エンコード済み・バッファ済みの末尾) を動画全体に対する割合で描く
            - シークバーのドラッグ / クリック / ホバー時刻は、DPlayer がリスナを張っている `.dplayer-bar-wrap` の**親要素のキャプチャフェーズで横取り**して独自処理へ振り替える (同一要素のキャプチャでは DPlayer 側のリスナを止められないため)
            - `DPlayer.seek()` は差し替えるが、**現在のストリームの範囲内なら DPlayer 標準の処理をそのまま呼ぶ**。範囲外 (←→ キーの大きなスキップなど) のときだけストリームを作り直す仮想シークへ流す。画質切替時の再生位置復元など DPlayer 内部の `seek()` 呼び出しを壊さないための分岐
            - 有効になるのは `isEnabledVirtualTimeline()` を true にした `RecordedStreamingVideo` / `RecordedHLSStreamingVideo` のみ。直接再生 (`NormalVideo`) とライブ視聴は DPlayer 標準の挙動のまま
        - 独自のシーク UI を足す場合はプレーヤー外に並べるのではなく DPlayer のコントローラを拡張すること
    - 番組表を放送波種別ではなく地域別に切り替えられるようにした
        - `src/model/channel/BroadcastRegion.ts` (`IBroadcastRegion`) を追加。serviceId の地域符号 (`serviceId / 1024`) を主判定として地上波の地域を決める (1 関東広域 〜 62 沖縄)
        - 地域符号が効かない CATV パススルー等 (TOKYO MX / tvk / テレ玉 / J:COM / Baycom など) は networkId のテーブルで補正し、どちらでも判定できない場合は「その他 (CATV 等)」へ集約する
        - 広域圏と域内の独立局は同じグループへマージする (関東 = 関東広域 + 東京 + 神奈川 + 埼玉 + 千葉 + 群馬 + 栃木 + 茨城、近畿 = 近畿広域 + 大阪〜滋賀、中京 = 中京広域 + 愛知 / 三重 / 岐阜、北海道 = 道域 + 札幌〜室蘭)。鳥取・島根 / 岡山・香川は 2 県合同
        - 対象は `GR` と `NW1`〜`NW40`。BS / CS / SKY は地域を持たない (従来どおり放送波種別で表示)
        - `ChannelItem` / `ScheduleChannleItem` に `region` (`id` / 表示名) を追加し、`ChannelApiModel` / `ScheduleApiModel` が付与する (`api.yml` の `BroadcastRegionItem`)
        - クライアントのサイドバーは GR / NWxx の項目を廃し、地域名のフラットな一覧 (「番組表関東」「番組表北海道」…) + 末尾の「番組表その他 (CATV 等)」にする。放送局情報が未取得のときは従来の放送波種別表示にフォールバックする (`NavigationState.ts`)
        - `/guide?region=<地域 id>` で番組表を地域で絞り込み、ヘッダタイトルにも地域名を出す (`GuideState.ts` / `Guide.vue`)。絞り込みは取得済みの番組表をクライアント側でフィルタする実装のため、サーバへの問い合わせ量は「全ての放送波」と同じになる
        - 地域符号の対応表は実チャンネルの serviceId で検証し、`test/ut/broadcast-region.test.js` に固定した (特に九州は 56 熊本 / 57 長崎 / 58 鹿児島 / 59 宮崎 / 60 大分 / 61 佐賀 と並びが直感に反するので取り違えに注意)
        - サイドバーの地域は**都道府県コード (JIS X 0401) 順**に並べる。`BroadcastRegionItem.order` として API で返し、複数県をまとめたグループは域内で最小の県コードを使う (関東 = 茨城 8 / 中京 = 岐阜 21 / 近畿 = 滋賀 25)。「その他」は order 99 で必ず末尾
        - **放映中一覧 (`/onair`) のタブも同じ地域名にした**: 従来は放送波種別をそのまま出していたため NW1〜NW40 が「NW1」「NW2」… と並んで判別できなかった。地上波系 (GR / NWxx) を地域名タブ (都道府県コード順) にまとめ、BS / CS / SKY は従来どおり種別で分ける (`OnAirState.getTabs()`)。タブの識別子は `region:<地域 id>` / `type:<ChannelType>` で、地域は `ScheduleChannleItem.region` から求める (放送局一覧の取得を待たずに済む)。番組情報が空で地域を判定できない間は従来どおり放送波種別で表示する
    - 放送局を**系列別**にもまとめられるようにした (日テレ系・TBS 系… / 独立系)
        - 判定は放送波の **BIT (Broadcaster Information Table, PID `0x0024` / table_id `0xC4`)** に載る **系列識別 (`affiliation_id`)** を使う。局名の推測やリモコンキー ID からの推定はしない
        - `aribts` の `TsSectionParser` は BIT に対応していないため、TS パケットの分解とセクション組み立てだけ自前で行う (`src/model/channel/BitParser.ts`)。記述子の解析は `aribts` の `TsDescriptors` に任せ、`extended_broadcaster_descriptor` (tag `0xCE`, `broadcaster_type = 1`) から `affiliation_id` と、その事業者が送出する `original_network_id` の一覧を取り出す。CRC_32 が合わないセクション・`current_next_indicator` が 0 のセクションは捨てる
        - **収集は受動収集のみ**。Mirakurun の API には系列情報が無く、BIT は TS を実際に受信しないと得られないため、以下の 2 経路で「録画・視聴のついで」に集める。チューナーを占有する能動スキャンは行わない
            - 録画・アップロードファイルの TS 解析 (`TsInfoAnalyzer` → `TsInfo.bitSections` → `VideoFileAnalyzeModel.saveTsInfo()`)
            - ライブ視聴の配信経路に挟んだ pass-through Transform (`BitCollectTransform`。`LiveStreamBaseModel` が `BroadcastTimeExtractor` の下流に接続する)
        - 収集結果は `channel_affiliation` テーブル (`networkId` + `affiliationId` の複合主キー) に保存する。クロスネット局のように複数系列に属する放送局があるため 1 対多で持ち、表示は**表示順が先の系列**にまとめる
        - `extended_broadcaster_descriptor` の `broadcasters[]` (= その事業者が送出する `original_network_id` の一覧) を対象に割り当てるため、**1 局分の受信で同一ネットワークの他局の系列も埋まる**ことがある。`broadcasters[]` が空の場合は、そのセクションに事業者が 1 つしか無いときのみセクションの `original_network_id` へ割り当てる (誤った割り当てを避けるため)
        - **BIT をまだ受信していない放送局は「未分類」** (`unknown`, order 99) になる。「独立系」(BIT が系列なしと明示した局) とは別扱いにして、収集済みかどうかが画面から分かるようにしている
        - `ChannelItem` / `ScheduleChannleItem` に `affiliation` を追加し、`ChannelApiModel` / `ScheduleApiModel` が付与する (`api.yml` の `BroadcastAffiliationItem`)。判定は `BroadcastAffiliation` (`IBroadcastAffiliation`) が DB から読んだ索引を引く。Operator (録画解析) が書いた結果を Service (API) へ反映するため、索引は **60 秒の TTL 付きキャッシュ**にして API の入口で `updateCache()` を呼ぶ
        - 系列識別 → 系列名の対応表は ARIB TR-B14 第五編に基づく (`0x00` NHK総合 / `0x01` NHK Eテレ / `0x02` 日テレ系 / `0x03` TBS 系 / `0x04` フジテレビ系 / `0x05` テレビ朝日系 / `0x06` テレビ東京系 / `0x07` 独立系)。表に無い値は「その他 (系列 ID: n)」として値ごと表示するので、実データで想定外の値が出たらここに追記する
        - UI は**番組表・放映中それぞれの 3 点リーダーから「地域別 / 系列別」を切り替える** (既定は地域別)。設定は共通 (`ISettingValue.channelGroupingType`) なので、どちらの画面で変えても両方に反映される
            - 番組表: `GuideMainMenu.vue` に切り替え項目を追加。切り替えると表示中の放送局が属する新しいグループ (`/guide?affiliation=<系列 id>`) へ移動する。絞り込みは地域別と同じくクライアント側フィルタ (`GuideState.filterSchedules()`)
            - 放映中: `ChannelGroupingMenu.vue` (共通コンポーネント) を `TitleBar` の menu スロットに置く。タブ識別子は `affiliation:<系列 id>` (地域別は従来どおり `region:<地域 id>`)
            - サイドバーの番組表リンクも軸に追従する (`NavigationState.getChannelGroups()`)。`GuideRouteUtil` は `affiliation` も引き継ぐので、時刻移動や単局表示への遷移で絞り込みが外れない
        - テストは `test/ut/bit-parser.test.js` (合成した BIT セクションの解析) と `test/ut/broadcast-affiliation.test.js` (系列判定・収集の割り当て規則) に固定した

    - 番組表 (`/guide`) の操作性を修正・強化した
        - **スクロールできなくなっていた回帰を修正**: Vuetify 4 のユーティリティ (`.overflow-auto` 等) は `@layer vuetify-utilities.helpers` の中で定義されており、**レイヤ外の scoped CSS に必ず負ける**。`Guide.vue` の `.program-wrap` が `overflow: hidden` を指定していたため番組表がまったくスクロールしなくなっていた (Vuetify 2 時代はユーティリティ側が `!important` だったので勝てていた)。同じ書き方をしている箇所を足すときは注意する
        - **無限スクロール**: 番組表の末尾付近まで縦スクロールすると次の時間帯を追加読み込みする (`GuideState.appendGuide()` / `Guide.vue` の `loadMore()`)。表示中の放送局にだけ番組を追加し、境界をまたぐ番組は programId で重複排除する。上限は 8 日分 (`MAX_TIME_LENGTH`)、単局表示 (週間番組表) は 8 日固定なので対象外
        - **時刻移動をカレンダー UI に変更**: `GuideTimeSelector.vue` (ヘッダのカレンダーアイコン) と `GuideDaySelectDialog.vue` (タイトルクリック) を `v-date-picker` + 時刻選択に置き換えた。旧実装は `v-select` の項目を `{ text, value }` で渡していたため **Vuetify 3 以降では項目名が空欄になって選べなかった** (Vuetify 3 の既定の item-title は `title`)
        - **表示条件を落とさないようにした**: 時刻移動・単局表示への遷移で `type` / `region` / `channelId` が消えていた (地域別番組表で日付を変えると全放送波に戻る等)。`client/src/util/GuideRouteUtil.ts` にクエリ組み立てを集約し、各遷移で引き継ぐ
        - **特定局の週間番組表**: 番組表の放送局名をクリック → ダイアログの「週間番組表」ボタンで `/guide?channelId=<id>` (8 日分) を開く。従来からある機能だが「番組表」という名前で分かりにくかったため改名し、時刻・地域の条件も引き継ぐようにした
    - 過去の番組表データの保存期間を設定できるようにした (`epgRetentionTime` / `epgDeleteIntervalTime`)
        - `epgRetentionTime` は終了した番組を残す時間 (時間単位)。`0` で従来どおり順次削除、**`-1` で無期限保存**。`epgDeleteIntervalTime` は削除の実行間隔 (分、省略時は `epgUpdateIntervalTime` と同じ)
        - **EPG の全件更新は番組テーブルを全削除してから入れ直す**ため、保存期間を設定した場合は全件更新時の削除条件も変える必要がある (`ProgramDB.insert()` の `ProgramKeepOption`)。「現在時刻以降に終了する番組 (入れ直す分)」と「保存期間を過ぎた番組」だけを消し、保存期間内に終了した過去番組は残す
        - Mirakurun は終了した番組を返さないため、無期限保存にしても過去に遡って埋まるわけではない (設定した時点以降に溜まっていく)
    - Vuetify 4 移行で壊れていた選択リスト (`v-select`) をまとめて修正した
        - Vuetify 4 の `v-select` は `:items` の各要素の **`title`** を表示ラベルに使う (既定 `item-title="title"`)。Vuetify 2 時代の `{ text, value }` のままだと `title` が無いためアイテムオブジェクト自体が文字列化され、**全選択肢が同じ表示 (`[object Object]`) になって「同じ行が二重に並ぶ」ように見える**
        - あわせて Vuetify 3 以降で発火しない `v-on:change` を `v-on:update:model-value` へ置き換えた。「放映中」「番組表」の視聴ダイアログでは、これが原因で配信方式を変えても画質リストが更新されていなかった
        - 影響範囲は視聴ストリーム選択 (放映中 / 番組表 / 録画詳細)・録画検索フィルタ・ルール検索・手動予約・アップロード・エンコード追加。**新しく選択肢を作るときは必ず `{ title, value }` で書くこと**
        - **`plugins/vuetify.ts` の `defaults` で `itemTitle: 'text'` を全 `v-select` / `v-autocomplete` / `v-combobox` に効かせていたのを削除した**。移行初期に Vuetify 2 の `{ text, value }` を延命するために入れた設定で、選択肢を `{ title, value }` に直したあとも残っていたため、`item-title="title"` を明示していない箇所 (視聴ストリーム選択ダイアログの画質リスト等) が `[object Object]` 表示のままだった。既定値 (`'title'`) に戻したので **`item-title` は原則書かなくてよい**
    - 録画詳細画面にシリーズ情報と関連録画を表示するようにした (`client/src/components/recorded/detail/RecordedDetailSeries.vue`)
        - `GET /api/series/mappings/{recordedId}` でシリーズ紐付けを引き、`GET /api/series/{seriesId}` の詳細 (クール・話数・放送種別・外部辞書 ID) をチップで表示する。アイキャッチは `GET /api/series/{seriesId}/image` (Annict 由来)
        - 同じシリーズの録画済み一覧を「関連リスト」として並べ、件数が多い場合はシリーズ詳細画面へ誘導する
        - ジャンルと録画タグもチップ表示にした (`RecordedDisplayData.display.genreItems` / `tags`)。表示は `featureFlags.seriesLibrary` でゲート (opt-out) し、シリーズ未紐付けの録画では何も出さない
        - サーバ側 API の追加は無し (既存エンドポイントの再利用のみ)
    - 放送局ロゴを表示するようにした
        - 録画一覧 (小 / 大カード・テーブル)・録画詳細・番組表の放送局ヘッダで、局名の横にロゴを出す (`GET /api/channels/{channelId}/logo`)
        - 番組表のヘッダは**ロゴと局名を横 1 行**に並べる (`client/src/components/guide/Channel.vue`)。ロゴは `max-width: 40%` + ヘッダ高までに収め、局名は残り幅で `text-overflow: ellipsis`
        - `hasLogoData` が false の局と、画像取得に失敗した局は**従来どおり局名のみ**にフォールバックする。番組表は局数が多いため `loading="lazy"` で遅延読み込みし、失敗した局 id をコンポーネント側で覚えて再要求しない
    - エンコード設定を「プリセット表 + 一括有効化フラグ」方式にした (`src/util/EncodePresets.ts`)
        - 軸は **ハードウェア (software / qsv / vaapi / nvenc / qsvencc / nvencc / vceencc) × コーデック (h264 / hevc) × 画質 (1080p / 720p / 480p / 240p) × 用途 (録画エンコード / ライブ HLS / 録画ストリーミング)**。`config.yml` に `encodePresets` を書くと該当する組み合わせの `encode` / `stream.profiles.*` が自動生成される
        - `qsvencc` / `nvencc` / `vceencc` は **rigaya 氏製の QSVEncC / NVEncC / VCEEncC** を使う。実行ファイルパスは `config.yml` の `qsvencc` / `nvencc` / `vceencc` (省略時は PATH 上のコマンド名、`EncoderModel` が環境変数 `QSVENCC` / `NVENCC` / `VCEENCC` として `config/enc.js` へ渡す)。配信は「rigaya 系エンコーダ → パイプ → ffmpeg で remux」の 2 段構成 (`cmd` に `|` を含むためシェル経由で実行される)
        - **rigaya 系 CLI は 3 ツールで完全に共通ではない**ので分岐が必要。`--vpp-deinterlace` は QSVEncC/NVEncC のみ (かつ `--interlace tff`/`bff` の指定が前提) で VCEEncC には無い → VCEEncC は共通オプションの `--vpp-yadif` を使う。`--strict-gop` も VCEEncC には無い。`--closed-gop` というオプションは 3 ツールいずれにも存在しない。コンテナ指定は `--output-format` (`--format` は無い)。アスペクト比追従リサイズは `--output-res -2x<height>` (`preserve_aspect_ratio` に `input` という値は無い)
        - 不正な `hwaccel` / `codecs` / `qualities` / `targets` はテーブル引きが `undefined` になって起動時に落ちるため、`expand()` で未知の値を捨てて既定値へフォールバックする
        - **完全に opt-in**。`encodePresets` を書かなければ挙動は一切変わらない。優先順位は「手書き優先」で、`encode` / `stream.profiles.live` / `recorded.ts` / `recorded.encoded` の**セクション単位**に判定する (旧形式 `stream.live` / `stream.recorded` の手書きも尊重する)
        - ライブ HLS のプリセットは `%streamFileDir%` を含まない (in-memory 配信のまま)、録画ストリーミングの HLS はディスク方式 (字幕対応) を維持する。`doc/streaming-refresh.md` の 2 モードの区別を壊さないこと
        - `config/enc.js.template` に VAAPI (AMD / Intel) プリセットを追加。テンプレートの HW 別コメントアウトの塊はプリセットで置き換えられる分を削除した (有効な設定値は変更していない)
        - **`config.yml` の `encodePresets` (入力フラグ) と API 応答の `Config.encodePresets` (クライアント向けの解決済み一覧) は同名だが別物**なので混同しないこと
        - 詳細は `doc/conf-manual.md` の `encodePresets` の項、テストは `test/ut/encode-presets.test.js`
    - 依存パッケージを更新 (サーバ / クライアント両方)
        - TypeScript 5.9 → 6.0 系。あわせてクライアントの `tsconfig.json` から TypeScript 7.0 で廃止予定の `baseUrl` を削除し、`paths` を tsconfig 相対 (`./src/*`) に変更
        - ESLint 8 → 10 系へ移行。旧 `.eslintrc.json` を廃止し Flat Config (`eslint.config.mjs`) に移行、`@typescript-eslint/*` は統合パッケージ `typescript-eslint` 8 系に置き換え。lint スクリプトも v9 以降で廃止された `--ext` を削除 (`eslint --fix src/`)
            - ESLint 10 の recommended で追加された `no-useless-assignment` / `preserve-caught-error` は既存コードの記述を維持するため無効化。`@typescript-eslint/no-require-imports` も `swagger-ui-dist` の `require()` を許可するため無効化
        - `eventsource` 2 → 4 系 (default export が廃止されたため `import { EventSource } from 'eventsource'` に変更、`@types/eventsource` は本体同梱の型定義に置き換え)、`js-yaml` 4 → 5 系、`typeorm` 1.0 → 1.1、その他 axios / socket.io / vuetify / vue-router / hls.js / sass / vite 系などをマイナー更新
        - `better-sqlite3` は package.json のみ 13.0.1 表記で lockfile と typeorm の peer (`^12`) に矛盾していたため 12.11.1 に揃えた (npm install が ERESOLVE で失敗する状態だった)
        - 本体が型定義を同梱するようになった `@types/{js-yaml,mkdirp,file-type,socket.io,hls.js,socket.io-client}` を削除
        - `file-type` 16 → 22 系 (ASF パーサの無限ループ脆弱性 GHSA-5v7r-6r5c-r473 の修正が 22 系のみのため)。22 系は ESM 専用だが Node.js 22.12 以降の `require(ESM)` により CommonJS ビルドのままロードできる。API 名変更に伴い `fileType.fromFile()` → `fileTypeFromFile()` に修正 (`src/model/api/video/VideoApiModel.ts`)
        - `uuid` (mirakurun → jsonrpc2-ws 経由の間接依存) を overrides で `^11.1.1` に固定し GHSA-w5hq-g745-h8pq を解消
        - 見送った更新: `url-join` 5 / `inversify` 8 (ESM 専用かつ `require(ESM)` 時に API 互換性の確認が必要)、`vue-facing-decorator` 4 (全クラスコンポーネントに影響)、`typescript` 7 (typescript-eslint 8 の peer が `<6.1.0`)、`aribts` (npm の latest タグが現行より古い)
        - `npm audit` に残る 10 件 (high) は `mirakurun` パッケージ経由の間接依存 (`brace-expansion` / `js-yaml` 4 系) で、いずれも API 非互換な修正版しか存在せず対処不可。EPGStation 側から実行されないコード (redoc / mirakurun 本体) か、静的な glob パターンにしか使われないため実害はない
        - `overrides` の `express-openapi.glob: ^7.0.0` は維持する必要がある。glob 10 以降の `globSync()` は Windows でパス区切りが `\` になり、`fs-routes` が組み立てる API のルートパス (`src/model/service/api/` のディレクトリ構造 = URL パス) が壊れるため
    - シリーズ判定を「対象を絞って実行」「1 件だけ実行」できるようにし、判定過程を画面とログから追えるようにした
        - **未シリーズ化のみ / 直近 N 件のみのバックフィル** (`POST /api/series/backfill` の `onlyUnlinked` / `latest`): サーバー設定 > シリーズ管理タブのチェックボックスと件数入力から指定する。`onlyUnlinked` は `IRecordedDB.findForSeriesBackfill()` の SQL で `recorded_series_link` に無い録画だけに絞る (走査自体を減らす。従来はループ内でスキップしていたためドライランでは効いていなかった)。`latest` は `findSeriesBackfillFloorId(count)` で直近 N 件の下限 id を求め、そこから昇順に処理する
        - **直近 N 件の実行は「部分実行」扱い**で、ドライランと同じくメモリ上の状態で完結させ `IAppSettingDB` の再開カーソル (`seriesBackfill`) を書き換えない。全件バックフィルの続きが失われないようにするため
        - **録画 1 件だけのシリーズ判定** (`POST /api/series/analyze/{recordedId}`): 録画詳細画面の「シリーズ判定を実行」ボタンから叩く。`SeriesBackfillManageModel.analyze()` が Operator 側で `SeriesResolver.resolve()` を 1 件分だけ実行し、結果 (シリーズ・話数・サブタイトル・判定方法・確度) と判定過程を返す。シリーズ未紐付けの録画でもボタンは出る
        - **判定過程のトレース**: `ISeriesResolver.resolve(recording, trace?)` に収集器を渡すと、放送予定照会 → エイリアス辞書 → 作品辞書 → LLM → 類似度スコアリングの各ステップについて「入力・戻り値の要約・確定したか・生の戻り値 (JSON)」を記録する。**トレースは省略可能**で、渡さないときの挙動は従来どおり (バックフィル本体はコスト増を避けるため渡さない)
        - 結果は `SeriesAnalyzeDialog.vue` のポップアップに表を出し、行ごとに「生データ」を展開できる。同じ内容は Operator のログにも 1 ステップ 1 行で出る
    - 外部メタデータへの問い合わせをログから追えるようにした (コメントが取れない等の切り分け用)
        - `ProviderHttpClient` にロガーを注入し、リクエスト (メソッド・URL・試行回数)、レスポンス (ステータス・所要時間・バイト数)、429 のリトライ待ち、4xx の本文冒頭、試行を使い切った失敗を出すようにした。URL は 300 文字で切り詰める (Wikidata の SPARQL 対策)。`ILoggerModel` は `@optional()` なので未注入でも動く
        - `SyobocalTitleDictionary.fetchComment()`: 連携が無効でスキップした場合・TitleItem は返ったがコメントが空の場合を区別してログに出す (件数・レスポンスサイズ・URL 付き)。取得できた場合は文字数を出す
        - `SeriesMetadataFiller.fill()`: 作品コメントの結果を常に集計して出す (`filled/fetched` に加え、**しょぼいカレンダー TID が無くて引けなかった件数**と**1 回の上限 100 件を超えて次回へ繰り越した件数**)。コメントが埋まらない原因が「連携無効」「TID 未確定」「上限」のどれなのかを切り分けられる
        - `SyobocalProgramLookup`: 放送予定の取得件数 (ChID・Range・バイト数) を info、連携無効・ChID 未解決・該当放送なし・確定した TID / 話数 / サブタイトル / コメント長を debug で出す
    - しょぼいカレンダーの放送予定照会 (ProgLookup) が実質使えていなかったのを直した
        - **同梱チャンネルマップ (`SyobocalChannelMapData`) を実データから作り直した**。従来は東京キー局 7 局だけを収録していたうえ、**ChID も networkId も誤っていた** (ChID は `3=日テレ / 5=テレ朝 / 6=TBS / 8=フジ` としていたが、しょぼいカレンダーの実際の割り当ては `3=フジ / 4=日テレ / 5=TBS / 6=テレ朝 / 8=tvk`。networkId も 7 局すべて `32736` = NHK総合・東京の値になっていた)。このため放送予定照会がほぼ全件で `no ChID` となり、**放送回コメントもサブタイトルも一切入らない**状態だった
        - ChID は `ChLookup` (`https://cal.syoboi.jp/db.php?Command=ChLookup`)、networkId / serviceId は実機の `channel` テーブルから起こし、**地上波・BS・CS 110 度の 124 局**を収録した。地上波の networkId は放送事業者ごとに全国一意なので、収録した値はそのまま他環境でも使える
        - しょぼいカレンダー未登録の県域局 (福島中央テレビなど) は**意図的に載せない**。これらは従来どおり系列 (BIT) のキー局の放送予定で代用する
        - `SyobocalProgramLookup.KEY_STATION_CH_ID` も同じ誤りを持っていた (`ntv:3, ex:5, tbs:6, cx:8`) ので `ntv:4, ex:6, tbs:5, cx:3` に修正した。BIT が取れている環境では**キー局代用が別局の番組表を引いていた**
        - 検証: 実データで TOKYO MX (ChID 19) / MBS (ChID 48) の録画が確度 0.98 (開始時刻一致) でシリーズ・話数まで確定するのを確認済み。テスト `test/ut/syobocal-channel-map.test.js` にキー局の ChID 対応と ChID / networkId+serviceId の一意性を固定した
    - しょぼいカレンダーへのアクセス間隔を上げ、429 を受けたら自動で広げるようにした
        - しょぼいカレンダーは Cloudflare のレート制限が厳しく、既定の 250ms 間隔では **429 (error 1015)** を返す。`ProviderHttpClient.HOST_MINIMUM_INTERVAL_MS` でホスト別の最小間隔を持たせ、`cal.syoboi.jp` は 1500ms にした
        - さらに 429 を受けたホストは以後の最小間隔を 2 倍 (上限 10 秒) に引き上げる。同じ同期の続きで叩き続けて弾かれ続けるのを防ぐ。呼び出し側が `option.minimumIntervalMs` を明示した場合はそちらが優先される
    - 作品コメントの取得が 1 回では終わらない問題に対処した
        - 1 回の `SeriesMetadataFiller.fill()` で取りに行く上限を 100 → 300 件に引き上げ、**繰り越しが残っていれば 10 分後に続きを自動実行する** (最大 20 回)。作品コメントは TID ごとに 1 リクエスト必要で、レート制限もあるため 1 回では全件取り切れず、従来は利用者が手動実行を繰り返すしかなかった
        - `SeriesMetadataFillResult` (= `POST /api/series/refresh-metadata` の応答) に `commentFetched` / `commentFilled` / `commentPending` / `commentSkippedNoTid` を追加し、シリーズ一覧の再取得ボタンのスナックバーに「コメント N 件取得、残り M 件」を出すようにした
    - 続編 (第 2 期など) を放送時期で選び分けるようにした
        - **局によっては期の表記を送出しない** (例: 福島中央テレビの「株式会社マジルミエ[字]」)。しょぼいカレンダーは期ごとに別 TID を持ち、正式タイトルは「株式会社マジルミエ」「株式会社マジルミエ(第2期)」なので、タイトル照合だけでは**常に期表記の無い第 1 期に当たってしまう**。放送予定照会が引けない局ではこれを覆せず、2026 年 7 月放送の第 2 期が 2024 年秋の第 1 期に紐づいていた
        - `WorkDictionary` が「期表記を落とした基本キー」(`SeriesNormalizer.seasonBaseKey()`) で同じ作品の全期をグループ化し、`lookup(title, airedAt)` に録画の放送日時を渡すと**その日時が放送期間に入る期へ差し替える**。放送期間は しょぼいカレンダーの初回放送年月 + 総話数分の週 + 余裕 6 週で見積もる。期間に入る期が 1 つに定まらない場合・放送日時を渡さない場合は従来どおり
        - **再放送 (`parsed.airType === 'rerun'`) では放送日時を渡さない**。第 1 期の再放送が第 2 期の放送期間に入って誤判定するため
        - 判定順は変えていない。放送予定照会 (`SyobocalProgramLookup`) が引ける局ではそちらが先に確定するので、これはしょぼいカレンダー未登録の局を救う後段の判定になる
        - `ISyobocalTitleDB.listSeasons()` を追加 (TID・照合キー・初回放送年月・総話数)。バックフィルのドライラン (`SeriesBackfillManageModel.decide()`) も同じ条件で放送日時を渡す
    - 系列を同梱データで補い、遅れ放送の話数を系列キー局の放送予定から確定できるようにした
        - **系列の同梱データ** (`src/model/channel/BroadcastAffiliationData.ts`): 系列は BIT (PID 0x0024) の受動収集のみだったため、**まだ受信していない局は「未分類」のまま**で、番組表の系列別グルーピングも、しょぼいカレンダー未登録局のキー局代用も機能しなかった (実環境では `channel_affiliation` が 0 件だった)。公知の系列を同梱データとして持ち、BIT が無い局だけこれで補う。**BIT を受信済みの局は常に BIT が優先**される (実際の送出が唯一の正)
        - 同梱データは 2 段構え。**`BROADCAST_AFFILIATION_BY_NETWORK_ID`** が networkId → 系列識別 (ARIB TR-B14 の affiliation_id) の実測値 127 局分 (実機の `channel` テーブルから起こしたもの)、**`BROADCAST_AFFILIATION_BY_NAME`** が放送局名 → 系列の全国データ 129 局分。後者は Wikipedia の各ニュースネットワーク (NNN / JNN / FNN / ANN / TXN) と全国独立放送協議会の加盟局一覧から起こしており、**地上波の民放全社を網羅する**ため、実測値に無い地域の局でも局名から系列が付く
        - 局名の照合は「正式名称の含有一致 (長い名前から) → 略称の完全一致」の順。EPG の局名にはサブチャンネル番号が付く (「福島中央テレビ1」) ため含有一致にしているが、**「大分放送」と「大分朝日放送」のように一方が他方を含む組み合わせがある**ので必ず長い名前から照合する。略称 (3 文字程度) は偶然一致しやすいので完全一致のみ (末尾のサブチャンネル番号は落として比較)
        - `BroadcastAffiliationTarget` に `name` を追加し、`ChannelApiModel` / `ScheduleApiModel` / `SyobocalProgramLookup` が局名を渡す
        - ケーブル・コミュニティ局は系列を持たないため収録しない。実データでは地上波の実局はすべて分類され、未分類として残るのはケーブル局と (このフォークで `NW*` 扱いになっている) 衛星チャンネルだけになった
        - **遅れ放送の話数解決** (`ISyobocalProgramLookup.lookupDelayed()`): しょぼいカレンダー未登録の県域局はキー局の数日後に同じ作品を流すため、同時刻の照合 (`lookup()`) では拾えない。**作品 (TID) が確定していれば**キー局の放送予定を `ChID` + `TID` で絞って引き、録画時刻より前で最も近い放送をその回とみなす。遅れ日数が一定でなくても (2 週遅れ・特番による飛び) 追える。遡る範囲は 28 日、応答は 1 作品分なので軽い
        - 呼び出しは `SeriesResolver.linkToWork()` の話数解決の**最後**。「放送予定の話数 → タイトルの話数表記 → サブタイトル逆引き → 遅れ放送」の順で、前段で決まっていれば外部照会は行わない。遅れ放送で確定した場合は `airType` を `delayed` にする
        - 検証: 福島中央テレビ (しょぼいカレンダー未登録・日テレ系) の「株式会社マジルミエ[字]」4 件が、キー局 (日本テレビ) の放送予定から第 1〜4 話 + サブタイトルまで確定するのを実データで確認した (6 日遅れのネット)
    - NHK 系の「番組名（17）」形式の話数を読めるようにした
        - NHK 総合 / Eテレは話数を括弧だけで表す (「アニメ　アオアシ（１７）東京都リーグ第７節…」)。従来の括弧付き話数のパターンは**前に空白を要求していた**ため、この表記では話数が取れず、正規化キーにも括弧数字とサブタイトルが残っていた (「アオアシ(17)東京都リーグ第7節 多摩体育大学附属高校戦」) 。空白なしでも拾うようにし、`SeriesNormalizer` の話数抽出・末尾除去の双方に効かせた
        - **「(2024)」のような年号は話数と取り違えない** (19xx / 20xx の 4 桁を除外)。また括弧数字は年号・版数と紛らわしいため、話数抽出の優先度は最下位にしてある (「第3話」等の明示的な表記があればそちらが勝つ)。`(HDマスター版)` のような版の違いは従来どおりシリーズ名に残る
        - 効果: 放送予定が引けない再放送枠でも話数が付くようになった (例: Eテレの「アオアシ（１７）」の再放送が第 17 話 + サブタイトルまで確定)
    - **NHK の総合 / Eテレを放送局名で決め直すようにした**
        - ARIB 上は `0x00` = NHK総合 / `0x01` = NHK Eテレ だが、**実際の送出では Eテレの BIT にも `0x00` (NHK総合) が入っている環境がある** (NHK を 1 事業者として扱っているため)。BIT を受信済みの環境ではそれが優先されるので、Eテレの録画が NHK総合と判定され、しょぼいカレンダーの問い合わせ先が ChID 1 (NHK総合) になって放送予定を引けなかった
        - 実例: NHK Eテレ福島の「アニメ　魔入りました！入間くん４（１８）…」が `系列キー局 ChID 1 で代用、その日の放送予定 2 件に開始時刻の一致なし` で落ちていた (正しくは ChID 2)
        - `BroadcastAffiliation.getAffiliation()` で、NHK と判定された局に限り局名 (`Eテレ` / `教育` / `総合`) から決め直す。**民放には手を触れない** (BIT の系列識別が正しく入っているため)
    - 放送予定照会が「該当なし」になった理由を画面とログから追えるようにし、失敗を掴んだままにしないようにした
        - **XML 以外の応答を「該当なし」と誤認しないようにした** (`SyobocalXml.assertSyobocalResponse()`)。しょぼいカレンダーは Cloudflare のレート制限 (error 1015) やメンテナンス時に XML ではなく HTML を返すが、`xmlItems()` はそれを黙って空配列にするため**正常な「その日は放送なし」と区別が付かなかった**。ルート要素 (`ProgLookupResponse` 等) と `Result/Code` (200 / 404 のみ正常) を検証し、それ以外は取得失敗として上位へ伝える。放送予定照会・作品辞書の同期・作品コメント取得のすべてに適用
        - **0 件の結果はキャッシュしない**。従来は一時的な失敗で空になった結果も 6 時間キャッシュしていたため、一度失敗すると復旧まで同じ局が延々と「該当なし」になっていた
        - **`ISyobocalProgramLookup.lookup()` の戻り値に理由を付けた** (`{ match, detail }`)。「系列キー局 ChID 2 で代用、その日の放送予定 11 件から特定」「…11 件に開始時刻の一致なし (キー局代用時は開始時刻がほぼ一致する放送のみ採用)」のように、**どの ChID を引いて何件返ったか**がシリーズ判定のトレース (ポップアップ) に出る。引けなかったときに原因を切り分けられないのが一番困るため

- **データ放送 (BML) に対応した**
    - **背景**: 従来は映像・音声・字幕・実況コメントまでは表示できても、天気・番組連動クイズ・ニュース速報などのデータ放送 (BML) は一切表示できなかった
    - **BML ブラウザは [tsukumijima/web-bml](https://github.com/tsukumijima/web-bml) (otya128/web-bml のフォーク、MIT License) を npm 依存として使う**: `"web-bml": "github:tsukumijima/web-bml#fea69f4526ee4acc66687019a1985643618be572"`。このフォークは**ビルド済みの `dist/` と型定義をリポジトリにコミットしている**ため、submodule も追加のビルド手順も無く `npm install` だけで使える (ルートと `client/` の両方の package.json に依存を追加している)。サーバは `web-bml/worker` (DOM 非依存のエントリ) から `decodeTS` を、クライアントは `web-bml` から `BMLBrowser` / `AribKeyCode` を import する。実装方針は [KonomiTV (tsukumijima/KonomiTV)](https://github.com/tsukumijima/KonomiTV) の `LiveDataBroadcastingManager` を参考にした
    - **映像は EPGStation の DPlayer、web-bml は BML の描画専用**: web-bml が持つ ffmpeg エンコード機能・koa サーバは使わない。映像は引き続き DPlayer が再生するため、二重エンコードが起きず実況コメント・ARIB 字幕・シーク UI といった既存機能をそのまま使える
    - **データ放送用に TS をもう 1 本引く**: ライブは Mirakurun の同一サービスストリームをもう 1 本開き、録画は録画ファイルをプロセス内で `fs.createReadStream` して直接読む (どちらも HTTP は経由しない)
    - **サーバ側 (`src/model/service/dataBroadcasting/`)**
        - `webBml.ts` — `web-bml/worker` の `decodeTS` と `ResponseMessage` 等の型を薄く re-export するだけのモジュール。テストは `__setDecodeTSForTest()` でスタブに差し替える
        - `DataBroadcastingManageModel.ts` — WebSocket 1 本 = 1 ストリーム。同時接続数は既定 4 (`config.yml` の `dataBroadcasting.maxStreams`) を超えると最も古い接続を閉じる。decodeTS の Transform は下流を持たないため `resume()` で流し切る。backpressure 対策として `ws.bufferedAmount` が 8MB を超えている間は `moduleDownloaded` 以外のメッセージを間引き、32MB を超えたら切断する
        - `DataBroadcastingWebSocketServer.ts` — npm の `ws` を `noServer: true` で使い、`ServiceServer` が作った http/https サーバの `upgrade` イベントに相乗りする。**パスが `<subDirectory>/api/dataBroadcasting/ws` でないリクエストの socket には一切触れない** (同じ upgrade イベントを socket.io と共有しているため、無関係な socket に触ると socket.io のハンドシェイクが壊れる)。`auth.enabled` が有効なときは `SocketIOManageModel` と同じ方式でセッション Cookie を検証する
        - `DataBroadcastingParamParser.ts` — WebSocket の `?param=<JSON>` を手動で検証する。ライブは `{"type":"epgStationLive","channelId":<Channel.id>}`、録画は `{"type":"epgStationRecorded","videoFileId":<id>,"seek":<byte offset>}`
        - close code は `1008` (パラメータ不正) / `1011` (内部エラー) / `4000` (正常終了・同時接続数超過による追い出し)。ハンドシェイク前に弾く場合は `401` (未認証)
    - **クライアント側 (iframe は使わない)**
        - `BMLBrowser` は内部で closed な Shadow DOM を使うため EPGStation 本体の CSS と衝突しない。そのため iframe 隔離をやめ、BML ブラウザを直接 DOM に生成して DPlayer に組み込む方式にした
        - `client/src/util/DataBroadcastingManager.ts` — **Vue 非依存のプレーンクラス**。DPlayer インスタンスと接続パラメータを受け取り、BMLBrowser の生成・映像要素の移動・拡大縮小率の計算・WebSocket 接続・破棄を担う。**BMLBrowser 内部の JS-Interpreter が Vue のリアクティブ Proxy に包まれると壊れるため、Vue 側は必ず `markRaw()` で包んで保持する** (これが Vue コンポーネントではなくプレーンクラスに切り出している理由)
        - BMLBrowser は DPlayer の `player.template.videoWrap` の中に動的に挿入した `div.dplayer-bml-browser` (映像より下のレイヤー) に生成する
        - **映像要素を BML ブラウザの中へ物理的に移動するのが肝**。`bmlBrowser.getVideoElement()` が返す要素へ DPlayer の `player.template.videoWrapAspect` を `appendChild` する。`load` と `invisible: false` で BML 内へ移動し、`invisible: true` と破棄時に DPlayer へ戻す
        - データ放送は 960×540 か 720×480 の固定サイズなので、`transform: scale()` と CSS カスタムプロパティ (`--bml-browser-scale-factor-width` / `-height`) で親のサイズに合わせる。720×480 のときは 16:9 へ矯正する倍率も掛ける。`ResizeObserver` で `videoWrap` を監視する。CSS は `client/src/App.vue` のグローバルスタイルに `.dplayer-bml-browser` として定義している (動的に挿入される要素のため scoped では効かない)。**背景色は指定しない** (BML 文書側が背景を持つため、塗ると映像に重ねて一部だけ表示するコンテンツで透過すべき領域が潰れる)
        - サーバから WebSocket で受け取ったメッセージは、そのまま `bmlBrowser.emitMessage(msg)` へ渡すだけ
        - **ARIB のデータ放送は起動直後 `invisible` (非表示) で、d ボタンを押して初めて表示される**。EPGStation では「データ放送を有効にする」操作自体が表示の意思表示なので、`load` 後に**最初の 1 回だけ自動で d (`AribKeyCode.DataButton`) を送る**
        - **双方向データ放送 (IP 通信) はサーバ側にプロキシ API が無いため無効化している** (`isIPConnected(): 0` / `getConnectionType(): 403`)。将来サーバ側を実装したら差し替えられるよう TODO コメントを残してある
        - `epg.tune` (データ放送からのチャンネル切り替え) は networkId + serviceId で EPGStation の channel を引いて視聴画面へ遷移する
        - `greg` (受信機の電源を切るまで持続するメモリ) は sessionStorage に 64 要素で保持する
        - `client/src/components/dataBroadcasting/DataBroadcastingRemote.vue` — リモコン UI (d / カラー 4 色 / 十字 / 決定 / 戻る / 数字)。web-bml の `AribKeyCode` を使い `bmlBrowser.content.processKeyDown/processKeyUp` へ送る。数字キーは BML が数字キーを使っているとき (`usedkeylistchanged` で判定) のみ有効
        - `client/src/components/dataBroadcasting/DataBroadcastingMenu.vue` — 3 点リーダーの ON/OFF。localStorage (`isEnableDataBroadcasting`、**既定 false**)
        - 組み込みは `client/src/components/video/BaseVideo.ts` が軸。`getDataBroadcastingParam()` (既定 `null`) を各 video コンポーネントが実装する。ライブ系は `channelId` から、録画系は `videoFileId` + シーク位置から作る
        - 録画の `seek` は `videoFile.size × (再生位置秒 / 総再生時間秒)` の概算バイト位置。**再生位置が大きく飛んだ (シークした) ときは Manager ごと作り直して WebSocket を張り直す**
        - BML 用フォントは `client/public/fonts/bml/` にコミットしてある (tsukumijima/web-bml 同梱の Kosugi / KosugiMaru)。Vite が `client/dist/fonts/bml/` へコピーする
    - **ビルド・設定**: 追加のビルド手順は無い。`npm run all-install` → `npm run build` (従来通り `build-server && build-client`) だけ。機能フラグ `featureFlags.dataBroadcasting` (opt-out、未指定は有効)。`config.yml` の `dataBroadcasting.maxStreams` (既定 4) で同時接続数の上限を変更できる
    - **検証済みのこと / 未検証のこと**
        - 実 Mirakurun のライブ TS (NHK 総合福島) を 40 秒流し、サーバ側の `decodeTS` が `moduleDownloaded` / `pmt` / `moduleListUpdated` / `pcr` / `esEventUpdated` / `bit` / `programInfo` を出すことを確認済み
        - そこで得た実データを `BMLBrowser` (EPGStation と同じオプション) へ流し込み、ヘッドレスブラウザで **NHK 福島のデータ放送が正しく描画されることをスクリーンショットで確認済み** (解像度 960×540 / profile A)。d ボタン送出前は `invisible: true`、送出後に描画される挙動も確認した
        - **EPGStation の実画面 (DPlayer と組み合わせた状態) での表示・映像プレーンの移動・拡大縮小の見た目は未検証**
        - 双方向データ放送 (IP 通信) は未対応
        - ワンセグ (profile C) など 16:9 以外の解像度での見た目は未検証
    - **テスト**: `test/ut/data-broadcasting-manage-model.test.js`、`test/ut/data-broadcasting-param-parser.test.js`

- **サーバー設定画面を中心に、スマホ・タブレットでの表示崩れを直した（レスポンシブ対応 フェーズ1）**
    - **背景**: 雲形などの一括編集テーブルやタブがデスクトップ幅固定で作られており、スマホ・タブレットで開くと列が折り重なる・横スクロールが発生する箇所が多しあった（視聴画面は別作業で対応済みのため今回の対象外）
    - **共通方針**: 各 Vue コンポーネントに `get isMobile(): boolean { return this.$vuetify.display.smAndDown; }` を追加し、優先度の低い列を `v-if="isMobile === false"` で非表示にし、その内容を主列（タイトル等）の下に `text-caption` でキャプション表示する方式に統一した（既存の `SeriesAnalyzeDialog.vue` のパターンを踏袖）
    - **録画一覧 / 予約一覧 / ルール一覧**: `RecordedTableItems.vue` / `ReservesTableItems.vue` / `RuleTableItems.vue` で、放送局・内容・除外キーワード・ジャンルなどの列をスマホで隠し、主列の下にキャプションとして表示するようにした（`RecordedTableItems.vue` は `time`/`menu` 列幅も 600px 以下で縮めている）
    - **シリーズ一覧 / シリーズ詳細**: `Series.vue` のコンパクト表示で出所・クール・未視聴・容量列を、`SeriesDetail.vue` の一括編集テーブルで放送局・放送日時列をそれぞれスマホで隠し、タイトル下のキャプションにまとめた（話数・放送種別列は幅を縮めて残している）
    - **サーバー設定 (`SystemSetting.vue`)**: `v-tabs` に `show-arrows` を付けてタブが横スクロールできるようにした上で、以下を対応させた
        - ログインユーザー一覧・通知失敗履歴は、スマホでは表の代わりにカード一覧（`v-card` 縦並び）で表示する
        - 作品辞書検索結果はクール・話数・外部 ID 列をスマホで隠して作品名下にまとめ、エイリアス辞書は学習元・登録日時列（`colgroup` も含む）をスマホで隠す
    - **対象外**: 視聴画面（`WatchOnAir.vue` / `WatchRecorded.vue` / `WatchRecordedStreaming.vue` / `components/watch/*`）は既にダーク・ライト両モード対応済みのため今回の変更に含めていない

- **番組表以外の画面でもダーク/ライト両モードで色が破綻していた箇所を直した（レスポンシブ対応 フェーズ2）**
    - **背景**: 視聴画面 (`WatchLayout.vue` 等) は既に CSS 変数でテーマ対応済みだった一方、他の画面にはライトモードやダークモードのどちら一方だけを前提にした固定色 (`rgba(0, 0, 0, 0.06)` や固定のグレー・黄色) が残っており、もう一方のテーマではコントラスト不足や色の浮きが発生していた
    - **ページネーション (`MobilePagination.vue`)**: 無効ボタンの固定グレー `rgb(167 167 167)` を、Vuetify の非活性不透明度変数 `rgba(var(--v-theme-on-surface), var(--v-disabled-opacity))` に置き換えた（ライトモードでのコントラスト不足を解消）
    - **更新パネル (`UpdatePanel.vue`)**: コミット ID ・更新ログの背景だった固定の `rgba(0, 0, 0, 0.06)` を `rgba(var(--v-theme-on-surface), 0.06)` にし、ダークモードで背景がほとんど見えなくなっていたのを直した
    - **予約カード・検索結果カード (`ReservesCard.vue` / `SearchResultCard.vue`)**: 衝突・スキップ・重複の背景色が番組表 (`Guide.vue`) と違いライトモード配色固定だったため、番組表と同じ `isDark` 判定を追加して、ダークモード時は同じダークパレット (`#f6c90e` / `#717171`) を使うようにした
    - **対象外としたもの**: ジャンル別の固定色や番組表のチップ文字色など、すでにライト/ダーク両方の定義を持つもの (`Guide.vue`の`.ctg-*`等) や、背景画像に重ねるオーバーレイのようにテーマと無関係であるべき色 (チェックボックス背景の白丸、モーダルの暗幕など) は意図してそのままにしている

- **設定項目の定義を一本化し、実効値の決まり方 (既定値 → config.yml → 画面) を出所ごとに表示できるようにした**
    - **背景**: 従来は `IConfigFile` の型定義、`ConfigOverlay` の GUI 編集可能キー一覧、画面側のフォームフィールド定義 (旧 `client/src/util/ConfigFormFields.ts`) の 3 箇所に項目定義が分散しており、追加漏れや表記ゆれの原因になっていた
    - **単一定義元 (`ConfigSchema`)**: `src/model/config/ConfigSchema.ts` の `CONFIG_SCHEMA` (84 エントリ) を唯一の定義元とし、キー・ラベル・型・GUI 編集可否・再起動要否・秘密情報フラグをここから導出するようにした。`ConfigOverlay.ts` の `CONFIG_OVERLAY_FIELDS` も手書き配列を廃止し、`CONFIG_SCHEMA` の `editable === 'gui'` エントリから生成するだけになった
    - **項目の分類は 3 種**: `editable: 'gui'` + `fields` あり (画面の汎用フォームで編集) / `editable: 'gui'` + `customEditor: true` (`recorded` / `encode` / `stream` の 3 件のみ、専用 Vue コンポーネントで編集) / `editable: 'ymlOnly'` (config.yml でのみ設定)。この 3 つのどれにも当てはまらない項目 (`gui` なのに `fields` も `customEditor` も無い、定義漏れ) は `ConfigFormPanel.vue` が画面上部に「分類未定義の項目 (要確認)」として警告表示する
    - **`ymlOnly` の理由は 2 系統**: `YML_ONLY_REASON_CATEGORY` が `'safety'` (`selfReference` = DB 接続設定の自己参照、`authLockout` = 認証のロックアウト。恒久的に GUI 化しない、`dbtype` / `sqlite` / `mysql` / `postgres` / `auth` の 5 件) と `'notImplemented'` (`notYetWired` / `shadowedByAppSetting`。単に GUI 未実装で将来変わりうる、`https` / `uid` / `gid` / `notifications` / `metadataChannelMappingPath` / `metadataSharedDataUrl` / `metadataSharedDataUpdateIntervalMs` / `seriesStartup` / `dataBroadcasting` / `metadataDefaults` / `seriesDefaults` / `importDirs` / `encodePresets` / `urlscheme` / `kodiHosts` の 15 件) に分ける。画面もこの 2 グループを別パネルに分けて表示する
    - **実効値の 3 層**: 設定値は **既定値 (`Configuration.DEFAULT_VALUE`) → config.yml → DB オーバーレイ (画面からの変更)** の順に重ねて決まる。`Configuration` の読み込みは `applyMainConfigString()` に一本化し、`formatConfig()` が成功したときにだけ実効値のキャッシュと config.yml の生値スナップショット (`rawFileConfig`) を同時に差し替える (途中で失敗しても両者が食い違わない)
    - **出所判定はサーバー側で確定**: `GET` の `EditableConfig` に `provenance` (path → `'default' | 'file' | 'overlay'`) というマップを追加した。以前検討していた `raw` / `defaults` を丸ごと返してクライアント側で出所を再判定する方式は採らず、判定ロジックはサーバー (`AppSettingApiModel`) 側に閉じている
    - **画面はスキーマ駆動で描画**: `ConfigFormPanel.vue` が `ConfigSchema` を元に項目を描画し、各項目にサーバーが返す `provenance` に基づく出所バッジ (既定値 / config.yml / 画面で変更) を表示するようにした。旧 `ConfigFormFields.ts` は削除した
    - **秘密情報のマスク**: `AppSettingApiModel.maskConfig()` が API 応答を再帰的にマスクする。対象は ①`ConfigSchema` の `fields[].secret === true` が付いた path (`seriesLlm.apiKey` 等) ②キー名ベースの汎用マスク (`token` / `apiKey` / `secret` / `password` / `clientSecret`、ネストの深さを問わない。`ymlOnly` で `fields` を持たない `auth` / `mysql` / `postgres` 等はこちらで拾う) ③`notifications.targets[].url` (Webhook URL は場所限定で秘密情報扱い)。伏せ字は `********`
    - **伏せ字の送り返し救済**: マスクされたまま (`********`) 保存要求が来た項目は「変更なし」とみなし、既存の秘密情報を上書きしない (`stripMaskedPlaceholders()`)
    - **同値の差分は保存しない**: 画面で編集して config.yml と同じ値に戻した項目は、保存時に leaf 単位で差分から取り除かれる (`pruneLeavesEqualToFileConfig()`)。配列項目は丸ごと単位で比較する。これにより「一度触っただけで永久に『画面で変更』と表示され続ける」ことがない
    - **ドキュメント**: `doc/conf-manual.md` に「設定の決まり方」章を追加し、3 層の重なり方と、GUI で変えられる/変えられない項目とその理由を説明した
    - **テンプレートの記載漏れを補完**: `ConfigSchema` にはあるが `config.yml.template` / `config-win.yml.template` に一切記載がなかった項目 (`socketioPort` / `apiServers` / `postgres` / 各種外部コマンド等) を、既存のコメントスタイルに合わせて両テンプレートにコメントアウト例として追記した
    - **スキーマ ⇄ テンプレートの同期テスト**: `test/ut/config-schema-template-sync.test.js` を追加し、`ConfigSchema` の全キー・全フィールドが両テンプレートに完全パス (`a.b.c` 形式まで復元して) 記載されていることを機械的に検証する。leaf 名だけの照合だと `seriesLlm.url` が `notifications.targets.url` に当たって誤合格する等の穴があったため、完全パスでの突合に加えてテンプレートにあってスキーマに無いキーの逆方向も検証し、定義追加漏れを CI で検知できるようにした
    - **`IConfigFile` との突合テスト**: `test/ut/config-schema-source-sync.test.js` を追加し、`IConfigFile` のトップレベルキーと `CONFIG_SCHEMA` の双方向一致、`CONFIG_OVERLAY_KEYS` と `gui` 集合の一致、`ymlOnly` エントリの `reason` 必須などを検証する
    - **テスト**: `test/ut/config-overlay.test.js` (既存拡張)、`test/ut/config-schema-template-sync.test.js`、`test/ut/config-schema-source-sync.test.js`、`test/ut/app-setting-api-model.test.js` (マスク対象・伏せ字の送り返し救済・同値差分の除去・出所判定を固定する)

- **本家 Mirakurun / mirakc など他の Mirakurun 互換実装にも接続できるようにした (従来は stuayu 版 Mirakurun 専用だった)**
    - **背景**: stuayu 版 Mirakurun は `Service.channel` を配列で返す (`lib/Mirakurun/ServiceItem.js` の `toItem()` が `this._channel[0].type` のように配列前提で実装している) が、同梱の `api.yml` (= `GET /api/docs` がそのまま返す OpenAPI 定義) は単数の `Channel` のままで実装と食い違っている。EPGStation 側もこれに合わせて `channel.channel[0]` を直読みしていたため、単一オブジェクトを返す本家 Mirakurun や mirakc には接続できなかった
    - **`ChannelDB` を配列・単一オブジェクトの両対応にした**: `src/model/db/ChannelDB.ts` に `createInsertValue()` を切り出し、`channel.channel` が配列でも単一オブジェクトでも受け付けるようにした (`Array.isArray()` で分岐し、単一オブジェクトの場合は型アサーション経由でそのまま使う)。あわせて挿入データ作成ループの try/catch を**ループ全体からサービス 1 件単位へ**移した。以前は 1 件の変換失敗で以降のサービスすべてが未登録のまま処理が続いていたが、失敗したサービスだけを skip し、失敗件数と対象をまとめて error ログへ出すようにした
    - **npm `mirakurun` クライアントは呼び出しのたびに `GET {basePath}/docs` を取得して operationId を解決する**という仕組みがあり (`node_modules/mirakurun/lib/client.js`)、`/docs` を提供しない、または Mirakurun と互換性の無い内容を返すサーバーに接続すると、`getStatus()` を含む全 API 呼び出しが `operationId "..." is not found.` という原因の分かりにくいエラーで失敗していた。`src/model/ConnectionCheckModel.ts` の疎通確認 (`checkMirakurun()`) がこのエラーパターン、または docs エンドポイント自体が無いと判断できる 404 / 501 を検出した場合、`getDocs()` を明示的に呼び直して「docs 自体が取得できないのか」「docs は取得できたが内容が Mirakurun と一致しないのか」を切り分け、warn ログに出すようにした
    - **`EPGUpdateManageModel.checkTunerServerType()` の判定を刷新**: `getServerConfig()` の失敗を一律 mirakc 扱いにしていたのをやめ、`operationId ... is not found` / 404 / 501 (エンドポイントが無いと判断できる応答) は「非互換」として mirakc 判定しキャッシュする一方、接続不能・5xx・不明なエラーは「一時的な失敗」としてキャッシュせず次回呼び出しで再判定するようにした。判定結果と根拠は info / warn ログに出す
    - **`tunerServerType` 設定を新設**: `config.yml` に `tunerServerType` (`mirakurun` / `mirakc` / `auto`、既定は未指定 = `auto`) を追加した。明示指定時は `getServerConfig()` を呼ばずに種別を確定する。互換実装の検証時などに自動判定を迂回して固定したい場合に使う。`IConfigFile.ts` / `ConfigSchema.ts` (GUI 編集可) / `config.yml.template` / `config-win.yml.template` / `doc/conf-manual.md` に反映済み
    - **実起動での疎通確認はまだ行われていない** (静的解析とユニットテストのみ)。本家 Mirakurun / mirakc への接続可否は今後の実機検証で確認する
    - **テスト**: `test/ut/channel-db.test.js` (配列・単一オブジェクト両方の変換、1 件失敗時に以降が処理されること)、`test/ut/tuner-server-type.test.js` (`tunerServerType` 明示指定・404/501 判定・一時的失敗の非キャッシュ)、`test/ut/connection-check-docs-hint.test.js` (docs 取得可否の切り分けログ)

- **DB 層 (`src/model/db/`) で例外を握り潰していた箇所にログを追加し、不具合調査を追いやすくした**
    - **背景**: DB 層の catch 節の多くが「メッセージだけ出してエラー本体を出さない」「エラーを完全に握り潰して既定値を返す」ままで、DB 障害発生時に原因追跡が困難だった。挙動は変えず、ログの追加のみを行った
    - **完全な握り潰し (A) を修正**: `SeriesDB.parsePendingCandidates()` は壊れた `candidatesJson` を空配列へフォールバックする際に何もログを出していなかった。静的メソッドでインスタンスのロガーを持たないため `console.error` に出すようにし、呼び出し元が分かる場合に識別情報を付けられるよう任意の `context` 引数を追加した (省略可、既存呼び出しは無変更で動く)。**その後、この `console.error` 自体が log4js を経由しない問題そのものだったため、インスタンスメソッドに変更して `this.log.system.error()` を使うようにした** (`ISeriesDB` にも追加)。唯一の呼び出し元 `SeriesPendingApiModel.list()` は `SeriesDB.parsePendingCandidates(...)` (static import) から `this.seriesDB.parsePendingCandidates(x.candidatesJson, \`recordedId=${x.recordedId}\`)`へ変更し、識別情報として`recordedId` を渡すようにした。パース失敗時に空配列で継続する挙動は変えていない
    - **情報欠落 (B) を修正**: `DBOperator.setSQLiteExtensions()` の 2 箇所 (拡張読み込みチェック失敗時 / 拡張読み込み失敗時) はメッセージのみでエラー本体を出していなかったため `this.log.system.error(error)` を追加した。`ChannelAffiliationDB.replace()` はロガーを一切持たずエラーを完全に上位へ委ねていたため、`ILoggerModel` を注入して `networkId` とエラー本体をログしてから rethrow するようにした
    - **`restore()` 系メソッドの `console.error` を構造化ログへ置き換え**: `DropLogFileDB` / `RecordedHistoryDB` / `ReserveDB` / `RecordedDB` / `ThumbnailDB` / `RecordedTagDB` / `RuleDB` / `VideoFileDB` の `restore()` (バックアップ復元、delete → insert をトランザクションで行い失敗時は rollback + throw) は、失敗時に `console.error(err)` だけ出して `log4js` の設定 (ログファイル出力) を経由していなかった。全クラスに `ILoggerModel` を注入し、`this.log.system.error()` でクラス名・対象件数・エラー本体を出すようにした。`SeriesDB` の `restoreSeries` / `restoreEpisodes` / `restoreLinks` / `restoreAliases` / `restorePendingMatches` / `restoreHistories` (エラーをそのまま rethrow するだけでログ無し) にも同様にログを追加した。`ReserveDB.updateMany()` は対象の delete/insert/update id をログに含めるようにした
    - **DI コンストラクタ変更**: 上記クラスはいずれもコンストラクタ末尾に `@inject('ILoggerModel') logger: ILoggerModel` を追加しただけで、`ModelContainerSetter.ts` の登録 (`.to(Class)`) は変更不要 (inversify がデコレータから解決するため)。`test/ita/recorded-tag-hierarchy.test.js` が `RecordedTagDB` を位置引数で組み立てていたため、ロガースタブを追加した
    - **見つけたが直していない箇所 (報告のみ)**: 同様に `restore()` 系の rethrow は既存の呼び出し元 (`DBTools.ts`) で `dropLogFileDB.restore()` 以外は `.catch()` されておらず、失敗時は未処理の rejection になる。これも挙動変更 (エラーハンドリング追加) にあたるため今回は対象外とした
    - **`ChannelDB.insert()` の死んだコードを修正**: `hasError` はトランザクションエラー時も `true` に更新されない**定数**になっており、121-123 行の `if (hasError) throw` は永遠に到達しない死んだコードだった。**個々のレコード (1 サービス単位) の挿入/更新/削除失敗は従来どおりログを出して次のレコードへ進む** (EPG 更新は一部の放送局が登録できなくても続行したいため) が、**トランザクション自体が失敗した場合 (`catch (transactionErr)` に到達した場合) は rollback してエラーログを出したうえで `insert()` が reject するようにした** (`hasError` 変数は削除し、`catch` 節から `throw transactionErr` するだけに整理)。呼び出し元は `EPGUpdateManageModel.updateChannels()` の `this.channelDB.insert(services).catch(...)` (rethrow 済み) と `saveService()` 内の `this.channelDB.update()` (内部で `insert()` を呼ぶだけ、こちらは `.catch()` していない) の 2 箇所のみで、後者を呼ぶ `saveService()` 自体は唯一の呼び出し元 `EPGUpdater.ts` の `updateMirakurunEventStream()` が `.catch()` して rethrow しているため、未処理の rejection にはならない
    - **テスト**: `test/ut/db-error-logging.test.js` を追加。`DropLogFileDB` / `RecordedHistoryDB` / `ThumbnailDB` / `ChannelAffiliationDB` / `SeriesDB` の `restore()` 系メソッドが失敗時にロガーへエラー本体を渡すこと、rollback すること、例外を rethrow することを固定した (`RecordedDB` / `ReserveDB` / `RuleDB` / `RecordedTagDB` / `VideoFileDB` も同じ修正を行ったが、行数の大きいクラスを新たに `require()` すると行カバレッジ計測の対象に加わり大量の未テストメソッド分だけ全体の行カバレッジ率を押し下げてしまうため、テストは代表的な小さいクラスに絞った)
    - **上記フォローアップ分のテスト**: `test/ut/series-db.test.js` の `parsePendingCandidates` テストをインスタンスメソッド呼び出しへ更新し、ロガーの `error` が呼ばれることを追加で検証。`test/ut/db-error-logging.test.js` にも同様の固定テストがある (こちらは `SeriesDB.parsePendingCandidates` 名のまま、識別情報 `context` がログに含まれることを検証)。`test/ut/channel-db.test.js` に「個々のレコード (insert/update/delete いずれも) が失敗しても他のレコードは登録され `insert()` は成功で返る」「トランザクション自体が失敗 (`commitTransaction` が reject) した場合は rollback してログを出し `insert()` が reject する」の 2 件を追加した

- **シリーズの欠番検出と放送種別 (初回 / 再放送 / 遅れ放送) の判定に外部システムのデータを使うようにした**
    - **背景 1 (欠番)**: シリーズ詳細の「欠番: …」表示とシリーズ一覧の欠番バッジは `series.totalEpisodes` (DB の値) だけを見ていた。辞書同期前に作られたシリーズではこの列が `null` のままで、その場合は「観測済みの最大話数まで」しか欠番検出の対象にならず、**最終話側の録り逃しが一切出なかった**。さらにシリーズ詳細の欠番一覧 (`SeriesDetail.continuity`) は `analyzeSeriesContinuity()` をオプション無しで呼んでおり、同じ画面のバッジ (総話数・放送ペース補正あり) と結果が食い違っていた
    - **修正 1**: 総話数の解決を `ISeriesTotalEpisodes` / `SeriesTotalEpisodes` (`src/model/series/`) に切り出した。優先順位は **`series.totalEpisodes` (画面から手動設定できる) → しょぼいカレンダー作品辞書 (`syobocal_title.totalEpisodes`) → Annict (`annict_work.episodesCount`)**。参照するのはローカルに同期済みのテーブルだけなので外部への HTTP は発生せず、一覧のような件数の多い経路からも呼べる (辞書引きの結果は 10 分キャッシュ)
        - `SeriesApiModel.list()` は `resolveMany()` でページ分をまとめて解決し、`get()` はバッジ用と画面表示用の欠番一覧の**両方**に同じ `totalEpisodesBySeason` と `now` を渡すようにした (放送ペース補正も詳細画面に効くようになった)
        - `MissingEpisodeApiModel.externalTotals()` も同じモデルを使うよう置き換え、外部 API への問い合わせはローカル辞書で分からなかった場合だけにした
        - メタデータ側がシーズン区分を持たない制約は従来どおりで、総話数は season 1 にのみ適用する
    - **背景 2 (放送種別)**: `airType` は「録画タイトルの `(再)` 等の表記 → 同じ回のリンクが DB に既にあるか」の順で決めており、**しょぼいカレンダーの放送予定が持つ再放送情報を全く見ていなかった**。局が `(再)` を送出しない再放送は、ライブラリにその回が無ければ `first` (初回放送) と誤ラベルされていた。遅れ放送の判定も「タイトルからもサブタイトル逆引きからも話数が取れなかった場合」にしか走らず、話数表記のある県域局の録画は遅れ放送として扱われなかった
    - **修正 2**: `ProgItem.Flag` を取り込み、放送予定を放送種別の判定に最優先で使うようにした
        - `Flag` はビットフラグで **1 = 注目 / 2 = 新番組 (初回) / 4 = 最終回 / 8 = 再放送**。実 API の応答 (ProgLookup) で確認した値で、`SyobocalProgramMatch` に `isRerun` / `isFirstEpisode` / `isFinalEpisode` として持たせる
        - 判定順は `SeriesResolver.decideAirType()` に集約した。**① 放送予定が再放送として編成している回 → `rerun` ② キー局を遡って対応付けた回 → `delayed` ③ 放送予定は引けたが再放送フラグが無い → `first`** (ただしタイトルに `(再)` 等の明示があるときは `rerun` を残す。しょぼいカレンダー側のフラグ付け漏れで初回放送に倒さないため) ④ 放送予定が引けない場合のみ従来どおりタイトル表記 → ローカル DB の重複判定
        - 遅れ放送の照会 (`lookupDelayed()`) は **話数が既に取れている録画でも引く**ようにした (話数の有無で打ち切ると、話数表記のある県域局の録画が初回放送に化けるため)。その代わり、**キー局側の話数がタイトルから読み取れている話数と食い違う場合はその照会結果を採らない** (特番による飛び・遅れ週数のずれで別の回を指している可能性が高いため、話数もサブタイトルも放送種別も採用しない)。照会先はその局自身の放送予定が引けなかった場合 (`viaKeyStation`) のみで、結果は日単位でキャッシュされるので外部への問い合わせはほとんど増えない
    - **テスト**: `test/ut/syobocal-program-lookup.test.js` に `Flag` のビット解釈、`test/ut/series-resolver.test.js` に「放送予定が再放送と言えば `rerun`」「再放送でなければ `first`」「フラグが無くてもタイトルの `(再)` は残す」「話数既知でも遅れ放送を照会する」「キー局の話数が食い違えば採らない」、`test/ut/series-api-model.test.js` に「外部辞書の総話数まで欠番を出す (一覧・詳細の両方)」、`test/ita/missing-episode-api.test.js` に「総話数が分かれば末尾側の欠番も提案する」を追加した
    - **DI コンストラクタ変更**: `SeriesApiModel` は末尾に `ISeriesTotalEpisodes` を追加、`MissingEpisodeApiModel` は末尾の `ISyobocalTitleDB` を `ISeriesTotalEpisodes` へ置き換えた (`ModelContainerSetter.ts` に `ISeriesTotalEpisodes` を登録済み)

- **シリーズ単位で「録画をまとめて再問い合わせ」できるようにした (シリーズ詳細の 1 件 / シリーズ一覧の複数選択)**
    - **背景**: 判定ロジックや外部辞書の内容が変わっても、既に紐づけ済みの録画は再判定する手段が「録画 1 件ずつの `POST /api/series/analyze/{recordedId}`」か「全件バックフィル」しか無く、あるシリーズだけ話数・放送種別を付け直すことができなかった
    - **API**: `POST /api/series/reanalyze` (body: `{ seriesIds: number[] (1〜100), refreshMetadata?: boolean }`) を追加した。処理は 2 段で、① `SeriesMetadataFiller.fill({ seriesIds, force: true })` でシリーズ側のメタデータ (表示名・クール・読み仮名・総話数・外部 ID・作品コメント) を辞書から引き直し (`refreshMetadata: false` で省略可)、② 続けてそのシリーズにリンク済みの録画をバックフィルにかけ直す。応答は `{ seriesCount, metadata, backfill }` で、録画側はバックグラウンドで進むため進捗は `GET /api/series/backfill/status` で追う
    - **バックフィルのシリーズ絞り込み**: `SeriesBackfillOption` / `SeriesBackfillFilter` に `seriesIds` を追加し、`RecordedDB.createSeriesBackfillQuery()` が `recorded.id IN (SELECT link.recordedId FROM recorded_series_link link WHERE link.seriesId IN (...))` で絞る。**`latest` と同じく一時的な部分実行として扱い、全件バックフィルの再開カーソル (`lastRecordedId`) は書き換えない**。進捗には対象シリーズ数 (`seriesCount`) を載せ、サーバー設定 > シリーズ管理タブにも「シリーズ N 件を対象にした再解析」として出る
    - **手動確定は壊さない**: 録画側の再判定は通常のバックフィルと同じ経路なので、`manualLock` 済みの録画はスキップされる。シリーズ側も手動設定した表示名・クール・コメント (`titleSource` / `seasonSource` / `commentSource` が `manual`) は `force` でも上書きしない
    - **UI**: シリーズ詳細に「録画を再問い合わせ」ボタン、シリーズ一覧の選択モードのツールバーに「再解析」ボタンを追加した (どちらも確認ダイアログで対象と「メタデータも引き直すか」を示す)。シリーズ詳細は対象が 1 シリーズで短時間に終わるため、実行後にバックフィルの進捗を 2 秒間隔で最大 2 分見に行き、完了したら画面を再読み込みして結果 (処理件数・更新件数) を出す
    - **テスト**: `test/ut/series-maintenance-api.test.js` に reanalyze の 4 件 (メタデータ再取得 + バックフィル開始、メタデータ省略、空リスト・不明 id の拒否、機能フラグ)、`test/ut/series-backfill-manage-model.test.js` に「`seriesIds` 指定は該当シリーズの録画だけを処理し永続カーソルを動かさない」、`test/ut/series-backfill-api-model.test.js` に `seriesIds` の受け渡しを追加した。DB クエリ自体 (`createSeriesBackfillQuery`) は他の絞り込み条件と同様に単体テスト対象外で、生成される SQL を TypeORM のクエリビルダで実地確認した

- **新4K8K衛星放送 (BS4K / CS4K) に対応した**
    - **前提**: 新4K8K衛星放送 (ISDB-S3) は MPEG-2 TS ではなく **MMT/TLV** で送出されるため、Mirakurun / EPGStation では扱えない。本フォークでは **フロントエンド ([dantto4k](https://github.com/nekohkr/dantto4k) / `BonDriver_dantto4k`) が MMT/TLV を MPEG-2 TS へ変換したストリーム**を受け取る方式を採る。変換後は SDT / EIT / PMT / 字幕 (ARIB B24) がすべて通常の TS と同じ形で載るため、EPG 取得・予約・録画・字幕は既存経路がそのまま使える (映像は HEVC、音声は MPEG-4 AAC になる)
    - **Mirakurun 側 (`stuayu/Mirakurun`)**
        - `ChannelType` に `BS4K` / `CS4K` を追加 (`api.yml` / `api.d.ts` / `common.ts` の `channelTypes` / `Service.ts` の `channelOrder` / `ServiceItem.getOrder()`)。並び順は既存の値を動かさないよう末尾 (BS4K = 45 / CS4K = 46) に置いた
        - チャンネルスキャン (`/api/config/channels/scan`) に `BS4K` / `CS4K` を追加した。既定のチャンネル名は `BS4K{ch00}_{subch}` (ch 1〜23 / subch 0〜3) と `CS4K{ch}` (ch 2〜24) だが、**チャンネル識別子はチューナーコマンド (BonDriver 等) のチャンネル空間に依存する**ため `channelNameFormat` で上書きできる
        - **サービススキャンのタイムアウトを設定可能にした** (`server.yml` の `serviceScanTimeout` / 環境変数 `SERVICE_SCAN_TIMEOUT`)。MMT/TLV → TS の変換は選局に 15〜20 秒かかることがあり、従来の固定 20 秒ではスキャンが空振りするため、**`BS4K` / `CS4K` のときは既定を 40 秒**にした (設定した場合はチャンネル種別によらずその値を使う)
        - EPG 側は元から `stream_content = 9 (h.265)` と `component_type = 0x91〜0x94 (2160p)` / `0x83 (4320p)` を解釈できるため変更不要
        - テスト: `test/scan.spec.js` に `BS4K` / `CS4K` のスキャン設定生成 (既定値・範囲指定・`channelNameFormat` 上書き) を追加
    - **EPGStation 側**
        - `ChannelType` に `BS4K` / `CS4K` を追加し、**放送波を 1 種別 1 フラグで扱っている箇所をすべて展開した**: `api.yml` (`ChannelType` enum・`RuleSearchOption`・`BroadcastStatus`・`requiredBS4K` / `requiredCS4K` パラメータ)、`api.d.ts`、`ProgramDB.setChannelQuery()`、`ChannelDB.getChannelTypeId()` (BS4K = 44 / CS4K = 45、既定値は 46 へ繰り下げ)、`RuleDB`、`ScheduleApiModel.getSchedules()`、`IPTVApiModel`、`schedules.ts`、`ReserveOptionChecker`、`ReservationManageModel.broadcastStatus`、クライアント側の `GuideState.BROADCAST_TYPES` / `OnAirState` / `NavigationState` / `SearchState` / `ISearchState` / `SearchOption.vue`
        - **DB**: ルール検索の放送波に `rule.BS4K` / `rule.CS4K` を追加した (マイグレーションは sqlite / mysql の両方。既存ルールは `false` のままなので挙動は変わらない)
        - **エンコードプリセット**: `EncodeQuality` に `2160p` を追加した (`height: 2160` / 映像 15000kbps / 音声 256kbps)。H.264 の 4K は Level 5.1 以上が要るため `h264Level()` に `2160 → 5.2` を足した。**ビットレートは HEVC 前提の値**なので `encodePresets` では `codecs: [hevc]` と組み合わせて使う
        - 放送波タブ (番組表・放映中・グローバルナビゲーション) は `Mirakurun のチューナー types` から自動生成されるため、`tuners.yml` に `BS4K` / `CS4K` のチューナーを書けば UI にも出る
        - テスト: `test/ut/encode-presets.test.js` に 2160p プリセットの生成 (H.264 の `-level 5.2` 含む)、`test/ita/rule-4k-broadcast-migration.test.js` に rule テーブルへの `BS4K` / `CS4K` 追加とロールバックを追加
    - **注意点**
        - 映像が HEVC になるため、**ブラウザでの再生はクライアント側の HEVC 対応に依存する**。Safari は HLS + HEVC をネイティブ再生できるが、Chrome / Firefox で mpegts.js の低遅延ライブを使う場合は HEVC 対応版が要る。確実に再生したい場合は `encodePresets` で H.264 へエンコードして配信する
        - 録画ファイル自体は変換後の TS をそのまま保存するので、録画・取り込み・TS 解析 (`TsInfoAnalyzer`) は従来どおり動く
        - 本フォークの `package.json` は Mirakurun をタグで固定しているため、**この 4K 対応を使うには `stuayu/Mirakurun` 側の新しいタグを切って `package.json` の参照タグを差し替える必要がある** (ブランチ参照は lockfile が壊れるため禁止)

- **再生開始時の Playback API とポリシー解決を追加した**
    - `/api/streams/live/{channelId}/playback-options` と `/api/videos/{videoFileId}/playback-options` で、入力映像・端末能力に応じた利用可能プロファイルと推奨を返すようにした
    - `PlaybackPolicyResolver` は再エンコード不要な場合に `video-copy` / `direct-play` を優先し、HDR 非対応端末では SDR 系へ自動 fallback する。fallbackChain は最大 3 件
    - 既存のストリーム cmd、録画後エンコード、client は変更していない
    - テスト: `test/ut/playback-policy-resolver.test.js`

- **Phase 8/9 のクライアント画質選択 UI 基盤を追加した**
    - `PlaybackQualitySheet` / `PlaybackQualityList` / `PlaybackQualityItem` を追加し、開始時選択と再生中メニューで同じ画質リストを使えるようにした
    - デスクトップの dialog/menu とモバイルの Bottom Sheet、safe area、44px タップ領域、`70svh` 上限、`.menu-card` / `.menu-card-body` を実装した
    - `ClientCapabilityUtil` は MediaCapabilities、canPlayType、dynamic-range を使い、HEVC Main10 (`hvc1.2.4.L153.B0`) を iOS 固定判定せず TTL キャッシュする
    - `PlaybackLabelUtil` で通常表示の技術用語を隠し、`PlaybackOptionsState` と Phase 7 Playback API クライアントで選択状態を保存する
    - 既存の type + mode 導線と BaseVideo の切替経路は互換維持のため変更していない

- **Playback API の fallbackChain をクライアントへ接続した**
    - playback-options API が `PlaybackPolicyResolver` の `recommended.fallbackChain` を返すようにし、クライアントは Resolver の順序 (同系統の軽量 → SDR 版 → H.264 互換) を優先して最大 3 回まで再試行する
    - 旧 API 応答では利用可能 profile 順へ fallback する保険を残した

- **Playback API の画質表示を品質バケット順へ統一した**
    - `recommended.label` を解決済みプリセットのバケット名へ揃え、`profiles` は「自動・おすすめ」を先頭に高画質順で表示する
    - プリセット ID、cmd、実際の選択・配信経路、通常表示/折り畳みの件数は変更していない
