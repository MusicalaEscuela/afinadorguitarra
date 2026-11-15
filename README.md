# Afinador Musicala

Afinador web instalable (PWA) para guitarra, bajo, ukelele, violín, viola, violonchelo, contrabajo, tiple, charango, cuatro, mandolina, banjo y, en modo cromático, cualquier instrumento o voz. HTML, CSS y JavaScript sin dependencias ni paso de compilación.

## Funciones

- Instrumentos con sus afinaciones y modo cromático (A0 a C7).
- Reconocimiento automático de la cuerda, o cuerda fija al tocarla en pantalla.
- Modo guiado cuerda por cuerda.
- Tono guía, calibración de La4 (430–450 Hz), tolerancia y nombres de notas (C D E o Do Re Mi).
- Uso sin conexión después de abrirlo una vez en HTTPS.

## Archivos

| Archivo | Qué hace |
|---|---|
| `app.js` | Interfaz: estado, eventos y pintado |
| `audio-engine.js` | Micrófono, filtros, captura y detección de ataques |
| `tuner-worklet.js` | AudioWorklet que entrega cuadros de audio a ritmo constante |
| `pitch.js` | Detección de tono: YIN + corrección de octava + medición por fase |
| `reading.js` | Lectura estable: descarta atípicos y promedia |
| `dial.js` | Medidor radial |
| `instruments.js` | Catálogo de instrumentos y afinaciones |
| `tuner-config.js` | Versión y matemática de notas |
| `reference-tone.js` | Tono guía y aviso al afinar |

Para añadir un instrumento o una afinación, edita `instruments.js`.

## Probar

```bash
npm test
```

Mide el error del motor en cents con tonos sintéticos de cada instrumento. Falla si alguna nota supera 1 cent de error.

Para abrirlo localmente (el micrófono no funciona desde `file://`):

```bash
python -m http.server 8000
```

## Publicar

Sube los archivos a un repositorio con GitHub Pages. Al cambiar algo, sube `APP_VERSION` en `tuner-config.js` y `CACHE_NAME` en `service-worker.js` para que los usuarios reciban la versión nueva.
