import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';
@Entity({ name: 'app_setting' })
export default class AppSetting extends BaseEntity {
    // MySQL は TEXT を PK にできないため mysql マイグレーションは varchar(191) で作成している。
    // エンティティ側もそれに合わせる (sqlite は VARCHAR/TEXT のアフィニティが同じため影響なし)
    @PrimaryColumn({ type: 'varchar', length: 191 }) key!: string;
    @Column({ type: 'text' }) value!: string;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
