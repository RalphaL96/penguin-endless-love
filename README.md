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
