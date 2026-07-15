<?php

namespace Tests\Unit;

use App\Services\SensitiveFilter;
use PHPUnit\Framework\TestCase;

class SensitiveFilterTest extends TestCase
{
    private function filter(): SensitiveFilter
    {
        return new SensitiveFilter;
    }

    public function test_flags_api_keys_and_tokens(): void
    {
        $this->assertNotNull($this->filter()->scan('kľúč sk-ABCdef0123456789ghij'));
        $this->assertNotNull($this->filter()->scan('token ghp_ABCdefGHIjklMNOpqrSTUvwx0123'));
        $this->assertNotNull($this->filter()->scan('AWS AKIAIOSFODNN7EXAMPLE'));
    }

    public function test_flags_passwords_cards_iban(): void
    {
        $this->assertNotNull($this->filter()->scan('heslo: superTajne123'));
        $this->assertNotNull($this->filter()->scan('karta 4111 1111 1111 1111'));
        $this->assertNotNull($this->filter()->scan('SK89 0200 0000 0012 3456 7890'));
    }

    public function test_allows_ordinary_knowledge(): void
    {
        $this->assertNull($this->filter()->scan('Konverzný lievik', 'Optimalizácia lievika pre e-shop.'));
        $this->assertNull($this->filter()->scan('Laravel', 'PHP framework pre web aplikácie.'));
    }
}
