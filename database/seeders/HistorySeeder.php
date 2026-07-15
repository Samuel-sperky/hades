<?php

namespace Database\Seeders;

use App\Services\MindService;
use Illuminate\Database\Seeder;

/**
 * Prvotny seed vedomia z historie sessions a znamych faktov o tvorcovi.
 */
class HistorySeeder extends Seeder
{
    public function run(MindService $mind): void
    {
        $items = [
            // Vyvoj & kod
            ['skill', 'Laravel backend', 'Stavba PHP backendov v Laraveli — API, queue, broadcasting, scheduler.', 'Vývoj & kód', 'Backend', []],
            ['skill', 'MariaDB', 'Návrh schém a práca s MariaDB v Docker prostredí.', 'Vývoj & kód', 'Backend', []],
            ['skill', 'Docker Compose', 'Kontajnerizácia aplikácií — multi-service compose stacky, volumes, siete.', 'Vývoj & kód', 'DevOps', []],
            ['skill', 'ngrok tunneling', 'Vystavenie lokálnych aplikácií cez ngrok tunel.', 'Vývoj & kód', 'DevOps', []],
            ['skill', 'Laravel Reverb WebSockets', 'Real-time broadcasting cez Reverb a pusher protokol.', 'Vývoj & kód', 'Backend', ['Laravel backend']],
            ['skill', 'Canvas visualization (d3-force)', 'Interaktívne canvas vizualizácie s force-directed layoutom.', 'Vývoj & kód', 'Frontend', []],

            // Marketing & SEO
            ['skill', 'SEO analysis (Ahrefs)', 'SEO analýzy cez Ahrefs — keywords, backlinky, site audit, brand radar.', 'Marketing & SEO', 'SEO', []],

            // Dizajn & kreativa
            ['skill', 'Figma', 'Práca s dizajnmi vo Figme vrátane MCP integrácie.', 'Dizajn & kreatíva', 'Nástroje', []],
            ['skill', 'Canva', 'Tvorba grafiky a šablón v Canve.', 'Dizajn & kreatíva', 'Nástroje', []],
            ['skill', 'AI media generation (Higgsfield)', 'Generovanie obrázkov a videí cez AI nástroje.', 'Dizajn & kreatíva', 'Nástroje', []],

            // Osobne & preferencie
            ['memory', 'Komunikácia po slovensky', 'Tvorca komunikuje po slovensky; technické pojmy môžu ostať v angličtine.', 'Osobné & preferencie', 'Preferencie', []],
            ['memory', 'Marketing šperkov', 'Tvorca sa venuje marketingu šperkov (značka Aura, marketing4.sperky).', 'Osobné & preferencie', 'Práca', []],
            ['memory', 'Návrh cez otázky, potom autonómia', 'Preferuje spoločný návrh riešenia cez sériu otázok; po odsúhlasení necháva plnú autonómiu pri stavbe.', 'Osobné & preferencie', 'Preferencie', []],

            // Biznis & projekty
            ['project', 'Hades (AI-mind)', 'Živé vedomie AI — neurónová sieť skills, spomienok a projektov s MCP učením a glow vizualizáciou. Laravel + MariaDB + Reverb v Dockeri.', 'Biznis & projekty', 'Aplikácie', ['Laravel backend', 'MariaDB', 'Docker Compose', 'Laravel Reverb WebSockets', 'Canvas visualization (d3-force)', 'MCP server development']],
            ['project', 'Šperky Aura app', 'Aplikácia pre značku šperkov Aura — Docker setup s ngrok tunelom.', 'Biznis & projekty', 'Aplikácie', ['Docker Compose', 'ngrok tunneling', 'Marketing šperkov']],
            ['project', 'Banner Generator', 'Docker aplikácia na generovanie marketingových bannerov.', 'Biznis & projekty', 'Aplikácie', ['Docker Compose', 'Canva', 'Marketing šperkov']],
        ];

        foreach ($items as [$type, $label, $description, $area, $department, $connections]) {
            $result = $mind->learn(
                type: $type,
                label: $label,
                description: $description,
                areaName: $area,
                departmentName: $department,
                connections: $connections,
            );

            $this->command?->line("  {$result['action']}: {$label}");
        }
    }
}
