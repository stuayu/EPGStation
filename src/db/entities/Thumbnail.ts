import { BaseEntity, Column, CreateDateColumn, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import Recorded from './Recorded';

@Entity()
export default class Thumbnail extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public filePath!: string;

    @Column({ type: 'text', default: 'poster' })
    public variant: string = 'poster';

    @Column({ type: 'integer', nullable: true })
    public width: number | null = null;

    @Column({ type: 'integer', nullable: true })
    public height: number | null = null;

    @Column({ type: 'float', nullable: true })
    public timestamp: number | null = null;

    @Column({ type: 'float', nullable: true })
    public score: number | null = null;

    @Column({ type: 'text', default: 'jpeg' })
    public format: string = 'jpeg';

    @CreateDateColumn({ type: 'datetime', nullable: true })
    public createdAt: Date | null = null;

    @Column()
    public recordedId!: number;

    @Column({ type: 'integer', nullable: true })
    public videoFileId: number | null = null;

    @Column({ type: 'bigint', nullable: true })
    public videoFileSize: number | null = null;

    @Column({ type: 'bigint', nullable: true })
    public videoFileAnalyzedAt: number | null = null;

    @ManyToOne(() => Recorded, recorded => recorded.thumbnails)
    @JoinTable({ name: 'recordedId' })
    public recorded?: Recorded;
}
