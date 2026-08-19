<?php

namespace App\Services\Console;

use App\Http\Controllers\Console\RunController;
use App\Models\ConsoleThread;
use App\Services\Console\Tools\ConsoleTool;
use App\Services\Llm\ProviderFactory;

/**
 * Beh konzoly BEZ človeka — pre CLI, skript a inú AI.
 *
 * Rozdiel proti {@see RunController} nie je len v tom, že tu netečie NDJSON.
 * Sú to dva:
 *
 * ── 1. Register je LEN NA ČÍTANIE ──────────────────────────────────────────
 *
 * Zápisový tool ťah ZAPARKUJE rámcom `permission` a čaká, kým človek klikne
 * (dvojfázový beh v {@see AgentRunner}). Pri programovom behu tam nikto nie je,
 * takže parkovanie nie je pauza, ale trvalé zablokovanie vlákna: `pending` tool
 * call odmietne aj ďalšiu správu do toho istého vlákna
 * ({@see ConsoleThread::pendingToolCall()}), a odblokovať ho vie iba človek
 * v UI. Preto sa zápisové tooly modelu ani NEPONÚKNU — z kánonu
 * {@see ToolRegistry::TOOLS} sa odfiltrujú tie, ktoré majú `isWrite()`.
 *
 * Opačná odpoveď — `auto_accept = true`, teda automaticky povoliť zápisy — by
 * z programového vstupu urobila cestu, ktorou vie skript alebo iná AI prepísať
 * pamäť aj súbory bez toho, aby to ktokoľvek videl. Filtrovanie sady je
 * fail-closed, auto-accept je fail-open.
 *
 * Sada sa nevypisuje menami: keď v `TOOLS` pribudne zápisový tool, počíta sa
 * z `isWrite()` znova a nikto na jeho pridanie do zoznamu nezabudne.
 *
 * ── 2. Výsledok je pre STROJ, nie pre obrazovku ────────────────────────────
 *
 * Rámce sa nezbierajú všetky. `delta` rámce sú po štvoriciach znakov to isté,
 * čo `text` — keby sa do výsledku skopírovali oboje, odpoveď je dvakrát a pri
 * dlhom ťahu je to zaplatený kontext za nič. Zostane text (súčet delt), tooly
 * so stavom a cenou ťahu a `thread`, ktorým sa dá pokračovať v tej istej
 * konverzácii.
 */
final class HeadlessRunner
{
    /** Register bez zápisu — postaví sa raz, tooly sú bezstavové. */
    private ?ToolRegistry $readOnly = null;

    public function __construct(
        private readonly ProviderFactory $providers,
        private readonly SystemPrompt $prompt,
    ) {}

    /**
     * Jeden ťah. Vlákno sa nájde podľa `uuid`, alebo sa založí nové.
     *
     * @param  array{provider?: string|null, model?: string|null}  $options
     * @return array<string, mixed> kompaktný výsledok, alebo pole s kľúčom `error`
     */
    public function run(string $message, ?string $threadUuid = null, array $options = []): array
    {
        $thread = $this->thread($threadUuid, $options);

        if (! $thread instanceof ConsoleThread) {
            return $thread;
        }

        // Vlákno s nedorozhodnutým zápisom nesmie prijať ďalšiu správu — model by
        // dostal históriu s `tool_use` bez výsledku. Tu to znamená, že vlákno
        // zaparkoval človek v UI; odblokovať ho môže tiež len on.
        if ($thread->pendingToolCall() !== null) {
            return [
                'thread' => $thread->uuid,
                'error' => 'Vlákno čaká na rozhodnutie o zápise. Rozhodni ho v konzole a spusti beh znova.',
            ];
        }

        $acc = ['text' => '', 'tools' => [], 'steps' => 0, 'end' => null, 'error' => null];

        // Vlastná instancia smyčky, nie tá z kontejnera: `AgentRunner` si register
        // berie v konštruktore, takže read-only sada sa inak nedá podstrčiť bez
        // toho, aby sa prepísal register aj pre prehliadačový okruh.
        $runner = new AgentRunner($this->providers, $this->prompt, $this->registry());

        $runner->run(
            $thread,
            $message,
            function (array $frame) use (&$acc): void {
                $this->absorb($frame, $acc);
            },
            null,
            ['provider' => $options['provider'] ?? null, 'model' => $options['model'] ?? null],
        );

        if ($acc['error'] !== null) {
            return ['thread' => $thread->uuid, 'error' => $acc['error']];
        }

        return [
            'thread' => $thread->uuid,
            'text' => $acc['text'],
            'tools' => array_values($acc['tools']),
            'tokens_in' => (int) ($acc['end']['tokens_in'] ?? 0),
            'tokens_out' => (int) ($acc['end']['tokens_out'] ?? 0),
            'tokens_per_second' => $acc['end']['tokens_per_second'] ?? null,
            'stop_reason' => $acc['end']['stop_reason'] ?? null,
            'steps' => $acc['steps'],
        ];
    }

    /**
     * Sada toolov programového behu — kánon z {@see ToolRegistry::TOOLS} bez
     * zápisových. Verejná preto, že „ani jeden zápisový tool" je vlastnosť, ktorú
     * má zmysel overiť testom, nie prečítať v komentári.
     */
    public function registry(): ToolRegistry
    {
        return $this->readOnly ??= new ToolRegistry(array_values(array_filter(
            array_map(static fn (string $class): ConsoleTool => app($class), ToolRegistry::TOOLS),
            static fn (ConsoleTool $tool): bool => ! $tool->isWrite(),
        )));
    }

    /**
     * Vlákno pre ťah: existujúce podľa `uuid`, alebo nové.
     *
     * Neznáme `uuid` sa NEZALOŽÍ ako nové vlákno. Volajúci si myslí, že
     * pokračuje v konverzácii, a ticho založené prázdne vlákno by mu vrátilo
     * odpoveď bez kontextu, o ktorý žiadal — bez toho, aby mal ako zistiť prečo.
     *
     * @param  array{provider?: string|null, model?: string|null}  $options
     * @return ConsoleThread|array<string, mixed>
     */
    private function thread(?string $threadUuid, array $options): ConsoleThread|array
    {
        $uuid = trim((string) $threadUuid);

        if ($uuid === '') {
            return ConsoleThread::create([
                'provider' => $options['provider'] ?? config('hades.console.provider'),
                'model' => $options['model'] ?? null,
            ]);
        }

        $thread = ConsoleThread::where('uuid', $uuid)->first();

        return $thread ?? ['error' => 'Také vlákno neexistuje: '.$uuid];
    }

    /**
     * Jeden rámec protokolu do akumulátora.
     *
     * `permission` sa tu považuje za chybu, nie za stav: s read-only registrom
     * nemá ako vzniknúť, a keby raz vznikol, znamená to, že sada prepustila
     * zápisový tool — teda že vlákno práve zamrzlo a treba to vedieť, nie mlčať.
     *
     * @param  array<string, mixed>  $frame
     * @param  array<string, mixed>  $acc
     */
    private function absorb(array $frame, array &$acc): void
    {
        switch ($frame['t'] ?? '') {
            case 'delta':
                $acc['text'] .= (string) ($frame['text'] ?? '');
                break;

            case 'step':
                $acc['steps'] = (int) ($frame['n'] ?? $acc['steps']);
                break;

            case 'tool':
                // kľúčom je id riadku, aby `tool_result` doplnil ten SVOJ tool aj
                // vtedy, keď krok volal tri naraz
                $acc['tools'][$frame['id']] = [
                    'name' => (string) ($frame['name'] ?? '?'),
                    'status' => 'running',
                    'duration_ms' => 0,
                ];
                break;

            case 'tool_result':
                $acc['tools'][$frame['id']] = [
                    'name' => (string) ($acc['tools'][$frame['id']]['name'] ?? '?'),
                    'status' => (string) ($frame['status'] ?? 'done'),
                    'duration_ms' => (int) ($frame['duration_ms'] ?? 0),
                ];
                break;

            case 'end':
                $acc['end'] = $frame;
                break;

            case 'permission':
                $acc['error'] = 'Beh sa zaparkoval na zápise `'.($frame['name'] ?? '?')
                    .'`, ktorý v programovom behu nemá kto povoliť.';
                break;

            case 'error':
                $acc['error'] = (string) ($frame['message'] ?? 'Beh spadol.');
                break;
        }
    }
}
