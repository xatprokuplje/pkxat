export class BotState {
    /**
     * @param {object} [accountConfig] - Per-account credentials ({ username, apikey }).
     *   When omitted, falls back to BOT_USER / BOT_APIKEY from process.env so the
     *   single-account setup keeps working unchanged.
     */
    constructor(accountConfig = {}) {
        this.ws = null;
        this.isLoggingIn = false;
        this.isConnected = false;
        this.isStopped = false;
        this.intervals = [];
        this.chatInfo = {};
        this.badwords = {};
        this.loginInfo = {};
        this.settings = {};
        this.commands = {};
        this.usersFlood = {};
        this.users = new Map();
        this.userKicks = new Map();
        this.lastMessageUserId = null;
        this.lastMessageTimestamp = 0;

        const username = accountConfig.username || process.env.BOT_USER;
        const apiKey = accountConfig.apikey || process.env.BOT_APIKEY;

        // Nick koji se prikazuje u chatu za OVAJ nalog. Podrazumevano je
        // username, ali se može promeniti u letu preko admin panela
        // (vidi Bot.setNickname).
        this.nickname = accountConfig.nickname || username;

        // Lista poruka koje nalog šalje u krug (auto-poruke) i razmak
        // između njih. Menja se u letu preko admin panela (vidi
        // Bot.setMessages).
        this.autoMessages = Array.isArray(accountConfig.messages) ? accountConfig.messages : [];
        this.messageIntervalMs = accountConfig.messageIntervalMs || 60000;
        this.autoMessageIndex = 0;

        this.envData = {
            username,
            apiKey,
            chat: process.env.BOT_CHAT,
            language: process.env.CHAT_LANGUAGE,
            websocketUrl: process.env.WEBSOCKET_URL,
            websocketOrigin: process.env.WEBSOCKET_ORIGIN,
            openaiApiKey: process.env.OPENAI_KEY,
            owners: JSON.parse(process.env.BOT_OWNERS),
            disabledPowers: JSON.parse(process.env.DISABLED_POWERS),
        };

        // Each account needs its own login-session file so multiple accounts
        // running in the same process don't overwrite each other's session.
        this.loginCachePath = `./cache/login_${username}.json`;
    }

    /**
     * Adds or updates a user in the users map.
     * @param {number} id User ID to add.
     * @param {User} user User instance to add.
     */
    addUser(id, user) {
        this.users.set(id, user);
    }

    /**
     * Increments kick count for a user and returns the new count.
     * @param {number} userId
     * @return {number}
     */
    incrementKick(userId) {
        const kicks = (this.userKicks.get(userId) || 0) + 1;
        this.userKicks.set(userId, kicks);
        return kicks;
    }

    /**
     * Gets the current kick count for a user.
     * @param {number} userId
     * @return {number}
     */
    getKicks(userId) {
        return this.userKicks.get(userId) || 0;
    }

    /**
     * Resets the kick count for a user.
     * @param {number} userId
     */
    resetKicks(userId) {
        this.userKicks.set(userId, 0);
    }

    /**
     * Removes a user from the users map by ID.
     * @param {number} userId User ID to remove.
     */
    removeUser(userId) {
        this.users.delete(userId);
    }

    /**
     * Gets a user by ID from the users map.
     * @param {number} userId User ID to retrieve.
     * @return {User|undefined}
     */
    getUser(userId) {
        return this.users.get(userId);
    }
}