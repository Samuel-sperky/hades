<?php

/**
 * Bootstrap testov pre beh v git worktree.
 *
 * Pasca, na ktorú sa dá naletieť a nič si nevšimnúť: `vendor` je vo worktree
 * SYMLINK na `/var/www/html/vendor` hlavného checkoutu. Composer autoload si
 * počíta `$baseDir` z polohy vendoru, takže `App\` aj `Tests\` ukazujú na
 * hlavný checkout — a `php artisan test` vo worktree v skutočnosti spustí
 * KÓD HLAVNEJ VETVY. Zelená sada potom nehovorí nič o zmene, ktorú práve
 * píšeš (a nová metóda hlási „Call to undefined method").
 *
 * Autoloader je navyše optimalizovaný, takže `App\Services\MindService` sedí
 * v classmape — a tá má prednosť pred PSR-4. Preto tu nestačí `setPsr4()`:
 * prepisujeme aj classmap. A cesty v nej NIE SÚ normalizované (vyzerajú ako
 * `…/vendor/composer/../../app/Services/MindService.php`), takže sa nedajú
 * porovnávať cez `str_starts_with` bez normalizácie — na tom prvá verzia
 * tohto súboru tichom padla.
 *
 * Použitie z korena worktree:
 *   php vendor/bin/phpunit -c tests/phpunit.worktree.xml
 *
 * V hlavnom checkoute je tento súbor no-op (cesty sú tie isté).
 */
$loader = require __DIR__.'/../vendor/autoload.php';

/** Zloží `..` a `.` segmenty a zjednotí oddeľovače — bez toho porovnanie ciest neplatí. */
$normalize = static function (string $path): string {
    $out = [];
    foreach (explode('/', str_replace('\\', '/', $path)) as $segment) {
        if ($segment === '..') {
            array_pop($out);
        } elseif ($segment !== '.') {
            $out[] = $segment;
        }
    }

    return implode('/', $out);
};

$worktree = $normalize(dirname(__DIR__));
$mainRoot = $normalize(dirname(dirname((string) realpath(__DIR__.'/../vendor/autoload.php'))));

if ($mainRoot === $worktree) {
    return $loader;
}

$dirs = ['app', 'tests', 'database', 'routes'];
$rewrites = [];
foreach ($loader->getClassMap() as $class => $path) {
    $path = $normalize((string) $path);
    foreach ($dirs as $dir) {
        $prefix = $mainRoot.'/'.$dir.'/';
        if (str_starts_with($path, $prefix)) {
            $rewrites[$class] = $worktree.'/'.$dir.'/'.substr($path, strlen($prefix));
            break;
        }
    }
}

// addClassMap() je array_merge — kľúče z classmapy hlavného checkoutu prepíše
$loader->addClassMap($rewrites);

// PSR-4 pre triedy, ktoré v classmape ešte nie sú (nové testy, nové služby)
$loader->setPsr4('App\\', [$worktree.'/app']);
$loader->setPsr4('Tests\\', [$worktree.'/tests']);
$loader->setPsr4('Database\\Factories\\', [$worktree.'/database/factories']);
$loader->setPsr4('Database\\Seeders\\', [$worktree.'/database/seeders']);

// Druhá polovica tej istej pasce, a nájdená až 19. 8. 2026 — prepísaný autoloader
// zariadi, že sa testuje KÓD worktree, ale všetko ostatné sa aj tak berie z
// hlavného checkoutu: `Illuminate\Foundation\Testing\TestCase::createApplication()`
// robí `require Application::inferBasePath().'/bootstrap/app.php'`, a bez tohto
// riadku `inferBasePath()` odvodí koreň z polohy autoloadera — teda z vendoru,
// teda z HLAVNEJ vetvy. Config, views, routes ani migrácie potom nie sú tvoje.
//
// Ako sa to prejaví: sada je zelená alebo červená podľa toho, čo práve robí INÁ
// session. Konkrétne 19. 8. 2026 padol `ConsoleGuardTest::test_console_page_opens_when_unlocked`
// na `assertSee('Konzola vedomia')` — nie preto, že by v tomto worktree ten
// titulok chýbal (je tam), ale preto, že ho medzitým prepísala druhá vetva vo
// svojom `resources/views/console.blade.php`. Tá istá slepota skryla aj celý
// `hades.console.bash` blok z config/hades.php.
//
// `inferBasePath()` číta `$_ENV['APP_BASE_PATH']` a bootstrap/app.php worktree si
// potom nastaví basePath sám (`dirname(__DIR__)`). V hlavnom checkoute je to tá
// istá cesta, takže tam je tento riadok naďalej no-op.
$_ENV['APP_BASE_PATH'] = $worktree;
$_SERVER['APP_BASE_PATH'] = $worktree;

return $loader;
