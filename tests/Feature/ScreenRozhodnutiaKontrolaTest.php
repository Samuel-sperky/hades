<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Decision;
use App\Models\Node;
use App\Serializers\Screen\KontrolaScreen;
use App\Serializers\Screen\RozhodnutiaScreen;
use App\Serializers\ScreenSerializer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Dvojitá plocha pre obrazovky ROZHODNUTIA a KONTROLA (vlna E).
 *
 * Tento test stráži päť vecí a každá z nich má za sebou dokázaný nález auditu
 * z 19. 8. 2026, nie hypotézu:
 *
 *  1. **Payload sa nerozbil.** `/api/decisions` a `/api/review/queue` vracajú
 *     všetko, čo vracali — kľúč po kľúči, hodnotu po hodnote. Serializér smie
 *     pridávať, nesmie brať ani premenúvať.
 *  2. **`/api/v1/*` je kontrakt.** Tie isté kontroléry servujú externý mirror
 *     s Bearer tokenom a jeho kľúče drží niekto iný než my.
 *  3. **Názov oblasti prichádza zo servera.** `rozhodnutia.js:94,175` ho bralo
 *     z grafového payloadu (`S.areas`), pretože `/api/decisions` ho nevracal —
 *     človek teda videl oblasť a AI to isté rozhodnutie bez nej.
 *  4. **Kontrola je pre AI skutočná fronta, nie počet.** Audit to pomenoval
 *     presne: „AI frontu na kontrolu plní, nevidí ju."
 *  5. **`fieldsForAi()` nemenuje kľúč, ktorý `data()` nedáva.** Preklep v zozname
 *     by pole ticho vyhodil z odpovede pre AI a nikto by si to nevšimol.
 *
 * Zámerne NEtestuje DOM, slovenské popisky, poradie čipov v UI ani farby —
 * kozmetická zmena obrazovky ho nesmie zhodiť, inak ho niekto vypne.
 */
class ScreenRozhodnutiaKontrolaTest extends TestCase
{
    use RefreshDatabase;

    private string $token = 'test-secret-token';

    private int $areaId;

    private int $otherAreaId;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'hades.api_token' => $this->token,
            'hades.allow_brain_write' => false,
            'cache.default' => 'array',
        ]);

        $this->areaId = Area::create([
            'name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ])->id;

        $this->otherAreaId = Area::create([
            'name' => 'Osobné', 'slug' => 'osobne', 'color' => '#7e5a03', 'angle' => 90,
        ])->id;
    }

    // ---- 1. payload sa nerozbil --------------------------------------------

    public function test_the_decisions_payload_keeps_every_key_it_had(): void
    {
        $decision = $this->decision(['text' => 'Zvolili sme MariaDB.']);

        $row = collect($this->getJson('/api/decisions')->assertOk()->json('decisions'))
            ->firstWhere('id', $decision->id);

        $this->assertNotNull($row, '/api/decisions už nevracia riadok, ktorý vracal.');

        foreach (self::asJson($decision->fresh()->toApi()) as $key => $value) {
            $this->assertArrayHasKey($key, $row, "Riadok rozhodnutia stratil kľúč `{$key}`.");
            $this->assertSame($value, $row[$key], "Riadok rozhodnutia zmenil hodnotu `{$key}`.");
        }
    }

    public function test_the_review_queue_payload_keeps_every_key_it_had(): void
    {
        $node = $this->node(['label' => 'Uzol na kontrolu']);

        $res = $this->getJson('/api/review/queue')->assertOk();
        $row = collect($res->json('queue'))->firstWhere('id', $node->id);

        $this->assertNotNull($row, '/api/review/queue už nevracia riadok, ktorý vracal.');
        $this->assertSame(1, $res->json('total'), '`total` je počítadlo v raile — musí prežiť.');

        foreach (self::asJson(Node::findOrFail($node->id)->toApi()) as $key => $value) {
            $this->assertArrayHasKey($key, $row, "Riadok fronty stratil kľúč `{$key}`.");
            $this->assertSame($value, $row[$key], "Riadok fronty zmenil hodnotu `{$key}`.");
        }
    }

    // ---- 2. /api/v1/* je kontrakt ------------------------------------------

    public function test_the_external_mirror_keeps_its_keys(): void
    {
        $decision = $this->decision();
        $node = $this->node();

        $decRow = collect($this->withToken($this->token)->getJson('/api/v1/decisions')
            ->assertOk()->json('decisions'))->firstWhere('id', $decision->id);

        foreach (self::asJson($decision->fresh()->toApi()) as $key => $value) {
            $this->assertArrayHasKey($key, $decRow, "/api/v1/decisions stratil `{$key}`.");
            $this->assertSame($value, $decRow[$key], "/api/v1/decisions zmenil `{$key}`.");
        }

        $queue = $this->withToken($this->token)->getJson('/api/v1/review/queue')->assertOk();
        $nodeRow = collect($queue->json('queue'))->firstWhere('id', $node->id);

        $this->assertSame(1, $queue->json('total'), '/api/v1/review/queue stratil `total`.');

        foreach (self::asJson(Node::findOrFail($node->id)->toApi()) as $key => $value) {
            $this->assertArrayHasKey($key, $nodeRow, "/api/v1/review/queue stratil `{$key}`.");
            $this->assertSame($value, $nodeRow[$key], "/api/v1/review/queue zmenil `{$key}`.");
        }
    }

    /**
     * Nové parametre filtrov nesmú zaviesť 422 tam, kde predtým 200 bolo. Mirror
     * ich doteraz mlčky zahadzoval a klient, ktorý ich posiela, existovať môže.
     */
    public function test_unknown_filter_values_are_ignored_not_rejected(): void
    {
        $this->decision();
        $this->node();

        $this->getJson('/api/decisions?q=&limit=abc')->assertOk();
        $this->getJson('/api/review/queue?type=neexistuje&certainty=vymyslene&limit=999999')
            ->assertOk()->assertJsonCount(1, 'queue');
    }

    // ---- 3. názov oblasti prichádza zo servera ------------------------------

    public function test_the_area_name_comes_from_the_server_not_from_the_graph(): void
    {
        $decision = $this->decision(['area_id' => $this->areaId]);
        $orphan = $this->decision(['area_id' => null, 'text' => 'Bez oblasti']);

        $rows = collect($this->getJson('/api/decisions')->assertOk()->json('decisions'));

        $this->assertSame(
            'Vývoj / kód',
            $rows->firstWhere('id', $decision->id)['area'],
            'Rozhodnutie prišlo bez názvu oblasti — obrazovka si ho musí brať z grafu, '.
            'a to je presne ten rozchod, ktorý audit našiel.',
        );

        // Rozhodnutie bez oblasti nesmie dostať vymyslené meno.
        $this->assertNull($rows->firstWhere('id', $orphan->id)['area']);

        // Os oblastí je serverová: id, slug (hodnota filtra) aj počet.
        $axis = $this->getJson('/api/decisions')->json('areas');
        $this->assertSame(
            [['id' => $this->areaId, 'slug' => 'vyvoj-kod', 'name' => 'Vývoj / kód', 'count' => 1]],
            $axis,
            'Os oblastí musí niesť slug (to je hodnota parametra `area`) aj počet.',
        );

        // A AI dostane to isté meno, nie area_id.
        $ai = (new RozhodnutiaScreen)->forAi();
        $aiRow = collect($ai['decisions'])->firstWhere('id', $decision->id);
        $this->assertSame('Vývoj / kód', $aiRow['area']);
        $this->assertArrayNotHasKey('area_id', $aiRow, 'Číslo oblasti je pre AI slepé — patrí tam meno.');
    }

    public function test_the_queue_row_carries_its_area_name_too(): void
    {
        $node = $this->node(['area_id' => $this->otherAreaId]);

        $row = collect($this->getJson('/api/review/queue')->json('queue'))
            ->firstWhere('id', $node->id);

        $this->assertSame('Osobné', $row['area']);
    }

    // ---- 4. Kontrola je fronta, nie počet ----------------------------------

    public function test_the_review_screen_gives_the_ai_the_queue_and_not_just_a_number(): void
    {
        $a = $this->node(['label' => 'Prvý na kontrolu', 'description' => 'Popis prvého.']);
        $this->node(['label' => 'Druhý na kontrolu', 'type' => 'skill', 'certainty' => 'pasca']);

        $ai = (new KontrolaScreen)->forAi();

        $this->assertArrayHasKey('queue', $ai, 'AI dostala z Kontroly len číslo — presne to, čo audit vytýkal.');
        $this->assertCount(2, $ai['queue']);
        $this->assertSame(2, $ai['total']);

        $first = collect($ai['queue'])->firstWhere('id', $a->id);
        $this->assertSame('Prvý na kontrolu', $first['label']);
        $this->assertSame('Popis prvého.', $first['description']);

        // Fronta má aj tvar, nie len dĺžku: podľa čoho sa dá triediť práca.
        $this->assertSame(1, $ai['counts']['by_type']['memory']);
        $this->assertSame(1, $ai['counts']['by_type']['skill']);
        $this->assertSame(1, $ai['counts']['by_certainty']['pasca']);

        // Nenastavená istota ide do priehradky `bez`, nie do kľúča s prázdnym
        // menom — na živých dátach vracal agregát `{"":4}`.
        $this->node(['label' => 'Bez istoty', 'certainty' => null]);
        $this->assertSame(1, (new KontrolaScreen)->data()['counts']['by_certainty']['bez']);

        // Polia bez informácie sa AI neposielajú: v tejto fronte je needs_review
        // vždy true a verified_at vždy prázdne.
        $this->assertArrayNotHasKey('needs_review', $first);
        $this->assertArrayNotHasKey('verified_at', $first);
    }

    /**
     * `verify` sa z MCP nedáva (rozhodnutie kontraktu §4) — overenie poznatku je
     * akt človeka. Serializér Kontroly preto nesmie niesť nič, čo by vyzeralo
     * ako akcia, a `total` musí zostať nefiltrovaný, aby rail nelhal.
     */
    public function test_the_review_screen_is_read_only_for_the_ai(): void
    {
        $this->node(['label' => 'Skill na kontrolu', 'type' => 'skill']);
        $this->node(['label' => 'Spomienka na kontrolu']);

        $screen = new KontrolaScreen(['type' => 'skill']);
        $data = $screen->data();

        $this->assertCount(1, $data['queue'], 'Filter typu musí zúžiť frontu.');
        $this->assertSame(2, $data['total'], '`total` nesie rail počítadlo a filter ho zúžiť NESMIE.');
        $this->assertSame(1, $data['counts']['shown']);

        foreach ($screen->fieldsForAi() as $field) {
            $this->assertStringNotContainsString('verify', $field);
        }
    }

    // ---- 5. fieldsForAi() nemenuje neexistujúci kľúč ------------------------

    public function test_the_ai_field_list_never_names_a_key_the_screen_does_not_have(): void
    {
        $this->decision();
        $this->node();

        foreach ([RozhodnutiaScreen::class, KontrolaScreen::class] as $class) {
            /** @var ScreenSerializer $screen */
            $screen = new $class;
            $data = $screen->data();

            foreach ($screen->fieldsForAi() as $field) {
                if (! str_contains($field, '[].')) {
                    $this->assertArrayHasKey($field, $data, "{$class} menuje pre AI kľúč `{$field}`, ktorý `data()` nedáva.");

                    continue;
                }

                [$list, $key] = explode('[].', $field, 2);

                $this->assertArrayHasKey($list, $data, "{$class} menuje pre AI zoznam `{$list}`, ktorý `data()` nedáva.");
                $this->assertNotEmpty($data[$list], "Zoznam `{$list}` je vo fixture prázdny — test by nemeral nič.");

                foreach ($data[$list] as $row) {
                    $this->assertArrayHasKey(
                        $key,
                        $row,
                        "{$class} menuje pre AI kľúč `{$field}`, ktorý riadok nedáva. ".
                        'Preklep by pole ticho vyhodil z odpovede pre AI.',
                    );
                }
            }
        }
    }

    /**
     * Endpoint a plocha AI nad tou istou fixture: každý zdieľaný kľúč identický.
     * Opačný smer sa nekontroluje — plocha človeka smie mať navyše, to je celý
     * zmysel `fieldsForAi()`.
     */
    public function test_the_endpoint_and_the_ai_surface_agree_on_every_shared_key(): void
    {
        $this->decision();
        $this->node();

        $this->assertParity(
            $this->getJson('/api/decisions')->assertOk()->json(),
            (new RozhodnutiaScreen)->forAi(),
            'rozhodnutia',
        );

        $this->assertParity(
            $this->getJson('/api/review/queue')->assertOk()->json(),
            (new KontrolaScreen)->forAi(),
            'kontrola',
        );
    }

    // ---- serverové filtre a počty ------------------------------------------

    public function test_the_filter_axis_is_computed_on_the_server_over_the_whole_corpus(): void
    {
        $this->decision(['decided_on' => '2026-08-19', 'area_id' => $this->areaId]);
        $this->decision(['decided_on' => '2026-07-01', 'area_id' => $this->areaId]);
        $this->decision(['decided_on' => '2025-12-24', 'area_id' => $this->otherAreaId, 'origin' => 'brain']);

        $data = (new RozhodnutiaScreen)->data();

        $this->assertSame(
            [['year' => 2026, 'count' => 2], ['year' => 2025, 'count' => 1]],
            $data['years'],
            'Roky musia prísť zo servera s počtami a od najnovšieho.',
        );
        $this->assertSame(['total' => 3, 'session' => 2, 'brain' => 1, 'shown' => 3], $data['counts']);

        // Oblasti od najpoužívanejšej — poradie robí server, nie prehliadač.
        $this->assertSame(['Vývoj / kód', 'Osobné'], array_column($data['areas'], 'name'));

        // Filtre zužujú serverovo, ale os a počty ostávajú nad celým korpusom:
        // inak by čip po kliknutí tvrdil, že iných rokov niet.
        $filtered = (new RozhodnutiaScreen(['year' => 2025]))->data();
        $this->assertCount(1, $filtered['decisions']);
        $this->assertSame(3, $filtered['counts']['total']);
        $this->assertSame(1, $filtered['counts']['shown']);
        $this->assertCount(2, $filtered['years']);
    }

    public function test_area_filter_accepts_the_slug_and_an_unknown_area_returns_nothing(): void
    {
        $this->decision(['area_id' => $this->areaId]);
        $this->decision(['area_id' => $this->otherAreaId]);

        $this->assertCount(1, (new RozhodnutiaScreen(['area' => 'vyvoj-kod']))->data()['decisions']);
        $this->assertCount(1, (new RozhodnutiaScreen(['area' => 'Vývoj / kód']))->data()['decisions']);
        // Preklep vo filtri nesmie vrátiť „všetko" — to by vyzeralo, akoby filter nebol.
        $this->assertCount(0, (new RozhodnutiaScreen(['area' => 'nic-take']))->data()['decisions']);
    }

    public function test_the_month_grouping_key_comes_from_the_server(): void
    {
        $decision = $this->decision(['decided_on' => '2026-08-19']);

        $row = collect((new RozhodnutiaScreen)->data()['decisions'])->firstWhere('id', $decision->id);

        $this->assertSame('2026-08', $row['month']);
    }

    // ---- rail počítadlo po mutácii -----------------------------------------

    /**
     * Obrazovka si dĺžku fronty po akcii dopočítavala (`total - 1`). Server ju
     * teraz hlási — bez toho rail po paralelnom `mind_learn` lhal.
     */
    public function test_review_mutations_report_the_new_queue_length(): void
    {
        $a = $this->node(['origin' => 'session']);
        $b = $this->node(['origin' => 'session']);
        $this->node(['origin' => 'session']);

        $this->postJson('/api/nodes/'.$a->id.'/verify')
            ->assertOk()->assertJsonPath('queue_total', 2);

        $this->postJson('/api/nodes/'.$b->id.'/resolve-review')
            ->assertOk()->assertJsonPath('queue_total', 1);
    }

    // ---- pomôcky -----------------------------------------------------------

    /**
     * Základ na porovnanie musí prejsť tou istou cestou ako odpoveď, teda cez
     * `json_encode`/`decode`. Bez toho test padne na `strength`: v PHP je to
     * `float 1.0`, po serializácii `1` — a to je artefakt JSON-u, nie rozchod
     * plôch. Presne ten druh falošného nálezu, ktorý harness robí nedôveryhodným.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private static function asJson(array $data): array
    {
        $out = json_decode(json_encode($data), true);

        // `heat` je funkcia času (decay), takže dve čítania toho istého uzla sa
        // líšia na desiatom desatinnom miesta. Nie je to zmena kľúča, je to živý
        // uzol — porovnávať ho by znamenalo mať test, ktorý padne sám od seba.
        unset($out['heat']);

        return $out;
    }

    /**
     * @param  array<string, mixed>  $human
     * @param  array<string, mixed>  $ai
     */
    private function assertParity(array $human, array $ai, string $screen, string $path = ''): void
    {
        foreach ($ai as $key => $value) {
            $here = $path === '' ? (string) $key : "{$path}.{$key}";

            $this->assertArrayHasKey(
                $key,
                $human,
                "{$screen} dáva AI `{$here}`, ktoré obrazovka nemá — to je druhá implementácia.",
            );

            if (is_array($value) && is_array($human[$key])) {
                $this->assertParity($human[$key], $value, $screen, $here);

                continue;
            }

            $this->assertSame($human[$key], $value, "{$screen}: plochy sa rozišli na `{$here}`.");
        }
    }

    /**
     * @param  array<string, mixed>  $attrs
     */
    private function decision(array $attrs = []): Decision
    {
        return Decision::create(array_merge([
            'area_id' => $this->areaId,
            'decided_on' => '2026-08-19',
            'text' => 'Rozhodnutie '.uniqid(),
            'reason' => 'Dôvod.',
            'origin' => 'session',
        ], $attrs));
    }

    /**
     * @param  array<string, mixed>  $attrs
     */
    private function node(array $attrs = []): Node
    {
        return Node::create(array_merge([
            'type' => 'memory',
            'origin' => 'session',
            'area_id' => $this->areaId,
            'label' => 'Uzol '.uniqid(),
            'description' => null,
            'certainty' => 'hypoteza',
            'strength' => 1,
            'needs_review' => true,
            'last_activated_at' => now(),
        ], $attrs));
    }
}
