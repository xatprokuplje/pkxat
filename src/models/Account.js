import { DataTypes } from "sequelize";
import { sequelize } from "../core/Database.js";

export const Account = sequelize.define("account", {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    apikey: {
        type: DataTypes.STRING,
        allowNull: false
    },
    // Nadimak kojim se nalog prikazuje u chatu. Podrazumevano = username,
    // ali može dinamički da se menja preko admin panela.
    nickname: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // Lista poruka koje nalog automatski šalje u chat, redom, u krug.
    // Čuva se kao JSON niz stringova (npr. ["Poruka 1", "Poruka 2"]).
    messages: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '[]',
        get () {
            const raw = this.getDataValue('messages');
            try {
                const parsed = JSON.parse(raw || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        },
        set (value) {
            const arr = Array.isArray(value) ? value : [];
            this.setDataValue('messages', JSON.stringify(arr.map((m) => String(m)).filter((m) => m.trim().length > 0)));
        }
    },
    // Razmak između automatskih poruka, u milisekundama. Podrazumevano 1 minut.
    messageIntervalMs: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 60000
    }
}, {
    timestamps: true
});
