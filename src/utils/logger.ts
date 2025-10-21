import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf((i) => `${i.timestamp} [${i.level}] ${i.message}`)
  ),
  transports: [new winston.transports.Console()],
});

export function logErr(e: unknown, ctx = '') {
  const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
  logger.error(`${ctx ? `[${ctx}] ` : ''}${msg}`);
}


