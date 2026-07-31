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
 * NAJDÔLEŽITEJŠIE PRAVIDLO: **čísla skladá kód, nikdy model.** Text sa tu zostavuje
 * z hodnôt vrátených API a model ho môže najviac preformulovať (a to len pod dohľadom
 * `NumberGuard`, ktorý zmenu čísla odmietne).
 *
 * DRUHÉ PRAVIDLO — mena (rozhodnutie 1 a 5): API vracia `currency` v zozname aj
 * v detaile, takže obrat sa DÁ povedať — ale výhradne PO MENÁCH, každá mena na
 * vlastnom riadku. Súčet EUR + HUF tu nevznikne nikdy a prepočet na jednu menu je
 * zakázaný. Staré vysvetlenie „menu API neuvádza" je zmazané — už by bolo nepravdivé.
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

    public function __construct(
        private readonly SperkyClient $client,
        private readonly OrderWindowReader $reader,
    ) {}

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

    /** Detail jednej objednávky — mena je z API, nie z krajiny. */
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
        $currency = is_string($order['currency'] ?? null) ? $order['currency'] : null;
        $products = is_array($order['products'] ?? null) ? $order['products'] : [];

        $lines = ["**Objednávka #{$id}**"];

        if (is_string($order['date_add'] ?? null) && $order['date_add'] !== '') {
            $lines[] = '- Prijatá: '.$order['date_add'];
        }

        if (is_numeric($paid)) {
            $lines[] = '- Zaplatené: '.$this->amount((float) $paid, $currency);
        }

        if ($country !== null || $iso !== null) {
            $lines[] = '- Krajina: '.trim(($country ?? '').($iso !== null ? " ({$iso})" : ''));
        }

        if ($products !== []) {
            $items = [];
            foreach (array_slice($products, 0, 12) as $line) {
                $items[] = '#'.(int) ($line['id'] ?? 0).'×'.(int) ($line['qty'] ?? 1);
            }
            $lines[] = '- Položiek v objednávke: '.count($products)
                .' ('.implode(', ', $items).(count($products) > 12 ? ', …' : '').')';
        }

        return $this->answerText($intent, implode("\n", $lines));
    }

    /** Produkt podľa id — vrátane variantov so stavom zásoby (rozhodnutie 4). */
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

        // Cena produktu je v mene katalógu; produktový endpoint menu neuvádza,
        // takže tu ju zámerne nepíšem — radšej žiadna než nesprávna.
        if (is_numeric($product['price'] ?? null)) {
            $lines[] = '- Cena: '.number_format(round((float) $product['price'], 2), 2, ',', ' ');
        }

        $variants = is_array($product['attributes'] ?? null) ? $product['attributes'] : [];
        if ($variants !== []) {
            $lines[] = '- Variantov: **'.$this->num(count($variants)).'**';
            foreach (array_slice($variants, 0, 8) as $variant) {
                $lines[] = '  - '.$this->variantLine($variant);
            }
            if (count($variants) > 8) {
                $lines[] = '  - … a ďalších '.$this->num(count($variants) - 8);
            }
        }

        $short = $this->text($product['description_short'] ?? '');
        if ($short !== '') {
            $lines[] = '';
            $lines[] = mb_strimwidth($short, 0, 400, '…');
        }

        return $this->answerText($intent, implode("\n", $lines));
    }

    /** Počty objednávok za okno — presné, jeden dopyt. */
    private function ordersCount(Intent $intent): ?ChatAnswer
    {
        $window = $this->window();
        if (! $window->available()) {
            // Zlyhanie API sa NESMIE prezentovať ako nula — `null` pošle chat na
            // čestnú šablónu „napojenie nie je dostupné".
            return null;
        }

        $lines = [];

        $total = $this->totalInShop();
        if ($total !== null) {
            $lines[] = 'V e-shope je celkovo **'.$this->num($total).'** objednávok.';
        }

        // Dnešný počet je presný, keď sa prečítalo celé okno; inak sa radšej
        // nepovie nič, než by sa uvádzala dolná hranica ako fakt.
        $today = $this->countFor($window->byDay, now()->toDateString());
        if ($today !== null) {
            $lines[] = 'Dnes ich prišlo **'.$this->num($today).'**.';
        }

        $lines[] = 'Za posledných '.$this->windowDays().' dní **'.$this->num((int) $window->orders).'**.';

        return $this->answerText($intent, implode("\n", $lines));
    }

    /**
     * OBRAT PO MENÁCH (rozhodnutie 1 a 5). Každá mena vlastný riadok, žiadny
     * súčet naprieč menami, žiadny prepočet na EUR.
     */
    private function revenue(Intent $intent): ?ChatAnswer
    {
        $window = $this->window();
        if (! $window->available() || $window->revenue === []) {
            return null;
        }

        $lines = ['Obrat za posledných '.$this->windowDays().' dní **po menách** '
            .'(sumy v rôznych menách sa nesčítavajú):'];

        foreach ($window->revenue as $row) {
            $lines[] = '- **'.number_format((float) $row['total'], 2, ',', ' ').' '.(string) $row['currency'].'**'
                .' — '.$this->num((int) $row['orders']).' obj.';
        }

        if (! $window->complete) {
            $lines[] = '';
            $lines[] = '_Sumy pokrývajú '.$this->num($window->ordersRead).' z '
                .$this->num((int) $window->orders).' objednávok okna — strop požiadaviek sa vyčerpal._';
        }

        if ($window->withoutCurrency > 0) {
            $lines[] = '';
            $lines[] = '_'.$this->num($window->withoutCurrency).' objednávok neprišlo s menou, '
                .'takže nie sú v žiadnej sume._';
        }

        return $this->answerText($intent, implode("\n", $lines));
    }

    /** Rozpad podľa krajín — PRESNE, jeden dopyt na krajinu (rozhodnutie 3). */
    private function countries(Intent $intent): ?ChatAnswer
    {
        [$from, $to] = $this->windowDates();
        $total = $this->reader->count($from, $to);

        $breakdown = $this->reader->countries($from, $to, (array) config('sperky.countries', []), $total);
        if ($breakdown['countries'] === []) {
            return null;
        }

        $lines = ['Krajiny podľa počtu objednávok za posledných '.$this->windowDays().' dní (presné počty):'];

        foreach ($breakdown['countries'] as $row) {
            $orders = $row['orders'];
            if ($orders === null) {
                continue;
            }
            $lines[] = '- '.(string) $row['country_iso'].' — **'.$this->num((int) $orders).'**';
        }

        if ($breakdown['other'] !== null) {
            $lines[] = '- ostatné krajiny — **'.$this->num((int) $breakdown['other']).'**';
        }

        return $this->answerText($intent, implode("\n", $lines));
    }

    // ---------------------------------------------------------------- pomocné

    /** Okno posledných N dní. Jeden dopyt na počet, stránkovanie len pre obrat. */
    private function window(): OrderWindow
    {
        [$from, $to] = $this->windowDates();

        return $this->reader->read($from, $to, [
            'max_requests' => max(1, (int) config('sperky.chat.revenue_max_requests', 12)),
            'sleep_ms' => 0,
        ]);
    }

    /** @return array{0: string, 1: string} */
    private function windowDates(): array
    {
        $days = $this->windowDays();

        return [now()->subDays($days - 1)->toDateString(), now()->toDateString()];
    }

    private function windowDays(): int
    {
        return max(1, (int) config('sperky.chat.days', config('sperky.summary.days', 7)));
    }

    /** Celkový počet objednávok v e-shope — bez filtra, `total` z API (nález N7). */
    private function totalInShop(): ?int
    {
        try {
            return $this->client->ordersTotal();
        } catch (SperkyException) {
            return null;
        }
    }

    /**
     * @param  list<array{date: string, orders: int}>  $byDay
     */
    private function countFor(array $byDay, string $date): ?int
    {
        foreach ($byDay as $row) {
            if (($row['date'] ?? null) === $date) {
                return (int) $row['orders'];
            }
        }

        return null;
    }

    /** @param  array<string, mixed>  $variant */
    private function variantLine(array $variant): string
    {
        $labels = [];
        foreach ((array) ($variant['values'] ?? []) as $value) {
            if (! is_array($value)) {
                continue;
            }
            $labels[] = trim(($value['group'] !== null ? $value['group'].': ' : '').(string) ($value['value'] ?? ''));
        }

        $head = $labels === []
            ? '#'.(int) ($variant['id_product_attribute'] ?? 0)
            : implode(', ', array_filter($labels));

        $parts = [];
        if ($variant['quantity'] !== null) {
            $parts[] = 'na sklade '.$this->num((int) $variant['quantity']).' ks';
        }
        if (is_numeric($variant['price_impact'] ?? null) && (float) $variant['price_impact'] !== 0.0) {
            $parts[] = 'cena '.($variant['price_impact'] > 0 ? '+' : '')
                .number_format((float) $variant['price_impact'], 2, ',', ' ');
        }
        if (($variant['is_default'] ?? false) === true) {
            $parts[] = 'predvolený';
        }

        return $head.($parts === [] ? '' : ' ('.implode(' · ', $parts).')');
    }

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

    /** Suma vždy s menou, a mena vždy z API — nikdy odhad z krajiny. */
    private function amount(float $value, ?string $currency): string
    {
        $formatted = number_format(round($value, 2), 2, ',', ' ');

        return $currency === null
            ? $formatted.' (menu e-shop k tejto objednávke nevrátil)'
            : $formatted.' '.$currency;
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
