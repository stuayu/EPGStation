'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createTelemetryResourceAttributes, default: telemetry } = require('../../dist/model/observability/Telemetry');

test('Operator と Service の service.name にプロセス種別を含める', () => {
    assert.equal(createTelemetryResourceAttributes({}, 'operator')['service.name'], 'epgstation-operator');
    assert.equal(
        createTelemetryResourceAttributes({ serviceName: 'station' }, 'service')['service.name'],
        'station-service',
    );
});

test('OpenTelemetry 無効時は SDK を読み込まず計測 API が何もしない', async () => {
    await telemetry.initialize({ observability: { otel: { enabled: false } } }, 'operator');

    telemetry.recordingSessionStarted(1);
    telemetry.recordingSessionEnded(1);
    telemetry.startRecordingAttempt(1, 1).end();
    telemetry.finishRecordingAttempt(1, 1);
    telemetry.reconnect();
    telemetry.gap(10);
    telemetry.recordingStartDelay(20);
    telemetry.eitFallback('soft');
    telemetry.tunerOpenFailure('GR');
    const planner = telemetry.startPlanner();
    planner.conflicts(1);
    planner.end();
    await telemetry.shutdown();

    for (const packageName of [
        '@opentelemetry/api',
        '@opentelemetry/sdk-node',
        '@opentelemetry/resources',
        '@opentelemetry/sdk-metrics',
        '@opentelemetry/exporter-trace-otlp-http',
        '@opentelemetry/exporter-metrics-otlp-http',
    ]) {
        assert.equal(require.cache[require.resolve(packageName)], undefined, `${packageName} が未ロード`);
    }
});

test('OpenTelemetry 有効時に endpoint が空なら明示的に失敗する', async () => {
    await assert.rejects(
        telemetry.initialize({ observability: { otel: { enabled: true } } }, 'service'),
        /observability\.otel\.endpoint/,
    );
});

test('有効時は in-memory exporter に recording metrics と親子 span を記録する', async () => {
    const {
        MeterProvider,
        InMemoryMetricExporter,
        PeriodicExportingMetricReader,
    } = require('@opentelemetry/sdk-metrics');
    const { NodeTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } = require('@opentelemetry/sdk-trace-node');
    const api = require('@opentelemetry/api');
    const metricExporter = new InMemoryMetricExporter();
    const metricReader = new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60 * 60 * 1000,
    });
    const meterProvider = new MeterProvider({ readers: [metricReader] });
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] });
    let sdkShutdownCount = 0;

    await telemetry.initialize(
        { observability: { otel: { enabled: true, endpoint: 'http://localhost:4318' } } },
        'operator',
        {
            sdk: {
                start: () => {},
                shutdown: () => {
                    sdkShutdownCount++;
                },
            },
            tracer: tracerProvider.getTracer('epgstation-test'),
            meter: meterProvider.getMeter('epgstation-test'),
            api,
        },
    );

    telemetry.recordingSessionStarted(17);
    telemetry.startRecordingAttempt(17, 1);
    telemetry.finishRecordingAttempt(17, 1, { 'recording.close.reason': 'completed' });
    telemetry.recordingStartDelay(800);
    telemetry.reconnect();
    telemetry.gap(125);
    telemetry.eitFallback('hard');
    telemetry.tunerOpenFailure('NW12');
    const planner = telemetry.startPlanner();
    planner.conflicts(2);
    planner.end();
    telemetry.recordingSessionEnded(17, { 'recording.result.status': 'completed' });

    await tracerProvider.forceFlush();
    const collected = await metricReader.collect();
    const spans = spanExporter.getFinishedSpans();
    const metrics = collected.resourceMetrics.scopeMetrics.flatMap(scope => scope.metrics);
    const byName = new Map(metrics.map(metric => [metric.descriptor.name, metric]));

    assert.deepEqual(
        spans.map(span => span.name).sort(),
        ['recording.attempt', 'recording.session', 'scheduler.plan'].sort(),
    );
    const sessionSpan = spans.find(span => span.name === 'recording.session');
    const attemptSpan = spans.find(span => span.name === 'recording.attempt');
    assert.equal(attemptSpan.parentSpanContext.spanId, sessionSpan.spanContext().spanId);
    assert.equal(byName.get('recording.sessions.active').dataPoints[0].value, 0);
    assert.equal(byName.get('recording.transport.reconnects').dataPoints[0].value, 1);
    assert.equal(byName.get('recording.transport.gap_ms').dataPoints[0].value.sum, 125);
    assert.equal(byName.get('recording.start.delay_ms').dataPoints[0].value.sum, 800);
    assert.equal(byName.get('recording.eit.fallback').dataPoints[0].value, 1);
    assert.equal(byName.get('scheduler.conflicts').dataPoints[0].value, 2);
    assert.equal(byName.get('scheduler.replans').dataPoints[0].value, 1);
    assert.equal(byName.get('tuner.open_failures').dataPoints[0].attributes['channel.type'], 'NW12');

    await telemetry.shutdown();
    assert.equal(sdkShutdownCount, 1);
    await Promise.all([meterProvider.shutdown(), tracerProvider.shutdown()]);
});
