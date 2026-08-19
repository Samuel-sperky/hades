<?php

namespace App\Services\Console\Tools;

/**
 * Zápisový tool, ktorý sa smie vykonať aj vtedy, keď pri behu nikto nesedí.
 *
 * `isWrite()` v tomto projekte neznamená „mení dáta", ale „ťah sa zaparkuje a čaká
 * na človeka". To sú dve rôzne veci a headless beh na tom rozdiele stojí:
 * {@see \App\Services\Console\HeadlessRunner} filtroval sadu len podľa `isWrite()`,
 * takže z plánovaného behu vypadol aj `write_report` — a report je pritom jediný
 * výstup, ktorý má nočný rozvrh po sebe zmysel nechať. Bez neho skončí beh ako text
 * vo vlákne, ktoré nikto neotvorí, a keď si ho model vyžiada, dostane „unknown tool"
 * a vyzerá to ako halucinácia.
 *
 * Kritérium na túto značku je úzke a treba ho držať: tool smie zapisovať LEN do
 * svojho vlastného, na to určeného miesta (`storage/app/reports`), nesmie prepisovať
 * nič v projekte ani v pamäti, a jeho zlyhanie nesmie nič poškodiť. Čokoľvek, čo
 * mení kód, súbory projektu alebo uzly vedomia, sem NEPATRÍ — tam je čakanie na
 * človeka celý zmysel.
 */
interface SafeUnattended
{
}
