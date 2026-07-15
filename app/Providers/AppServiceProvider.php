<?php

namespace App\Providers;

use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Observers\AreaObserver;
use App\Observers\DepartmentObserver;
use App\Observers\EdgeObserver;
use App\Observers\NodeObserver;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Zrkadlenie vedomia do .md súborov (DB → mind/). Vypnuteľné cez env
        // (napr. v testoch), aby model eventy nezapisovali na disk.
        if (config('hades.mirror_enabled', true)) {
            Node::observe(NodeObserver::class);
            Edge::observe(EdgeObserver::class);
            Department::observe(DepartmentObserver::class);
            Area::observe(AreaObserver::class);
        }
    }
}
