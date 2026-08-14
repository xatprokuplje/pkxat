import { writeFile } from 'fs/promises';

export default {
    name: 'dup', // Packet name

    /**
     * Duplicate connection - xat javlja da je OVAJ nalog već konektovan
     * sa istom (keširanom) sesijom. Ako samo pokušamo ponovo sa istim
     * `loginInfo` iz cache-a, xat opet vraća DUP - u beskonačnom krugu.
     * Zato brišemo keširanu sesiju i forsiramo potpuno novo logovanje
     * (fresh 'v' paket sa username/apikey) pre sledećeg pokušaja.
     *
     * Više naloga radi u ISTOM Node procesu (vidi index.js), pa
     * `process.exit()` ovde ne bi ugasio samo ovaj nalog - ugasio bi
     * CEO servis i sve ostale naloge zajedno sa njim.
     */
    async execute (bot, packet) {
        bot.logger.error('DUP - stara keširana sesija je već aktivna. Brišem keš i tražim novo logovanje za ovaj nalog.');

        bot.state.isConnected = false;
        bot.state.isLoggingIn = true;
        bot.state.loginInfo = {};

        try {
            await writeFile(bot.state.loginCachePath, '{}');
        } catch (error) {
            bot.logger.error(`Greška pri brisanju keša: ${error.message}`);
        }

        try {
            bot.state.ws?.terminate();
        } catch { }

        if (!bot.state.isStopped) {
            clearTimeout(bot.state.reconnectTimer);
            bot.state.reconnectTimer = setTimeout(() => {
                if (!bot.state.isStopped && !bot.state.isConnected) {
                    bot.logger.info('Ponovni pokušaj konekcije (sa svežim logovanjem) posle DUP-a...');
                    bot.connect();
                }
            }, 20000);
        }
    }
}