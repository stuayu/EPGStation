import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';
@Entity({ name: 'app_setting' })
export default class AppSetting extends BaseEntity {
    @PrimaryColumn({ type: 'text' }) key!: string;
    @Column({ type: 'text' }) value!: string;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
