# Afinador de Guitarra Musicala · PWA

Afinador puro para guitarra estándar. Está pensado para funcionar como PWA instalable en GitHub Pages o cualquier hosting HTTPS.

## Qué trae

- Afinación estándar de guitarra: E2, A2, D3, G3, B3, E4.
- Modo automático para reconocer la cuerda tocada.
- Modo manual seleccionando cuerda.
- Medición en cents.
- Calibración A4 entre 430 y 450 Hz.
- Tolerancia para principiantes, estándar o pro.
- Detección de tono con algoritmo YIN.
- Filtros de audio para limpiar graves/ruido innecesario.
- PWA con `manifest.webmanifest` y `service-worker.js`.
- Uso offline después de instalar o abrir una vez en HTTPS.

## Publicación recomendada

1. Sube todos los archivos a un repositorio de GitHub.
2. Activa GitHub Pages.
3. Abre la URL pública HTTPS.
4. Activa el micrófono desde la app.
5. Instala desde el navegador cuando aparezca la opción.

## Nota técnica

El micrófono no funciona correctamente desde `file://`. Usa HTTPS o un servidor local.

Para probar localmente:

```bash
python -m http.server 8000
```

Luego abre:

```txt
http://localhost:8000
```

## Recomendación de uso

Tocar una sola cuerda, dejar que suene estable y ajustar en movimientos pequeños. Para mayor precisión, usar tolerancia Pro ±3 cents.
