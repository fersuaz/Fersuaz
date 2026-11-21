// Lectura de archivos de ventas con inteligencia artificial (Claude, de Anthropic).
// Recibe una factura, un reporte en PDF, una foto o una hoja sin formato fijo y devuelve las líneas
// de venta (farmacia, medicamento, unidades, precio, fecha, factura). No inventa: lo que no está en
// el archivo queda vacío y se revisa en pantalla antes de guardar.
// Necesita ANTHROPIC_API_KEY en el servidor; sin ella, solo se lee la plantilla de Excel.

const URL_API = 'https://api.anthropic.com/v1/messages';
const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const HERRAMIENTA = {
  name: 'registrar_ventas',
  description: 'Registra cada línea de venta a farmacias que aparece en el archivo.',
  input_schema: {
    type: 'object',
    properties: {
      filas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fecha: { type: 'string', description: 'Fecha de la venta en formato AAAA-MM-DD, si aparece.' },
            farmacia: { type: 'string', description: 'Nombre de la farmacia o cliente, tal como aparece.' },
            municipio: { type: 'string', description: 'Municipio o ciudad de la farmacia, si aparece.' },
            medicamento: { type: 'string', description: 'Nombre del medicamento y su presentación, tal como aparece.' },
            unidades: { type: 'number', description: 'Cantidad de unidades vendidas.' },
            precioUnitario: { type: 'number', description: 'Precio por unidad en RD$, si aparece.' },
            factura: { type: 'string', description: 'Número de factura o NCF, si aparece.' },
          },
          required: ['farmacia', 'medicamento', 'unidades'],
        },
      },
      notas: { type: 'string', description: 'Cualquier parte del archivo que no se pudo leer con seguridad.' },
    },
    required: ['filas'],
  },
};

const HERRAMIENTA_MEDICOS = {
  name: 'registrar_medicos',
  description: 'Registra cada médico que aparece en el archivo.',
  input_schema: {
    type: 'object',
    properties: {
      filas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nombre: { type: 'string', description: 'Nombre completo del médico, sin Dr. ni Dra.' },
            especialidad: { type: 'string', description: 'Especialidad médica, si aparece.' },
            establecimiento: { type: 'string', description: 'Hospital, clínica o consultorio donde labora, si aparece.' },
            provincia: { type: 'string' }, municipio: { type: 'string', description: 'Municipio o ciudad, si aparece.' },
            telefono: { type: 'string' }, instagram: { type: 'string' }, facebook: { type: 'string' }, web: { type: 'string' },
          },
          required: ['nombre'],
        },
      },
      notas: { type: 'string', description: 'Partes del archivo que no se pudieron leer con seguridad.' },
    },
    required: ['filas'],
  },
};

export function createLectorIA({ apiKey, fetchImpl = globalThis.fetch, modelo = 'claude-sonnet-5-5' } = {}) {
  async function llamar(archivo, herramienta, instruccion, sinResultado) {
      const r = await fetchImpl(URL_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: modelo, max_tokens: 16000, tools: [herramienta], tool_choice: { type: 'tool', name: herramienta.name },
          messages: [{ role: 'user', content: [archivo, { type: 'text', text: instruccion }] }],
        }),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = cuerpo?.error?.message ?? `error ${r.status}`;
        const sinSaldo = /credit|balance|billing/i.test(msg);
        throw Object.assign(new Error(sinSaldo
          ? 'La lectura con inteligencia artificial no tiene saldo en la cuenta de Anthropic. Recarga el saldo o usa la plantilla de Excel.'
          : r.status === 401 ? 'La clave de Anthropic del servidor no es válida. Usa la plantilla de Excel mientras se corrige.'
            : `No se pudo leer el archivo con inteligencia artificial (${msg}).`), { status: 502 });
      }
      const uso = (cuerpo.content ?? []).find((c) => c.type === 'tool_use' && c.name === herramienta.name);
      if (!uso) throw Object.assign(new Error(sinResultado), { status: 502 });
    return uso;
  }
  function contenido({ tipo, base64, texto }) {
    if (!apiKey) throw Object.assign(new Error('La lectura con inteligencia artificial no está configurada. Usa la plantilla de Excel.'), { status: 503 });
    if (texto != null) return { type: 'text', text: `Contenido del archivo (tabla en texto):\n${texto.slice(0, 180_000)}` };
    if (tipo === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
    if (TIPOS_IMAGEN.includes(tipo)) return { type: 'image', source: { type: 'base64', media_type: tipo, data: base64 } };
    throw Object.assign(new Error('Ese tipo de archivo no se puede leer. Usa PDF, foto (JPG o PNG), Excel o CSV.'), { status: 415 });
  }
  return {
    activo: Boolean(apiKey),
    modelo,
    /**
     * @param {{ tipo: string, base64?: string, texto?: string, medicamentos?: string[], farmacias?: string[] }} entrada
     * @returns {Promise<{ filas: object[], notas: string | null }>}
     */
    async leerVentas({ tipo, base64, texto, medicamentos = [], farmacias = [] }) {
      if (!apiKey) throw Object.assign(new Error('La lectura con inteligencia artificial no está configurada. Usa la plantilla de Excel.'), { status: 503 });
      let archivo;
      if (texto != null) archivo = { type: 'text', text: `Contenido del archivo (tabla en texto):\n${texto.slice(0, 180_000)}` };
      else if (tipo === 'application/pdf') archivo = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
      else if (TIPOS_IMAGEN.includes(tipo)) archivo = { type: 'image', source: { type: 'base64', media_type: tipo, data: base64 } };
      else throw Object.assign(new Error('Ese tipo de archivo no se puede leer. Usa PDF, foto (JPG o PNG), Excel o CSV.'), { status: 415 });
      const instruccion = [
        'Eres el asistente de un laboratorio farmacéutico de República Dominicana. El archivo dice lo que se le vendió a una o varias farmacias.',
        'Extrae CADA línea de venta con la herramienta registrar_ventas. Reglas:',
        '- No inventes datos. Si un dato no aparece, déjalo vacío.',
        '- Las unidades son la cantidad vendida de cada medicamento (no el monto).',
        '- Montos en pesos dominicanos (RD$), sin símbolos ni separadores de miles.',
        '- Fechas en formato AAAA-MM-DD. Si el archivo usa día/mes/año, conviértelo.',
        '- Si una factura tiene una sola farmacia, repite su nombre en cada línea.',
        '- Ignora subtotales, impuestos, descuentos y totales: solo líneas de producto.',
        medicamentos.length ? `Medicamentos del catálogo (úsalos para escribir el nombre igual cuando corresponda): ${medicamentos.slice(0, 300).join('; ')}.` : '',
        farmacias.length ? `Farmacias conocidas: ${farmacias.slice(0, 300).join('; ')}.` : '',
      ].filter(Boolean).join('\n');
      const uso = await llamar(archivo, HERRAMIENTA, instruccion, 'La inteligencia artificial no devolvió líneas de venta. Revisa que el archivo sea legible.');
      return { filas: Array.isArray(uso.input?.filas) ? uso.input.filas : [], notas: uso.input?.notas || null };
    },
    /** Lista de médicos (directorio, hoja de visitas, foto de una lista): nombre, especialidad, centro, teléfono, redes. */
    async leerMedicos({ tipo, base64, texto, establecimientos = [] }) {
      const archivo = contenido({ tipo, base64, texto });
      const instruccion = [
        'Eres el asistente de un laboratorio farmacéutico de República Dominicana. El archivo es una lista de médicos.',
        'Extrae CADA médico con la herramienta registrar_medicos. Reglas:',
        '- No inventes datos. Si un dato no aparece, déjalo vacío.',
        '- El nombre sin "Dr." ni "Dra.". La especialidad en español (ej. Pediatría, Ginecología).',
        '- Teléfonos tal como aparecen. Redes: usuario o enlace de Instagram y Facebook, y página web si aparece.',
        '- Ignora encabezados, totales y textos que no sean médicos.',
        establecimientos.length ? `Centros conocidos (escribe el nombre igual cuando corresponda): ${establecimientos.slice(0, 300).join('; ')}.` : '',
      ].filter(Boolean).join('\n');
      const uso = await llamar(archivo, HERRAMIENTA_MEDICOS, instruccion, 'La inteligencia artificial no encontró médicos. Revisa que el archivo sea legible.');
      return { filas: Array.isArray(uso.input?.filas) ? uso.input.filas : [], notas: uso.input?.notas || null };
    },
  };
}
