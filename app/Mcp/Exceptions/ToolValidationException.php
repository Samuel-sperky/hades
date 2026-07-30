<?php

namespace App\Mcp\Exceptions;

use InvalidArgumentException;

/**
 * Chybný VSTUP do MCP toolu (chýbajúci argument, hodnota mimo enumu).
 *
 * Vlastný typ existuje kvôli log hygiene: 87 zo 102 „chýb" v laravel.log bolo
 * `report($e)` nad presne týmito výnimkami — teda nad bežnou validáciou, nie nad
 * poruchou servera. Validačná chyba je legitímna odpoveď protokolu (`isError`),
 * do error logu nepatrí. {@see \App\Mcp\McpServer} ju preto NEreportuje a
 * `bootstrap/app.php` ju má v `dontReport`.
 */
class ToolValidationException extends InvalidArgumentException {}
