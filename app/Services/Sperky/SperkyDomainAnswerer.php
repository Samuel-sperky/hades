<?php

namespace App\Services\Sperky;

use App\Services\Chat\ChatAnswer;
use App\Services\Chat\DomainAnswerer;
use App\Services\Chat\Intent;
use App\Services\Sperky\Exceptions\SperkyException;
use Illuminate\Support\Facades\Log;

/**
 * Napojenie chatu na SPERKY e-shop — implementácia {@see DomainAnswerer} pre `shop.*`.
 *
 * Toto je spojka, ktorú si dva balíky navzájom prehodili: SPERKY-BE ju nechal P5
 * („patrí chatu"), P5 ju nechal P11 („dodá dátový zdroj"), takže ju nenapísal nikto
 * a chat na každú otázku o e-shope odpovedal čestnou, ale zbytočnou šablónou
 * „napojenie ešte nie je aktívne".
 *
 * NAJDÔLEŽITEJŠIE PRAVIDLO: **čísla skladá kód, nikdy model.** Text sa tu zostavuje
 * z hodnôt vrátených API a model ho môže najviac preformulovať (a to len pod dohľadom
 * `NumberGuard`, ktorý zmenu čísla odmietne).
 *
 * DRUHÉ PRAVIDLO — mena (nález N1 z 08-SPERKY-API-SPEC.md): `total_paid` je v mene
 * objednávky, ale API menu NEVRACIA. Na vzorke 100 objednávok bolo 37 hodnôt nad 1000,
 * lebo HU platí v HUF a CZ v CZK. Súčet cez objednávky je preto nezmyselné číslo a
 * tento answerer ho **nikdy nevytvorí**:
 *   - `shop.revenue` odpovie POČTAMI a vysvetlí, prečo súhrnný obrat nedáva zmysel
 *   - suma sa uvedie len pri JEDNEJ objednávke, kde krajinu poznáme z detailu, a vždy
 *     s menou označenou ako odhad
 *
 * Keď je API nedostupné, vráti `null` → chat použije šablónu. Nikdy nevyhodí výnimku
 * do chatovej cesty.
 */
final class SperkyDomainAnswerer implements DomainAnswerer
{
    /** Zámery, na ktoré má tento answerer dáta. */
    private const HANDLED = [
        'shop.orders_count',
        'shop.revenue',
        'shop.order_detail',
        'shop.product_lookup',
        'shop.countries',
    ];

    private readonly SperkyCurrency $currency;

    /**
     * `SperkyCurrency` sa nedá autowirovať — berie mapu `country_iso → mena` z configu,
     * takže sa stavia rovnako ako v `SperkyAggregator` a `SperkyClient`.
     */
    public function __construct(
        private readonly SperkyClient $client,
        private readonly OrderScanner $scanner,
    ) {
        $this->currency = SperkyCurrency::fromConfig();
    }

    public function handles(Intent $intent): bool
    {
        return in_array($intent->name, self::HANDLED, true);
    }

    public function answer(Intent $intent, string $message): ?ChatAnswer
    {
        try {
            return match ($intent->name) {
                'shop.order_detail' => $this->orderDetail($intent),
                'shop.product_lookup' => $this->productLookup($intent),
                'shop.orders_count' => $this->ordersCount($intent),
                'shop.revenue' => $this->revenue($intent),
                'shop.countries' => $this->countries($intent),
                default => null,
            };
        } catch (SperkyException $e) {
            // Doménová aj infrastruktúrna chyba skončí rovnako: šablónou. Správa výnimky
            // je fixná konštanta bez používateľského vstupu, takže sa dá logovať.
            Log::info('sperky chat answerer nedokázal odpovedať', [
                'intent' => $intent->name,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    // ---------------------------------------------------------------- zámery

    /** Detail jednej objednávky — jediné miesto, kde smie byť suma s menou. */
    private function orderDetail(Intent $intent): ?ChatAnswer
    {
        $id = $this->intParam($intent, 'order_id');
        if ($id === null) {
            return null;
        }

        $order = $this->client->order($id);
        if ($order === null) {
            return $this->answerText($intent, "Objednávku #{$id} som v e-shope nenašiel.");
        }

        $iso = is_string($order['country_iso'] ?? null) ? $order['country_iso'] : null;
        $country = is_string($order['country'] ?? null) ? $order['country'] : null;
        $paid = $order['total_paid'] ?? null;
        $products = is_array($order['product_ids'] ?? null) ? $order['product_ids'] : [];

        $lines = ["**Objednávka #{$id}**"];

        if (is_string($order['date_add'] ?? null) && $order['date_add'] !== '') {
            $lines[] = '- Prijatá: '.$order['date_add'];
        }

        if (is_numeric($paid)) {
            $lines[] = '- Zaplatené: '.$this->amount((float) $paid, $iso);
        }

        if ($country !== null || $iso !== null) {
            $lines[] = '- Krajina: '.trim(($country ?? '').($iso !== null ? " ({$iso})" : ''));
        }

        if ($products !== []) {
            $lines[] = '- Produktov v objednávke: '.count($products)
                .' (id: '.implode(', ', array_map('strval', array_slice($products, 0, 12)))
                .(count($products) > 12 ? ', …' : '').')';
        }

        return $this->answerText($intent, implode("\n", $lines));
    }

    /** Produkt podľa id. Varianty sa nezobrazujú — API ich nevracia (nález N2). */
    private function productLookup(Intent $intent): ?ChatAnswer
    {
        $id = $this->intParam($intent, 'product_id');
        if ($id === null) {
            // „čo mám za produkty" bez čísla — povedz počet, to je zmysluplná odpoveď.
            $list = $this->client->products(1, 1);
            $total = $this->intOrNull($list['total'] ?? null);

            return $total === null
                ? null
                : $this->answerText($intent, 'V katalógu je **'.$this->num($total).'** produktov. '
                    .'Ak chceš konkrétny, napíš jeho id (napr. „produkt 49").');
        }

        $product = $this->client->product($id);
        if ($product === null) {
            return $this->answerText($intent, "Produkt #{$id} som v katalógu nenašiel.");
        }

        $lines = ['**'.$this->text($product['name'] ?? "Produkt #{$id}").'**', "- Id: {$id}"];

        // Cena produktu je v mene e-shopu a API pri produktoch krajinu nemá, takže menu
        // neuvádzam vôbec — radšej žiadna než nesprávna.
        if (is_numeric($product['price'] ?? null)) {
            $lines[] = '- Cena: '.number_format(round((float) $product['price'], 2), 2, ',', ' ');
        }

        $short = $this->text($product['description_short'] ?? '');
        if ($short !== '') {
            $lines[] = '';
            $lines[] = mb_strimwidth($short, 0, 400, '…');
        }

        return $this->answerText($intent, implode("\n", $lines));
    }

    /** Počty objednávok — hlavné číslo e-shopu (nález N1). */
    private function ordersCount(Intent $intent): ?ChatAnswer
    {
        $scan = $this->scanWindow();
        $total = $scan->totalOrders;

        // Zlyhanie API sa NESMIE prezentovať ako nula. Keď scan neprešiel do konca,
        // nevrátil ani jednu objednávku a nepozná ani celkový počet, nemáme čo povedať —
        // `null` pošle chat na čestnú šablónu „napojenie nie je dostupné".
        if ($total === null && $scan->count() === 0 && ! $scan->isComplete()) {
            return null;
        }

        $lines = [];
        if ($total !== null) {
            $lines[] = 'V e-shope je celkovo **'.$this->num($total).'** objednávok.';
        }

        // Denné počty sa musia spočítať tu — scan vracia surové objednávky, nie agregát.
        $today = $this->countForDay($scan, now()->toDateString());
        if ($today !== null) {
            $lines[] = 'Dnes ich prišlo **'.$this->num($today).'**.';
        }

        $days = $this->windowDays();
        $lines[] = 'Za posledných '.$days.' dní '
            .($scan->isComplete() ? '**' : 'aspoň **').$this->num($scan->count()).'**.';

        if (! $scan->isComplete()) {
            $lines[] = '';
            $lines[] = '_Sken sa zastavil na strope požiadaviek, takže čísla za okno sú dolná hranica._';
        }

        return $this->answerText($intent, implode("\n", $lines));
    }

    /** Okno posledných N dní. Scanner využíva zostupné radenie podľa id a zastaví na
     *  prvej objednávke pred hranicou (nález N4), takže to nie sú tisíce requestov. */
    private function scanWindow(): OrderScan
    {
        $days = $this->windowDays();

        return $this->scanner->scan(
            now()->subDays($days)->startOfDay(),
            now()->endOfDay(),
            ['max_requests' => (int) config('sperky.summary.max_requests', 12)],
        );
    }

    private function windowDays(): int
    {
        return max(1, (int) config('sperky.summary.days', 7));
    }

    /** Počet objednávok pre konkrétny deň zo surového scanu. */
    private function countForDay(OrderScan $scan, string $date): ?int
    {
        $n = 0;
        $seen = false;

        foreach ($scan->orders as $order) {
            $added = $order['date_add'] ?? null;
            if (! is_string($added) || $added === '') {
                continue;
            }
            $seen = true;
            if (str_starts_with($added, $date)) {
                $n++;
            }
        }

        return $seen ? $n : null;
    }

    /**
     * Obrat. ZÁMERNE nevracia jedno číslo — pozri N1 v hlavičke triedy.
     * Namiesto toho vysvetlí, prečo, a dá to, čo zmysel má: počty.
     */
    private function revenue(Intent $intent): ?ChatAnswer
    {
        $counts = $this->ordersCount($intent);
        if (! $counts instanceof ChatAnswer) {
            return null;
        }

        return $counts->withText(
            $counts->text."\n\n"
            .'_Súhrnný obrat ti nepoviem, a nie je to chyba: API vracia `total_paid` v mene '
            .'objednávky, ale samotnú menu neuvádza. Slovensko a Slovinsko platia v eurách, '
            .'Maďarsko vo forintoch, Česko v korunách — súčet cez objednávky by teda spočítal '
            .'HUF s EUR a dal nezmysel. Rozpad podľa krajín s odhadnutou menou nájdeš na '
            .'obrazovke E-shop._'
        );
    }

    /** Rozpad podľa krajín zo vzorky — krajina je len v detaile, takže celé okno by
     *  stálo jeden request na každú objednávku. */
    private function countries(Intent $intent): ?ChatAnswer
    {
        $scan = $this->scanWindow();
        $sample = max(1, (int) config('sperky.chat.country_sample', 15));

        // details() rešpektuje pauzy medzi requestmi aj rate limit (nález N5) a vracia
        // obálku {details, requests, stopped_by} — nie plochý zoznam.
        $batch = $this->scanner->details($scan->ids(), $sample);
        $details = is_array($batch['details'] ?? null) ? $batch['details'] : [];
        if ($details === []) {
            return null;
        }

        $byIso = [];
        foreach ($details as $d) {
            if (! is_array($d)) {
                continue;
            }
            $iso = is_string($d['country_iso'] ?? null) && $d['country_iso'] !== ''
                ? $d['country_iso']
                : '??';
            $name = is_string($d['country'] ?? null) && $d['country'] !== '' ? $d['country'] : $iso;
            $byIso[$iso] ??= ['n' => 0, 'name' => $name];
            $byIso[$iso]['n']++;
        }

        if ($byIso === []) {
            return null;
        }

        uasort($byIso, fn (array $a, array $b) => $b['n'] <=> $a['n']);

        $lines = ['Krajiny podľa počtu objednávok (vzorka '.count($details)
            .' z posledných '.$this->windowDays().' dní):'];

        foreach (array_slice($byIso, 0, 8, true) as $iso => $row) {
            $code = $this->currency->guess($iso === '??' ? null : $iso);
            $lines[] = '- '.$row['name'].' — **'.$this->num($row['n']).'**'
                .($code !== null ? ' _(platí v '.$code.')_' : '');
        }

        $lines[] = '';
        $lines[] = '_Je to vzorka, nie celé okno: krajina je len v detaile objednávky, takže '
            .'presný rozpad by stál jeden request na každú objednávku. Mena je odhad z krajiny._';

        return $this->answerText($intent, implode("\n", $lines));
    }

    // ---------------------------------------------------------------- pomocné

    private function answerText(Intent $intent, string $text): ChatAnswer
    {
        return new ChatAnswer(
            text: $text,
            intent: $intent,
            citations: [],
            degraded: false,
            source: 'template',
        );
    }

    /** Suma vždy s menou a vždy s priznaním, že mena je odhad z krajiny (nález N1). */
    private function amount(float $value, ?string $iso): string
    {
        $formatted = number_format(round($value, 2), 2, ',', ' ');
        $code = $this->currency->guess($iso);

        return $code === null
            ? $formatted.' (menu API neuvádza)'
            : $formatted.' '.$code.' (mena odhadnutá z krajiny)';
    }

    private function num(int $value): string
    {
        return number_format($value, 0, ',', ' ');
    }

    private function intParam(Intent $intent, string $key): ?int
    {
        $raw = $intent->param($key);

        return $raw !== null && ctype_digit($raw) ? (int) $raw : null;
    }

    private function intOrNull(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    private function text(mixed $value): string
    {
        return is_string($value) ? trim(strip_tags($value)) : '';
    }
}
