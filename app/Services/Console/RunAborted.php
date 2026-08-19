<?php

namespace App\Services\Console;

use RuntimeException;

/**
 * Používateľ stlačil Stop (alebo zavrel stránku) uprostred generovania.
 *
 * Prečo výnimka a nie návratová hodnota: text priteká cez callback `$onDelta`,
 * ktorý poskytovateľ volá zvnútra čítania HTTP streamu. Z callbacku sa smyčka
 * inak zastaviť nedá — návratová hodnota sa zahodí a model by dogeneroval celý
 * ťah do mŕtveho socketu, čo je na CPU inferencii aj niekoľko minút.
 * Výnimka prebublá cez `OllamaStreamParser::feed()` von z `stream()` a čítanie
 * tela sa tým ukončí.
 *
 * Nie je to chyba behu — {@see AgentRunner} ju chytí, uloží, čo sa dogenerovalo,
 * a ticho skončí. Rámec `error` sa neposiela: klient, ktorý beh prerušil, už
 * nečíta.
 */
final class RunAborted extends RuntimeException {}
