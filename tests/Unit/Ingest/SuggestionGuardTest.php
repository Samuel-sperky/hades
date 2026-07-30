<?php

namespace Tests\Unit\Ingest;

use App\Services\Ingest\SuggestionGuard;
use PHPUnit\Framework\TestCase;

/**
 * Rozhodnutie #112 — „model navrhne, deterministický kód rozhodne".
 * Guard je to miesto, kde sa rozhoduje. Keď vráti null, ingest použije
 * dnešný deterministický výsledok.
 *
 * Všetky „kľúče" v testoch sú vymyslené a testujú len tvar vzoru.
 */
class SuggestionGuardTest extends TestCase
{
    private SuggestionGuard $guard;

    protected function setUp(): void
    {
        parent::setUp();
        $this->guard = new SuggestionGuard;
    }

    // ---- titulok -----------------------------------------------------------

    public function test_valid_title_passes_unchanged(): void
    {
        $this->assertSame(
            'Rozsekanie ingestu na štyri vrstvy',
            $this->guard->title('Rozsekanie ingestu na štyri vrstvy'),
        );
    }

    public function test_title_is_normalized_not_repaired(): void
    {
        // úvodzovky, markdown nadpis a zdvojené medzery sú formát, nie obsah
        $this->assertSame(
            'Rozsekanie ingestu na štyri vrstvy',
            $this->guard->title('## "Rozsekanie   ingestu na štyri vrstvy"'),
        );
    }

    public function test_think_block_of_reasoning_model_is_stripped(): void
    {
        $raw = "<think>Používateľ chce titulok, skúsim…</think>\nRozsekanie ingestu na vrstvy";

        $this->assertSame('Rozsekanie ingestu na vrstvy', $this->guard->title($raw));
    }

    public function test_unterminated_think_block_is_rejected(): void
    {
        // model vyčerpal strop tokenov v uvažovaní → žiadny použiteľný titulok
        $this->assertNull($this->guard->title('<think>Tak najprv sa pozriem na prompty a potom'));
    }

    public function test_only_first_line_is_used(): void
    {
        $this->assertSame(
            'Rozsekanie ingestu na vrstvy',
            $this->guard->title("Rozsekanie ingestu na vrstvy\nVysvetlenie: rozdelil som to…"),
        );
    }

    public function test_json_envelope_is_unwrapped(): void
    {
        // config/llm.php vynucuje format:"json" pre každú modelovú vetvu
        $this->assertSame(
            'Rozsekanie ingestu na vrstvy',
            $this->guard->title('{"title": "Rozsekanie ingestu na vrstvy"}'),
        );
        $this->assertSame(
            'Rozsekanie ingestu na vrstvy',
            $this->guard->title('{"neznamy_kluc": "Rozsekanie ingestu na vrstvy"}'),
        );
    }

    public function test_json_without_usable_field_is_rejected(): void
    {
        // surové JSON sa nikdy nesmie stať titulkom
        $this->assertNull($this->guard->title('{"a": "prvá hodnota", "b": "druhá hodnota"}'));
        $this->assertNull($this->guard->title('{"count": 12, "ok": true}'));
    }

    public function test_too_short_title_is_rejected(): void
    {
        $this->assertNull($this->guard->title('Oprava'));
    }

    public function test_too_long_title_is_rejected(): void
    {
        $this->assertNull($this->guard->title(str_repeat('dlhý titulok ', 10)));
    }

    public function test_empty_and_null_are_rejected(): void
    {
        $this->assertNull($this->guard->title(null));
        $this->assertNull($this->guard->title('   '));
    }

    public function test_title_starting_with_url_or_slash_is_rejected(): void
    {
        $this->assertNull($this->guard->title('https://example.test/nejaka/cesta/k/veci'));
        $this->assertNull($this->guard->title('/sprint pokračuj v rozsekávaní'));
    }

    public function test_title_with_secret_is_rejected(): void
    {
        $this->assertNull($this->guard->title('Kľúč AKIAABCDEFGHIJKLMNOP do configu'));
        $this->assertNull($this->guard->title('token ghp_'.str_repeat('a1B2', 8).' do CI'));
    }

    public function test_title_echoing_redaction_marker_is_rejected(): void
    {
        // model prepisoval už redigovaný vstup → marker sa nesmie stať titulkom
        $this->assertNull($this->guard->title('Uloženie [REDAKTOVANÉ: high-entropy-b64] do konfigurácie'));
    }

    // ---- zhrnutie ----------------------------------------------------------

    public function test_valid_summary_passes(): void
    {
        $text = 'Session rozsekala ingest transcriptov na parser, klasifikátor, linker a writer. '
            .'Chovanie zostalo rovnaké, pridali sa regresné testy.';

        $this->assertSame($text, $this->guard->summary($text));
    }

    public function test_summary_blank_lines_are_collapsed(): void
    {
        $raw = "Prvý odsek zhrnutia session o rozsekaní ingestu.\n\n\n\nDruhý odsek s výsledkom práce.";

        $this->assertSame(
            "Prvý odsek zhrnutia session o rozsekaní ingestu.\n\nDruhý odsek s výsledkom práce.",
            $this->guard->summary($raw),
        );
    }

    public function test_too_short_summary_is_rejected(): void
    {
        $this->assertNull($this->guard->summary('Rozsekal ingest.'));
    }

    public function test_too_long_summary_is_rejected(): void
    {
        $this->assertNull($this->guard->summary(str_repeat('veta o práci. ', 200)));
    }

    public function test_summary_with_secret_is_rejected(): void
    {
        $this->assertNull($this->guard->summary(
            'Session nastavila prístup k API. Použitý kľúč bol sk-ant-'.str_repeat('a1B2', 6).' v konfigurácii.'
        ));
    }
}
