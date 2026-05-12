import winston from 'winston';

export const createLogger = (label: string) => {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.label({ label }),
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ level, message, label, timestamp, ...metadata }) => {
        let msg = `${timestamp} [${label}] ${level}: ${message}`;
        if (Object.keys(metadata).length > 0) {
          msg += ` ${JSON.stringify(metadata)}`;
        }
        return msg;
      })
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      }),
      new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 10_485_760, maxFiles: 3 }),
      new winston.transports.File({ filename: 'logs/combined.log', maxsize: 20_971_520, maxFiles: 5 }),
    ],
  });
};
