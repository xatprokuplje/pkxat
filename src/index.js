import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import express from 'express';
import { sequelize } from './core/Database.js';
import { Bot } from './core/Bot.js';
import { Account } from './models/Account.js';
import { Settings } from './models/Settings.js';
import { ACCOUNTS_CATALOG } from './accountsCatalog.js';
import './ping.js';

config();

// JEDNOKRATNI "clean start" - obriše bazu i sve keširane login sesije
// PRE nego što se sequelize/botovi uopšte pokrenu. Ovo je potrebno jer su
// stari database.db i cache/login_*.json fajlovi (verovatno commit-ovani u
// git sa lokalnog pokretanja) izazivali DUP na svakom Render deploy-u,
// pošto se isti "trulih" fajlovi vraćaju iz repoa pri svakom kloniranju.
//
// VAŽNO (Render): ako servis NEMA zakačen Persistent Disk, ceo fajl-sistem
// se ionako resetuje na svakom deploy-u - WIPE_ON_BOOT=false tu ništa ne
// menja, nalozi dodati preko panela i dalje neće preživeti deploy.
// Da nalozi TRAJNO ostanu (i preko deploy-a):
//   1. Render dashboard -> servis -> "Disks" -> dodaj disk (npr. 1GB),
//      mount path npr. /var/data
//   2. Env varijabla: DATA_DIR=/var/data
//   3. Env varijabla: WIPE_ON_BOOT=false (POSLE prvog čistog pokretanja)
// Bez diska, panel i dalje radi (brže je dodati naloge nego kroz .env),
// ali ih treba ponovo dodati posle svakog deploy-a.
const dataDir = process.env.DATA_DIR || '.';
if ((process.env.WIPE_ON_BOOT || 'true') !== 'false') {
    try {
        await fs.rm(`${dataDir}/database.db`, { force: true });
        await fs.rm(`${dataDir}/cache`, { recursive: true, force: true });
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
        isPrimary: account.isPrimary,
    });
    bots.set(account.id, bot);
    return bot;
}

/**
 * Katalog naloga - hardkodovana lista iz src/accountsCatalog.js (preživljava
 * deploy). Vraća svaki unos + da li je TRENUTNO aktivan (postoji u bazi).
 */
app.get('/api/catalog', requireAuth, safe(async (req, res) => {
    const activeAccounts = await Account.findAll();
    const activeByUsername = new Map(activeAccounts.map((a) => [a.username, a]));

    res.json(ACCOUNTS_CATALOG.map((entry) => {
        const active = activeByUsername.get(entry.username);
        const bot = active ? bots.get(active.id) : null;
        return {
            username: entry.username,
            nickname: entry.nickname || entry.username,
            active: Boolean(active),
            accountId: active?.id ?? null,
            connected: Boolean(bot?.state?.isConnected),
        };
    }));
}));

/**
 * Aktivira nalog iz kataloga po username-u: upisuje ga u bazu (ako već nije)
 * i pali bota. Jednim klikom u panelu, bez ručnog kucanja imena/API ključa.
 */
app.post('/api/catalog/:username/activate', requireAuth, safe(async (req, res) => {
    const entry = ACCOUNTS_CATALOG.find((a) => a.username === req.params.username);
    if (!entry) {
        return res.status(404).json({ error: 'Nalog nije u katalogu.' });
    }

    const existing = await Account.findOne({ where: { username: entry.username } });
    if (existing) {
        return res.status(409).json({ error: 'Nalog je već aktivan.' });
    }

    const hasPrimary = await Account.findOne({ where: { isPrimary: true } });
    const account = await Account.create({
        username: entry.username,
        apikey: entry.apikey,
        nickname: entry.nickname || entry.username,
        isPrimary: !hasPrimary,
    });

    try {
        startBot(account);
    } catch (error) {
        console.error(`Greška pri pokretanju naloga ${entry.username}: ${error.message}`);
    }

    res.status(201).json({ id: account.id, username: account.username });
}));

/**
 * Deaktivira nalog: gasi bota i briše ga iz baze. Ostaje u katalogu (kodu)
 * za sledeću aktivaciju - ništa se ne gubi.
 */
app.post('/api/catalog/:username/deactivate', requireAuth, safe(async (req, res) => {
    const account = await Account.findOne({ where: { username: req.params.username } });
    if (!account) {
        return res.status(404).json({ error: 'Nalog nije aktivan.' });
    }

    const bot = bots.get(account.id);
    if (bot) {
        try {
            await bot.stop();
        } catch (error) {
            console.error(`Greška pri gašenju bota: ${error.message}`);
        }
        bots.delete(account.id);
    }

    await account.destroy();
    res.json({ success: true });
}));

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
            isPrimary: a.isPrimary,
        };
    }));
}));

/**
 * Sets ONE account as "primary" (the only one that sends the welcome
 * message) and unsets every other account. Updates both the DB and the
 * already-running in-memory bots, so it takes effect immediately without
 * restarting anything.
 */
app.post('/api/accounts/:id/primary', requireAuth, safe(async (req, res) => {
    const id = Number(req.params.id);
    const account = await Account.findByPk(id);
    if (!account) {
        return res.status(404).json({ error: 'Nalog nije pronađen.' });
    }

    await Account.update({ isPrimary: false }, { where: {} });
    await Account.update({ isPrimary: true }, { where: { id } });

    for (const [accId, bot] of bots) {
        bot.setPrimary(accId === id);
    }

    res.json({ success: true, primaryId: id });
}));

/**
 * Dodaje VIŠE naloga odjednom, umesto pojedinačno preko modala.
 * Body: { accounts: [{ username, apikey, nickname? }, ...] }
 * Nove naloge palimo sa malim razmakom (kao i na startu servisa) da
 * izbegnemo DUP od istovremenog logovanja više naloga.
 */
app.post('/api/accounts/bulk', requireAuth, safe(async (req, res) => {
    const rows = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
    if (rows.length === 0) {
        return res.status(400).json({ error: 'Lista naloga je prazna.' });
    }

    const created = [];
    const errors = [];
    let hasPrimary = Boolean(await Account.findOne({ where: { isPrimary: true } }));

    for (const row of rows) {
        const username = String(row?.username || '').trim();
        const apikey = String(row?.apikey || '').trim();
        const nickname = String(row?.nickname || '').trim() || username;

        if (!username || !apikey) {
            errors.push({ username: username || '(prazno)', error: 'Korisničko ime i API ključ su obavezni.' });
            continue;
        }

        const existing = await Account.findOne({ where: { username } });
        if (existing) {
            errors.push({ username, error: 'Nalog sa tim korisničkim imenom je već dodat.' });
            continue;
        }

        try {
            const account = await Account.create({ username, apikey, nickname, isPrimary: !hasPrimary });
            if (!hasPrimary) hasPrimary = true; // samo prvi u ovoj seriji postaje glavni
            created.push(account);
        } catch (error) {
            errors.push({ username, error: error.message });
        }
    }

    // Palimo nove naloge sa razmakom od 4s (isto kao na startu servisa),
    // asinhrono, da ne blokiramo HTTP odgovor dok se svi ne uloguju.
    (async () => {
        for (let i = 0; i < created.length; i++) {
            try {
                startBot(created[i]);
            } catch (error) {
                console.error(`Greška pri pokretanju naloga ${created[i].username}: ${error.message}`);
            }
            if (i < created.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 4000));
            }
        }
    })();

    res.status(created.length ? 201 : 400).json({
        created: created.map((a) => ({ id: a.id, username: a.username, nickname: a.nickname })),
        errors,
    });
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

    const hasPrimary = await Account.findOne({ where: { isPrimary: true } });
    const account = await Account.create({ username, apikey, nickname, isPrimary: !hasPrimary });

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

    // Osiguraj da tačno JEDAN nalog bude "glavni" (šalje pozdravnu poruku).
    // Ako baza već ima naloge a nijedan nije označen (npr. stari podaci od
    // pre ove izmene), prvi dodati nalog automatski postaje glavni.
    if (accounts.length > 0 && !accounts.some((a) => a.isPrimary)) {
        accounts[0].isPrimary = true;
        await accounts[0].save();
        console.log(`Nalog "${accounts[0].username}" automatski postavljen kao glavni (šalje pozdrav).`);
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
