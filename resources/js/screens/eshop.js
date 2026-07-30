/* Obrazovka E-shop — živé dáta zo SPERKY API (sperky-eshop.sk).

   SKELETON. Obsah dopĺňa agent SPERKY-FE; tento súbor je už zapojený v app.js,
   takže netreba siahať do zdieľaných súborov.

   POVINNÉ OBMEDZENIA z refactor-auraai/08-SPERKY-API-SPEC.md — nie sú to
   odporúčania, sú to dôsledky overenia proti živej produkcii:

   N1  `total_paid` je v mene objednávky, ale API menu NEVRACIA. HU=HUF, CZ=CZK,
       SK/SI=EUR; na vzorke 100 objednávok bolo 37 hodnôt nad 1000. Súčet cez
       objednávky je preto nezmyselné číslo.
       → hlavné číslo obrazovky je POČET objednávok
       → obrat LEN rozpadnutý podľa country_iso, s priznaním, že mena je odhad
       → ZAKÁZANÉ: jedno súhrnné číslo obratu, akýkoľvek prepočet na EUR
   N2  `has_attributes` a `attributes` v odpovedi neexistujú → varianty nezobrazuj.
   N3  filtrovanie podľa dátumu neexistuje — neznámy parameter API tichým
       spôsobom zahodí, takže „objednávky za včera" sa nedá vyžiadať priamo.
   N6  HTTP status nie je zdroj pravdy: `forbidden` aj `no id` prídu s kódom 200
       a chybou v tele. Klient MUSÍ čítať telo.
   N7  všetky čísla vždy z API, nikdy z konštanty.

   Keď je API nedostupné, obrazovka to musí povedať a nespadnúť. */

/**
 * @param {ParentNode} root
 */
export function register(root) {
    void root;
    // SPERKY-FE: naplň. Vzor anatómie obrazovky je v screens/library.js
    // (toolbar → sekcie → skeleton/empty/error stavy zo screens/shared/anatomy.js).
}
