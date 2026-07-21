<?php

namespace App\Services\Brain;

/**
 * Minimalistický parser YAML frontmatteru (`--- … ---` na začiatku súboru).
 *
 * Zámerne NEťahá symfony/yaml — Hades nemá build step ani ťažké závislosti a
 * frontmatter mozgov je plochý: skalárne kľúče (name, description, certainty,
 * source, node_id, area…), jednoúrovňové vnorenie (`metadata.type`) a jednoduchý
 * zoznam tagov (`tags: a, b` alebo `tags: [a, b]` alebo YAML `- a` odrážky).
 *
 * Port a rozšírenie z ClaudeMemoryIngestService::frontmatter().
 */
final class Frontmatter
{
    /**
     * Rozparsuje frontmatter blok na mapu kľúč → hodnota. Skaláry sú stringy,
     * `tags` je vždy list<string>, `metadata.type` sa sploští na 'metadata_type'.
     *
     * @return array<string, mixed>
     */
    public static function parse(string $raw): array
    {
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw) ?? $raw;
        if (! preg_match('/^---\r?\n(.*?)\r?\n---/s', $raw, $m)) {
            return [];
        }

        $out = [];
        $parent = null;
        $tagList = [];
        $inTagsBlock = false;

        foreach (preg_split('/\r?\n/', $m[1]) as $line) {
            if (trim($line) === '') {
                continue;
            }

            // YAML zoznamová odrážka pod `tags:` (`  - devops`)
            if ($inTagsBlock && preg_match('/^\s*-\s+(.+)$/', $line, $li)) {
                $tag = trim($li[1], " \t\"'");
                if ($tag !== '') {
                    $tagList[] = $tag;
                }

                continue;
            }
            $inTagsBlock = false;

            if (! preg_match('/^(\s*)([\w.-]+):\s*(.*)$/', $line, $mm)) {
                continue;
            }

            $indent = strlen($mm[1]);
            $key = $mm[2];
            $value = trim($mm[3], " \t\"'");

            if ($indent === 0) {
                $parent = $key;

                if ($key === 'tags') {
                    $tagList = array_merge($tagList, self::splitTags($mm[3]));
                    // ak je hodnota prázdna, tagy môžu prísť ako odrážky nižšie
                    $inTagsBlock = trim($mm[3]) === '';

                    continue;
                }

                if ($value !== '') {
                    $out[$key] = $value;
                }
            } elseif ($parent === 'metadata' && $key === 'type' && $value !== '') {
                $out['metadata_type'] = $value;
            }
        }

        $tagList = array_values(array_unique(array_filter($tagList, fn ($t) => $t !== '')));
        if ($tagList !== []) {
            $out['tags'] = $tagList;
        }

        return $out;
    }

    /**
     * Telo súboru bez frontmatteru.
     */
    public static function body(string $raw): string
    {
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw) ?? $raw;

        return preg_replace('/^---\r?\n.*?\r?\n---\r?\n?/s', '', $raw) ?? $raw;
    }

    /**
     * `a, b, c` alebo `[a, b, c]` → list<string>.
     *
     * @return list<string>
     */
    private static function splitTags(string $value): array
    {
        $value = trim($value);
        if ($value === '') {
            return [];
        }

        $value = trim($value, "[]");

        return array_values(array_filter(array_map(
            fn ($t) => trim($t, " \t\"'"),
            explode(',', $value),
        ), fn ($t) => $t !== ''));
    }
}
