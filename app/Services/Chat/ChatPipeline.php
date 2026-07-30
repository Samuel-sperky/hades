<?php

namespace App\Services\Chat;

use App\Llm\ChatOptions;
use App\Llm\ProviderFactory;
use App\Llm\ProviderHealth;
use App\Models\Node;
use App\Services\Brain\SecretScanner;
use Illuminate\Support\Collection;

/**
 * Orchestrátor trojvrstvovej architektúry chatu (rozhodnutie #117). Vlastník P5.
 *
 *   1. IntentRouter        — deterministický, POVINNÝ, prvý, funguje offline
 *   2. ModelIntentRouter   — model ako DOPLNOK, len keď vrstva 1 vráti 'none'
 *   3. TemplateAnswerer    — čísla a fakty skladá VŽDY kód z reálnych dát
 *
 * Eskalácia na voľnú odpoveď modelu sa spustí len keď ani jeden router zámer
 * nerozpoznal (teda šablóna nemá čo povedať) a model je dostupný. Aj tam platí
 * „model negeneruje čísla" — vynucuje to NumberGuard, nie prompt.
 *
 * Keď Ollama nebeží, všetko dobehne z vrstiev 1+3, HTTP zostáva 200 a odpoveď
 * nesie `meta.degraded = true` + `meta.reason` (rozhodnutie #119). NIKDY 500.
 */
final class ChatPipeline
{
    public function __construct(
        private readonly IntentRouter $router,
        private readonly ModelIntentRouter $modelRouter,
        private readonly TemplateAnswerer $templates,
        private readonly ProviderFactory $providers,
        private readonly RephraseValidator $validator,
        private readonly SecretScanner $scanner,
    ) {}

    /**
     * Nestreamovaná odpoveď — `POST /api/chat`.
     *
     * `$allowModel = false` vypne celú vrstvu 2 pre túto jednu požiadavku
     * (používa to StreamGate, keď je slot streamu obsadený) — odpoveď potom
     * dobehne čisto z vrstiev 1+3, teda okamžite a bez workera na modeli.
     *
     * @param  list<array{role: string, content: string}>  $history
     */
    public function answer(string $message, string $context = '', ?string $sessionKey = null, array $history = [], bool $allowModel = true): ChatAnswer
    {
        return $this->run($message, $context, $sessionKey, $history, null, $allowModel);
    }

    /**
     * Streamovaná odpoveď — `POST /api/chat/stream`. `$onToken` dostane každý
     * kúsok textu; deterministické šablóny sa streamujú po slovách, modelová
     * vetva token po tokene tak, ako ho pošle Ollama.
     *
     * @param  list<array{role: string, content: string}>  $history
     */
    public function stream(string $message, callable $onToken, string $context = '', ?string $sessionKey = null, array $history = [], bool $allowModel = true): ChatAnswer
    {
        return $this->run($message, $context, $sessionKey, $history, $onToken, $allowModel);
    }

    /** Klasifikácia zámeru bez odpovede — pre diagnostiku a slash príkaz `/nahlad`. */
    public function classify(string $message, bool $allowModel = true): Intent
    {
        $intent = $this->router->route($message);

        if (! $intent->isNone() || ! $allowModel) {
            return $intent;
        }

        return $this->modelRouter->route($message);
    }

    /**
     * @param  list<array{role: string, content: string}>  $history
     */
    private function run(string $message, string $context, ?string $sessionKey, array $history, ?callable $onToken, bool $allowModel = true): ChatAnswer
    {
        $health = $this->health();
        $intent = $this->classify($message, $allowModel);

        // shop.* — dátový zdroj dodáva P11 cez väzbu DomainAnswerer v kontejneri.
        if ($intent->isShop() && ($domain = $this->domainAnswer($intent, $message)) instanceof ChatAnswer) {
            return $this->emit($this->withHealth($domain, $health), $onToken);
        }

        $answer = $this->templates->answer($intent, $message, $sessionKey);

        // Eskalácia: ani deterministický router, ani model zámer nerozpoznali.
        if ($allowModel && $intent->isNone() && $health->chat) {
            $escalated = $this->escalate($message, $context, $sessionKey, $history, $answer, $onToken);
            if ($escalated instanceof ChatAnswer) {
                return $this->withHealth($escalated, $health);
            }
        }

        if ($allowModel) {
            $answer = $this->maybeRephrase($answer, $health);
        }

        return $this->emit($this->withHealth($answer, $health), $onToken);
    }

    /** Voľná odpoveď modelu z vybavených uzlov. Vracia null, keď sa nepodarila. */
    private function escalate(
        string $message,
        string $context,
        ?string $sessionKey,
        array $history,
        ChatAnswer $fallback,
        ?callable $onToken,
    ): ?ChatAnswer {
        $budget = (array) config('llm.context.escalation', ['nodes' => 20, 'chars' => 12_000]);
        $nodes = $this->templates->recallFor($message, (int) ($budget['nodes'] ?? 20), $sessionKey);
        $knowledge = $this->knowledgeBlock($nodes, $context, (int) ($budget['chars'] ?? 12_000));

        $messages = $this->messagesFor($message, $knowledge, $history);
        $opts = new ChatOptions(
            system: (string) config('prompts.system.escalation', ''),
            timeoutMs: (int) config('llm.timeouts.total', 300_000),
            task: 'chat',
        );

        // Guard drží čísla — povolené sú len tie z podkladu a z otázky.
        $guard = new NumberGuard($knowledge, $message);
        $provider = $this->providers->forEscalation();

        if ($onToken === null) {
            $result = $provider->chat($messages, $opts);
            $text = $result->ok() ? ModelText::extract($result->text) : null;

            if ($text === null) {
                return null;
            }

            $clean = $guard->push($text).$guard->flush();

            return $this->modelAnswer($fallback, $clean, $result->model, $result->ms, $result->tokPerS, $result->finishReason, $nodes, $guard->dropped());
        }

        $unwrapper = new JsonTextStream;
        $sent = '';

        $result = $provider->stream($messages, $opts, function (string $delta) use ($unwrapper, $guard, $onToken, &$sent): void {
            $plain = $unwrapper->push($delta);
            if ($plain === '') {
                return;
            }
            $safe = $guard->push($plain);
            if ($safe !== '') {
                $sent .= $safe;
                $onToken($safe);
            }
        });

        $tail = $guard->flush();
        if ($tail !== '') {
            $sent .= $tail;
            $onToken($tail);
        }

        if (trim($sent) === '') {
            // Model obal nedodržal alebo spojenie padlo pred prvým tokenom —
            // klient ešte nič nevidel, takže sa bez následkov vrátime k šablóne.
            return null;
        }

        return $this->modelAnswer($fallback, $sent, $result->model, $result->ms, $result->tokPerS, $result->finishReason, $nodes, $guard->dropped());
    }

    /** @param  Collection<int, Node>  $nodes */
    private function modelAnswer(
        ChatAnswer $fallback,
        string $text,
        string $model,
        int $ms,
        float $tokPerS,
        string $finishReason,
        Collection $nodes,
        int $droppedNumbers,
    ): ChatAnswer {
        return $fallback->with([
            'text' => trim($text),
            'citations' => $nodes->pluck('id')->map('intval')->unique()->values()->all(),
            'model' => $model,
            'ms' => $ms,
            'tokPerS' => $tokPerS,
            'finishReason' => $finishReason,
            'source' => 'model',
            'reason' => $droppedNumbers > 0 ? 'model_numbers_dropped' : null,
        ]);
    }

    /** Preformulovanie šablóny modelom — vypnuté by default, viď config llm.rephrase. */
    private function maybeRephrase(ChatAnswer $answer, ProviderHealth $health): ChatAnswer
    {
        if (! (bool) config('llm.rephrase.enabled', false) || ! $health->chat || $answer->text === '') {
            return $answer;
        }

        $result = $this->providers->forEscalation()->chat(
            [['role' => 'user', 'content' => $this->scanner->redact($answer->text)]],
            new ChatOptions(
                system: (string) config('prompts.system.rephrase', ''),
                timeoutMs: (int) config('llm.timeouts.first_token', 90_000),
                task: 'rephrase',
            ),
        );

        if (! $result->ok()) {
            return $answer;
        }

        $candidate = ModelText::extract($result->text);
        if ($candidate === null) {
            return $answer;
        }

        $validated = $this->validator->validate($answer->text, $candidate);
        if ($validated === null) {
            return $answer;
        }

        return $answer->with([
            'text' => $validated,
            'model' => $result->model,
            'tokPerS' => $result->tokPerS,
            'rephrased' => true,
        ]);
    }

    /**
     * Šablónová odpoveď sa streamuje po slovách — klient tak dostane rovnaký
     * tok udalostí ako pri modeli a streamovanie funguje aj s vypnutou Ollamou.
     */
    private function emit(ChatAnswer $answer, ?callable $onToken): ChatAnswer
    {
        if ($onToken === null || $answer->source === 'model' || $answer->text === '') {
            return $answer;
        }

        foreach (preg_split('/(?<=\s)/u', $answer->text) ?: [$answer->text] as $chunk) {
            if ($chunk !== '') {
                $onToken($chunk);
            }
        }

        return $answer;
    }

    /**
     * @param  Collection<int, Node>  $nodes
     */
    private function knowledgeBlock(Collection $nodes, string $context, int $budget): string
    {
        $lines = [];

        if ($nodes->isNotEmpty()) {
            $lines[] = 'Poznatky z mojej siete relevantné k otázke:';
            foreach ($nodes as $node) {
                $meta = collect([$node->type, $node->area?->name, $node->department?->name])
                    ->filter()
                    ->implode(' · ');
                $lines[] = '- '.$node->label.' ('.$meta.'): '.trim((string) $node->description);
            }
        }

        if (trim($context) !== '') {
            $lines[] = '';
            $lines[] = 'Priložený kontext (uzly, ktoré používateľ pripol — prioritný podklad):';
            $lines[] = trim($context);
        }

        $block = trim(implode("\n", $lines));
        if ($block === '') {
            $block = '(k tejto téme zatiaľ nemám v sieti žiadne uzly)';
        }

        // Prompt prechádza SecretScannerom PRED odoslaním (rozhodnutie #149).
        return $this->scanner->redact(mb_substr($block, 0, max(500, $budget)));
    }

    /**
     * @param  list<array{role: string, content: string}>  $history
     * @return list<array{role: string, content: string}>
     */
    private function messagesFor(string $message, string $knowledge, array $history): array
    {
        $messages = [];

        foreach (array_slice($history, -12) as $entry) {
            $role = (string) ($entry['role'] ?? '');
            $content = trim((string) ($entry['content'] ?? ''));
            if (in_array($role, ['user', 'assistant'], true) && $content !== '') {
                $messages[] = ['role' => $role, 'content' => $this->scanner->redact($content)];
            }
        }

        $messages[] = [
            'role' => 'user',
            'content' => $knowledge."\n\nOtázka: ".$this->scanner->redact(trim($message)),
        ];

        return $messages;
    }

    private function domainAnswer(Intent $intent, string $message): ?ChatAnswer
    {
        if (! app()->bound(DomainAnswerer::class)) {
            return null;
        }

        $answerer = app(DomainAnswerer::class);

        if (! $answerer instanceof DomainAnswerer || ! $answerer->handles($intent)) {
            return null;
        }

        return $answerer->answer($intent, $message);
    }

    private function withHealth(ChatAnswer $answer, ProviderHealth $health): ChatAnswer
    {
        if ($health->chat) {
            return $answer;
        }

        return $answer->with([
            'degraded' => true,
            'reason' => $answer->reason ?? ($health->error ?? 'model_unavailable'),
        ]);
    }

    private function health(): ProviderHealth
    {
        return $this->providers->forChat()->health();
    }
}
