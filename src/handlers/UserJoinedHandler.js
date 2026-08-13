import { parseUser } from "../utils/helpers.js";
import { User } from "../core/User.js";

// Kad je vise bot naloga u istoj sobi, svi dobiju isti "korisnik je usao"
// paket. Umesto da SVAKI bot posalje pozdrav (izgleda ruzno - isti tekst
// vise puta u chatu), sacekamo kratko (JOIN_WINDOW_MS) da se svi bot
// nalozi koji su videli ovaj dolazak prijave, pa NASUMICNO izaberemo
// samo JEDNOG od njih (od trenutno aktivnih) da posalje pozdrav.
const pendingJoins = new Map(); // key -> { candidates: [{bot, userId, user}], timer }
const JOIN_WINDOW_MS = 400;

// xat prima cist tekst - nema pravog boje-po-slovu (gradijent) formata u
// poruci. Ovo je "fake" gradijent efekat: kolor kvadratici u spektru boja
// oko poruke, koji vizuelno podsecaju na gradijent traku.
const GRADIENT_BAR = ["🟪", "🟦", "🟩", "🟨", "🟧", "🟥"];

function applyGradientEffect (text) {
    const left = GRADIENT_BAR.join("");
    const right = [...GRADIENT_BAR].reverse().join("");
    return `${left} ${text} ${right}`;
}

export default {
    name: "u", // Packet name

    /**
     * Someone joined chat
     * @param {object} bot - Bot instance
     * @param {object} packet - Packet data
     */
    async execute(bot, packet) {
        const userId = parseUser(packet.u);
        if (userId >= 1900000000) return;

        // Add user to cache
        const user = new User(packet);
        bot.state.addUser(userId, user);

        // Fetch necessary values
        if (bot.state.settings.welcome_msg && bot.state.settings.welcome_msg != "off" && !user.hasBeenHere()) {
            const key = `${bot.state.chatInfo?.id ?? "chat"}-${userId}`;
            let entry = pendingJoins.get(key);

            if (!entry) {
                entry = { candidates: [] };
                pendingJoins.set(key, entry);

                entry.timer = setTimeout(async () => {
                    pendingJoins.delete(key);
                    if (entry.candidates.length === 0) return;

                    // Nasumicno biramo JEDNOG od aktivnih botova koji su videli ovaj dolazak
                    const chosen = entry.candidates[Math.floor(Math.random() * entry.candidates.length)];

                    const rawMessage = chosen.bot.state.settings.welcome_msg
                        .replace("{chatname}", chosen.bot.state.chatInfo.name)
                        .replace("{chatid}", chosen.bot.state.chatInfo.id)
                        .replace("{user}", chosen.user.getRegname() || "Unregistered")
                        .replace("{name}", chosen.user.getNick())
                        .replace("{uid}", chosen.userId);

                    const welcomeMessage = applyGradientEffect(rawMessage);

                    try {
                        // Send message via PM/PC - samo od izabranog bota
                        await chosen.bot.reply(welcomeMessage, chosen.userId, chosen.bot.state.settings.welcome_type);
                    } catch (error) {
                        chosen.bot.logger?.error?.(`Greska pri slanju pozdrava: ${error.message}`);
                    }
                }, JOIN_WINDOW_MS);
            }

            entry.candidates.push({ bot, userId, user });
        }
    },
};
