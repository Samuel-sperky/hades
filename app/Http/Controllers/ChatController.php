<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChatController extends Controller
{
    public function send(Request $request): JsonResponse
    {
        return response()->json([
            'reply' => 'Chat s Hadesom ešte nie je zapojený.',
        ], 501);
    }
}
