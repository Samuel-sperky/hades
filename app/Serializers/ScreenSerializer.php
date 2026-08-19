<?php

namespace App\Serializers;

/**
 * Základ pre serializéry obrazoviek — jedno miesto pravdy pre plochu človeka
 * aj pre plochu AI.
 *
 * Kontrakt dvojitej plochy: **endpoint a MCP tool čítajú TEN ISTÝ `data()`.**
 * Endpoint ho vráti celý, MCP tool z neho vezme deklarovaný zoznam kľúčov a
 * vyhodí prázdne polia. Rozdiel medzi tým, čo vidí človek, a tým, čo dostane AI,
 * je preto **jeden zoznam kľúčov**, nie druhá implementácia — a keď sa obrazovka
 * zmení, AI to dostane zadarmo.
 *
 * Prečo sa prázdne polia AI neposielajú: je to kánon z CLAUDE.md („MCP — odpoveď
 * je pre AI, nie pre človeka"). `null` je 20 B za nulovú informáciu na každom
 * riadku a význam vynechania patrí do popisu nástroja, nie do payloadu. Človek
 * naopak potrebuje aj prázdne polia, aby UI nemuselo hádať tvar.
 */
abstract class ScreenSerializer
{
    /**
     * Celý obsah obrazovky. Toto je jediná metóda, ktorú potomok musí napísať.
     *
     * @return array<string, mixed>
     */
    abstract public function data(): array;

    /**
     * Kľúče, ktoré má dostať AI. Prázdny zoznam znamená „všetko, čo `data()`" —
     * použiteľné pre obrazovky, kde sa plochy nelíšia vôbec.
     *
     * @return list<string>
     */
    public function fieldsForAi(): array
    {
        return [];
    }

    /**
     * Tvar pre AI: výber kľúčov + vyhodenie prázdnych polí.
     *
     * @return array<string, mixed>
     */
    public function forAi(): array
    {
        return self::dropEmpty(self::project($this->data(), $this->fieldsForAi()));
    }

    /**
     * Podmnožina kľúčov. Zoznam môže adresovať aj kľúče vnútri riadkov zoznamu
     * zápisom `items[].tokens_out` — bez toho by sa musel projektovať každý riadok
     * ručne v každom toole, čo je presne tá druhá implementácia, ktorej sa vyhýbame.
     *
     * @param  array<string, mixed>  $data
     * @param  list<string>  $fields
     * @return array<string, mixed>
     */
    public static function project(array $data, array $fields): array
    {
        if ($fields === []) {
            return $data;
        }

        $out = [];
        $rowFields = [];

        foreach ($fields as $field) {
            if (str_contains($field, '[].')) {
                [$list, $key] = explode('[].', $field, 2);
                $rowFields[$list][] = $key;

                continue;
            }

            if (array_key_exists($field, $data)) {
                $out[$field] = $data[$field];
            }
        }

        foreach ($rowFields as $list => $keys) {
            if (! isset($data[$list]) || ! is_array($data[$list])) {
                continue;
            }

            $out[$list] = array_values(array_map(
                static fn (array $row): array => self::dropEmpty(self::project($row, $keys)),
                array_filter($data[$list], 'is_array'),
            ));
        }

        return $out;
    }

    /**
     * Vyhodí `null`, prázdny string a prázdne polia — rekurzívne.
     *
     * `0` a `false` ostávajú: nula tool callov je informácia („beh nič nevolal"),
     * kým chýbajúci kľúč je len ticho.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public static function dropEmpty(array $data): array
    {
        $out = [];

        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $value = self::dropEmpty($value);
            }

            if ($value === null || $value === '' || $value === []) {
                continue;
            }

            $out[$key] = $value;
        }

        // Zoznam sa musí preindexovať. Keby z desiatich riadkov vypadol tretí,
        // `json_encode` by z poľa spravil objekt `{"0":…,"2":…}` a klient, ktorý
        // nad tým robí `.map()`, by spadol na tvare, nie na dátach.
        return array_is_list($data) ? array_values($out) : $out;
    }
}
