<?php

namespace App\Http\Controllers;

use App\Models\Activation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ActivationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Activation::query()->orderBy('created_at');

        if ($since = $request->query('since')) {
            $query->where('created_at', '>=', $since);
        }

        $activations = $query
            ->limit(min((int) $request->query('limit', 2000), 10000))
            ->get(['id', 'node_id', 'kind', 'session_key', 'created_at']);

        return response()->json(['activations' => $activations]);
    }
}
