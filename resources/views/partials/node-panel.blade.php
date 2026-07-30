{{-- Vlastník: A5 (P9 — node panel).
     data-node-action="pack|edit|delete|connect|local|md|verify|resolve" je
     kontrakt; dnešné id (#node-edit, #node-pack, …) zostávajú ako aliasy. --}}
<aside id="node-panel" class="hidden" aria-label="Detail uzla">
    <div class="dock-head">
        <h2 id="node-label"></h2>
        <button class="close ms" id="node-close" aria-label="Zavrieť">close</button>
    </div>
    <div id="node-view">
        <span id="node-type" class="badge"><span id="node-swatch" class="swatch" aria-hidden="true"></span><span id="node-type-label"></span></span>
        <p id="node-meta"></p>
        <p id="node-desc"></p>
        <div id="node-record"></div>
        <h3>Spojenia</h3>
        <div id="node-neighbors"></div>
        <div id="node-suggestions-sec">
            <h3>Možno súvisí</h3>
            <div id="node-suggestions"></div>
        </div>
        <h3>História</h3>
        <div id="node-history"></div>
        <div class="row node-actions">
            <button id="node-edit" class="primary" data-node-action="edit">Upraviť</button>
            <button id="node-pack" class="ghost ms" data-node-action="pack" title="Do balíka" aria-label="Do balíka" aria-pressed="false">library_add</button>
            <button id="node-md" class="ghost ms hidden" data-node-action="md" title="Zobraziť dokument" aria-label="Zobraziť dokument">description</button>
            <button id="node-connect" class="ghost ms" data-node-action="connect" title="Prepojiť s uzlom" aria-label="Prepojiť s uzlom">link</button>
            <button id="node-delete" class="danger ms" data-node-action="delete" aria-label="Zmazať">delete</button>
        </div>
    </div>
    <div id="node-form" class="hidden">
        <label>Názov<input id="edit-label" maxlength="255"></label>
        <label>Popis<textarea id="edit-desc" rows="5"></textarea></label>
        <label id="edit-type-row" class="hidden">Typ<select id="edit-type">
            <option value="memory">Spomienka</option>
            <option value="skill">Skill</option>
            <option value="project">Projekt</option>
        </select></label>
        <label>Oblasť<select id="edit-area"></select></label>
        <label>Oddelenie<select id="edit-dept"></select></label>
        <div class="row">
            <button id="edit-save" class="primary">Uložiť</button>
            <button id="edit-cancel">Zrušiť</button>
        </div>
    </div>
</aside>
