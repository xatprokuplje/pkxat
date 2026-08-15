import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import express from 'express';
import { sequelize } from './core/Database.js';
import { Bot } from './core/Bot.js';
import { Account } from './models/Account.js';
import { Settings } from './models/Settings.js';
import './ping.js';

config();

// JEDNOKRATNI "clean start" - obriše bazu i sve keširane login sesije
// PRE nego što se sequelize/botovi uopšte pokrenu. Ovo je potrebno jer su
// stari database.db i cache/login_*.json fajlovi (verovatno commit-ovani u
// git sa lokalnog pokretanja) izazivali DUP na svakom Render deploy-u,
// pošto se isti "trulih" fajlovi vraćaju iz repoa pri svakom kloniranju.
//
// VAŽNO: postavi WIPE_ON_BOOT=false u Render env varijablama posle prvog
// čistog pokretanja, inače ćeš gubiti bazu (naloge/podešavanja) i login
// keš na SVAKI restart/deploy zauvek.
if ((process.env.WIPE_ON_BOOT || 'true') !== 'false') {
    try {
        await fs.rm('./database.db', { force: true });
        await fs.rm('./cache', { recursive: true, force: true });
        console.log('WIPE_ON_BOOT: baza i cache obrisani, kreće se ispočetka.');
    } catch (error) {
        console.error(`WIPE_ON_BOOT greška: ${error.message}`);
    }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;

// Ako je ADMIN_TOKEN postavljen u .env, admin panel/API traže taj kod.
// Ako nije postavljen, panel je otvoren svima koji dođu na URL (samo za lokalni rad!).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// accountId -> Bot instanca. Svi nalozi rade unutar OVOG istog procesa/servisa.
const bots = new Map();

// Startni nalozi koji se automatski dodaju SAMO ako je baza prazna (prvo
// ikad pokretanje servisa). Posle toga se sve radi preko panela.
const SEED_ACCOUNTS = [
    { username: 'AngelDobric', apikey: 'f9c78e399213cc93', nickname: 'AngelDobric' },
];

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function requireAuth (req, res, next) {
    if (!ADMIN_TOKEN) return next();
    if (req.header('x-admin-token') !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Neispravan pristupni kod.' });
    }
    next();
}

// Svaka async ruta se propušta kroz ovo, da izuzetak ne obori ceo proces
// (Node inače gasi ceo server na "unhandled rejection") nego se vrati kao 500.
function safe (fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Starts a Bot instance for a stored account and tracks it in `bots`.
 * @param {Account} account
 */
function startBot (account) {
    const bot = new Bot({
        username: account.username,
        apikey: account.apikey,
        nickname: account.nickname || account.username,
        messages: account.messages,
        messageIntervalMs: account.messageIntervalMs,
    });
    bots.set(account.id, bot);
    return bot;
}

app.get('/api/accounts', requireAuth, safe(async (req, res) => {
    const accounts = await Account.findAll({ order: [['createdAt', 'ASC']] });
    res.json(accounts.map((a) => {
        const bot = bots.get(a.id);
        return {
            id: a.id,
            username: a.username,
            nickname: a.nickname || a.username,
            connected: Boolean(bot?.state?.isConnected),
            messages: a.messages,
            messageIntervalMs: a.messageIntervalMs,
        };
    }));
}));

app.post('/api/accounts', requireAuth, safe(async (req, res) => {
    const username = (req.body?.username || '').trim();
    const apikey = (req.body?.apikey || '').trim();
    const nickname = (req.body?.nickname || '').trim() || username;

    if (!username || !apikey) {
        return res.status(400).json({ error: 'Korisničko ime i API ključ su obavezni.' });
    }

    const existing = await Account.findOne({ where: { username } });
    if (existing) {
        return res.status(409).json({ error: 'Nalog sa tim korisničkim imenom je već dodat.' });
    }

    const account = await Account.create({ username, apikey, nickname });

    try {
        startBot(account);
    } catch (error) {
        // Nalog ostaje sačuvan u bazi čak i ako pokretanje bota odmah ne uspe
        // (npr. loš API ključ) - videćeš ga kao offline u panelu.
        console.error(`Greška pri pokretanju bota ${username}: ${error.message}`);
    }

    res.status(201).json({ id: account.id, username: account.username, nickname: account.nickname });
}));

app.patch('/api/accounts/:id', requireAuth, safe(async (req, res) => {
    const id = Number(req.params.id);
    const account = await Account.findByPk(id);
    if (!account) {
        return res.status(404).json({ error: 'Nalog nije pronađen.' });
    }

    const bot = bots.get(id);

    // Nickname je opcion na ovoj ruti - može stići sam, zajedno sa
    // porukama, ili nijedno od to dvoje (npr. samo interval).
    if (req.body?.nickname !== undefined) {
        const nickname = (req.body.nickname || '').trim();
        if (!nickname) {
            return res.status(400).json({ error: 'Nickname je obavezan.' });
        }

        account.nickname = nickname;

        if (bot) {
            try {
                await bot.setNickname(nickname);
            } catch (error) {
                console.error(`Greška pri promeni nickname-a: ${error.message}`);
            }
        }
    }

    // Lista auto-poruka i/ili razmak između njih (u minutima, sa panela).
    if (req.body?.messages !== undefined || req.body?.messageIntervalMinutes !== undefined) {
        if (req.body.messages !== undefined) {
            if (!Array.isArray(req.body.messages)) {
                return res.status(400).json({ error: 'Poruke moraju biti niz.' });
            }
            account.messages = req.body.messages;
        }

        if (req.body.messageIntervalMinutes !== undefined) {
            const minutes = Number(req.body.messageIntervalMinutes);
            if (!Number.isFinite(minutes) || minutes <= 0) {
                return res.status(400).json({ error: 'Interval mora biti broj veći od 0.' });
            }
            account.messageIntervalMs = Math.round(minutes * 60000);
        }

        if (bot) {
            try {
                await bot.setMessages(account.messages, account.messageIntervalMs);
            } catch (error) {
                console.error(`Greška pri ažuriranju poruka: ${error.message}`);
            }
        }
    }

    await account.save();

    res.json({
        id: account.id,
        username: account.username,
        nickname: account.nickname,
        messages: account.messages,
        messageIntervalMs: account.messageIntervalMs,
    });
}));

app.delete('/api/accounts/:id', requireAuth, safe(async (req, res) => {
    const id = Number(req.params.id);
    const account = await Account.findByPk(id);

    if (!account) {
        return res.status(404).json({ error: 'Nalog nije pronađen.' });
    }

    const bot = bots.get(id);
    if (bot) {
        try {
            await bot.stop();
        } catch (error) {
            console.error(`Greška pri gašenju bota: ${error.message}`);
        }
        bots.delete(id);
    }

    await account.destroy();
    res.json({ success: true });
}));

// Sve neuhvaćene greške iz ruta završe ovde umesto da obore server.
app.use((err, req, res, next) => {
    console.error(`API error: ${err.message}\n${err.stack}`);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Došlo je do greške na serveru. Pokušaj ponovo.' });
});

// Poslednja linija odbrane: loguj i nastavi da radiš umesto da se ceo servis
// (i svi nalozi na njemu) ugase zbog jedne neočekivane greške.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

// Kad se server gasi (Ctrl+C u terminalu), lepo zatvori sve konekcije ka xat-u
// pre izlaska. Bez ovoga sesije ostaju "zaglavljene" na xat serveru i sledeći
// pokušaj povezivanja dobija DUP grešku.
async function shutdown () {
    console.log('Gašenje servera, zatvaram sve konekcije...');
    for (const bot of bots.values()) {
        try {
            await bot.stop();
        } catch { }
    }
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

(async () => {
    await sequelize.authenticate();
    await sequelize.sync();

    // Napravi red sa podešavanjima PRE nego što se ijedan bot pokrene, da
    // izbegnemo trku ("race condition") kad više naloga startuje istovremeno
    // i svaki pokuša da napravi isti red u bazi.
    await Settings.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });

    const accounts = await Account.findAll();

    // Jednokratno seedovanje: ako baza još nema NIJEDAN nalog (prvo ikad
    // pokretanje), ubaci startne naloge. Posle toga sve ide preko panela.
    if (accounts.length === 0) {
        for (const acc of SEED_ACCOUNTS) {
            const created = await Account.create(acc);
            accounts.push(created);
            console.log(`Dodat startni nalog: ${created.username}`);
        }
    }

    // Naloge palimo sa malim razmakom (ne sve u istom trenutku) - simultano
    // logovanje više naloga ka xat-u je čest okidač za DUP/koliziju.
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
            startBot(account);
        } catch (error) {
            console.error(`Greška pri pokretanju naloga ${account.username}: ${error.message}`);
        }
        if (i < accounts.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 4000));
        }
    }

    console.log(`Pokrenuto naloga: ${accounts.length}`);
})();
