<?php

namespace App\Http\Controllers;

use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StructureController extends Controller
{
    /** Strom oblastí a oddelení s počtami uzlov (pre foldering UI). */
    public function index(): JsonResponse
    {
        $areas = Area::query()
            ->withCount('nodes')
            ->with(['departments' => fn ($q) => $q->withCount('nodes')->orderBy('name')])
            ->orderBy('angle')
            ->get()
            ->map(fn (Area $area) => [
                'id' => $area->id,
                'name' => $area->name,
                'color' => $area->color,
                'node_count' => $area->nodes_count,
                'departments' => $area->departments->map(fn (Department $d) => [
                    'id' => $d->id,
                    'name' => $d->name,
                    'slug' => $d->slug,
                    'node_count' => $d->nodes_count,
                ])->values(),
            ]);

        return response()->json([
            'areas' => $areas,
            'unassigned' => Node::whereNull('area_id')->where('type', '!=', 'core')->count(),
            'core' => Node::where('type', 'core')->count(),
        ]);
    }

    /** Premenovanie oddelenia a/alebo presun do inej oblasti (aj s uzlami). */
    public function updateDepartment(Request $request, Department $department): JsonResponse
    {
        $validated = $request->validate([
            'area_id' => 'sometimes|required|exists:areas,id',
            'name' => 'sometimes|required|string|max:255',
        ]);

        if (isset($validated['name'])) {
            $department->name = $validated['name'];
        }

        $newAreaId = isset($validated['area_id']) ? (int) $validated['area_id'] : null;
        $areaChanged = $newAreaId !== null && $newAreaId !== $department->area_id;

        if ($areaChanged) {
            // slug musí byť unikátny v rámci cieľovej oblasti
            $conflict = Department::where('area_id', $newAreaId)
                ->where('slug', $department->slug)
                ->where('id', '!=', $department->id)
                ->exists();
            if ($conflict) {
                return response()->json([
                    'message' => 'V cieľovej oblasti už existuje oddelenie s rovnakým slugom.',
                ], 422);
            }

            $department->area_id = $newAreaId;
        }

        $department->save();

        if ($areaChanged) {
            // uzly oddelenia sa presúvajú spolu s ním
            Node::where('department_id', $department->id)->update(['area_id' => $newAreaId]);
        }

        return response()->json([
            'department' => [
                'id' => $department->id,
                'area_id' => $department->area_id,
                'name' => $department->name,
                'slug' => $department->slug,
            ],
        ]);
    }

    /** Zmazanie oddelenia — jeho uzly idú do "Nezaradené" v rovnakej oblasti. */
    public function destroyDepartment(Department $department): JsonResponse
    {
        if ($department->slug === 'nezaradene') {
            return response()->json(['message' => 'Oddelenie Nezaradené sa nedá zmazať.'], 422);
        }

        $fallback = Department::firstOrCreate(
            ['area_id' => $department->area_id, 'slug' => 'nezaradene'],
            ['name' => 'Nezaradené'],
        );

        Node::where('department_id', $department->id)
            ->update(['department_id' => $fallback->id]);

        $id = $department->id;
        $department->delete();

        return response()->json(['deleted' => $id, 'moved_to' => $fallback->id]);
    }
}
