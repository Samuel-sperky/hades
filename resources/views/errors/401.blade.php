{{--
    Zamknutý Hades. Vidno ju len na HTML ceste (`/`) — /api/* a /mcp vracajú JSON
    (shouldRenderJsonWhen v bootstrap/app.php). Zámerne neprezrádza nič o stave
    vedomia ani o dôvode odmietnutia nad rámec toho, čo už vie ten, kto token má.
--}}
<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hades — zamknuté</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='30' fill='%23b88a3a'/><circle cx='50' cy='50' r='45' fill='none' stroke='%236d3fb5' stroke-opacity='.4' stroke-width='4'/></svg>">
    <style>
        :root { color-scheme: light dark; }
        body {
            margin: 0; min-height: 100vh; display: grid; place-items: center;
            background: #f8f4f7; color: #101d1b;
            font: 400 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
        }
        main { max-width: 30rem; padding: 2.5rem; text-align: center; }
        h1 { margin: 0 0 .5rem; font-size: 1.35rem; font-weight: 600; letter-spacing: -.01em; }
        p { margin: 0 0 1rem; color: #566964; }
        code {
            display: inline-block; padding: .35rem .6rem; border-radius: .4rem;
            background: rgba(109, 63, 181, .08); color: #6d3fb5;
            font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: .85em;
        }
        .ring {
            width: 44px; height: 44px; margin: 0 auto 1.25rem; border-radius: 50%;
            border: 3px solid rgba(109, 63, 181, .35); background: #b88a3a;
        }
        @media (prefers-color-scheme: dark) {
            body { background: #0e1413; color: #eaf3f1; }
            p { color: #8a9b98; }
            code { background: rgba(196, 162, 245, .12); color: #c4a2f5; }
        }
    </style>
</head>
<body>
    <main>
        <div class="ring" aria-hidden="true"></div>
        <h1>Hades je zamknutý</h1>
        <p>Vedomie beží, ale toto okno nie je odomknuté. Odomkni ho raz tokenom
            z <code>HADES_UI_TOKEN</code> — ďalej si to už session pamätá.</p>
        <p><code>/?token=&lt;HADES_UI_TOKEN&gt;</code></p>
    </main>
</body>
</html>
