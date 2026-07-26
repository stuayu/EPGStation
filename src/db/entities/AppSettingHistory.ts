import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
/**
 * app_setting の変更履歴 (§6.3)。update() のたびに変更前の値を 1 行追加し、
 * 直前ロールバック (undo) を可能にする。無制限に積み上がらないよう
 * AppSettingHistoryDB 側で key ごとに直近 N 件のみ保持する
 */
@Entity({ name: 'app_setting_history' })
@Index('IDX_app_setting_history_key', ['key', 'updatedAt'])
export default class AppSettingHistory extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) public id!: number;
    @Column({ type: 'varchar', length: 191 }) public key!: string;
    @Column({ type: 'text' }) public previousValue!: string;
    @Column({ type: 'bigint' }) public updatedAt!: number;
}
