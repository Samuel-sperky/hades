<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Api\StatsController;
use App\Serializers\Screen\DnesScreen;
use Illuminate\Http\JsonResponse;

/**
 * Zdroj pre obrazovku Dnes — `GET /api/today`.
 *
 * Kontrolér sám nič neserializuje: tvar odpovede drží {@see DnesScreen}, tá istá
 * trieda, z ktorej čítá MCP tool `mind_today`. Keby si kontrolér skladal odpoveď
 * sám, plochy človeka a AI by sa rozišli pri prvej zmene obrazovky — a audit
 * 19. 8. 2026 našiel, že presne to sa už na štyroch miestach stalo.
 *
 * Odpoveď je od 20. 8. 2026 **celá obrazovka**, teda pôvodné ľahké zoznamy plus
 * agregáty, ktoré si prehliadač dovtedy dopĺňal druhým volaním na
 * `/api/dashboard`. Ten endpoint žije ďalej nezmenený (má externý mirror
 * `/api/v1/stats`); dôvod zlúčenia je v docblocku {@see DnesScreen}.
 */
class TodayController extends Controller
{
    public function index(StatsController $stats): JsonResponse
    {
        return response()->json((new DnesScreen($stats))->data());
    }
}
