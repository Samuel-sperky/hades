<?php

// Zámerne bez definícií kanálov.
//
// Appka nemá auth flow (model `App\Models\User` bol zmazaný ako mŕtvy kód) a jediný
// broadcast kanál je VEREJNÝ: `App\Events\MindPulse` vysiela na `new Channel('mind')`.
// Verejné kanály sa neautorizujú, takže tu nič nepatrí. Skeletonový
// `Broadcast::channel('App.Models.User.{id}', …)` odkazoval na zmazaný model
// a nikto ho nikdy nepoužil.
//
// Súbor MUSÍ existovať — `bootstrap/app.php` ho registruje cez
// `withRouting(channels: …)`. Až keď pridáš privátny/presence kanál, definuj ho tu.
