import { createLogger, format, transports } from "winston";

/**
 * Creates a logger instance.
 * @param {string} [label='app'] - Used as the log filename and console prefix,
 *   so each account gets its own log file when multiple bots run at once.
 */
export function setupLogger(label = 'app') {
    return createLogger({
        level: 'debug',
        format: format.combine(
            format.timestamp({ format: "HH:mm:ss DD-MM-YYYY" }),
            format.printf(({ timestamp, level, message }) => {
                return `[${timestamp}] [${label}]: ${message}`;
            })
        ),
        transports: [
            // Fajl pamti SVE, uključujući sirove pakete (korisno za debug).
            new transports.File({ filename: `./logs/${label}.log`, level: 'debug' }),
            // Terminal prikazuje samo bitne stvari (greške, konekcije...),
            // bez spama od sirovih paketa (buddy liste i sl.).
            new transports.Console({ level: 'info' })
        ]
    });
}
