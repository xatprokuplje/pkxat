// KATALOG NALOGA - hardkodovana lista koja PREŽIVLJAVA svaki deploy, jer je
// deo koda (git-a), a ne baze. WIPE_ON_BOOT briše samo database.db i cache/,
// nikad ne dira ovaj fajl.
//
// Ovo NIJE lista aktivnih naloga - to je samo "katalog" iz kog u panelu
// jednim klikom aktiviraš/deaktiviraš nalog (vidi GET/POST /api/catalog u
// src/index.js). Aktivacija upisuje nalog u bazu i pali bota; deaktivacija
// gasi bota i briše ga iz baze - ali ostaje ovde u katalogu za sledeći put.
//
// Da dodaš nalog: dodaj novi red u nizu ispod. Nickname je opcion (ako ga
// izostaviš, koristi se username). Posle izmene ovog fajla treba redeploy
// (kao i za bilo koju izmenu koda) da bi se novi unos pojavio u katalogu.
export const ACCOUNTS_CATALOG = [
    { username: "AngelDobric", apikey: "f9c78e399213cc93", nickname: "AngelDobric" },
    { username: "KikoslavGal", apikey: "17c670f729eabd33", nickname: "zizu" },
    { username: "Vanesagalaksija", apikey: "eb4f3c42043b873e", nickname: "galaksija" },
    { username: "RadioXgalaksija", apikey: "3bf3b781c3d015b6", nickname: "zizu" },

    // Dodaj ispod još naloga po istom obrascu:
    // { username: "NoviNalog", apikey: "NJEGOVAPIKLJUC", nickname: "Nadimak" },
];
