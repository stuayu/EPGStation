import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export default class RecordedTag extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public name!: string; // タグ名

    @Column({
        type: 'text',
    })
    public halfWidthName!: string; // 検索用の name を半角化したもの

    @Column()
    public color!: string; // 色

    @Index()
    @Column({
        type: 'integer',
        nullable: true,
    })
    public parentId!: number | null; // 親タグの id (階層タグ用)
}
