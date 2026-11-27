# Penguin Endless Love — sitio
Sitio estático (sin compilación). En Vercel: Framework Preset "Other", sin Build Command, Output Directory vacío (raíz).
- index.html  Penguin Endless Love
- summer.html Penguin Endless Summer
- p.html      página del chip NFC (bautizo y certificado; modo demostración hasta conectar Supabase)
- mundo.html  la isla
## Modo estudio (obras intervenidas) · 25/11/2026
Herramienta para que el estudio certifique una obra pintada a mano: `estudio.html`.
1. **La obra:** colección, título, tamaño, año, técnica, notas.
2. **Fotos:** sesión guiada de 12 vistas (8 alrededor, 3 desde arriba, la base opcional) con silueta guía; cámara del teléfono o fotos de la galería. El fondo liso se separa solo.
3. **Revisar:** las fotos se proyectan sobre el modelo y se funden en una textura de 1024 px, en el navegador (`bake.js`, sin WebGL ni Blender). Vista 3D con la textura.
4. **Enlace:** se genera `p.html?o=<id>` para grabar en el chip. Ese enlace abre el bautizo de obra intervenida (el aspecto ya está fijado; el custodio elige carácter y nombre) y, una vez bautizada, su certificado. El pingüino aparece en la isla con su textura.

- Los modelos con rig (`penguin-*-rig.glb`) ahora llevan UV. Se generaron una sola vez con `python3 tools/add_uv.py entrada.glb salida.glb`; esqueleto y animaciones intactos.
- `node tools/bake.test.mjs` comprueba el motor con fotos sintéticas (encuadre desviado, fondo con degradado, brillo de estudio).
- `estudio.html?prueba=1` añade «Generar fotos de prueba» para recorrer el flujo sin una pieza delante.
- **Modo demostración:** obras y bautizos se guardan en `localStorage` del navegador (igual que el resto del ecosistema hasta desplegar el backend). Para producción faltan: guardar obra y textura en el backend, proteger `estudio.html` con acceso del estudio y hacer el enlace de un solo uso en servidor.
- La cámara necesita HTTPS (Vercel lo da). Separación de fondo: pensada para fondo liso; un fondo complejo deja la foto «Sin recorte» y se usa alineada con la silueta.

## La isla · vida de colonia (fase 1) · 27/11/2026
La isla vive un día cada tres horas (`DAY` en `life.js`), igual para todos los visitantes:
- **Minuto 0:** amanece y cada pingüino vuelve a su rutina.
- **Minutos 20, 45, 70, 95 y 120:** la colonia va en fila al mar, duda en la orilla, el más valiente se lanza y los demás lo siguen; dan una vuelta a la isla nadando con saltos y salen del agua.
- **Minuto 138 a 150:** atardece. **Minuto 150 a 180:** noche; se juntan en el centro y cada 40 s dan un paso en ola.
- Parejas: citas en las que los dos llegan al mismo punto y se saludan a la vez. Visitas: ahora van a donde está de verdad el otro.
- Recién llegado (primeras 24 h): los demás lo visitan más. Su custodio lo ve llegar nadando la primera vez (`?llegada=1` lo repite).
- Tocar un pingüino: gira hacia el visitante y saluda; al segundo toque, salta. Solo lo ve quien toca.

Ensayo, solo para quien abre el enlace (no guarda nada): `mundo.html?ensayo=12` añade pingüinos de muestra, `&minuto=149` empieza en ese minuto del día (0 a 180), `&ritmo=8` acelera el tiempo.
