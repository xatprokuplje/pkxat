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
    }
}, {
    timestamps: true
});
