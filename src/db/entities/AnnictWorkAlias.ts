import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Annict 作品の別名表記 (titleEn / titleRo / titleKana) から作った照合キー辞書。
 * 英題・ローマ字表記で放送される作品 (Ubel Blatt, Die Neue These 等) を拾うために使う
 */
@Entity({ name: 'annict_work_alias' })
@Index('IDX_annict_work_alias_key', ['lookupKey'])
@Index('IDX_annict_work_alias_work', ['annictId'])
export default class AnnictWorkAlias extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'text' }) lookupKey!: string;
    @Column({ type: 'integer' }) annictId!: number;
    // 優先度 0: 正式タイトル / 2: 英題・ローマ字・かな
    @Column({ type: 'integer', default: 2 }) rank: number = 2;
}
