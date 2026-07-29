<?php

namespace App\Services\Brain;

use App\Exceptions\BrainFileNotFoundException;
use App\Exceptions\BrainWriteDisabledException;
use App\Exceptions\SecretsDetectedException;
use App\Models\Decision;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tombstone;
use Illuminate\Support\Str;

/**
 * Jediná cesta zápisu do ľudsky písaných `.md` „mozgov" — „markdown je master".
 * Model Hadesa je „1 súbor = 1 uzol", takže create/update/delete zapisuje CELÝ
 * súbor (frontmatter + telo), nie bulletový riadok.
 *
 * DATA-SAFETY (poučenia z auditu Apolla — NEZDEDIŤ jeho chyby):
 *   - Atomický zápis: `<file>.tmp.<pid>` v TOM ISTOM adresári + `rename()`.
 *     Čitateľ nikdy nevidí polovičný súbor; cross-device rename nepadá (tmp je
 *     v rovnakom filesystéme). Pri zlyhaní sa tmp upratuje, nezostáva.
 *   - Presun medzi súbormi (move): cieľ zapíš+over, AŽ POTOM zmaž zdroj — nikdy
 *     naopak. Pri zlyhaní zostane obsah aspoň v jednom súbore.
 *   - Guard `config('auraai.allow_brain_write')` default OFF → BrainWriteDisabledException.
 *     Cieľový zdroj musí byť navyše `writable`.
 *   - SecretScanner pri každom zápise; nález bez `force` → SecretsDetectedException
 *     (len názvy vzorov, nikdy hodnota). `force=true` → varovania.
 *   - Delete: Tombstone(external_key) zabráni znovu-adopcii pri ďalšom syncu.
 *
 * Po každom úspešnom zápise beží TARGETOVANÝ resync ({@see BrainSyncService::sync}
 * s `sourceKey`), ktorý sa serializuje cez `Cache::lock('brain-sync')`. Samotný
 * zápis súboru zámok nepotrebuje — atomický rename zaručí, že súbežný full-sync
 * číta buď starý, alebo nový celý obsah (idempotencia syncu dorovná zvyšok).
 */
class BrainWriter
{
    public function __construct(
        private readonly SecretScanner $scanner = new SecretScanner,
        private readonly BrainSyncService $sync = new BrainSyncService,
        private readonly BrainSourceRegistry $registry = new BrainSourceRegistry,
    ) {}

    // ------------------------------------------------------------------
    // Public API (volané B4 REST /api/*, B5 verify/review, DecisionController)
    // ------------------------------------------------------------------

    /**
     * Založí nový brain `.md` súbor (origin=brain) a targetovane resyncne.
     *
     * @return array{source_file: string, source_key: string, warnings: list<string>, sync: array}
     */
    public function create(NodeDraft $draft, bool $force = false): array
    {
        $this->ensureWriteEnabled();
        $warnings = $this->scanOrFail($draft->scannableText(), $force);

        [$sourceKey, $root] = $this->resolveWritableSource($draft->sourceKey);
        $rel = $draft->relPath ?: $this->deriveRelPath($draft, $root);
        $abs = $this->join($root, $rel);

        if (is_file($abs)) {
            throw new \RuntimeException("Cieľový súbor už existuje: {$rel}. Použi update().");
        }

        $this->atomicWrite($abs, $this->buildFile($draft));

        $sync = $this->sync->sync($sourceKey);

        return ['source_file' => $rel, 'source_key' => $sourceKey, 'warnings' => $warnings, 'sync' => $sync];
    }

    /**
     * Prepíše súbor existujúceho brain uzla. Ak sa cieľové umiestnenie líši
     * (iný zdroj/cesta), vykoná bezpečný PRESUN: cieľ zapíš+over, potom zmaž zdroj.
     *
     * @return array{source_file: string, source_key: string, warnings: list<string>, sync: array}
     */
    public function update(Node $node, NodeDraft $draft, bool $force = false): array
    {
        $this->ensureWriteEnabled();
        $warnings = $this->scanOrFail($draft->scannableText(), $force);

        $currentRel = (string) ($node->source_file ?? '');
        $currentAbs = $this->absForNode($node);

        // cieľ: buď rovnaké miesto ako uzol, alebo nový (move)
        if ($draft->sourceKey !== null || $draft->relPath !== null) {
            [$sourceKey, $root] = $this->resolveWritableSource($draft->sourceKey ?? $this->nodeSourceKey($node));
            $targetRel = $draft->relPath ?: $currentRel;
        } else {
            $sourceKey = $this->nodeSourceKey($node);
            $root = $this->absRoot($node);
            $targetRel = $currentRel;
        }
        $targetAbs = $this->join($root, $targetRel);

        $content = $this->buildFile($draft);

        if ($this->samePath($targetAbs, $currentAbs)) {
            // in-place prepis
            $this->atomicWrite($targetAbs, $content);
        } else {
            // MOVE — najprv zapíš+over cieľ …
            $this->atomicWrite($targetAbs, $content);
            if (! is_file($targetAbs)) {
                throw new \RuntimeException("Cieľ presunu sa nezapísal: {$targetRel}");
            }
            // … a LEN keď je cieľ overený, zmaž zdroj (nikdy naopak)
            if (is_file($currentAbs)) {
                $this->deleteFile($currentAbs);
            }
        }

        $sync = $this->sync->sync($sourceKey);

        return ['source_file' => $targetRel, 'source_key' => $sourceKey, 'warnings' => $warnings, 'sync' => $sync];
    }

    /**
     * Zmaže brain uzol: zmaž súbor, náhrobok na external_key (bráni znovu-adopcii),
     * odstráň uzol aj jeho hrany, targetovane resyncni.
     *
     * @return array{deleted: bool, source_file: ?string, sync: array}
     */
    public function delete(Node $node): array
    {
        $this->ensureWriteEnabled();

        $rel = $node->source_file;
        $abs = $this->absForNode($node, allowMissing: true);

        if ($abs !== null && is_file($abs)) {
            $this->deleteFile($abs);
        }

        if ($node->external_key) {
            Tombstone::firstOrCreate(
                ['external_key' => $node->external_key],
                ['reason' => 'brain-write delete', 'created_at' => now()],
            );
        }

        // osirelé hrany po delete zmaž (nenechať visieť)
        Edge::where('source_id', $node->id)->orWhere('target_id', $node->id)->delete();
        $sourceKey = $this->nodeSourceKey($node);
        $node->delete();

        $sync = $this->sync->sync($sourceKey);

        return ['deleted' => true, 'source_file' => $rel, 'sync' => $sync];
    }

    /**
     * Verify (guard ON vetva): povýši certainty uzla v jeho `.md` na `overene`
     * (frontmatter upgrade) a targetovane resyncne. DB polia (verified_at,
     * needs_review) nastavuje volajúci (B5 ReviewController). Pri guard OFF sa
     * sem NEvolá — B5 spraví len DB update + warning.
     *
     * @return array{source_file: ?string, warnings: list<string>, sync: array}
     */
    public function verify(Node $node): array
    {
        $this->ensureWriteEnabled();

        $abs = $this->absForNode($node);
        $raw = @file_get_contents($abs);
        if ($raw === false) {
            throw new BrainFileNotFoundException((string) $node->source_file);
        }

        $updated = $this->upsertFrontmatterCertainty($raw, 'overene');
        $this->atomicWrite($abs, $updated);

        $sync = $this->sync->sync($this->nodeSourceKey($node));

        return ['source_file' => $node->source_file, 'warnings' => [], 'sync' => $sync];
    }

    /**
     * Append rozhodnutia do ľudsky písaného `.md` časovej osi (guard ON + writable).
     * DB Decision riadok zakladá volajúci (DecisionController); tu ide o markdown
     * zrkadlo. Pri guard OFF sa sem NEvolá (rozhodnutie ostane len DB origin=session).
     *
     * @return array{source_file: string, source_key: string, warnings: list<string>}
     */
    public function writeDecision(string $text, ?string $reason = null, ?string $area = null, ?string $decidedOn = null, bool $force = false): array
    {
        $this->ensureWriteEnabled();
        $warnings = $this->scanOrFail($text.' '.(string) $reason, $force);

        [$sourceKey, $root] = $this->resolveWritableSource(null);
        $rel = 'rozhodnutia/'.($area ? Str::slug($area) : 'vseobecne').'.md';
        $abs = $this->join($root, $rel);

        $date = $decidedOn ?: now()->format('Y-m-d');
        $line = '- '.$date.' — '.BrainText::normalize($text).($reason ? ' ('.BrainText::normalize($reason).')' : '');

        $existing = is_file($abs) ? (string) @file_get_contents($abs) : "# Rozhodnutia\n";
        $content = rtrim($existing, "\n")."\n".$line."\n";

        $this->atomicWrite($abs, $content);

        return ['source_file' => $rel, 'source_key' => $sourceKey, 'warnings' => $warnings];
    }

    // ------------------------------------------------------------------
    // Guardy + sken
    // ------------------------------------------------------------------

    private function ensureWriteEnabled(): void
    {
        if (! config('auraai.allow_brain_write')) {
            throw new BrainWriteDisabledException;
        }
    }

    /**
     * @return list<string>  varovania keď sa zapisuje napriek nálezu (force)
     *
     * @throws SecretsDetectedException  nález bez force
     */
    private function scanOrFail(string $text, bool $force): array
    {
        $patterns = $this->scanner->scan($text);

        if ($patterns === [] || $force) {
            return array_map(fn (string $p): string => "Uložené napriek nálezu vzoru tajomstva: {$p}", $patterns);
        }

        throw new SecretsDetectedException($patterns);
    }

    // ------------------------------------------------------------------
    // Skladanie súboru
    // ------------------------------------------------------------------

    /** Poskladá `.md` obsah z draftu: YAML frontmatter + telo. */
    private function buildFile(NodeDraft $draft): string
    {
        $fm = ['name: '.$this->yamlScalar($draft->label)];
        if ($draft->description !== null && trim($draft->description) !== '') {
            $fm[] = 'description: '.$this->yamlScalar($draft->description);
        }
        if ($draft->certainty !== null && $draft->certainty !== '') {
            $fm[] = 'certainty: '.$draft->certainty;
        }
        if ($draft->area !== null && $draft->area !== '') {
            $fm[] = 'area: '.$draft->area;
        }
        $fm[] = 'type: '.$draft->type;
        if ($draft->tags !== []) {
            $fm[] = 'tags: ['.implode(', ', array_map(fn ($t) => (string) $t, $draft->tags)).']';
        }

        $body = $draft->body ?? ('# '.$draft->label."\n\n".(string) $draft->description);

        return "---\n".implode("\n", $fm)."\n---\n\n".rtrim($body, "\n")."\n";
    }

    /**
     * Nastaví/prepíše `certainty:` vo frontmatteri. Ak súbor frontmatter nemá,
     * predsadí ho. Telo ostáva nedotknuté.
     */
    private function upsertFrontmatterCertainty(string $raw, string $certainty): string
    {
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw) ?? $raw;

        if (! preg_match('/^---\r?\n(.*?)\r?\n---(\r?\n?)(.*)$/s', $raw, $m)) {
            // žiadny frontmatter → predsadíme minimálny
            return "---\ncertainty: {$certainty}\n---\n".$raw;
        }

        $fm = $m[1];
        if (preg_match('/^\s*certainty\s*:.*$/mi', $fm)) {
            $fm = preg_replace('/^\s*certainty\s*:.*$/mi', 'certainty: '.$certainty, $fm);
        } else {
            $fm = rtrim($fm, "\n")."\ncertainty: ".$certainty;
        }

        return "---\n".$fm."\n---".$m[2].$m[3];
    }

    /** Bezpečný YAML skalár na jednom riadku (úvodzovky keď treba). */
    private function yamlScalar(string $value): string
    {
        $value = str_replace(["\r", "\n"], ' ', trim($value));
        if ($value === '' || preg_match('/[:#\[\]{}",\']/', $value)) {
            return '"'.str_replace('"', '\"', $value).'"';
        }

        return $value;
    }

    // ------------------------------------------------------------------
    // Rozlíšenie zdrojov a ciest
    // ------------------------------------------------------------------

    /**
     * Vyrieši cieľový writable zdroj → [sourceKey, root]. Ak $key nie je zadaný,
     * vezme prvý writable zdroj z registra. Guard `allow_brain_write` už prešiel;
     * tu overíme, že konkrétny zdroj je writable a má koreň.
     *
     * @return array{0: string, 1: string}
     */
    private function resolveWritableSource(?string $key): array
    {
        $sources = $this->registry->sources();

        foreach ($sources as $s) {
            if ($key !== null && $s['key'] !== $key) {
                continue;
            }
            if (! ($s['writable'] ?? false)) {
                if ($key !== null) {
                    throw new \RuntimeException("Zdroj '{$key}' nie je writable — zápis odmietnutý.");
                }

                continue;
            }
            $root = $s['path'] ?? null;
            if (! is_string($root) || $root === '') {
                throw new \RuntimeException("Zdroj '{$s['key']}' nemá koreňovú cestu.");
            }

            return [(string) $s['key'], rtrim($root, '/\\')];
        }

        throw new \RuntimeException($key !== null
            ? "Writable zdroj '{$key}' sa nenašiel."
            : 'Nie je nakonfigurovaný žiadny writable brain zdroj.');
    }

    /** Odvodí rel. cestu nového súboru zo slug-u labelu (nekoliduje s existujúcim). */
    private function deriveRelPath(NodeDraft $draft, string $root): string
    {
        $slug = Str::slug($draft->label) ?: 'uzol';
        $rel = $slug.'.md';
        $i = 2;
        while (is_file($this->join($root, $rel))) {
            $rel = $slug.'-'.$i.'.md';
            $i++;
        }

        return $rel;
    }

    /** Koreň zdroja uzla (meta.root, fallback base_path). */
    private function absRoot(Node $node): string
    {
        $meta = is_array($node->meta) ? $node->meta : [];
        $root = $meta['root'] ?? base_path();

        return rtrim((string) $root, '/\\');
    }

    /** source_key uzla z meta (fallback odvodený z origin). */
    private function nodeSourceKey(Node $node): ?string
    {
        $meta = is_array($node->meta) ? $node->meta : [];

        return isset($meta['source_key']) ? (string) $meta['source_key'] : null;
    }

    /**
     * Absolútna cesta k `.md` súboru uzla: meta.root + (meta.path | source_file).
     *
     * @throws BrainFileNotFoundException  keď uzol nemá stopu do súboru
     */
    private function absForNode(Node $node, bool $allowMissing = false): ?string
    {
        $meta = is_array($node->meta) ? $node->meta : [];
        $rel = $meta['path'] ?? $node->source_file;

        if (! is_string($rel) || $rel === '') {
            if ($allowMissing) {
                return null;
            }
            throw new BrainFileNotFoundException((string) $node->source_file);
        }

        return $this->join($this->absRoot($node), $rel);
    }

    private function join(string $root, string $rel): string
    {
        return rtrim($root, '/\\').DIRECTORY_SEPARATOR.str_replace(['\\', '/'], DIRECTORY_SEPARATOR, ltrim($rel, '/\\'));
    }

    /** Porovnanie ciest tolerantné k oddeľovačom (Windows/Unix). */
    private function samePath(string $a, string $b): bool
    {
        $n = fn (string $p) => rtrim(str_replace('\\', '/', $p), '/');

        return $n($a) === $n($b);
    }

    // ------------------------------------------------------------------
    // Atomický zápis (tmp v tom istom adresári + rename) — override-friendly
    // ------------------------------------------------------------------

    /**
     * Atomicky zapíše $content do $abs cez `<abs>.tmp.<pid>` + rename. Pri
     * akomkoľvek zlyhaní upratuje tmp a hodí RuntimeException — pôvodný súbor
     * ostáva nedotknutý (rename je all-or-nothing).
     */
    private function atomicWrite(string $abs, string $content): void
    {
        $dir = dirname($abs);
        if (! is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $tmp = $abs.'.tmp.'.getmypid();

        try {
            if ($this->putContents($tmp, $content) === false) {
                throw new \RuntimeException("Nepodarilo sa zapísať dočasný súbor: {$tmp}");
            }
            if (! $this->rename($tmp, $abs)) {
                throw new \RuntimeException("Nepodarilo sa premenovať {$tmp} → {$abs}");
            }
        } catch (\Throwable $e) {
            if (is_file($tmp)) {
                @unlink($tmp);
            }
            throw $e;
        }
    }

    /** Wrapper pre testovateľnosť (test double vie simulovať zlyhanie). */
    protected function putContents(string $path, string $content): int|false
    {
        return @file_put_contents($path, $content);
    }

    /** Wrapper pre testovateľnosť. */
    protected function rename(string $from, string $to): bool
    {
        return @rename($from, $to);
    }

    /** Wrapper pre testovateľnosť. */
    protected function deleteFile(string $path): bool
    {
        return @unlink($path);
    }
}
