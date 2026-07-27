import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
export type SeriesAirType = 'first' | 'rerun' | 'delayed' | 'unknown';
export type SeriesMatchMethod =
    | 'syobocal'
    | 'annict'
    // Wikidata の全ジャンル番組辞書で確定
    | 'wikidata'
    | 'title'
    // LLM が抽出した作品名で既存シリーズへ束ねた (作品辞書に無いジャンル用)
    | 'llm'
    | 'manual'
    | 'alias'
    | 'reservation-hint';
@Entity({ name: 'recorded_series_link' })
@Index('IDX_recorded_series_link_recorded', ['recordedId'], { unique: true })
@Index('IDX_recorded_series_link_series', ['seriesId'])
@Index('IDX_recorded_series_link_series_channel', ['seriesId', 'channelId'])
export default class RecordedSeriesLink extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer' }) recordedId!: number;
    @Column({ type: 'integer' }) seriesId!: number;
    // recorded.channelId の非正規化カラム (§4.2)。listRecorded / listChannels での recorded への JOIN を避けるため保持する
    // channelId は networkId * 100000 + serviceId で生成され int の上限 (2147483647) を超えるため bigint にする
    @Column({ type: 'bigint' }) channelId!: number;
    @Column({ type: 'integer', nullable: true }) episodeId!: number | null;
    @Column({ type: 'text', default: 'unknown' }) airType: SeriesAirType = 'unknown';
    @Column({ type: 'text', default: 'title' }) matchMethod: SeriesMatchMethod = 'title';
    @Column({ type: 'real', default: 0 }) confidence: number = 0;
    @Column({ default: false }) manualLock: boolean = false;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
