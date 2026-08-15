/**
 * Amatsukaze から受け取ったテキストの文字コードを扱うユーティリティ。
 *
 * Amatsukaze (と AmatsukazeAddTask) は日本語 Windows の ANSI コードページ (cp932) で
 * コンソール出力・エンコーダのログを吐く。UTF-8 として読むと日本語が化けるため、
 * UTF-8 として成立しない場合は Shift_JIS として読み直す。
 */
namespace AmatsukazeTextUtil {
    // UTF-8 デコードに失敗したバイトが置き換えられる文字 (U+FFFD)
    const REPLACEMENT_CHARACTER = '�';

    /**
     * バイト列を文字列へ変換する。
     * UTF-8 として成立していればそのまま、崩れていれば Shift_JIS として読み直す
     * (Amatsukaze の出力は cp932 だが、環境によっては UTF-8 のこともあるため決め打ちにしない)
     * @param buffer: Buffer
     * @return string
     */
    export const decode = (buffer: Buffer): string => {
        const utf8 = buffer.toString('utf8');
        if (utf8.includes(REPLACEMENT_CHARACTER) === false) {
            return utf8;
        }

        try {
            return new TextDecoder('shift_jis').decode(buffer);
        } catch (err: any) {
            // Shift_JIS を扱えない環境では UTF-8 の結果で妥協する
            return utf8;
        }
    };

    /**
     * 子プロセスの出力を行単位で組み立てるデコーダ。
     *
     * ストリームのチャンクは文字の途中で切れるため、バイト列のまま溜めて
     * 改行で区切ってから変換する (途中で変換すると分割位置の文字が化ける)
     */
    export class LineDecoder {
        private pending: Buffer = Buffer.alloc(0);

        /**
         * チャンクを流し込み、行が完結した分だけ返す
         * @param chunk: Buffer
         * @return string[] 完結した行 (改行は含まない)
         */
        public push(chunk: Buffer): string[] {
            this.pending = Buffer.concat([this.pending, chunk]);

            const lines: string[] = [];
            for (;;) {
                const index = this.pending.indexOf(0x0a); // \n
                if (index < 0) {
                    break;
                }

                const line = this.pending.subarray(0, index);
                this.pending = this.pending.subarray(index + 1);
                lines.push(decode(line).replace(/\r$/, ''));
            }

            return lines;
        }

        /**
         * 溜まっている分を吐き出す (改行で終わらない最後の行)
         * @return string | null 何も残っていない場合は null
         */
        public flush(): string | null {
            if (this.pending.length === 0) {
                return null;
            }

            const line = decode(this.pending).replace(/\r$/, '');
            this.pending = Buffer.alloc(0);

            return line;
        }
    }
}

export default AmatsukazeTextUtil;
