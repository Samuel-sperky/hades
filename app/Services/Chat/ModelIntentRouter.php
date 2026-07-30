<?php

namespace App\Services\Chat;

use App\Llm\ChatOptions;
use App\Llm\ProviderFactory;
use App\Services\Brain\SecretScanner;

/**
 * VRSTVA 2 — model ako DOPLNOK deterministického routera. Vlastník P5.
 *
 * Zapojí sa LEN keď vrstva 1 nenašla zhodu. Model je `qwen3:4b` (100 % presnosť
 * v SK, 12/12 — docs/BENCHMARK-LLM.md §2); parametre `think:false`,
 * `format:"json"` a `temperature:0` sú v `config('llm.tasks.router')` a sú
 * POVINNÉ — bez nich model spáli budget na `<think>` blok a vráti prázdno.
 *
 * Výstup sa validuje proti uzavretému enumu tried. Čokoľvek mimo enumu (aj halucinácia
 * typu `{"intent":"Kolko objednavok…"}`) sa zahodí a zámer zostane 'none'.
 * Keď Ollama nebeží, vetva sa preskočí BEZ chyby a bez logu.
 */
final class ModelIntentRouter
{
    public function __construct(
        private readonly ProviderFactory $providers,
        private readonly IntentRouter $deterministic,
        private readonly SecretScanner $scanner,
    ) {}

    public function route(string $message): Intent
    {
        if (! (bool) config('llm.router.model_fallback', true)) {
            return Intent::none();
        }

        $message = trim($message);
        if ($message === '') {
            return Intent::none();
        }

        $provider = $this->providers->forChat();

        // Prompt prechádza SecretScannerom PRED odoslaním (rozhodnutie #149).
        $safe = $this->scanner->redact($message);

        $result = $provider->chat(
            [['role' => 'user', 'content' => $safe]],
            new ChatOptions(
                system: (string) config('prompts.system.router', ''),
                timeoutMs: (int) config('llm.timeouts.first_token', 90_000),
                task: 'router',
            ),
        );

        if (! $result->ok()) {
            return Intent::none();
        }

        $intent = ModelText::intent($result->text);

        if ($intent === null || ! in_array($intent, $this->deterministic->allowedIntents(), true)) {
            return Intent::none();
        }

        return new Intent($intent, [], 'model');
    }
}
