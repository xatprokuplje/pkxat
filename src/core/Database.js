import { Sequelize } from "sequelize";
import path from "path";

// Ako je DATA_DIR postavljen (npr. na Render disku), baza se čuva TAMO
// umesto u kod-folderu, da preživi redeploy. Bez DATA_DIR ponaša se kao
// pre (baza pored koda) - za lokalni rad ništa se ne menja.
const dataDir = process.env.DATA_DIR || ".";

export const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: path.join(dataDir, "database.db"),
    logging: false
});