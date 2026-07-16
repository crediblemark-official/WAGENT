import pino from 'pino';

let _logger: pino.Logger | null = null;

export function createLogger(name: string, level = 'info'): pino.Logger {
  _logger = pino({
    name,
    level: process.env.LOG_LEVEL || level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  });
  return _logger;
}

export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = createLogger('wagent');
  }
  return _logger;
}
