<?php

namespace App\Providers;

use App\Services\Console\ToolRegistry;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Jeden register na request. Bez singletonu by `RunController` a
        // `AgentRunner` dostali dva rôzne objekty a nastavenie profilu na jednom
        // by na druhý nemalo vplyv — chyba, ktorá sa neprejaví chybou, ale tým,
        // že profil nefunguje a nikto nevie prečo.
        //
        // `useProfile()` je stav v rámci JEDNÉHO requestu; kontajner sa medzi
        // requestami stavia nanovo a projekt nebeží na Octane. Keby niekto Octane
        // pridal, tento riadok je prvé, čo treba prehodnotiť.
        $this->app->singleton(ToolRegistry::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
