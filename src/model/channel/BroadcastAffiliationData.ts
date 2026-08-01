/**
 * 放送局 → 系列識別 (BIT の affiliation_id) の同梱初期データ。
 *
 * 系列は本来 BIT (PID 0x0024) から受動収集するが、BIT はその放送局を実際に受信するまで
 * 集まらない。まだ 1 度も受信していない局が「未分類」のままだと、
 * - 番組表・放映中の系列別グルーピングが機能しない
 * - しょぼいカレンダー未登録の県域局を系列キー局の放送予定で代用できない
 *   (SyobocalProgramLookup)
 * という実害があるため、公知の系列を同梱データとして持ち **BIT が無い局だけ**これで補う。
 * BIT を受信済みの局は常に BIT が優先される (BroadcastAffiliation.getAffiliation)。
 *
 * 値は ARIB TR-B14 第五編の系列識別と同じ (0x00 NHK総合 / 0x01 NHK Eテレ / 0x02 日テレ系 /
 * 0x03 TBS 系 / 0x04 フジテレビ系 / 0x05 テレビ朝日系 / 0x06 テレビ東京系 / 0x07 独立系)。
 * クロスネット局 (テレビ大分・テレビ宮崎・福井放送) は主たる系列を 1 つだけ持たせる。
 */

/**
 * networkId → 系列識別。実機の channel テーブルから起こした実測値なので最優先で引く
 */
const BROADCAST_AFFILIATION_BY_NETWORK_ID: Readonly<Record<number, number>> = {
    // NHK総合1・佐賀
    31776: 0x00,
    // NHKEテレ1佐賀
    31777: 0x01,
    // STSサガテレビ1
    31778: 0x04,
    // NHK総合1・大分
    31792: 0x00,
    // NHKEテレ1大分
    31793: 0x01,
    // OBS大分放送
    31794: 0x03,
    // TOSテレビ大分1
    31795: 0x02,
    // OAB大分朝日放送1
    31796: 0x05,
    // NHK総合1・長崎
    31840: 0x00,
    // NHKEテレ1長崎
    31841: 0x01,
    // NBC長崎放送
    31842: 0x03,
    // テレビ長崎1
    31843: 0x04,
    // NCC長崎文化放送1
    31844: 0x05,
    // 長崎国際テレビ1
    31845: 0x02,
    // NHK総合1・熊本
    31856: 0x00,
    // NHKEテレ1熊本
    31857: 0x01,
    // RKK熊本放送1
    31858: 0x03,
    // テレビ熊本1
    31859: 0x04,
    // くまもと県民1
    31860: 0x02,
    // KAB熊本朝日放送1
    31861: 0x05,
    // KBCテレビ
    31874: 0x05,
    // RKB毎日放送
    31875: 0x03,
    // FBS福岡放送1
    31876: 0x02,
    // TVQ九州放送1
    31877: 0x06,
    // テレビ西日本1
    31878: 0x04,
    // NHK総合1・松山
    31936: 0x00,
    // NHKEテレ1松山
    31937: 0x01,
    // 南海放送1
    31938: 0x02,
    // 愛媛朝日テレビ
    31939: 0x05,
    // あいテレビ1
    31940: 0x03,
    // テレビ愛媛
    31941: 0x04,
    // NHK総合1・岡山
    32000: 0x00,
    // NHKEテレ1岡山
    32001: 0x01,
    // NHK総合1・広島
    32016: 0x00,
    // NHKEテレ1広島
    32017: 0x01,
    // RCCテレビ1
    32018: 0x03,
    // 広島テレビ1
    32019: 0x02,
    // 広島ホームテレビ1
    32020: 0x05,
    // テレビ新広島1
    32021: 0x04,
    // NHK総合1・大津
    32032: 0x00,
    // BBCびわ湖放送1
    32038: 0x07,
    // NHK総合1・京都
    32096: 0x00,
    // KBS京都
    32102: 0x07,
    // NHK総合1・津
    32144: 0x00,
    // 三重テレビ1
    32150: 0x07,
    // NHK総合1・静岡
    32192: 0x00,
    // NHKEテレ1静岡
    32193: 0x01,
    // SBS1
    32194: 0x03,
    // テレビ静岡
    32195: 0x04,
    // Daiichi-TV1
    32196: 0x02,
    // 静岡朝日テレビ
    32197: 0x05,
    // NHK総合1・名古屋
    32224: 0x00,
    // テレビ愛知1
    32230: 0x06,
    // NHK総合1・新潟
    32256: 0x00,
    // NHKEテレ1新潟
    32257: 0x01,
    // BSN1
    32258: 0x03,
    // NST1
    32259: 0x04,
    // TeNY1
    32260: 0x02,
    // 新潟テレビ21_1
    32261: 0x05,
    // NHK総合1・長野
    32272: 0x00,
    // NHKEテレ1長野
    32273: 0x01,
    // テレビ信州1
    32274: 0x02,
    // 長野朝日放送
    32275: 0x05,
    // SBC信越放送1
    32276: 0x03,
    // 長野放送
    32277: 0x04,
    // テレ玉1
    32295: 0x07,
    // チバテレ1
    32327: 0x07,
    // NHK総合1・前橋
    32352: 0x00,
    // ぐんテレ
    32359: 0x07,
    // tvk1
    32375: 0x07,
    // TOKYO MX1
    32391: 0x07,
    // NHK総合1・青森
    32400: 0x00,
    // NHKEテレ1青森
    32401: 0x01,
    // RAB青森放送1
    32402: 0x02,
    // ATV青森テレビ
    32403: 0x03,
    // 青森朝日放送
    32404: 0x05,
    // NHK総合1・福島
    32416: 0x00,
    // NHKEテレ1福島
    32417: 0x01,
    // FTV福島テレビ1
    32418: 0x04,
    // 福島中央テレビ1
    32419: 0x02,
    // KFB福島放送1
    32420: 0x05,
    // テレビユー福島
    32421: 0x03,
    // NHK総合1・盛岡
    32432: 0x00,
    // NHKEテレ1盛岡
    32433: 0x01,
    // IBCテレビ1
    32434: 0x03,
    // テレビ岩手1
    32435: 0x02,
    // めんこいテレビ1
    32436: 0x04,
    // 岩手朝日テレビ
    32437: 0x05,
    // TUY1
    32452: 0x03,
    // NHK総合1・秋田
    32464: 0x00,
    // NHKEテレ1秋田
    32465: 0x01,
    // ABS秋田放送1
    32466: 0x02,
    // AKT秋田テレビ1
    32467: 0x04,
    // 秋田朝日放送
    32468: 0x05,
    // NHK総合1・仙台
    32480: 0x00,
    // NHKEテレ1仙台
    32481: 0x01,
    // TBCテレビ1
    32482: 0x03,
    // 仙台放送
    32483: 0x04,
    // ミヤギテレビ1
    32484: 0x02,
    // 東日本放送CH1
    32485: 0x05,
    // NHK総合1・札幌
    32592: 0x00,
    // NHKEテレ1札幌
    32593: 0x01,
    // 瀬戸内海放送
    32675: 0x05,
    // TSCテレビせとうち
    32677: 0x06,
    // OHK
    32678: 0x04,
    // HBC
    32690: 0x03,
    // 札幌テレビ1
    32691: 0x02,
    // HTB1
    32692: 0x05,
    // 北海道文化放送1
    32693: 0x04,
    // TVh1
    32694: 0x06,
    // NHKEテレ1名古屋
    32705: 0x01,
    // 東海テレビ011
    32706: 0x04,
    // CBCテレビ
    32707: 0x03,
    // メ~テレ
    32708: 0x05,
    // 中京テレビ1
    32709: 0x02,
    // NHKEテレ1大阪
    32721: 0x01,
    // MBS毎日放送
    32722: 0x03,
    // ABCテレビ1
    32723: 0x05,
    // 関西テレビ1
    32724: 0x04,
    // 読売テレビ1
    32725: 0x02,
    // NHK総合1・東京
    32736: 0x00,
    // NHKEテレ1東京
    32737: 0x01,
    // 日テレ1
    32738: 0x02,
    // TBS1
    32739: 0x03,
    // フジテレビ
    32740: 0x04,
    // テレビ朝日
    32741: 0x05,
    // テレ東
    32742: 0x06,
};

/**
 * 放送局名から系列を引くための表 (networkId が未収録の局向けのフォールバック)。
 * 出典は Wikipedia の各ニュースネットワーク (NNN / JNN / FNN / ANN / TXN) と
 * 全国独立放送協議会の加盟局一覧で、地上波の民放全社を収録している。
 *
 * - names: 正式名称。EPG の局名に「含まれていれば」その系列とみなす
 *   (「福島中央テレビ1」のようにサブチャンネル番号が付くため)。
 *   紛らわしい組み合わせ (「大分放送」と「大分朝日放送」など) を取り違えないよう、
 *   照合は必ず**長い名前から**行うこと
 * - abbreviations: 略称。3 文字程度で偶然一致しやすいため**完全一致でのみ**引く
 *   (末尾のサブチャンネル番号は落としてから比較する)
 */
export interface BroadcastAffiliationNameEntry {
    affiliationId: number;
    names: string[];
    abbreviations: string[];
}

const BROADCAST_AFFILIATION_BY_NAME: readonly BroadcastAffiliationNameEntry[] = [
    // --- NNN (日本テレビ系) ---
    { affiliationId: 0x02, names: ['日本テレビ'], abbreviations: ['日テレ', 'NTV'] },
    { affiliationId: 0x02, names: ['札幌テレビ'], abbreviations: ['STV'] },
    { affiliationId: 0x02, names: ['青森放送'], abbreviations: ['RAB'] },
    { affiliationId: 0x02, names: ['テレビ岩手'], abbreviations: ['TVI'] },
    { affiliationId: 0x02, names: ['宮城テレビ'], abbreviations: ['ミヤギテレビ', 'MMT'] },
    { affiliationId: 0x02, names: ['秋田放送'], abbreviations: ['ABS'] },
    { affiliationId: 0x02, names: ['山形放送'], abbreviations: ['YBC'] },
    { affiliationId: 0x02, names: ['福島中央テレビ'], abbreviations: ['FCT'] },
    { affiliationId: 0x02, names: ['山梨放送'], abbreviations: ['YBS'] },
    { affiliationId: 0x02, names: ['テレビ新潟'], abbreviations: ['TeNY'] },
    { affiliationId: 0x02, names: ['テレビ信州'], abbreviations: ['TSB'] },
    { affiliationId: 0x02, names: ['静岡第一テレビ'], abbreviations: ['Daiichi-TV', 'SDT'] },
    { affiliationId: 0x02, names: ['北日本放送'], abbreviations: ['KNB'] },
    { affiliationId: 0x02, names: ['テレビ金沢'], abbreviations: ['KTK'] },
    { affiliationId: 0x02, names: ['福井放送'], abbreviations: ['FBC'] },
    { affiliationId: 0x02, names: ['中京テレビ'], abbreviations: ['CTV'] },
    { affiliationId: 0x02, names: ['読売テレビ'], abbreviations: ['ytv'] },
    { affiliationId: 0x02, names: ['日本海テレビ'], abbreviations: ['NKT'] },
    { affiliationId: 0x02, names: ['広島テレビ'], abbreviations: ['HTV'] },
    { affiliationId: 0x02, names: ['山口放送'], abbreviations: ['KRY'] },
    { affiliationId: 0x02, names: ['四国放送'], abbreviations: ['JRT'] },
    { affiliationId: 0x02, names: ['西日本放送'], abbreviations: ['RNC'] },
    { affiliationId: 0x02, names: ['南海放送'], abbreviations: ['RNB'] },
    { affiliationId: 0x02, names: ['高知放送'], abbreviations: ['RKC'] },
    { affiliationId: 0x02, names: ['福岡放送'], abbreviations: ['FBS'] },
    { affiliationId: 0x02, names: ['長崎国際テレビ'], abbreviations: ['NIB'] },
    { affiliationId: 0x02, names: ['熊本県民テレビ'], abbreviations: ['くまもと県民', 'KKT'] },
    { affiliationId: 0x02, names: ['鹿児島讀賣テレビ'], abbreviations: ['鹿児島読売テレビ', 'KYT'] },
    { affiliationId: 0x02, names: ['テレビ大分'], abbreviations: ['TOS'] },
    // --- JNN (TBS 系) ---
    { affiliationId: 0x03, names: ['TBSテレビ'], abbreviations: ['TBS'] },
    { affiliationId: 0x03, names: ['北海道放送'], abbreviations: ['HBC'] },
    { affiliationId: 0x03, names: ['青森テレビ'], abbreviations: ['ATV'] },
    { affiliationId: 0x03, names: ['岩手放送'], abbreviations: ['IBCテレビ', 'IBC'] },
    { affiliationId: 0x03, names: ['東北放送'], abbreviations: ['TBCテレビ', 'tbc'] },
    { affiliationId: 0x03, names: ['テレビユー山形'], abbreviations: ['TUY'] },
    { affiliationId: 0x03, names: ['テレビユー福島'], abbreviations: ['TUF'] },
    { affiliationId: 0x03, names: ['テレビ山梨'], abbreviations: ['UTY'] },
    { affiliationId: 0x03, names: ['新潟放送'], abbreviations: ['BSN'] },
    { affiliationId: 0x03, names: ['信越放送'], abbreviations: ['SBC'] },
    { affiliationId: 0x03, names: ['静岡放送'], abbreviations: ['SBS'] },
    { affiliationId: 0x03, names: ['チューリップテレビ'], abbreviations: ['TUT'] },
    { affiliationId: 0x03, names: ['北陸放送'], abbreviations: ['MRO'] },
    { affiliationId: 0x03, names: ['CBCテレビ'], abbreviations: ['CBC'] },
    { affiliationId: 0x03, names: ['毎日放送'], abbreviations: ['MBS'] },
    { affiliationId: 0x03, names: ['山陰放送'], abbreviations: ['BSS'] },
    { affiliationId: 0x03, names: ['山陽放送'], abbreviations: ['RSK'] },
    { affiliationId: 0x03, names: ['中国放送'], abbreviations: ['RCCテレビ', 'RCC'] },
    { affiliationId: 0x03, names: ['テレビ山口'], abbreviations: ['tys'] },
    { affiliationId: 0x03, names: ['あいテレビ'], abbreviations: ['itv'] },
    { affiliationId: 0x03, names: ['テレビ高知'], abbreviations: ['KUTV'] },
    { affiliationId: 0x03, names: ['RKB毎日放送'], abbreviations: ['RKB'] },
    { affiliationId: 0x03, names: ['長崎放送'], abbreviations: ['NBC'] },
    { affiliationId: 0x03, names: ['熊本放送'], abbreviations: ['RKK'] },
    { affiliationId: 0x03, names: ['大分放送'], abbreviations: ['OBS'] },
    { affiliationId: 0x03, names: ['宮崎放送'], abbreviations: ['MRT'] },
    { affiliationId: 0x03, names: ['南日本放送'], abbreviations: ['MBC'] },
    { affiliationId: 0x03, names: ['琉球放送'], abbreviations: ['RBC'] },
    // --- FNN (フジテレビ系) ---
    { affiliationId: 0x04, names: ['フジテレビ'], abbreviations: ['CX'] },
    { affiliationId: 0x04, names: ['北海道文化放送'], abbreviations: ['UHB'] },
    { affiliationId: 0x04, names: ['岩手めんこいテレビ'], abbreviations: ['めんこいテレビ', 'mit'] },
    { affiliationId: 0x04, names: ['仙台放送'], abbreviations: ['OX'] },
    { affiliationId: 0x04, names: ['秋田テレビ'], abbreviations: ['AKT'] },
    { affiliationId: 0x04, names: ['さくらんぼテレビ'], abbreviations: ['SAY'] },
    { affiliationId: 0x04, names: ['福島テレビ'], abbreviations: ['FTV'] },
    { affiliationId: 0x04, names: ['新潟総合テレビ'], abbreviations: ['NST'] },
    { affiliationId: 0x04, names: ['長野放送'], abbreviations: ['NBS'] },
    { affiliationId: 0x04, names: ['テレビ静岡'], abbreviations: ['SUT'] },
    { affiliationId: 0x04, names: ['富山テレビ'], abbreviations: ['BBT'] },
    { affiliationId: 0x04, names: ['石川テレビ'], abbreviations: ['ITC'] },
    { affiliationId: 0x04, names: ['福井テレビ'], abbreviations: ['ftb'] },
    { affiliationId: 0x04, names: ['東海テレビ'], abbreviations: ['THK'] },
    { affiliationId: 0x04, names: ['関西テレビ'], abbreviations: ['KTV'] },
    { affiliationId: 0x04, names: ['山陰中央テレビ'], abbreviations: ['TSK'] },
    { affiliationId: 0x04, names: ['岡山放送'], abbreviations: ['OHK'] },
    { affiliationId: 0x04, names: ['テレビ新広島'], abbreviations: ['TSS'] },
    { affiliationId: 0x04, names: ['テレビ愛媛'], abbreviations: ['EBC'] },
    { affiliationId: 0x04, names: ['高知さんさんテレビ'], abbreviations: ['KSS'] },
    { affiliationId: 0x04, names: ['テレビ西日本'], abbreviations: ['TNC'] },
    { affiliationId: 0x04, names: ['サガテレビ'], abbreviations: ['STS'] },
    { affiliationId: 0x04, names: ['テレビ長崎'], abbreviations: ['KTN'] },
    { affiliationId: 0x04, names: ['テレビ熊本'], abbreviations: ['TKU'] },
    { affiliationId: 0x04, names: ['鹿児島テレビ'], abbreviations: ['KTS'] },
    { affiliationId: 0x04, names: ['沖縄テレビ'], abbreviations: ['OTV'] },
    { affiliationId: 0x04, names: ['テレビ宮崎'], abbreviations: ['UMK'] },
    // --- ANN (テレビ朝日系) ---
    { affiliationId: 0x05, names: ['テレビ朝日'], abbreviations: ['EX'] },
    { affiliationId: 0x05, names: ['北海道テレビ'], abbreviations: ['HTB'] },
    { affiliationId: 0x05, names: ['青森朝日放送'], abbreviations: ['ABA'] },
    { affiliationId: 0x05, names: ['岩手朝日テレビ'], abbreviations: ['IAT'] },
    { affiliationId: 0x05, names: ['東日本放送'], abbreviations: ['khb', 'KHB'] },
    { affiliationId: 0x05, names: ['秋田朝日放送'], abbreviations: ['AAB'] },
    { affiliationId: 0x05, names: ['山形テレビ'], abbreviations: ['YTS'] },
    { affiliationId: 0x05, names: ['福島放送'], abbreviations: ['KFB'] },
    { affiliationId: 0x05, names: ['新潟テレビ21'], abbreviations: ['UX'] },
    { affiliationId: 0x05, names: ['長野朝日放送'], abbreviations: ['abn'] },
    { affiliationId: 0x05, names: ['静岡朝日テレビ'], abbreviations: ['SATV'] },
    { affiliationId: 0x05, names: ['北陸朝日放送'], abbreviations: ['HAB'] },
    { affiliationId: 0x05, names: ['名古屋テレビ'], abbreviations: ['メ~テレ', 'メ〜テレ', 'NBN'] },
    { affiliationId: 0x05, names: ['朝日放送テレビ'], abbreviations: ['ABCテレビ', 'ABC'] },
    { affiliationId: 0x05, names: ['瀬戸内海放送'], abbreviations: ['KSB'] },
    { affiliationId: 0x05, names: ['広島ホームテレビ'], abbreviations: ['HOME'] },
    { affiliationId: 0x05, names: ['山口朝日放送'], abbreviations: ['yab'] },
    { affiliationId: 0x05, names: ['愛媛朝日テレビ'], abbreviations: ['eat'] },
    { affiliationId: 0x05, names: ['九州朝日放送'], abbreviations: ['KBCテレビ', 'KBC'] },
    { affiliationId: 0x05, names: ['長崎文化放送'], abbreviations: ['NCC'] },
    { affiliationId: 0x05, names: ['熊本朝日放送'], abbreviations: ['KAB'] },
    { affiliationId: 0x05, names: ['大分朝日放送'], abbreviations: ['OAB'] },
    { affiliationId: 0x05, names: ['鹿児島放送'], abbreviations: ['KKB'] },
    { affiliationId: 0x05, names: ['琉球朝日放送'], abbreviations: ['QAB'] },
    // --- TXN (テレビ東京系) ---
    { affiliationId: 0x06, names: ['テレビ東京'], abbreviations: ['テレ東', 'TX'] },
    { affiliationId: 0x06, names: ['テレビ北海道'], abbreviations: ['TVh'] },
    { affiliationId: 0x06, names: ['テレビ愛知'], abbreviations: ['TVA'] },
    { affiliationId: 0x06, names: ['テレビ大阪'], abbreviations: ['TVO'] },
    { affiliationId: 0x06, names: ['テレビせとうち'], abbreviations: ['TSC'] },
    { affiliationId: 0x06, names: ['TVQ九州放送'], abbreviations: ['TVQ'] },
    // --- 独立局 (全国独立放送協議会) ---
    { affiliationId: 0x07, names: ['とちぎテレビ'], abbreviations: ['GYT'] },
    { affiliationId: 0x07, names: ['群馬テレビ'], abbreviations: ['ぐんテレ', 'GTV'] },
    { affiliationId: 0x07, names: ['テレビ埼玉'], abbreviations: ['テレ玉', 'TVS'] },
    { affiliationId: 0x07, names: ['千葉テレビ'], abbreviations: ['チバテレ', 'CTC'] },
    { affiliationId: 0x07, names: ['TOKYO MX'], abbreviations: ['MX'] },
    { affiliationId: 0x07, names: ['テレビ神奈川'], abbreviations: ['tvk'] },
    { affiliationId: 0x07, names: ['岐阜放送'], abbreviations: ['ぎふチャン', 'GBS'] },
    { affiliationId: 0x07, names: ['三重テレビ'], abbreviations: ['MTV'] },
    { affiliationId: 0x07, names: ['びわ湖放送'], abbreviations: ['BBC'] },
    { affiliationId: 0x07, names: ['京都放送'], abbreviations: ['KBS京都', 'KBS'] },
    { affiliationId: 0x07, names: ['サンテレビ'], abbreviations: ['SUN'] },
    { affiliationId: 0x07, names: ['奈良テレビ'], abbreviations: ['TVN'] },
    { affiliationId: 0x07, names: ['テレビ和歌山'], abbreviations: ['WTV'] },
    // --- NHK 総合 ---
    { affiliationId: 0x00, names: ['NHK総合'], abbreviations: [] },
    // --- NHK Eテレ ---
    { affiliationId: 0x01, names: ['NHKEテレ'], abbreviations: ['NHK教育'] },
];

export { BROADCAST_AFFILIATION_BY_NETWORK_ID, BROADCAST_AFFILIATION_BY_NAME };
