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
        $areas = [
            ['name' => 'Marketing & SEO', 'slug' => 'marketing-seo', 'color' => '#b88a3a', 'angle' => 270],
            ['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 342],
            ['name' => 'Dizajn & kreatíva', 'slug' => 'dizajn-kreativa', 'color' => '#9d5c7a', 'angle' => 54],
            ['name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#2f6d8f', 'angle' => 126],
            ['name' => 'Osobné & preferencie', 'slug' => 'osobne-preferencie', 'color' => '#a86a4a', 'angle' => 198],
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
