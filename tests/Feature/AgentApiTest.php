<?php

namespace Tests\Feature;

use App\Jobs\RunAgentJob;
use App\Models\AgentRun;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Agent command centre — interné /api/agents (SPA, bez tokenu).
 * Deštruktívne agenty za maintenance.destructive_enabled (default OFF).
 */
class AgentApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Fail-safe stav: deštruktívne joby vypnuté (default), fronta nech nebeží.
        config([
            'maintenance.destructive_enabled' => false,
            'auraai.destructive_jobs_enabled' => false,
        ]);
    }

    public function test_index_returns_agents_with_summary(): void
    {
        $res = $this->getJson('/api/agents')
            ->assertOk()
            ->assertJsonStructure([
                'agents' => [[
                    'key', 'command', 'label', 'description', 'category',
                    'autonomy', 'destructive', 'schedule', 'placeholder',
                    'latest_run', 'next_run',
                ]],
                'summary' => ['total', 'autonomous', 'running'],
                'destructive_enabled',
            ]);

        // Register nesie všetkých 21 reálnych + 2 placeholder agentov.
        $this->assertSame(23, $res->json('summary.total'));
        $this->assertSame(0, $res->json('summary.running'));
        $this->assertFalse($res->json('destructive_enabled'));
    }

    public function test_destructive_agent_is_blocked_when_flag_off(): void
    {
        Queue::fake();

        $this->postJson('/api/agents/mind-cleanup-edges/run')
            ->assertStatus(423)
            ->assertJsonPath('error', 'destructive_disabled');

        // Žiadny beh sa nesmel vytvoriť ani zaradiť do fronty.
        $this->assertDatabaseCount('agent_runs', 0);
        Queue::assertNotPushed(RunAgentJob::class);
    }

    public function test_safe_agent_creates_queued_run(): void
    {
        Queue::fake();

        $res = $this->postJson('/api/agents/mind-ingest/run')
            ->assertStatus(201)
            ->assertJsonPath('run.agent_key', 'mind-ingest')
            ->assertJsonPath('run.status', 'queued');

        $this->assertDatabaseHas('agent_runs', [
            'id' => $res->json('run.id'),
            'agent_key' => 'mind-ingest',
            'status' => 'queued',
        ]);
        Queue::assertPushed(RunAgentJob::class);
    }

    public function test_placeholder_agent_cannot_run(): void
    {
        Queue::fake();

        $this->postJson('/api/agents/workforce-research/run')
            ->assertStatus(422)
            ->assertJsonPath('error', 'placeholder');

        $this->assertDatabaseCount('agent_runs', 0);
        Queue::assertNotPushed(RunAgentJob::class);
    }

    public function test_pause_without_running_run_is_409(): void
    {
        $this->postJson('/api/agents/mind-ingest/pause')
            ->assertStatus(409)
            ->assertJsonPath('error', 'not_running');
    }

    public function test_pause_marks_latest_active_run_paused(): void
    {
        $run = AgentRun::create(['agent_key' => 'mind-ingest', 'status' => 'running', 'progress' => 50]);

        $this->postJson('/api/agents/mind-ingest/pause')
            ->assertOk()
            ->assertJsonPath('run.status', 'paused');

        $this->assertSame('paused', $run->fresh()->status);
    }

    public function test_show_run_includes_log(): void
    {
        $run = AgentRun::create([
            'agent_key' => 'mind-ingest',
            'status' => 'done',
            'progress' => 100,
            'log' => 'riadok 1\nriadok 2',
        ]);

        $this->getJson("/api/agent-runs/{$run->id}")
            ->assertOk()
            ->assertJsonPath('run.id', $run->id)
            ->assertJsonStructure(['run' => ['id', 'status', 'log']]);
    }
}
