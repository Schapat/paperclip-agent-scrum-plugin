/**
 * Unit Tests für den Logger
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger, formatError, logApiOperation, type LogEntry } from '../logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger with default config', () => {
      const logger = createLogger();
      expect(logger).toHaveProperty('debug');
      expect(logger).toHaveProperty('info');
      expect(logger).toHaveProperty('warn');
      expect(logger).toHaveProperty('error');
      expect(logger).toHaveProperty('child');
    });

    it('should respect log level filtering', () => {
      const handler = vi.fn();
      const logger = createLogger({ level: 'warn', handler });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(handler).toHaveBeenCalledTimes(2); // Only warn and error
    });

    it('should include custom prefix', () => {
      const handler = vi.fn();
      const logger = createLogger({ prefix: '[Custom]', handler });

      logger.info('test message');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ context: '[Custom]' })
      );
    });

    it('should create child logger with combined prefix', () => {
      const handler = vi.fn();
      const logger = createLogger({ prefix: '[Parent]', handler });
      const child = logger.child('Child');

      child.info('child message');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ context: '[Parent]:Child' })
      );
    });

    it('should call custom handler with log entry', () => {
      const handler = vi.fn();
      const logger = createLogger({ handler });

      logger.info('test message', { key: 'value' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'test message',
          data: { key: 'value' },
        })
      );
    });

    it('should include timestamp in log entry', () => {
      const handler = vi.fn();
      const logger = createLogger({ handler });

      logger.info('test');

      const entry = handler.mock.calls[0][0] as LogEntry;
      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe('log levels', () => {
    it('should log debug messages when level is debug', () => {
      const handler = vi.fn();
      const logger = createLogger({ level: 'debug', handler });

      logger.debug('debug');
      expect(handler).toHaveBeenCalled();
    });

    it('should not log debug when level is info', () => {
      const handler = vi.fn();
      const logger = createLogger({ level: 'info', handler });

      logger.debug('debug');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should log info and above when level is info', () => {
      const handler = vi.fn();
      const logger = createLogger({ level: 'info', handler });

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should only log errors when level is error', () => {
      const handler = vi.fn();
      const logger = createLogger({ level: 'error', handler });

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'error' })
      );
    });
  });

  describe('console output', () => {
    it('should call console.debug for debug level', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const logger = createLogger({ level: 'debug' });

      logger.debug('debug message');

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should call console.info for info level', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = createLogger();

      logger.info('info message');

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should call console.warn for warn level', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = createLogger();

      logger.warn('warn message');

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should call console.error for error level', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = createLogger();

      logger.error('error message');

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});

describe('formatError', () => {
  it('should format Error objects', () => {
    const error = new Error('Test error');
    const formatted = formatError(error);

    expect(formatted).toContain('Error: Test error');
  });

  it('should include stack trace when available', () => {
    const error = new Error('Test error');
    const formatted = formatError(error);

    expect(formatted).toContain('at ');
  });

  it('should handle custom error names', () => {
    const error = new TypeError('Type error');
    const formatted = formatError(error);

    expect(formatted).toContain('TypeError: Type error');
  });

  it('should convert non-Error values to string', () => {
    expect(formatError('string error')).toBe('string error');
    expect(formatError(123)).toBe('123');
    expect(formatError({ msg: 'object' })).toBe('[object Object]');
  });

  it('should handle null and undefined', () => {
    expect(formatError(null)).toBe('null');
    expect(formatError(undefined)).toBe('undefined');
  });
});

describe('logApiOperation', () => {
  it('should create info level for successful operations', () => {
    const entry = logApiOperation(
      'createIssue',
      { title: 'Test' },
      { success: true }
    );

    expect(entry.level).toBe('info');
    expect(entry.message).toBe('API createIssue');
    expect(entry.context).toBe('API');
  });

  it('should create error level for failed operations', () => {
    const entry = logApiOperation(
      'createIssue',
      { title: 'Test' },
      { success: false, error: 'Failed' }
    );

    expect(entry.level).toBe('error');
  });

  it('should include params and result in data', () => {
    const entry = logApiOperation(
      'updateIssue',
      { id: '123', status: 'done' },
      { success: true }
    );

    expect(entry.data).toEqual({
      params: { id: '123', status: 'done' },
      result: { success: true },
    });
  });

  it('should create info level when no result provided', () => {
    const entry = logApiOperation('getIssue', { id: '123' });

    expect(entry.level).toBe('info');
  });

  it('should include timestamp', () => {
    const entry = logApiOperation('test', {});

    expect(entry.timestamp).toBeDefined();
    expect(new Date(entry.timestamp).getTime()).toBeGreaterThan(0);
  });
});
