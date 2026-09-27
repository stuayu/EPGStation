type Attributes = Record<string, string | number | boolean>;

interface SpanHandle {
    end: (attributes?: Attributes) => void;
}

/** service.name にプロセス種別を含む Resource 属性を作る。 */
export function createTelemetryResourceAttributes(
    otel: { serviceName?: string },
    processType: 'operator' | 'service',
): Attributes {
    return {
        'service.name': `${otel.serviceName || 'epgstation'}-${processType}`,
        'epgstation.process.type': processType,
    };
}

export interface TelemetryTestOptions {
    sdk: { start: () => Promise<void> | void };
    tracer: any;
    meter: any;
    api?: any;
}

/** OpenTelemetry を設定時だけロードし、録画・Planner の計測を受け持つ。 */
class Telemetry {
    private api: any = null;
    private tracer: any = null;
    private meter: any = null;
    private sdk: any = null;
    private activeSessions = 0;
    private instruments: Record<string, any> = {};
    private readonly sessionSpans = new Map<number, any>();
    private readonly attemptSpans = new Map<string, SpanHandle>();

    /** 設定が有効なときだけ SDK と OTLP/HTTP exporter をロードする。 */
    public async initialize(
        config: any,
        processType: 'operator' | 'service',
        testOptions?: TelemetryTestOptions,
    ): Promise<void> {
        const otel = config?.observability?.otel;
        if (otel?.enabled !== true || this.sdk !== null) return;
        if (typeof otel.endpoint !== 'string' || otel.endpoint.trim() === '') {
            throw new Error('observability.otel.endpoint must be a non-empty OTLP/HTTP base URL');
        }

        if (testOptions !== undefined) {
            this.sdk = testOptions.sdk;
            this.tracer = testOptions.tracer;
            this.meter = testOptions.meter;
            this.api = testOptions.api ?? null;
            await this.sdk.start();
            this.createInstruments();
            return;
        }

        const [apiModule, sdkModule, resourcesModule, traceExporterModule, metricExporterModule, metricsModule] =
            await Promise.all([
                import('@opentelemetry/api'),
                import('@opentelemetry/sdk-node'),
                import('@opentelemetry/resources'),
                import('@opentelemetry/exporter-trace-otlp-http'),
                import('@opentelemetry/exporter-metrics-otlp-http'),
                import('@opentelemetry/sdk-metrics'),
            ]);
        this.api = apiModule;
        const endpoint = String(otel.endpoint ?? '').replace(/\/+$/, '');
        const resource = resourcesModule.resourceFromAttributes(createTelemetryResourceAttributes(otel, processType));
        const metricReader = new metricsModule.PeriodicExportingMetricReader({
            exporter: new metricExporterModule.OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        });
        this.sdk = new sdkModule.NodeSDK({
            resource,
            traceExporter: new traceExporterModule.OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
            metricReader,
        });
        await this.sdk.start();
        this.tracer = apiModule.trace.getTracer('epgstation');
        this.meter = apiModule.metrics.getMeter('epgstation');
        this.createInstruments();
    }

    /** 終了前に残っている traces / metrics を exporter へ送る。 */
    public async shutdown(): Promise<void> {
        if (this.sdk === null) return;
        const sdk = this.sdk;
        this.sdk = null;
        await sdk.shutdown();
        this.tracer = null;
        this.meter = null;
        this.api = null;
        this.instruments = {};
        this.sessionSpans.clear();
        this.attemptSpans.clear();
        this.activeSessions = 0;
    }

    private createInstruments(): void {
        this.instruments.sessions = this.meter.createUpDownCounter('recording.sessions.active');
        this.instruments.reconnects = this.meter.createCounter('recording.transport.reconnects');
        this.instruments.gaps = this.meter.createHistogram('recording.transport.gap_ms', { unit: 'ms' });
        this.instruments.startDelay = this.meter.createHistogram('recording.start.delay_ms', { unit: 'ms' });
        this.instruments.eitFallback = this.meter.createCounter('recording.eit.fallback');
        this.instruments.conflicts = this.meter.createCounter('scheduler.conflicts');
        this.instruments.replans = this.meter.createCounter('scheduler.replans');
        this.instruments.openFailures = this.meter.createCounter('tuner.open_failures');
    }

    /** 録画セッション span を開始し、active gauge を増やす。 */
    public recordingSessionStarted(sessionId: number): void {
        if (this.sdk === null) return;
        this.activeSessions++;
        this.instruments.sessions?.add(1);
        if (this.tracer !== null) this.sessionSpans.set(sessionId, this.tracer.startSpan('recording.session'));
    }

    /** 録画セッション span を閉じ、active gauge を減らす。 */
    public recordingSessionEnded(sessionId: number, attributes: Attributes = {}): void {
        if (this.sdk === null) return;
        if (this.activeSessions > 0) {
            this.activeSessions--;
            this.instruments.sessions?.add(-1);
        }
        const span = this.sessionSpans.get(sessionId);
        if (span !== undefined) {
            span.setAttributes(attributes);
            span.end();
            this.sessionSpans.delete(sessionId);
        }
    }

    /** 接続 attempt の子 span を開始する。 */
    public startRecordingAttempt(sessionId: number, attemptNo: number): SpanHandle {
        if (this.sdk === null) return { end: () => {} };
        const sessionSpan = this.sessionSpans.get(sessionId);
        const context =
            sessionSpan === undefined || this.api === null
                ? undefined
                : this.api.trace.setSpan(this.api.context.active(), sessionSpan);
        const span = this.tracer?.startSpan(
            'recording.attempt',
            { attributes: { 'recording.attempt.number': attemptNo } },
            context,
        );
        let ended = false;
        const handle = {
            end: (attributes: Attributes = {}): void => {
                if (ended) return;
                ended = true;
                span?.setAttributes(attributes);
                span?.end();
            },
        };
        this.attemptSpans.set(`${sessionId}:${attemptNo}`, handle);
        return handle;
    }

    /** attempt span を閉じる。 */
    public finishRecordingAttempt(sessionId: number, attemptNo: number, attributes: Attributes = {}): void {
        if (this.sdk === null) return;
        const key = `${sessionId}:${attemptNo}`;
        this.attemptSpans.get(key)?.end(attributes);
        this.attemptSpans.delete(key);
    }

    /** 再接続開始を数える。 */
    public reconnect(): void {
        if (this.sdk === null) return;
        this.instruments.reconnects?.add(1);
    }

    /** 上流の空白時間を記録する。 */
    public gap(durationMs: number): void {
        if (this.sdk === null) return;
        this.instruments.gaps?.record(durationMs);
    }

    /** 予定開始から初回データまでの遅延を記録する。 */
    public recordingStartDelay(delayMs: number): void {
        if (this.sdk === null) return;
        this.instruments.startDelay?.record(delayMs);
    }

    /** EIT timeout fallback を soft / hard 属性付きで数える。 */
    public eitFallback(kind: 'soft' | 'hard'): void {
        if (this.sdk === null) return;
        this.instruments.eitFallback?.add(1, { kind });
    }

    /** チューナー開始失敗を放送種別付きで数える。 */
    public tunerOpenFailure(channelType: string): void {
        if (this.sdk === null) return;
        this.instruments.openFailures?.add(1, { 'channel.type': channelType });
    }

    /** Planner span と結果メトリクス用の handle を返す。 */
    public startPlanner(): { conflicts: (count: number) => void; end: () => void } {
        if (this.sdk === null) return { conflicts: () => {}, end: () => {} };
        this.instruments.replans?.add(1);
        const span = this.tracer?.startSpan('scheduler.plan');
        let conflictCount = 0;
        return {
            conflicts: count => {
                conflictCount = count;
                if (count > 0) this.instruments.conflicts?.add(count);
            },
            end: () => {
                span?.setAttribute('scheduler.conflicts', conflictCount);
                span?.end();
            },
        };
    }
}

export default new Telemetry();
