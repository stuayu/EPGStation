import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * しょぼいカレンダー作品の別名表記 (ShortTitle / TitleEN / Keywords) から作った照合キー辞書。
 * 放送局が付ける表記ゆれ (略称・英題・旧題) を同一 TID へ寄せるために使う
 */
@Entity({ name: 'syobocal_title_alias' })
@Index('IDX_syobocal_title_alias_key', ['lookupKey'])
@Index('IDX_syobocal_title_alias_tid', ['tid'])
export default class SyobocalTitleAlias extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'text' }) lookupKey!: string;
    @Column({ type: 'integer' }) tid!: number;
    // 優先度 0: 正式タイトル / 1: ShortTitle・TitleEN / 2: Keywords。同一キーが競合した場合は小さい方を採用する
    @Column({ type: 'integer', default: 2 }) rank: number = 2;
}
