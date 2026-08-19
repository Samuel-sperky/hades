---
title: "great-perlman-0745d2 — práca 13.8.2026"
project: "great-perlman-0745d2"
date: 13.8.2026
session_id: "945b5afb-dedd-4d48-ae2d-62eca56cf58f"
source: "session"
---

# great-perlman-0745d2 — práca 13.8.2026

**Čo:** In the Hades project (C:\Users\Ucet\Desktop\AI-mind), decision records contain double-escaped HTML entities. `GET /api/d… **Výsledok:** Match area and department names entity-insensitively on the mind_learn path; commit **Súbory:** EntityRoundTripTest.php, MindService.php, MindFixEntities.php, FixEntitiesTest.php **Technológie:** docker, compose, php, api, mcp, git, artisan

## Prompty
- In the Hades project (C:\Users\Ucet\Desktop\AI-mind), decision records contain double-escaped HTML entities. `GET /api/decisions` returns text with a literal `&amp;` in it, for example: "Do Hadesa zav…

## Súbory
- tests/Feature/EntityRoundTripTest.php
- app/Services/MindService.php
- app/Console/Commands/MindFixEntities.php
- tests/Unit/FixEntitiesTest.php

## Commity
- Match area and department names entity-insensitively on the mind_learn path
- commit

## Záver
Done. One correction to the premise up front, because it changes what the fix is. ## The write path never escaped `&amp;` is not being introduced on write. Four independent checks: - No `htmlspecialchars`/`htmlentities`/sanitiser anywhere in `app/`, and `git log -S` finds none in the history either. - A round-trip test through the real `/mcp` endpoint stores `&`, `<b>`, `<style>` verbatim in decis...
