import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'client_setting' })
@Index('IDX_client_setting_userId', ['userId'], { unique: true })
export default class ClientSetting extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer', nullable: false }) userId!: number;
    // SQLite は text、MySQL migration は 256 KiB を格納できる MEDIUMTEXT を使う。
    @Column({ type: 'text' }) settings!: string;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
