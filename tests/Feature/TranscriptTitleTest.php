<?php

namespace Tests\Feature;

use App\Services\TranscriptIngestService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use ReflectionMethod;
use Tests\TestCase;

/**
 * A7 — názvy session uzlov.
 *
 * Audit 6.8.2026 označil „surový prompt ako uzol" za najčastejší vzorec odpadu.
 * Overenie 12.8.2026 ukázalo, že tie uzly nevznikajú z mind_learn, ale z ingestu
 * transcriptov: každý taký uzol mal source='session'. smartTitle() brala prvú
 * vetu prvého promptu doslova a orezala ju na 60 znakov, takže z požiadavky
 * „Potrebujem postaviť chat ako je Claude / Chatgpt a zároveň…" vznikol názov
 * uzla useknutý uprostred myšlienky.
 *
 * Fallback `<projekt> — práca <dátum>` bol vždy použiteľný; problém bol, že sa
 * naň nikdy nedostalo.
 */
class TranscriptTitleTest extends TestCase
{
    use RefreshDatabase;

    private function title(array $prompts, string $project = 'AI-mind'): string
    {
        $method = new ReflectionMethod(TranscriptIngestService::class, 'smartTitle');
        $method->setAccessible(true);

        return $method->invoke(app(TranscriptIngestService::class), [
            'prompts' => $prompts,
            'project' => $project,
            'started_at' => '2026-08-12 10:00:00',
        ]);
    }

    private function fallback(string $project = 'AI-mind'): string
    {
        return $project.' — práca 12.8.2026';
    }

    public function test_a_truncated_fragment_is_not_used_as_a_title(): void
    {
        // reálny uzol 2603
        $title = $this->title(['Potrebujem postaviť chat ako je Claude / Chatgpt a zároveň nemať duplicity v databaze na hades a aura ai']);

        $this->assertSame($this->fallback(), $title);
        $this->assertStringNotContainsString('Potrebujem', $title);
    }

    public function test_a_short_request_is_not_used_as_a_title(): void
    {
        // reálny uzol 2609 — 51 znakov, teda sa ani neorezáva
        $this->assertSame(
            $this->fallback(),
            $this->title(['potrebujem vylepšíť dizajn hades pošli mi screenshot'])
        );
    }

    public function test_a_request_in_the_middle_of_a_sentence_is_caught_too(): void
    {
        $this->assertSame(
            $this->fallback(),
            $this->title(['vypol sa počítač potrebujem obnoviť tunnel'])
        );
    }

    public function test_a_real_topic_is_still_used(): void
    {
        $this->assertSame(
            'Migrácia databázy na MariaDB 11.4',
            $this->title(['Migrácia databázy na MariaDB 11.4'])
        );
    }

    public function test_the_first_usable_prompt_wins(): void
    {
        $title = $this->title([
            'potrebujem to opraviť',                 // požiadavka → preskoč
            'ok',                                    // krátke → preskoč
            'Refaktor ingestu transcriptov',         // téma → ber
        ]);

        $this->assertSame('Refaktor ingestu transcriptov', $title);
    }

    public function test_fallback_is_scoped_by_project_so_two_projects_do_not_collide(): void
    {
        $a = $this->title(['potrebujem pomoc'], 'AI-mind');
        $b = $this->title(['potrebujem pomoc'], 'aura-ai');

        $this->assertNotSame($a, $b);
    }
}
