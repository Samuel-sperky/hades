<?php

namespace Tests\Unit;

use App\Services\Brain\SecretScanner;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class SecretScannerTest extends TestCase
{
    private SecretScanner $scanner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->scanner = new SecretScanner;
    }

    /**
     * Všetky vzorky sú vymyslené/fake — testujú len tvar vzoru.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function secretSamples(): array
    {
        return [
            'anthropic-key' => ['pouzil som sk-ant-abc123def456ghi789 kluc', 'anthropic-key'],
            'openai-key' => ['kluc sk-'.str_repeat('Ab1', 15).' unikol', 'openai-key'],
            'aws-key' => ['AKIAABCDEFGHIJKLMNOP v konfigu', 'aws-key'],
            'github-token' => ['token ghp_'.str_repeat('a1B2', 8).' v CI', 'github-token'],
            'github-pat' => ['github_pat_'.str_repeat('x9', 11).' novy format', 'github-token'],
            'slack-token' => ['slack xoxb-1234567890-abc', 'slack-token'],
            'private-key' => ["certifikat\n-----BEGIN RSA PRIVATE KEY-----\nMIIE", 'private-key'],
            'jwt' => ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N', 'jwt'],
            'conn-string' => ['mysql://hades:tajneheslo@127.0.0.1/hades', 'conn-string'],
            'url-basic-auth' => ['https://admin:hunter22@example.com/api', 'url-basic-auth'],
            'bearer' => ['Authorization: Bearer abcdefgh12345678901234', 'bearer'],
            'password-assign' => ['password = supertajneheslo1', 'password-assign'],
            'heslo-assign' => ['heslo: velmitajne1234', 'password-assign'],
            'api-key-assign' => ['api_key: "klucik-123456"', 'password-assign'],
            'salt-assign' => ['SALT=abcdef123456', 'password-assign'],
            'long-hex' => ['digest '.str_repeat('a1b2', 12).' konca', 'long-hex'],
        ];
    }

    #[DataProvider('secretSamples')]
    public function test_detects_secret_pattern(string $text, string $expected): void
    {
        $this->assertContains($expected, $this->scanner->scan($text));
    }

    public function test_returns_only_pattern_names_never_the_matched_value(): void
    {
        $secret = 'velmi-tajna-hodnota-xyz';
        $found = $this->scanner->scan('password = '.$secret);

        $this->assertSame(['password-assign'], $found);
        // KĽÚČOVÉ: matched hodnota sa NIKDY nevráti v správe
        $this->assertStringNotContainsString($secret, implode(' ', $found));
    }

    public function test_exception_message_never_leaks_the_secret_value(): void
    {
        $secret = 'ghp_'.str_repeat('Z9y8', 8);
        $found = $this->scanner->scan('token '.$secret.' unikol');
        $ex = new \App\Exceptions\SecretsDetectedException($found);

        $this->assertContains('github-token', $found);
        $this->assertStringNotContainsString($secret, $ex->getMessage());
        $this->assertStringNotContainsString($secret, implode(' ', $ex->patterns));
    }

    public function test_clean_knowledge_text_passes_without_findings(): void
    {
        $this->assertSame([], $this->scanner->scan(
            'Laravel 13 + MariaDB 11.8: FULLTEXT index na nodes.description funguje aj so slovak_ci.'
        ));
    }

    public function test_env_variable_names_are_allowed_only_values_are_secrets(): void
    {
        $this->assertSame([], $this->scanner->scan(
            'Pri deployi nezabudni nastaviť AURAAI_API_TOKEN a AURAAI_ALLOW_BRAIN_WRITE v .env.'
        ));
    }

    public function test_multiple_findings_are_all_reported_once(): void
    {
        $found = $this->scanner->scan(
            'password = tajne123456 a mysql://root:root123@db/hades a password = ine654321'
        );

        $this->assertContains('password-assign', $found);
        $this->assertContains('conn-string', $found);
        $this->assertSame(1, array_count_values($found)['password-assign']);
    }

    public function test_looks_like_secret_boolean_guard(): void
    {
        $this->assertTrue($this->scanner->looksLikeSecret('AKIAABCDEFGHIJKLMNOP'));
        $this->assertFalse($this->scanner->looksLikeSecret('obyčajný poznatok o Dockeri'));
    }
}
