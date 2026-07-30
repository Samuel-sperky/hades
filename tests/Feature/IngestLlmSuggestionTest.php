<?php

namespace Tests\Feature;

use App\Llm\ChatProvider;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\FakeProvider;
use Tests\Support\Ingest\BuildsTranscripts;
use Tests\TestCase;

/**
 * Rozhodnutie #112 v ingeste: „model NAVRHNE, deterministický kód ROZHODNE."
 *
 * Test drží tri veci, ktoré musia platiť naraz:
 *  1. bez vypínača v `config/ingest.php` sa model vôbec nezavolá a výsledok je
 *     bit-identický s dnešným (ingest beží každých 10 minút na živých dátach);
 *  2. keď je model dostupný a návrh prejde {@see \App\Services\Ingest\SuggestionGuard},
 *     použije sa a nesie audit `meta.generated_by`;
 *  3. keď model nebeží alebo návrh je nevalidný, výsledok je opäť dnešný —
 *     bez výnimky, bez chyby, bez prázdneho poľa.
 */
class IngestLlmSuggestionTest extends TestCase
{
    use BuildsTranscripts;
    use RefreshDatabase;

    /** Heuristický titulok, ktorý musí vyjsť vždy, keď model neuspeje. */
    private const HEURISTIC_TITLE = 'Rozsekaj ingest na štyri vrstvy.';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootTranscriptFixtures();
    }

    protected function tearDown(): void
    {
        $this->cleanTranscriptFixtures();
        parent::tearDown();
    }

    private function fake(string $reply): FakeProvider
    {
        $provider = new FakeProvider($reply);
        $this->app->instance(ChatProvider::class, $provider);

        return $provider;
    }

    private function ingestOne(string $sessionId): Node
    {
        $this->writeTranscript($sessionId, [self::HEURISTIC_TITLE]);
        $this->ingestService()->ingestAll();

        return Node::where('external_key', 'session:'.$sessionId)->firstOrFail();
    }

    // ---- titulok -----------------------------------------------------------

    public function test_model_is_not_called_at_all_when_flag_is_off(): void
    {
        $provider = $this->fake('Titulok od modelu, ktorý sa nesmie použiť');

        $node = $this->ingestOne('test-llm-off');

        $this->assertSame(0, $provider->chatCalls);
        $this->assertSame(self::HEURISTIC_TITLE, $node->label);
        $this->assertArrayNotHasKey('generated_by', $node->meta);
    }

    public function test_valid_suggestion_is_used_and_audited(): void
    {
        config(['ingest.llm_titles' => true]);
        $provider = $this->fake('Rozsekanie ingestu na štyri vrstvy');

        $node = $this->ingestOne('test-llm-on');

        $this->assertSame(1, $provider->chatCalls);
        $this->assertSame('Rozsekanie ingestu na štyri vrstvy', $node->label);
        $this->assertSame('fake-model', $node->meta['generated_by']['label']['model']);
        $this->assertSame('smart_title', $node->meta['generated_by']['label']['task']);
    }

    public function test_think_block_is_stripped_before_the_title_is_used(): void
    {
        config(['ingest.llm_titles' => true]);
        $this->fake("<think>Skúsim niečo krátke…</think>\nRozsekanie ingestu na vrstvy");

        $node = $this->ingestOne('test-llm-think');

        $this->assertSame('Rozsekanie ingestu na vrstvy', $node->label);
    }

    public function test_invalid_suggestion_falls_back_to_heuristic(): void
    {
        config(['ingest.llm_titles' => true]);
        // pod hranicou 15 znakov → guard zamietne
        $provider = $this->fake('Oprava');

        $node = $this->ingestOne('test-llm-short');

        $this->assertSame(1, $provider->chatCalls);
        $this->assertSame(self::HEURISTIC_TITLE, $node->label);
        $this->assertArrayNotHasKey('generated_by', $node->meta);
    }

    public function test_suggestion_containing_a_secret_is_never_written(): void
    {
        config(['ingest.llm_titles' => true]);
        // vymyslený token — guard ho musí zamietnuť celý, nie len redigovať
        $this->fake('Nastavenie tokenu ghp_'.str_repeat('a1B2', 8));

        $node = $this->ingestOne('test-llm-secret');

        $this->assertSame(self::HEURISTIC_TITLE, $node->label);
        $this->assertStringNotContainsString('ghp_', (string) json_encode($node->toArray()));
    }

    public function test_ingest_survives_a_dead_model_and_keeps_todays_behaviour(): void
    {
        config(['ingest.llm_titles' => true, 'ingest.llm_summaries' => true]);
        // presne stav „Ollama nebeží"
        $provider = (new FakeProvider)->broken();
        $this->app->instance(ChatProvider::class, $provider);

        $node = $this->ingestOne('test-llm-down');

        $this->assertSame(self::HEURISTIC_TITLE, $node->label);
        $this->assertStringStartsWith('**Čo:**', (string) $node->description);
        $this->assertArrayNotHasKey('generated_by', $node->meta);
        $this->assertArrayNotHasKey('summary_by', $node->meta);
    }

    // ---- zhrnutie ----------------------------------------------------------

    public function test_summary_stays_extractive_when_flag_is_off(): void
    {
        $provider = $this->fake('Zhrnutie od modelu, ktoré sa nesmie použiť ani zapísať do popisu.');

        $node = $this->ingestOne('test-sum-off');

        $this->assertSame(0, $provider->chatCalls);
        $this->assertStringStartsWith('**Čo:**', (string) $node->description);
        $this->assertArrayNotHasKey('summary_by', $node->meta);
    }

    public function test_valid_abstractive_summary_is_used_and_audited(): void
    {
        config(['ingest.llm_summaries' => true]);
        $reply = 'Session rozsekala ingest transcriptov na parser, klasifikátor, linker a writer '
            .'a doplnila regresné testy na redakciu tajomstiev aj na preteky dvoch behov.';
        $this->fake($reply);

        $node = $this->ingestOne('test-sum-on');

        $this->assertSame($reply, $node->description);
        $this->assertSame('llm', $node->meta['summary_by']);
        $this->assertSame('session_summary', $node->meta['generated_by']['description']['task']);

        // .md dokument je odvodený z rovnakého popisu
        $md = (string) file_get_contents(base_path($node->meta['summary_path']));
        $this->assertStringContainsString($reply, $md);
    }

    public function test_invalid_abstractive_summary_falls_back_to_extractive(): void
    {
        config(['ingest.llm_summaries' => true]);
        // pod hranicou 40 znakov → guard zamietne
        $this->fake('Rozsekal ingest.');

        $node = $this->ingestOne('test-sum-short');

        $this->assertStringStartsWith('**Čo:**', (string) $node->description);
        $this->assertArrayNotHasKey('summary_by', $node->meta);
    }
}
