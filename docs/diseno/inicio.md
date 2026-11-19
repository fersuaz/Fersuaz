# Paquete de diseño: hero de FERSUAZ.net (`apps/web/index.html`)

Estado: **borrador para aprobar el storyboard**. Todavía no se ha gastado ningún crédito.
Nivel: **Tier 2, recorrido encadenado** (4 segmentos de 6 s, unos 24 s de scroll).
Herramienta de imagen y video: **Higgsfield**, sin excepciones.

---

## 1. Premisa de marca

La palabra que guía todo es **cadena**. Una paciente se enferma, un médico le receta un medicamento FERSUAZ,
una farmacia lo tiene en el estante y el dependiente se lo entrega. Ella hace su tratamiento y mejora.
Esa mejoría es posible porque cada persona del equipo comercial hizo su parte: el visitador llegó al médico,
el vendedor surtió la farmacia, la promotora registró la receta y el dependiente cerró la venta.
La plataforma existe para que esa cadena no se rompa en ningún punto.

## 2. Paleta (tokens)

Se mantiene la identidad de `CLAUDE.md`. Cuando el video quede aprobado, se ajustan los tonos
a partir de los fotogramas reales.

```css
:root{
  --canvas:#08201C;        /* Verde Caribe: fondo */
  --panel:#123A33;         /* Bosque: tarjetas */
  --accent:#C9A96E;        /* Champán: CTA y énfasis puntual */
  --accent-hover:#D8BD88;
  --accent-muted:rgba(201,169,110,.28);
  --text-secondary:#8FA39D;/* Niebla */
  --text-primary:#E6EBE8;  /* Perla */
  --alert:#D2644A;
}
```

Mundo del video: luz de mañana fría y verdosa en la casa, que se vuelve cálida y champán al llegar la recuperación.
El cambio de temperatura de la luz cuenta la historia por su cuenta.

## 3. Tipografía

- Títulos: **Bodoni Moda** 400 y 500, itálica 400 para una sola palabra de énfasis por banda.
- Texto: **Figtree** 400, 500 y 600.
- Etiquetas pequeñas (hora, paso): **Figtree** 600 en versalitas con espaciado amplio. No se añade una tercera familia, para respetar la identidad ya aprobada.

## 4. Storyboard (un solo plano continuo, 4 segmentos)

Cómo encaja con las leyes del video, y dónde se desvía (dicho a propósito):
- **Ley 2 (un sujeto):** la protagonista es **la paciente** y la cámara la acompaña siempre. El médico y el dependiente aparecen a media distancia, de espaldas o de tres cuartos.
- **Ley 5 (sujetos que perdonan):** no hay planos cerrados de manos ni de caras. La receta y el frasco se ven desenfocados o a distancia.
- **Ley 6 (eje vertical):** **desviación.** La historia avanza hacia adelante (un empuje lento de cámara), no hacia abajo. Hacia adelante se lee como "seguir la historia" al hacer scroll.
- **Costuras (ley de la textura):** cada cambio de lugar ocurre dentro de un destello de luz cálida que llena el lente, así la unión no se nota.
- **Sin texto ni logos en el video.** El frasco real de Tio-Dex **no se genera con IA**: la IA inventaría la etiqueta. El producto real aparece en la página, con foto oficial.

| Seg. | Lugar | Movimiento de cámara | Final del segmento (inicio del siguiente) | Dónde va el texto |
|---|---|---|---|---|
| 1 | Casa, sala con ventana, amanecer frío | Empuje lento hacia la paciente, sentada con una manta, con tos leve; luego hacia la ventana | La luz de la ventana crece hasta llenar el lente (destello cálido) | Tercio izquierdo, sobre la pared en sombra |
| 2 | Consultorio con luz cálida de madera | Sale del destello; el médico, de tres cuartos, escucha y escribe; la cámara baja hacia el papel desenfocado | Empuje hacia el papel blanco iluminado (destello) | Tercio derecho, sobre la estantería desenfocada |
| 3 | Farmacia de barrio dominicana | Sale del destello; el dependiente entrega una bolsa de papel a la paciente sobre el mostrador; estantes desenfocados | La cámara sigue a la paciente hacia la puerta de cristal iluminada (destello) | Tercio izquierdo, sobre los estantes desenfocados |
| 4 | Balcón o patio con plantas, tarde dorada | Sale del destello; la paciente respira hondo, sonríe y se apoya en la baranda; la cámara se detiene | **Final en reposo:** ella de perfil a la derecha del cuadro, cielo dorado y vegetación ocupando la mitad izquierda | Centro e izquierda, sobre el cielo |

## 5. Prompts para Higgsfield (en inglés, porque los modelos responden mejor)

### 5.1 Referencia de personaje (imagen, 16:9, 2k)

Se usa como `image_references` en los cuatro segmentos para que la paciente sea la misma persona.

```
Portrait reference of a Dominican woman in her late thirties, warm brown skin,
shoulder-length dark curly hair tied loosely back, small gold stud earrings,
wearing a soft sage-green cotton blouse. Neutral expression, three-quarter view,
soft even daylight, plain deep green background. Photorealistic. No text, no logos,
no lettering anywhere.
```

### 5.2 Fotograma inicial del segmento 1 (imagen, 16:9, 2k)

```
A Dominican woman in her late thirties sits on a simple sofa in a modest Santo
Domingo living room at early dawn, wrapped in a light grey blanket, slightly
hunched as if she has a cough, positioned in the right third of the frame,
composed as the first moment of a slow forward camera push toward her and the
window behind her. Cool blue-green morning light through sheer curtains, the
room otherwise in soft shadow. Palette of deep Caribbean green walls, forest
green plants, pearl-grey fabric and a faint champagne glow at the window edge.
Dust drifting in the light. The left third of the frame is the same room
continuing in soft shadow: a plain wall and a doorway receding in depth.
Cinematic, photorealistic, 16:9. No text, no logos, no lettering anywhere.
```

### 5.3 Video, segmento 1

```
One continuous shot, no cuts. The camera pushes slowly forward toward the woman
on the sofa, then drifts past her toward the bright window. She stays alive
throughout: a soft cough into her blanket, a slow breath, a small shift of her
shoulders. The scene stays alive: dust drifting in the light, curtains moving
gently. As the camera reaches the window, warm light blooms and fills the lens
completely, with a beat of soft blur. No text or lettering anywhere.
```

### 5.4 Video, segmento 2 (parte del último fotograma del segmento 1)

```
One continuous shot, no cuts. The warm bloom of light fades back to reveal a
calm doctor's consulting room with honey wood and warm lamp light. The same
woman sits across a desk from a doctor in a white coat, seen from behind and in
three-quarter view at medium distance. The doctor listens, nods and writes on a
sheet of paper. The camera keeps its slow forward push and lowers gently toward
the paper on the desk, which stays soft and out of focus. Both people stay
alive: small gestures, a nod, a turn of the head. As the camera nears the bright
paper, light blooms and fills the lens with a beat of soft blur. No text or
lettering anywhere, the paper shows no readable writing.
```

### 5.5 Video, segmento 3

```
One continuous shot, no cuts. The warm bloom fades back to reveal a small,
clean Dominican neighbourhood pharmacy, shelves softly out of focus in the
background. A pharmacy attendant in a white coat stands behind the counter at
medium distance and hands a plain white paper bag to the same woman. The camera
keeps its slow forward push, then follows her as she turns toward the bright
glass door. Both stay alive: a smile, a small thank-you nod. The shelves show
no readable labels. As the camera reaches the glass door, sunlight blooms and
fills the lens with a beat of soft blur. No text, no logos, no lettering anywhere.
```

### 5.6 Video, segmento 4 (final en reposo)

```
One continuous shot, no cuts. The sunlight bloom fades back to reveal a small
balcony with potted tropical plants in golden late-afternoon light. The same
woman, now without the blanket, stands at the railing, takes a slow deep breath
and smiles. The camera keeps its slow forward push and eases to a complete
stop. She stays alive: hair moving in a light breeze, a relaxed breath. Leaves
sway gently. The shot ends at rest: the woman in profile in the right third of
the frame, the left half filled with warm champagne sky and soft green foliage,
calm and arrived. No text, no logos, no lettering anywhere.
```

Ajustes comunes de video: imagen a video, 1080p, 6 s, sin audio, 16:9, referencia de personaje en cada segmento.
Modelo recomendado: **Seedance 2.0** (modo `std`), porque mantiene la misma cara entre segmentos.
Antes de gastar, se consulta el precio real de cada llamada (`get_cost`) y se elige el modelo con esos números.

## 6. Mapa de bandas (puntos de partida; se validan con la prueba de flick)

Altura del hero: unos 1000vh.

| Banda | Rango | Momento del video | Texto (tal cual) | Entrada |
|---|---|---|---|---|
| 1 | 0.00 a 0.20 | Paciente en casa, con tos | "Todo empieza con alguien que necesita sentirse mejor." | Desenfoque a nitidez (la mañana que despierta) |
| 2 | 0.24 a 0.44 | Consultorio, el médico escribe | "Un médico la escucha y le receta un medicamento FERSUAZ." | Palabra por palabra, como escritura en el papel |
| 3 | 0.48 a 0.68 | Farmacia, entrega | "En la farmacia del barrio, el dependiente tiene lo que el médico recetó." | Las mitades se acercan, como la entrega de mano a mano |
| 4 | 0.72 a 0.86 | Balcón, respira | "Ella sigue su tratamiento y vuelve a respirar tranquila." | Subida lenta, como una respiración |
| 5 (llegada) | 0.88 a 1.00 | Final en reposo | Título: "Una receta mueve a todo un equipo." Subtítulo: "El visitador llegó al médico. El vendedor surtió la farmacia. La promotora registró la receta. FERSUAZ conecta cada paso." CTA: "Solicitar una cuenta" | Subida por palabras con llegada escalonada |

## 7. Hero fijo (teléfonos y movimiento reducido)

Sobre el fotograma final del segmento 4:
- Título: "Una receta mueve a todo un equipo."
- Subtítulo: "Del consultorio a la farmacia, FERSUAZ conecta a visitadores, vendedores, promotoras y dependientes en una sola plataforma."
- CTA: "Solicitar una cuenta" (enlace a `registro.html`).

## 8. Debajo del hero

Se conservan las secciones actuales (`#jornada`, `#cuentas`, cierre). Cambios propuestos:
- Nueva sección corta **"Tio-Dex"** con la foto oficial (frasco y caja) y solo datos del empaque: indicación, presentación,
  principios activos sin dosis, fabricante y registro sanitario, más "Lea el prospecto y consulte a su médico". Va en un PR propio.
- En el video, la bolsa de papel del segmento 3 se mantiene: el empaque real no se genera con IA.
- Pie de página: aviso de que las personas del video son generadas con IA (decisión pendiente, ver §10).

## 9. Lista de ingeniería

Video como Blob con anillo de carga y vigilancia de 20 s; lerp normalizado por tiempo; seeks con compuerta;
escrituras al DOM solo con cambios; bandas en vh con prueba de flick; sistema de legibilidad de 4 capas
con auditoría del peor fotograma (3.5:1 como mínimo); las 5 compuertas de hero fijo en CSS y JS, con escucha de cambios;
página completa sin video; codificación con `-g 8 -keyint_min 8`; crudos en `review/`, fuera de `apps/web`.

## 10. Pendientes antes de generar

1. **Aprobación de este storyboard** (la compuerta más barata).
2. **Tio-Dex: fotos recibidas** (`docs/diseno/referencias/`). Datos tomados del empaque: jarabe, vía oral, 120 mL;
   dextrometorfano y sulfaguayacolato; antitusivo, descongestionante nasal y bronquial; elaborado por FERSUAZ
   Farmacéutica S.R.L., La Vega; Reg. San. 09-0243; Reg. Ind. 18704. Falta confirmar si es de venta libre o bajo receta.
   **Verificar el empaque:** dice "Cada 5 mL contiene: Dextrometorfano 50 mg" y "Sulfaguayacolato 5 mL". Las dosis no
   se publican en la web hasta que el responsable técnico las confirme.
3. **Revisión regulatoria:** la publicidad de medicamentos en República Dominicana está regulada (DIGEMAPS). Frases como "vuelve a respirar tranquila" o "se sana" deben pasar por el responsable regulatorio de FERSUAZ. No soy abogado; esto es una alerta, no una opinión legal.
4. **Aviso de IA en el pie:** recomendado, porque las personas del video no son reales.
5. **Conector de Higgsfield con generación** (`https://mcp.higgsfield.ai/mcp`) o generación manual en higgsfield.ai con estos prompts.

## 11. Compuerta de textos

Todo el texto anterior se publica tal cual. Antes de mostrar la página: cero rayas largas, cero palabras de relleno
(leverage, seamless, empower, unlock, robust, actionable, data-driven, solutions y sus equivalentes en español)
y revisión de muletillas de IA en todo el archivo.
