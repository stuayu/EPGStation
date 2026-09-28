import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'recording_preset' })
export default class RecordingPreset extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'text' })
    public name!: string;

    @Column({ default: false })
    public isDefault: boolean = false;

    @Column({ type: 'text' })
    public settings!: string;

    @Column({ type: 'bigint' })
    public createdAt!: number;

    @Column({ type: 'bigint' })
    public updatedAt!: number;
}
