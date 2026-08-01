export interface SyobocalChannelMapEntry {
    // しょぼいカレンダーのチャンネル ID (ChID)
    chId: number;
    // Mirakurun の networkId
    networkId: number;
    // Mirakurun の serviceId
    serviceId: number;
    // false の場合はしょぼいカレンダーに ProgLookup 用の放送データが登録されていない局
    // (§5.4 未登録局フラグ)。この場合 ProgLookup を最初からスキップし、正規化マッチへ直行する
    syobocal: boolean;
}

/**
 * しょぼいカレンダー ChID ⇄ Mirakurun networkId/serviceId の同梱初期データ。
 *
 * ChID は しょぼいカレンダーの ChLookup (https://cal.syoboi.jp/db.php?Command=ChLookup) の実データ、
 * networkId / serviceId は各放送事業者に全国一意で割り当てられた値。どちらも実データから起こしている
 * ため、環境を問わずそのまま使える (地上波の networkId は地域ごとに異なるので、県域局は
 * その局の値をそのまま持つ)。
 *
 * 収録対象は「しょぼいカレンダーに ChID があり、かつ放送予定が登録されている局」に限る。
 * しょぼいカレンダー未登録の県域局 (福島中央テレビなど) は意図的に載せない。これらは
 * SyobocalProgramLookup が系列 (BIT) のキー局の放送予定で代用する。
 *
 * 運用者は `metadataChannelMappingPath` (config.yml)・共有静的データ・設定画面から
 * この一覧を上書き/追加できる (SyobocalChannelMap 参照)
 */
const SYOBOCAL_CHANNEL_MAP_DATA: readonly SyobocalChannelMapEntry[] = [
    // --- 地上波 (関東広域・キー局) ---
    // NHK総合・東京
    { chId: 1, networkId: 32736, serviceId: 1024, syobocal: true },
    // NHK Eテレ・東京
    { chId: 2, networkId: 32737, serviceId: 1032, syobocal: true },
    // 日本テレビ
    { chId: 4, networkId: 32738, serviceId: 1040, syobocal: true },
    // TBS
    { chId: 5, networkId: 32739, serviceId: 1048, syobocal: true },
    // フジテレビ
    { chId: 3, networkId: 32740, serviceId: 1056, syobocal: true },
    // テレビ朝日
    { chId: 6, networkId: 32741, serviceId: 1064, syobocal: true },
    // テレビ東京
    { chId: 7, networkId: 32742, serviceId: 1072, syobocal: true },
    // --- 地上波 (関東独立局) ---
    // tvk
    { chId: 8, networkId: 32375, serviceId: 24632, syobocal: true },
    // チバテレビ
    { chId: 13, networkId: 32327, serviceId: 27704, syobocal: true },
    // テレ玉
    { chId: 14, networkId: 32295, serviceId: 29752, syobocal: true },
    // TOKYO MX
    { chId: 19, networkId: 32391, serviceId: 23608, syobocal: true },
    // TOKYO MX2
    { chId: 187, networkId: 32391, serviceId: 23610, syobocal: true },
    // 群馬テレビ
    { chId: 72, networkId: 32359, serviceId: 25656, syobocal: true },
    // --- 地上波 (近畿) ---
    // MBS毎日放送
    { chId: 48, networkId: 32722, serviceId: 2064, syobocal: true },
    // ABCテレビ
    { chId: 67, networkId: 32723, serviceId: 2072, syobocal: true },
    // 関西テレビ
    { chId: 70, networkId: 32724, serviceId: 2080, syobocal: true },
    // 読売テレビ
    { chId: 54, networkId: 32725, serviceId: 2088, syobocal: true },
    // KBS京都
    { chId: 66, networkId: 32102, serviceId: 42032, syobocal: true },
    // BBCびわ湖放送
    { chId: 87, networkId: 32038, serviceId: 46128, syobocal: true },
    // --- 地上波 (中京・静岡) ---
    // 東海テレビ
    { chId: 77, networkId: 32706, serviceId: 3088, syobocal: true },
    // CBCテレビ
    { chId: 79, networkId: 32707, serviceId: 3096, syobocal: true },
    // メ〜テレ
    { chId: 81, networkId: 32708, serviceId: 3104, syobocal: true },
    // 中京テレビ
    { chId: 80, networkId: 32709, serviceId: 3112, syobocal: true },
    // テレビ愛知
    { chId: 59, networkId: 32230, serviceId: 33840, syobocal: true },
    // 三重テレビ
    { chId: 82, networkId: 32150, serviceId: 38960, syobocal: true },
    // SBSテレビ
    { chId: 113, networkId: 32194, serviceId: 35856, syobocal: true },
    // テレビ静岡
    { chId: 141, networkId: 32195, serviceId: 35864, syobocal: true },
    // だいいちテレビ
    { chId: 154, networkId: 32196, serviceId: 35872, syobocal: true },
    // 静岡朝日テレビ
    { chId: 155, networkId: 32197, serviceId: 35880, syobocal: true },
    // --- 地上波 (北海道) ---
    // HBC北海道放送
    { chId: 89, networkId: 32690, serviceId: 4112, syobocal: true },
    // STV札幌テレビ
    { chId: 92, networkId: 32691, serviceId: 4120, syobocal: true },
    // HTB北海道テレビ
    { chId: 88, networkId: 32692, serviceId: 4128, syobocal: true },
    // UHB北海道文化放送
    { chId: 91, networkId: 32693, serviceId: 4136, syobocal: true },
    // TVhテレビ北海道
    { chId: 90, networkId: 32694, serviceId: 4144, syobocal: true },
    // --- 地上波 (東北) ---
    // 東北放送
    { chId: 98, networkId: 32482, serviceId: 17424, syobocal: true },
    // 仙台放送
    { chId: 231, networkId: 32483, serviceId: 17432, syobocal: true },
    // ミヤギテレビ
    { chId: 232, networkId: 32484, serviceId: 17440, syobocal: true },
    // 東日本放送
    { chId: 255, networkId: 32485, serviceId: 17448, syobocal: true },
    // 青森放送
    { chId: 198, networkId: 32402, serviceId: 22544, syobocal: true },
    // 青森テレビ
    { chId: 200, networkId: 32403, serviceId: 22552, syobocal: true },
    // 青森朝日放送
    { chId: 199, networkId: 32404, serviceId: 22560, syobocal: true },
    // --- 地上波 (甲信越) ---
    // テレビ信州
    { chId: 111, networkId: 32274, serviceId: 30736, syobocal: true },
    // 長野朝日放送
    { chId: 237, networkId: 32275, serviceId: 30744, syobocal: true },
    // 信越放送
    { chId: 253, networkId: 32276, serviceId: 30752, syobocal: true },
    // 長野放送
    { chId: 236, networkId: 32277, serviceId: 30760, syobocal: true },
    // BSN
    { chId: 206, networkId: 32258, serviceId: 31760, syobocal: true },
    // NST
    { chId: 209, networkId: 32259, serviceId: 31768, syobocal: true },
    // TeNY
    { chId: 207, networkId: 32260, serviceId: 31776, syobocal: true },
    // 新潟テレビ21
    { chId: 208, networkId: 32261, serviceId: 31784, syobocal: true },
    // --- 地上波 (中国・四国) ---
    // 中国放送
    { chId: 102, networkId: 32018, serviceId: 47120, syobocal: true },
    // 広島テレビ
    { chId: 103, networkId: 32019, serviceId: 47128, syobocal: true },
    // 広島ホームテレビ
    { chId: 99, networkId: 32020, serviceId: 47136, syobocal: true },
    // テレビ新広島
    { chId: 60, networkId: 32021, serviceId: 47144, syobocal: true },
    // 瀬戸内海放送
    { chId: 123, networkId: 32675, serviceId: 5144, syobocal: true },
    // テレビせとうち
    { chId: 95, networkId: 32677, serviceId: 5160, syobocal: true },
    // 岡山放送
    { chId: 104, networkId: 32678, serviceId: 5168, syobocal: true },
    // 南海放送
    { chId: 114, networkId: 31938, serviceId: 52240, syobocal: true },
    // 愛媛朝日テレビ
    { chId: 117, networkId: 31939, serviceId: 52248, syobocal: true },
    // あいテレビ
    { chId: 116, networkId: 31940, serviceId: 52256, syobocal: true },
    // テレビ愛媛
    { chId: 115, networkId: 31941, serviceId: 52264, syobocal: true },
    // --- 地上波 (九州) ---
    // 九州朝日放送
    { chId: 138, networkId: 31874, serviceId: 56336, syobocal: true },
    // RKB毎日放送
    { chId: 94, networkId: 31875, serviceId: 56344, syobocal: true },
    // 福岡放送
    { chId: 96, networkId: 31876, serviceId: 56352, syobocal: true },
    // TVQ九州放送
    { chId: 93, networkId: 31877, serviceId: 56360, syobocal: true },
    // テレビ西日本
    { chId: 144, networkId: 31878, serviceId: 56368, syobocal: true },
    // 熊本放送
    { chId: 142, networkId: 31858, serviceId: 57360, syobocal: true },
    // サガテレビ
    { chId: 145, networkId: 31778, serviceId: 62480, syobocal: true },
    // 長崎放送
    { chId: 168, networkId: 31842, serviceId: 58384, syobocal: true },
    // テレビ長崎
    { chId: 170, networkId: 31843, serviceId: 58392, syobocal: true },
    // 長崎文化放送
    { chId: 169, networkId: 31844, serviceId: 58400, syobocal: true },
    // 長崎国際テレビ
    { chId: 171, networkId: 31845, serviceId: 58408, syobocal: true },
    // --- BS ---
    // NHK BS
    { chId: 179, networkId: 4, serviceId: 101, syobocal: true },
    // BS日テレ
    { chId: 71, networkId: 4, serviceId: 141, syobocal: true },
    // BS朝日
    { chId: 18, networkId: 4, serviceId: 151, syobocal: true },
    // BS-TBS
    { chId: 16, networkId: 4, serviceId: 161, syobocal: true },
    // BSテレ東
    { chId: 15, networkId: 4, serviceId: 171, syobocal: true },
    // BSフジ
    { chId: 17, networkId: 4, serviceId: 181, syobocal: true },
    // BSフジ・182
    { chId: 288, networkId: 4, serviceId: 182, syobocal: true },
    // WOWOWプライム
    { chId: 204, networkId: 4, serviceId: 191, syobocal: true },
    // WOWOWライブ
    { chId: 97, networkId: 4, serviceId: 192, syobocal: true },
    // WOWOWシネマ
    { chId: 76, networkId: 4, serviceId: 193, syobocal: true },
    // BS10
    { chId: 285, networkId: 4, serviceId: 200, syobocal: true },
    // BS11イレブン
    { chId: 128, networkId: 4, serviceId: 211, syobocal: true },
    // BS12トゥエルビ
    { chId: 129, networkId: 4, serviceId: 222, syobocal: true },
    // BSアニマックス
    { chId: 197, networkId: 4, serviceId: 236, syobocal: true },
    // J SPORTS 1
    { chId: 258, networkId: 4, serviceId: 242, syobocal: true },
    // J SPORTS 2
    { chId: 259, networkId: 4, serviceId: 243, syobocal: true },
    // J SPORTS 3
    { chId: 260, networkId: 4, serviceId: 244, syobocal: true },
    // J SPORTS 4
    { chId: 261, networkId: 4, serviceId: 245, syobocal: true },
    // WOWOWプラス
    { chId: 251, networkId: 4, serviceId: 252, syobocal: true },
    // 日本映画専門チャンネル
    { chId: 40, networkId: 4, serviceId: 255, syobocal: true },
    // BSよしもと
    { chId: 272, networkId: 4, serviceId: 265, syobocal: true },
    // NHK BSプレミアム4K
    { chId: 283, networkId: 11, serviceId: 101, syobocal: true },
    // --- CS (110 度) ---
    // 東映チャンネル
    { chId: 39, networkId: 6, serviceId: 218, syobocal: true },
    // 衛星劇場
    { chId: 220, networkId: 6, serviceId: 219, syobocal: true },
    // TBSチャンネル1
    { chId: 52, networkId: 6, serviceId: 296, syobocal: true },
    // テレ朝チャンネル1
    { chId: 224, networkId: 6, serviceId: 298, syobocal: true },
    // テレ朝チャンネル2
    { chId: 243, networkId: 6, serviceId: 299, syobocal: true },
    // 日テレNEWS24
    { chId: 263, networkId: 6, serviceId: 349, syobocal: true },
    // スポーツライブ+
    { chId: 264, networkId: 6, serviceId: 800, syobocal: true },
    // チャンネルNECO
    { chId: 26, networkId: 7, serviceId: 223, syobocal: true },
    // ムービープラス
    { chId: 152, networkId: 7, serviceId: 240, syobocal: true },
    // スカイA
    { chId: 262, networkId: 7, serviceId: 250, syobocal: true },
    // GAORA
    { chId: 265, networkId: 7, serviceId: 254, syobocal: true },
    // 日テレジータス
    { chId: 266, networkId: 7, serviceId: 257, syobocal: true },
    // TAKARAZUKA SKY STAGE
    { chId: 167, networkId: 7, serviceId: 290, syobocal: true },
    // 時代劇専門チャンネル
    { chId: 221, networkId: 7, serviceId: 292, syobocal: true },
    // ファミリー劇場
    { chId: 42, networkId: 7, serviceId: 293, syobocal: true },
    // ホームドラマチャンネル
    { chId: 153, networkId: 7, serviceId: 294, syobocal: true },
    // MONDO TV
    { chId: 47, networkId: 7, serviceId: 295, syobocal: true },
    // TBSチャンネル2
    { chId: 215, networkId: 7, serviceId: 297, syobocal: true },
    // 日テレプラス
    { chId: 119, networkId: 7, serviceId: 300, syobocal: true },
    // フジテレビONE
    { chId: 109, networkId: 7, serviceId: 307, syobocal: true },
    // フジテレビTWO
    { chId: 43, networkId: 7, serviceId: 308, syobocal: true },
    // フジテレビNEXT
    { chId: 131, networkId: 7, serviceId: 309, syobocal: true },
    // スペースシャワーTV
    { chId: 194, networkId: 7, serviceId: 322, syobocal: true },
    // MTV
    { chId: 235, networkId: 7, serviceId: 323, syobocal: true },
    // エムオン!
    { chId: 151, networkId: 7, serviceId: 325, syobocal: true },
    // 歌謡ポップスチャンネル
    { chId: 222, networkId: 7, serviceId: 329, syobocal: true },
    // キッズステーション
    { chId: 22, networkId: 7, serviceId: 330, syobocal: true },
    // カートゥーンネットワーク
    { chId: 23, networkId: 7, serviceId: 331, syobocal: true },
    // AT-X
    { chId: 20, networkId: 7, serviceId: 333, syobocal: true },
    // ディスカバリーチャンネル
    { chId: 61, networkId: 7, serviceId: 340, syobocal: true },
    // アニマルプラネット
    { chId: 56, networkId: 7, serviceId: 341, syobocal: true },
];

export default SYOBOCAL_CHANNEL_MAP_DATA;
