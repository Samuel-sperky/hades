<?php

namespace App\Services\Console;

use App\Models\Node;

/**
 * Kontext vybraných uzlov grafu, ktorý dok Charóna priloží k otázke človeka.
 *
 * Skladá sa TU, na serveri, iba z id — nikdy z textu, ktorý poslal prehliadač.
 * Dôvod je ten istý, prečo sa história vlákna skladá z DB a nie z requestu
 * (`create_console_tables` docblock): keby popis uzla skladal klient, dal by sa
 * modelu podstrčiť uzol, ktorý v pamäti nie je — a tento model má zápisové tooly.
 *
 * Prevzaté z `ChatController::buildContext()`, ale zúžené pre CPU model:
 * 8 uzlov namiesto 20, 2400 znakov namiesto 6000, 300 znakov na popis a
 * **žiadne telo .md** — model si súbor prečíta `read_file`om, keď ho profil má
 * (v profile `graph` ho zámerne nemá). Skrátenie sa priznáva: model, ktorý nevie,
 * že mu niečo chýba, si to domyslí.
 *
 * Čísla sú v `config('hades.console.context')`, aby sa dali ladiť bez zásahu do
 * kódu; validátor v `RunController` číta ten istý strop `nodes`, takže sa nedajú
 * rozísť.
 */
class ContextBlock
{
    /**
     * Poskladá blok kontextu z id uzlov, alebo vráti prázdny reťazec, keď niet
     * čo priložiť. Poradie id sa zachováva (je to poradie výberu človeka).
     *
     * @param  array<int, int|string>  $ids
     */
    public function build(array $ids): string
    {
        $maxNodes = (int) config('hades.console.context.nodes', 8);
        $budget = (int) config('hades.console.context.chars', 2400);
        $descChars = (int) config('hades.console.context.desc_chars', 300);

        // Unikátne, celočíselné, v poradí výberu, orezané na strop uzlov.
        $ids = array_values(array_unique(array_map('intval', $ids)));
        $requested = count($ids);
        if ($requested === 0) {
            return '';
        }
        $ids = array_slice($ids, 0, $maxNodes);

        // Jeden dotaz; poradie z DB nezodpovedá výberu, tak ho dosadíme späť.
        $byId = Node::whereIn('id', $ids)->get()->keyBy('id');

        $parts = [];
        $used = 0;
        $included = 0;

        foreach ($ids as $id) {
            $node = $byId->get($id);
            if ($node === null) {
                continue; // Uzol medzičasom zmizol — nie je čo priložiť.
            }

            $chunk = '### '.$node->label;
            $description = trim((string) $node->description);
            if ($description !== '') {
                $chunk .= "\n".mb_substr($description, 0, $descChars);
            }

            $len = mb_strlen($chunk) + 1; // +1 za spájací \n
            if ($used + $len > $budget) {
                break; // Strop znakov — zvyšok uzlov sa prizná nižšie.
            }

            $parts[] = $chunk;
            $used += $len;
            $included++;
        }

        if ($included === 0) {
            return '';
        }

        // Hlavička nesie počet, aby UI vedelo blok zložiť a aby sa nedal zameniť
        // s textom človeka. Skrátenie sa priznáva vždy, keď sa do bloku nezmestilo
        // všetko, čo človek vybral.
        $head = '[kontext z grafu — '.$included.' '.$this->plural($included).']';
        if ($included < $requested) {
            $head .= "\n… (kontext skrátený: ".$included.' z '.$requested.' uzlov)';
        }

        return $head."\n".implode("\n", $parts)."\n[/kontext]";
    }

    /** Slovenský plurál pre „uzol". */
    private function plural(int $n): string
    {
        if ($n === 1) {
            return 'uzol';
        }

        return $n >= 2 && $n <= 4 ? 'uzly' : 'uzlov';
    }
}
