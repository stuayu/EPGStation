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
 * しょぼいカレンダー ChID ⇄ Mirakurun networkId/serviceId の同梱初期データ (最低限のスケルトン)。
 * 主要な地上波キー局のみを収録し、それ以外は同梱データに無いものとして通常のタイトル一致に
 * フォールバックする。運用者は `metadataChannelMappingPath` (config.yml) で外部 JSON を
 * 指定することでこの一覧を上書き/追加できる
 */
const SYOBOCAL_CHANNEL_MAP_DATA: readonly SyobocalChannelMapEntry[] = [
    // NHK総合・東京
    { chId: 1, networkId: 32736, serviceId: 1024, syobocal: true },
    // NHK Eテレ・東京
    { chId: 2, networkId: 32736, serviceId: 1032, syobocal: true },
    // 日本テレビ
    { chId: 3, networkId: 32736, serviceId: 1040, syobocal: true },
    // テレビ朝日
    { chId: 5, networkId: 32736, serviceId: 1064, syobocal: true },
    // TBS
    { chId: 6, networkId: 32736, serviceId: 1048, syobocal: true },
    // テレビ東京
    { chId: 7, networkId: 32736, serviceId: 1072, syobocal: true },
    // フジテレビ
    { chId: 8, networkId: 32736, serviceId: 1056, syobocal: true },
];

export default SYOBOCAL_CHANNEL_MAP_DATA;
