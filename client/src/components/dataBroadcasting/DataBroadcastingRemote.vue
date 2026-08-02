<template>
    <div class="data-broadcasting-remote">
        <v-expansion-panels v-model="openedPanel" variant="accordion" density="compact">
            <v-expansion-panel value="remote">
                <v-expansion-panel-title>
                    データ放送リモコン
                    <v-progress-circular v-if="isLoading === true" indeterminate size="16" width="2" class="ml-2"></v-progress-circular>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                    <div class="remote-color-row">
                        <v-btn size="small" class="color-btn blue" v-on:click="pressColor('blue')">青</v-btn>
                        <v-btn size="small" class="color-btn red" v-on:click="pressColor('red')">赤</v-btn>
                        <v-btn size="small" class="color-btn green" v-on:click="pressColor('green')">緑</v-btn>
                        <v-btn size="small" class="color-btn yellow" v-on:click="pressColor('yellow')">黄</v-btn>
                    </div>

                    <div class="remote-dpad">
                        <div class="dpad-row">
                            <v-btn icon size="small" variant="tonal" v-on:click="pressKey('up')"><v-icon>mdi-chevron-up</v-icon></v-btn>
                        </div>
                        <div class="dpad-row">
                            <v-btn icon size="small" variant="tonal" v-on:click="pressKey('left')"><v-icon>mdi-chevron-left</v-icon></v-btn>
                            <v-btn size="small" variant="flat" color="primary" v-on:click="pressKey('enter')">決定</v-btn>
                            <v-btn icon size="small" variant="tonal" v-on:click="pressKey('right')"><v-icon>mdi-chevron-right</v-icon></v-btn>
                        </div>
                        <div class="dpad-row">
                            <v-btn icon size="small" variant="tonal" v-on:click="pressKey('down')"><v-icon>mdi-chevron-down</v-icon></v-btn>
                        </div>
                    </div>

                    <div class="remote-toolbar-row">
                        <v-btn size="small" v-on:click="pressKey('data')">d</v-btn>
                        <v-btn size="small" v-on:click="pressKey('back')">戻る</v-btn>
                    </div>

                    <div class="remote-numpad">
                        <v-btn
                            v-for="n in numPadKeys"
                            v-bind:key="n.label"
                            size="small"
                            variant="tonal"
                            v-bind:disabled="isUsingNumericKey === false"
                            v-on:click="pressKey(n.key)"
                            >{{ n.label }}</v-btn
                        >
                    </div>
                </v-expansion-panel-text>
            </v-expansion-panel>
        </v-expansion-panels>
    </div>
</template>

<script lang="ts">
import { AribKeyCode } from 'web-bml';
import { Component, Emit, Prop, Vue, toNative } from 'vue-facing-decorator';

type ColorKey = 'blue' | 'red' | 'green' | 'yellow';
type NamedKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'back' | 'data' | ColorKey | `digit${number}`;

interface NumPadKey {
    label: string;
    key: NamedKey;
}

const NAMED_KEY_TO_ARIB: Record<NamedKey, AribKeyCode> = {
    up: AribKeyCode.Up,
    down: AribKeyCode.Down,
    left: AribKeyCode.Left,
    right: AribKeyCode.Right,
    enter: AribKeyCode.Enter,
    back: AribKeyCode.Back,
    data: AribKeyCode.DataButton,
    blue: AribKeyCode.BlueButton,
    red: AribKeyCode.RedButton,
    green: AribKeyCode.GreenButton,
    yellow: AribKeyCode.YellowButton,
    digit0: AribKeyCode.Digit0,
    digit1: AribKeyCode.Digit1,
    digit2: AribKeyCode.Digit2,
    digit3: AribKeyCode.Digit3,
    digit4: AribKeyCode.Digit4,
    digit5: AribKeyCode.Digit5,
    digit6: AribKeyCode.Digit6,
    digit7: AribKeyCode.Digit7,
    digit8: AribKeyCode.Digit8,
    digit9: AribKeyCode.Digit9,
    digit10: AribKeyCode.Digit10,
    digit11: AribKeyCode.Digit11,
    digit12: AribKeyCode.Digit12,
};

const KEYBOARD_KEY_TO_NAMED: Record<string, NamedKey> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Enter: 'enter',
    Backspace: 'back',
    '0': 'digit0',
    '1': 'digit1',
    '2': 'digit2',
    '3': 'digit3',
    '4': 'digit4',
    '5': 'digit5',
    '6': 'digit6',
    '7': 'digit7',
    '8': 'digit8',
    '9': 'digit9',
};

/**
 * データ放送 (BML) 用のリモコン UI。
 * ボタン押下は ARIB キーコードそのものを key イベントで発火し、DataBroadcastingManager.sendKey へ中継される想定。
 * 数字キーは BML 文書側が数字キーを利用中 (isUsingNumericKey) のときだけ送る。
 * リモコン番号での選局 (数字キーが未使用のときの動作) は実装しない
 */
@Component({})
class DataBroadcastingRemote extends Vue {
    // BML ブラウザが数字キーを利用中かどうか (DataBroadcastingManager の usedkeylistchanged コールバックから渡される)
    @Prop({ required: false, default: false })
    public isUsingNumericKey!: boolean;

    // データ放送の読み込み/通信中インジケータ
    @Prop({ required: false, default: false })
    public isLoading!: boolean;

    public openedPanel: string | null = null;

    public numPadKeys: NumPadKey[] = [
        { label: '1', key: 'digit1' },
        { label: '2', key: 'digit2' },
        { label: '3', key: 'digit3' },
        { label: '4', key: 'digit4' },
        { label: '5', key: 'digit5' },
        { label: '6', key: 'digit6' },
        { label: '7', key: 'digit7' },
        { label: '8', key: 'digit8' },
        { label: '9', key: 'digit9' },
        { label: '10', key: 'digit10' },
        { label: '0', key: 'digit0' },
        { label: '11', key: 'digit11' },
        { label: '12', key: 'digit12' },
    ];

    private keydownListener = ((event: KeyboardEvent) => this.onKeydown(event)).bind(this);

    public mounted(): void {
        window.addEventListener('keydown', this.keydownListener);
    }

    public beforeUnmount(): void {
        window.removeEventListener('keydown', this.keydownListener);
    }

    private onKeydown(event: KeyboardEvent): void {
        if (event.altKey || event.ctrlKey || event.metaKey) return;

        const target = event.target as HTMLElement | null;
        if (target !== null && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

        if (event.key === 'd' || event.key === 'D') {
            event.preventDefault();
            this.pressKey('data');

            return;
        }

        const named = KEYBOARD_KEY_TO_NAMED[event.key];
        if (typeof named === 'undefined') return;
        event.preventDefault();
        this.pressKey(named);
    }

    public pressColor(color: ColorKey): void {
        this.pressKey(color);
    }

    public pressKey(key: NamedKey): void {
        // 数字キーは BML が利用中のときだけ送る (リモコン番号での選局は実装しない)
        if (key.startsWith('digit') === true && this.isUsingNumericKey === false) {
            return;
        }

        this.onKey(NAMED_KEY_TO_ARIB[key]);
    }

    @Emit('key')
    private onKey(keyCode: AribKeyCode): AribKeyCode {
        return keyCode;
    }
}

export default toNative(DataBroadcastingRemote);
</script>

<style lang="sass" scoped>
.data-broadcasting-remote
    max-width: 320px
    margin-top: 8px

.remote-color-row
    display: flex
    gap: 4px
    margin-bottom: 8px

    .color-btn
        color: white
        flex: 1

        &.blue
            background-color: rgb(0, 114, 214)
        &.red
            background-color: rgb(201, 0, 0)
        &.green
            background-color: rgb(27, 135, 0)
        &.yellow
            background-color: rgb(227, 178, 0)

.remote-dpad
    display: flex
    flex-direction: column
    align-items: center
    gap: 4px
    margin-bottom: 8px

    .dpad-row
        display: flex
        gap: 4px
        align-items: center
        justify-content: center

.remote-toolbar-row
    display: flex
    gap: 8px
    justify-content: center
    margin-bottom: 8px

.remote-numpad
    display: grid
    grid-template-columns: repeat(3, 1fr)
    gap: 4px
    max-width: 220px
    margin: 0 auto

@media (max-width: 400px)
    .data-broadcasting-remote
        max-width: 100%
</style>
