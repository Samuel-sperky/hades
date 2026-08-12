<?php

namespace Tests\Feature;

use App\Models\Activation;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A12 — retencia prevádzkovej telemetrie.
 *
 * sync_runs rástli bez stropu (144 behov denne, 1 450 riadkov, 1 169 starších
 * ako týždeň) a 84 % aktivácií tvorili stopy po čítaní — jeden recall zapíše
 * až 45 riadkov.
 */
class PruneTelemetryTest extends TestCase
{
    use RefreshDatabase;

    private function node(string $label = 'Uzol'): Node
    {
        return Node::create(['type' => 'skill', 'label' => $label, 'strength' => 1]);
    }

    private function activation(Node $node, string $kind, int $daysAgo): void
    {
        Activation::create([
            'node_id' => $node->id,
            'kind' => $kind,
            'session_key' => 'test',
            'created_at' => now()->subDays($daysAgo),
        ]);
    }

    private function syncRun(int $daysAgo): void
    {
        DB::table('sync_runs')->insert([
            'source' => 'skills',
            'started_at' => now()->subDays($daysAgo),
            'finished_at' => now()->subDays($daysAgo),
            'status' => 'ok',
            'created_at' => now()->subDays($daysAgo),
            'updated_at' => now()->subDays($daysAgo),
        ]);
    }

    public function test_old_sync_runs_are_pruned_and_recent_ones_kept(): void
    {
        $this->syncRun(30);
        $this->syncRun(10);
        $this->syncRun(2);

        $this->artisan('mind:prune-telemetry')->assertSuccessful();

        $this->assertSame(1, DB::table('sync_runs')->count());
    }

    public function test_old_read_activations_are_pruned(): void
    {
        $node = $this->node();

        $this->activation($node, 'recall', 60);
        $this->activation($node, 'recall-neighbor', 60);
        $this->activation($node, 'recall', 2);

        $this->artisan('mind:prune-telemetry')->assertSuccessful();

        $this->assertSame(1, Activation::count());
        $this->assertSame('recall', Activation::firstOrFail()->kind);
    }

    public function test_write_activations_are_never_pruned(): void
    {
        $node = $this->node();

        foreach (['learn', 'activate', 'merge', 'skill-used'] as $kind) {
            $this->activation($node, $kind, 400);
        }

        $this->artisan('mind:prune-telemetry')->assertSuccessful();

        $this->assertSame(
            4,
            Activation::count(),
            'GraphService a coActivate na nich stoja — nesmú zmiznúť bez ohľadu na vek'
        );
    }

    public function test_pruning_reads_does_not_touch_node_strength(): void
    {
        $node = $this->node();
        $node->forceFill(['strength' => 7])->save();

        $this->activation($node, 'recall', 90);

        $this->artisan('mind:prune-telemetry')->assertSuccessful();

        $this->assertSame(7.0, (float) $node->fresh()->strength);
    }

    public function test_dry_run_deletes_nothing(): void
    {
        $this->syncRun(30);
        $this->activation($this->node(), 'recall', 90);

        $this->artisan('mind:prune-telemetry', ['--dry-run' => true])->assertSuccessful();

        $this->assertSame(1, DB::table('sync_runs')->count());
        $this->assertSame(1, Activation::count());
    }

    public function test_retention_windows_are_configurable(): void
    {
        $this->syncRun(10);
        $this->activation($this->node(), 'recall', 10);

        $this->artisan('mind:prune-telemetry', ['--sync-days' => 30, '--recall-days' => 30])
            ->assertSuccessful();

        $this->assertSame(1, DB::table('sync_runs')->count());
        $this->assertSame(1, Activation::count());
    }
}
