import { BaseEntity, Column, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import Recorded from './Recorded';

@Entity()
export default class VideoFile extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public parentDirectoryName!: string;

    @Column({
        type: 'text',
    })
    public filePath!: string;

    @Column({
        type: 'text',
    })
    public type!: string; // apid.VideoFileType

    @Column({
        type: 'text',
    })
    public name!: string;

    @Column({
        type: 'bigint',
        default: 0,
    })
    public size: number = 0;

    // 外部録画ファイル取り込み (register モード) で追加された、EPGStation 管理外の実ファイルかどうか
    // true の場合、削除操作では DB レコードのみ削除し実ファイルには触れない
    @Column({
        type: 'boolean',
        default: false,
    })
    public isExternalFile: boolean = false;

    @Column()
    public recordedId!: number;

    @ManyToOne(() => Recorded, recorded => recorded.videoFiles)
    @JoinTable({ name: 'recordedId' })
    public recorded?: Recorded;
}
