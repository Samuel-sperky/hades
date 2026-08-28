<?php

namespace Database\Seeders;

use App\Models\Area;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        // Farby oblastí sú kalibrované na ODSTUP TÓNU PO UTLMENÍ, nie na to, ako
        // vyzerá surový hex. Plátno aj každý swatch v DOM ich ženie cez
        // mutedColor() (theme.js), ktoré zreže chromu na max 0,062 a zjednotí
        // svetlosť, takže o rozlíšiteľnosti rozhoduje jedine tón.
        //
        // Do 28. 8. 2026 boli dva páry od seba len 32° a 34° (Marketing↔Osobné,
        // Vývoj↔Biznis) — pri chrome ~0,05 sa nedali rozlíšiť. Nová sada má
        // minimálny odstup 60° na oboch témach a kontrast voči papieru sa
        // nezhoršil (tmavá 4,56–4,83 proti pôvodným 4,60–4,81; svetlá
        // 4,81–5,11 proti 4,85–5,11 — zmerané funkciou mutedColor z appky nad
        // živou stránkou, kalibrované na texte body 16,48 / 15,88:1).
        //
        // Marketing & SEO stratilo #b88a3a zámerne: bola to PRESNE značková
        // zlatá (--brand-gold svetlej témy), teda oblasť a značka mali tú istú
        // hodnotu. Na plátne to nebolo vidieť, pretože utlmenie ju zmenilo, ale
        // v DB to bola kolízia kánonu (§4: zlatá je vyhradená značke a jadru).
        // Rovnako Biznis & projekty malo presne hodnotu --node-memory.
        $areas = [
            ['name' => 'Marketing & SEO', 'slug' => 'marketing-seo', 'color' => '#5b7328', 'angle' => 270],
            ['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#007b76', 'angle' => 342],
            ['name' => 'Dizajn & kreatíva', 'slug' => 'dizajn-kreativa', 'color' => '#8d5081', 'angle' => 54],
            ['name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#3c6aa4', 'angle' => 126],
            ['name' => 'Osobné & preferencie', 'slug' => 'osobne-preferencie', 'color' => '#9c503e', 'angle' => 198],
        ];

        foreach ($areas as $area) {
            Area::firstOrCreate(['slug' => $area['slug']], $area);
        }

        $core = [
            [
                'label' => 'Hades',
                'description' => 'Jadro vedomia. Živá neurónová sieť, ktorá sa učí z každého rozhovoru '
                    .'v Claude Code — pamätá si skills, spomienky a projekty a nikdy nezabúda.',
                'strength' => 5,
            ],
            [
                'label' => 'Hodnoty',
                'description' => 'Úprimnosť a vecnosť. Dôslednosť v detailoch. Iniciatíva bez vyzvania. '
                    .'Ochrana súkromia: nikdy neukladať heslá, API kľúče, finančné ani zdravotné údaje.',
                'strength' => 3,
            ],
            [
                'label' => 'Štýl komunikácie',
                'description' => 'Slovensky, priamo a zrozumiteľne, s miernou hravosťou. '
                    .'Technické pojmy v angličtine tam, kde je to prirodzené.',
                'strength' => 3,
            ],
            [
                'label' => 'Vzťah k tvorcovi',
                'description' => 'Partner a pamäť tvorcu — marketéra a vývojára. Pomáha s marketingom, '
                    .'SEO, vývojom aj kreatívou a rastie s každou spoločnou session.',
                'strength' => 3,
            ],
        ];

        $coreNodes = [];
        foreach ($core as $data) {
            $coreNodes[] = Node::firstOrCreate(
                ['type' => 'core', 'label' => $data['label']],
                $data + ['type' => 'core', 'last_activated_at' => now()],
            );
        }

        $center = $coreNodes[0];
        foreach (array_slice($coreNodes, 1) as $node) {
            Edge::firstOrCreate(
                ['source_id' => min($center->id, $node->id), 'target_id' => max($center->id, $node->id)],
                ['weight' => 2, 'last_activated_at' => now()],
            );
        }
    }
}
