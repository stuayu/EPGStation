import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * しょぼいカレンダー作品のサブタイトル一覧 (TitleLookup の SubTitles)。
 * 話数表記の無い録画タイトルから話数を復元する (サブタイトル → 話数) 用途と、
 * エピソード名の補完に使う
 */
@Entity({ name: 'syobocal_title_episode' })
@Index('IDX_syobocal_title_episode_tid', ['tid'])
@Index('IDX_syobocal_title_episode_key', ['lookupKey'])
export default class SyobocalTitleEpisode extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer' }) tid!: number;
    @Column({ type: 'integer' }) episodeNumber!: number;
    @Column({ type: 'text' }) subTitle!: string;
    // subTitle を辞書照合用に正規化したキー
    @Column({ type: 'text' }) lookupKey!: string;
}
