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

return $loader;
