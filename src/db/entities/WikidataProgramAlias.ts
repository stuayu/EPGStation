import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Wikidata 番組の別名表記 (skos:altLabel) から作った厳密照合キー辞書。
 * 「水曜どうでしょうClassic」「TNCニュース」のように、正式ラベルとは別の表記で
 * 放送される番組を拾うために使う
 */
@Entity({ name: 'wikidata_program_alias' })
@Index('IDX_wikidata_program_alias_key', ['strictKey'])
@Index('IDX_wikidata_program_alias_program', ['qid'])
export default class WikidataProgramAlias extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'text' }) strictKey!: string;
    @Column({ type: 'text' }) qid!: string;
    // 優先度 0: 正式ラベル / 2: 別名
    @Column({ type: 'integer', default: 2 }) rank: number = 2;
}
