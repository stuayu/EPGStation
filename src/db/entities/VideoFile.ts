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

    // --- ffprobe で実測した動画メタデータ (未解析なら null) ---

    // 実測の動画長 (秒)
    @Column({
        type: 'float',
        nullable: true,
    })
    public duration: number | null = null;

    // コンテナの開始オフセット (秒)。TS の先頭ズレ補正に使う
    @Column({
        type: 'float',
        nullable: true,
    })
    public startTime: number | null = null;

    // 録画ファイルの先頭 (再生位置 0 秒) に対応する実時刻 (UNIX 時刻・ミリ秒)
    @Column({
        type: 'bigint',
        nullable: true,
    })
    public startAt: number | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public videoCodec: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public audioCodec: string | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public width: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public height: number | null = null;

    @Column({
        type: 'float',
        nullable: true,
    })
    public bitRate: number | null = null;

    // メタデータを解析した時刻 (UNIX 時刻・ミリ秒)
    @Column({
        type: 'bigint',
        nullable: true,
    })
    public analyzedAt: number | null = null;

    @Column()
    public recordedId!: number;

    @ManyToOne(() => Recorded, recorded => recorded.videoFiles)
    @JoinTable({ name: 'recordedId' })
    public recorded?: Recorded;
}
