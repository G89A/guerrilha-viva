import { describe, expect, it, vi } from 'vitest';
import { createLogger, type LogRecord } from '@/lib/logging/logger';
import { REDACTED } from '@/lib/logging/redact';

function collector() {
  const records: LogRecord[] = [];
  return { records, sink: (record: LogRecord) => records.push(record) };
}

describe('createLogger', () => {
  it('emits structured JSON-serialisable records', () => {
    const { records, sink } = collector();
    const logger = createLogger({ level: 'debug', sink, now: () => new Date('2026-05-01T10:00:00Z') });

    logger.info('campaign.started', { campaignId: 'camp_1' });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'info',
      message: 'campaign.started',
      campaignId: 'camp_1',
      timestamp: '2026-05-01T10:00:00.000Z',
    });
    expect(() => JSON.stringify(records[0])).not.toThrow();
  });

  it('drops records below the configured level', () => {
    const { records, sink } = collector();
    const logger = createLogger({ level: 'warn', sink });

    logger.debug('ignored');
    logger.info('ignored');
    logger.warn('kept');
    logger.error('kept');

    expect(records.map((record) => record.level)).toEqual(['warn', 'error']);
  });

  it('redacts secrets passed through context', () => {
    const { records, sink } = collector();
    const logger = createLogger({ level: 'debug', sink });

    logger.error('provider.call_failed', { metaAccessToken: 'EAAG-real' });

    expect(records[0]?.metaAccessToken).toBe(REDACTED);
  });

  it('merges child bindings into every record', () => {
    const { records, sink } = collector();
    const logger = createLogger({ level: 'debug', sink, base: { service: 'outreach' } });

    logger.child({ workspaceId: 'ws_1' }).info('scoped');

    expect(records[0]).toMatchObject({ service: 'outreach', workspaceId: 'ws_1' });
  });

  it('never writes to the sink when level filtering excludes the record', () => {
    const sink = vi.fn();
    createLogger({ level: 'error', sink }).info('quiet');
    expect(sink).not.toHaveBeenCalled();
  });
});
