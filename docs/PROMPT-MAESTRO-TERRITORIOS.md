# PROMPT MAESTRO PARA CLAUDE

## Desarrollo del módulo FERSUAZ -- Gestión Territorial, Rutas y Viáticos

**Producto:** FERSUAZ.NET\
**Nombre del módulo:** Gestión Territorial y Viáticos\
**Versión del documento:** 1.0\
**Idioma de la interfaz:** Español\
**País y alcance geográfico:** República Dominicana

------------------------------------------------------------------------

## 1. INSTRUCCIÓN PRINCIPAL

Actúa como arquitecto de software senior y desarrollador full-stack.
Debes analizar el proyecto existente de **FERSUAZ.NET** y desarrollar un
módulo nuevo denominado **Gestión Territorial y Viáticos**, integrado de
forma segura con la plataforma actual.

El módulo permitirá administrar representantes comerciales, territorios,
establecimientos médicos, vehículos, rutas, cronogramas de visitas,
gastos operativos y liquidaciones de viáticos.

### Regla crítica: no romper lo existente

Antes de modificar cualquier archivo:

1.  Inspecciona la estructura completa del repositorio.
2.  Identifica el framework, lenguaje del backend, sistema de
    autenticación, roles y permisos, base de datos, convenciones de
    código, componentes visuales y navegación.
3.  Identifica cómo se registran actualmente usuarios, empleados,
    sucursales y módulos.
4.  Revisa las migraciones, modelos, controladores, servicios, rutas y
    APIs existentes.
5.  Presenta un breve diagnóstico técnico y un plan de integración.
6.  Reutiliza los componentes, estilos, servicios y patrones ya
    aprobados en FERSUAZ.NET.
7.  No reemplaces archivos completos ni alteres módulos existentes sin
    necesidad demostrable.
8.  No cambies tecnologías, framework, arquitectura, autenticación ni
    estructura de base de datos por preferencia personal.
9.  No inventes endpoints, tablas, credenciales, datos ni integraciones.
    Descubre primero lo que existe.
10. Realiza cambios pequeños, controlados y reversibles. Mantén
    compatibilidad con las funcionalidades actuales.

**No construyas una aplicación independiente si el repositorio permite
integrar el módulo dentro de FERSUAZ.NET.**

Si el proyecto todavía no está disponible, prepara una versión modular
aislada de presentación y lógica de negocio, con contratos de
integración claramente documentados. No simules que está conectada a una
base de datos o API real.

------------------------------------------------------------------------

## 2. ACLARACIÓN TECNOLÓGICA

La interfaz solicitada utiliza:

-   **HTML5:** estructura de páginas y componentes.
-   **CSS3:** diseño visual responsive.
-   **JavaScript:** interacciones, validaciones, cálculos y lógica del
    navegador.

JavaScript no es Java. Para el backend, utiliza exclusivamente la
tecnología que ya emplee FERSUAZ.NET. No introduzcas Java como backend
salvo que el proyecto existente esté desarrollado en Java.

La persistencia de datos, autenticación, permisos y cálculos críticos
deben estar respaldados por el backend y la base de datos existentes. No
guardes información empresarial importante únicamente en `localStorage`.

------------------------------------------------------------------------

## 3. OBJETIVO DEL SISTEMA

Construir una herramienta gerencial que permita responder, para cada
representante:

-   Quién es y qué posición ocupa.
-   Cuáles provincias, municipios, distritos municipales, sectores y
    comunidades tiene asignados.
-   Qué clínicas, hospitales y establecimientos médicos debe visitar.
-   Cuántas visitas debe realizar y con qué frecuencia.
-   Desde qué residencia inicia sus recorridos.
-   Cuántos kilómetros recorre por ruta, día y mes.
-   Qué vehículo utiliza y cuánto combustible consume.
-   Si debe viajar fuera de su residencia y hospedarse.
-   Cuánto debe presupuestarse para alimentación, hoteles, combustible,
    peajes y otros gastos autorizados.
-   Cuánto viático debe recibir para cubrir su trabajo sin financiarlo
    con su salario.
-   Cuánto recibió, cuánto gastó, cuánto justificó y qué saldo queda
    pendiente.

El sistema debe producir un cronograma operativo y un presupuesto
mensual individual y consolidado para toda la fuerza comercial.

------------------------------------------------------------------------

## 4. REGLAS DE NEGOCIO YA APROBADAS

Estas decisiones son requisitos confirmados y no deben cambiarse sin
autorización:

  Parámetro                         Regla aprobada
  --------------------------------- -----------------------------------------------
  Punto de partida de las rutas     Residencia de cada representante
  Días laborales de planificación   21 días por mes, configurables
  Frecuencia inicial                2 visitas mensuales por establecimiento
  Frecuencia de visita              Configurable por establecimiento
  Vehículo                          Puede ser propio o asignado por FERSUAZ
  Rendimiento                       Rendimiento real en kilómetros por galón
  Directorio médico                 Cobertura nacional: toda República Dominicana
  Hospedaje                         Configurable por representante e itinerario
  Viáticos                          Presupuesto individual y consolidado
  Salario                           Separado de los gastos operativos y viáticos

La frecuencia de dos visitas mensuales es el valor predeterminado, no
una regla fija. Debe poder modificarse por establecimiento,
representante o campaña, respetando permisos y auditoría.

La gerencia podrá configurar excepciones, como una, dos, cuatro o más
visitas al mes.

No se debe asumir automáticamente que una ruta requiere hotel por su
distancia. El sistema puede sugerir hospedaje según distancia, tiempo y
horario, pero la decisión y autorización deben quedar registradas.

------------------------------------------------------------------------

## 5. MÓDULOS FUNCIONALES

### MÓDULO 1. Dashboard gerencial

Crear un panel de control con filtros por mes, representante, posición,
provincia, municipio y estado.

Indicadores mínimos:

-   Total de representantes activos.
-   Representantes por posición.
-   Provincias y municipios cubiertos.
-   Establecimientos médicos registrados y validados.
-   Establecimientos asignados y pendientes de asignación.
-   Visitas planificadas, realizadas, pendientes y reprogramadas.
-   Kilómetros presupuestados y reales.
-   Consumo estimado y real de combustible.
-   Presupuesto de viáticos.
-   Viáticos entregados.
-   Gastos justificados.
-   Saldos pendientes de liquidación.
-   Gastos de hospedaje.
-   Costo operativo por representante y territorio.

No mostrar cifras ficticias como datos reales. Si la base está vacía,
presentar estados vacíos y explicar qué datos faltan.

### MÓDULO 2. Representantes

Crear un directorio con búsqueda, filtros, alta, edición, activación y
desactivación.

Cada ficha deberá incluir:

-   Nombre completo.
-   Identificador interno o código de empleado, si existe en FERSUAZ.
-   Posición: Visitador, PVC, Vendedor o Promotora.
-   Teléfono y correo, si están disponibles y autorizados.
-   Estado: activo o inactivo.
-   Residencia habitual y dirección desde la que inicia las rutas.
-   Coordenadas GPS de la residencia, cuando estén disponibles.
-   Provincias y territorios asignados.
-   Vehículo asociado.
-   Parámetros de gastos y viáticos.
-   Historial de asignaciones, cambios y autorizaciones.

No exponer domicilios personales a usuarios que no tengan permiso. La
dirección exacta debe tratarse como información restringida.

### MÓDULO 3. Estructura geográfica nacional

Construir una estructura jerárquica:

1.  País.
2.  Provincia.
3.  Municipio.
4.  Distrito municipal.
5.  Sector, barrio, comunidad o localidad.
6.  Establecimiento médico.

El alcance incluye todas las provincias y municipios de República
Dominicana, no solamente los territorios actualmente asignados.

Requisitos:

-   Permitir consultar, buscar y filtrar cada nivel geográfico.
-   Relacionar cada municipio con su provincia.
-   Relacionar distritos municipales y localidades con su municipio
    correspondiente.
-   Evitar duplicados.
-   Guardar identificadores geográficos estables cuando la fuente los
    proporcione.
-   Registrar fuente, fecha de consulta, fecha de actualización y estado
    de validación.
-   Permitir importar datos mediante CSV/XLSX si el proyecto tiene
    soporte para ello.
-   Mantener un proceso de revisión de registros dudosos.

No inventar divisiones administrativas, sectores, coordenadas ni
direcciones. La información incompleta debe quedar marcada como
pendiente de validación.

### MÓDULO 4. Directorio nacional de establecimientos médicos

Incluir todos los establecimientos médicos de República Dominicana,
públicos y privados, dentro de las categorías aplicables:

-   Hospitales públicos.
-   Hospitales privados.
-   Clínicas generales.
-   Clínicas especializadas.
-   Centros de atención primaria.
-   UNAP y dispensarios.
-   Centros de primer nivel.
-   Centros de segundo nivel.
-   Centros diagnósticos.
-   Laboratorios.
-   Centros de imágenes.
-   Otros centros médicos especializados.

Cada establecimiento tendrá una ficha:

-   Nombre oficial.
-   Nombre comercial, si difiere.
-   Tipo de establecimiento.
-   Nivel de atención, cuando esté oficialmente identificado.
-   Naturaleza: público, privado u otra categoría documentada.
-   Provincia.
-   Municipio.
-   Distrito municipal.
-   Sector, barrio o comunidad.
-   Dirección.
-   Coordenadas GPS.
-   Teléfono y datos de contacto públicos, si están disponibles.
-   Fuente de información.
-   Fecha de obtención.
-   Fecha de última verificación.
-   Estado: pendiente, validado, observado o inactivo.
-   Representante responsable.
-   Frecuencia de visitas mensual.
-   Prioridad comercial.
-   Observaciones e historial.

**Calidad de los datos:** no clasificar un establecimiento por nivel de
atención basándose solamente en su nombre. Utilizar una fuente oficial o
dejar el nivel como "por verificar".

No afirmar que el directorio está completo hasta haber contrastado las
fuentes y documentado la cobertura. Incluir una pantalla de cobertura y
calidad de datos que identifique provincias o categorías pendientes.

Diseñar el modelo para importar fuentes oficiales y confiables, por
ejemplo registros públicos sanitarios y directorios institucionales
disponibles. Documentar la procedencia y condiciones de uso de cada
fuente. No realizar scraping que viole términos de uso ni inventar
registros.

### MÓDULO 5. Asignación territorial

Permitir asignar provincias, municipios, sectores y establecimientos a
cada representante.

La asignación debe admitir:

-   Un representante con varias provincias.
-   Varios representantes en una misma provincia, si la gerencia lo
    autoriza.
-   Excepciones por municipio o establecimiento.
-   Fecha de inicio y finalización de asignación.
-   Historial de cambios.
-   Responsable que autorizó el cambio.

Mostrar conflictos de cobertura, establecimientos sin representante y
posibles asignaciones duplicadas.

La asignación de un establecimiento no debe inferirse únicamente por
proximidad geográfica: debe ser una decisión administrativa explícita.

### MÓDULO 6. Vehículos

Cada representante podrá tener un vehículo propio o uno asignado por
FERSUAZ.

Campos:

-   Tipo de propiedad: propio o asignado.
-   Marca.
-   Modelo.
-   Año.
-   Tipo de combustible: gasolina, gasoil/diésel, GLP, híbrido o
    eléctrico.
-   Rendimiento real.
-   Unidad de rendimiento: km/galón, km/litro o kWh/100 km según
    corresponda.
-   Matrícula/placa, si es necesaria y el acceso está restringido.
-   Fecha de asignación.
-   Estado del vehículo.
-   Observaciones.

Para combustibles medidos en galones, utilizar km/galón. Para vehículos
eléctricos, no aplicar cálculos de galones: crear un método separado de
consumo y costo energético.

Permitir actualizar rendimiento real y conservar el historial para no
alterar presupuestos históricos.

En vehículos propios, el sistema debe permitir aplicar políticas de
reembolso por kilómetro, si FERSUAZ decide utilizarlas. No asumir que el
combustible será reembolsado de una manera específica sin configuración.

### MÓDULO 7. Rutas, distancias y mapas

Calcular rutas desde la residencia registrada del representante hasta
los establecimientos asignados y entre establecimientos consecutivos.

Funciones:

-   Selección de fecha o jornada.
-   Ordenamiento de visitas.
-   Distancia por tramo.
-   Distancia total diaria.
-   Tiempo estimado por tramo.
-   Kilómetros por semana y mes.
-   Rutas de ida y regreso a residencia cuando corresponda.
-   Visualización de paradas en mapa.
-   Comparación de alternativas de ruta.
-   Registro de kilómetros planificados y reales.
-   Detección de recorridos duplicados o innecesarios.

**Requisitos de precisión:**

-   Utilizar distancias por carretera, no distancias en línea recta,
    para presupuestar desplazamientos.
-   Diferenciar claramente kilómetros estimados de kilómetros reales.
-   No inventar distancias ni tiempos.
-   Si el proveedor de mapas no está conectado, mostrar "pendiente de
    cálculo" y no presentar valores falsos.
-   Diseñar un servicio de mapas intercambiable para permitir configurar
    el proveedor autorizado por FERSUAZ.
-   Documentar claves, límites de uso y costos del proveedor. Las claves
    privadas deben residir en el backend, nunca en JavaScript público.
-   Considerar restricciones de carreteras, cierres y rutas no
    disponibles cuando el proveedor lo soporte.

No calcular automáticamente una ruta mensual multiplicando una distancia
simple por 21. El cálculo debe partir de los itinerarios reales
planificados, las visitas requeridas, los puntos de inicio y retorno y
las rutas autorizadas.

### MÓDULO 8. Frecuencia y cronograma de visitas

Crear un calendario mensual por representante, con 21 días laborales
predeterminados.

Cada establecimiento tendrá una frecuencia inicial de dos visitas
mensuales, configurable.

Campos de una visita:

-   Representante.
-   Establecimiento.
-   Fecha y hora planificadas.
-   Fecha y hora reales.
-   Motivo o tipo de visita.
-   Prioridad.
-   Estado: planificada, realizada, pendiente, cancelada o reprogramada.
-   Resultado y observaciones.
-   Evidencia o documento adjunto, si está permitido.
-   Kilómetros estimados y reales, si están disponibles.

El sistema debe:

-   Distribuir visitas dentro de los días laborales.
-   Evitar duplicar visitas por error.
-   Respetar la frecuencia configurada.
-   Agrupar establecimientos cercanos para optimizar recorridos.
-   Considerar tiempos de visita y desplazamiento.
-   Advertir si el cronograma es imposible de cumplir.
-   Permitir reprogramación autorizada.
-   Mantener un historial de cambios.

No asumir que todos los meses tienen exactamente 21 días laborables: 21
será el valor de planificación inicial configurable, y el calendario
deberá contemplar fines de semana, feriados y días no laborables según
configuración.

### MÓDULO 9. Combustible y gastos de transporte

Registrar precio de combustible por tipo y vigencia.

Fórmula básica para vehículos de combustión:

**Galones estimados = kilómetros planificados / rendimiento en km por
galón**

**Costo estimado = galones estimados × precio por galón**

El precio debe poder variar por fecha y tipo de combustible. No utilizar
un precio fijo permanente.

Para cada representante mostrar:

-   Kilómetros mensuales.
-   Rendimiento del vehículo.
-   Galones estimados.
-   Precio aplicado.
-   Costo presupuestado.
-   Consumo y costo real reportado.
-   Diferencia entre presupuesto y gasto real.

Otros costos configurables:

-   Peajes.
-   Estacionamiento.
-   Transporte alternativo.
-   Reembolso por kilómetro.
-   Otros gastos autorizados.

Evitar contar dos veces el mismo gasto, por ejemplo combustible y
reembolso por kilómetro para el mismo trayecto, salvo que exista una
política expresa.

### MÓDULO 10. Alimentación

Configurar gasto diario por representante o por política de
posición/territorio.

Permitir:

-   Monto diario.
-   Días elegibles.
-   Diferentes tarifas según localidad, si la empresa lo define.
-   Días con alimentación cubierta por terceros.
-   Gastos presupuestados y reales.
-   Evidencias y observaciones.
-   Aprobación y liquidación.

No asumir automáticamente que los 21 días requieren el mismo gasto si
existen días sin desplazamiento o visitas canceladas.

### MÓDULO 11. Viajes y hospedaje

El hospedaje debe ser configurable por representante e itinerario.

Opciones:

-   No viaja: regresa a su residencia el mismo día.
-   Viaja sin hospedaje.
-   Viaja y requiere hospedaje.
-   Configuración específica por fecha o ruta.

Cuando se requiera hotel, registrar:

-   Municipio o localidad de destino.
-   Hotel o proveedor, si se conoce.
-   Fecha de entrada.
-   Fecha de salida.
-   Número de noches.
-   Tarifa por noche.
-   Impuestos y cargos, si aplican.
-   Costo total.
-   Motivo del hospedaje.
-   Aprobador.
-   Estado: propuesto, solicitado, aprobado, reservado, utilizado,
    cancelado o liquidado.

El sistema puede sugerir hospedaje según distancia, duración, horario y
política de viaje, pero no aprobarlo automáticamente.

Calcular noches reales entre entrada y salida, validando fechas y
evitando cobros duplicados.

### MÓDULO 12. Presupuesto y viáticos

El sistema debe generar presupuesto por representante, territorio y mes.

Categorías mínimas:

1.  Combustible o energía.
2.  Alimentación.
3.  Hospedaje.
4.  Peajes.
5.  Estacionamiento.
6.  Otros gastos autorizados.

Mostrar por separado:

-   Presupuesto calculado.
-   Monto solicitado.
-   Monto aprobado.
-   Monto entregado.
-   Gastos reales reportados.
-   Gastos justificados.
-   Saldo pendiente de liquidar.
-   Diferencia entre presupuesto y ejecución.

El sistema debe permitir anticipos y liquidaciones parciales o finales,
según política empresarial.

**Separación de salario y viáticos:**

-   El salario debe permanecer como concepto independiente.
-   Los viáticos corresponden a gastos operativos del trabajo.
-   No presentar viáticos como salario ni como una reducción del
    salario.
-   No determinar automáticamente el tratamiento fiscal o laboral.
-   Permitir que FERSUAZ configure políticas de viáticos y que su
    asesoría contable/legal valide su tratamiento conforme a la
    normativa dominicana.

### MÓDULO 13. Liquidaciones y comprobantes

Crear un flujo para:

1.  Generar presupuesto.
2.  Solicitar viáticos.
3.  Aprobar o rechazar.
4.  Registrar desembolso.
5.  Reportar gastos.
6.  Adjuntar comprobantes.
7.  Revisar y aprobar gastos.
8.  Calcular saldo.
9.  Cerrar liquidación.
10. Consultar historial.

Cada movimiento debe registrar usuario, fecha, importe, categoría,
estado y referencia documental.

No permitir borrar silenciosamente movimientos financieros aprobados.
Usar reversos o ajustes auditables.

### MÓDULO 14. Reportes

Generar reportes filtrables y exportables, según las capacidades
existentes del proyecto:

-   Ficha de representante.
-   Territorio asignado.
-   Directorio de establecimientos por territorio.
-   Cronograma mensual.
-   Visitas realizadas y pendientes.
-   Kilómetros por ruta y representante.
-   Consumo de combustible.
-   Gastos de alimentación.
-   Hospedajes y noches.
-   Presupuesto y ejecución de viáticos.
-   Liquidaciones pendientes.
-   Costo total por provincia, municipio y representante.
-   Consolidado mensual de toda la fuerza comercial.

Los reportes deben indicar el período, fecha de generación, filtros y si
los datos son estimados o reales.

------------------------------------------------------------------------

## 6. DATOS INICIALES DE REPRESENTANTES

Cargar estos registros como datos iniciales, conservando los nombres y
asignaciones tal como fueron suministrados. Antes de importar,
normalizar espacios y tildes sin alterar la identidad del registro.

  ------------------------------------------------------------------------
                     \# Representante    Posición         Zona
  --------------------- ---------------- ---------------- ----------------
                      1 Edward Cuecas    Visitador        Espaillat, La
                                                          Vega, Puerto
                                                          Plata, Duarte

                      2 Enmanuel Tavarez Visitador        Santiago, Licey,
                                                          Tamboril y La
                                                          Costa Noreste

                      3 Arianny Alvarez  Visitador        La Línea Larga y
                                                          Corta

                      4 Jimmy Mora       Visitador        Gran Santo
                                                          Domingo

                      5 Alfredo Rodolfo  Visitador        Monseñor Nouel

                      6 Junior Calcaño   PVC              El Sur

                      7 Representante    PVC              El Este
                        pendiente                         

                      8 Pedro Nuñez      Vendedor         Santiago y La
                                                          Línea Larga y
                                                          Corta

                      9 Samuel Batista   Vendedor         La Vega,
                                                          Espaillat,
                                                          Puerto Plata y
                                                          Monseñor Nouel

                     10 Gabriel Otaño    Vendedor         Gran Santo
                                                          Domingo

                     11 Marcos Mejia     Vendedor         Duarte y María
                                                          Trinidad Sánchez

                     12 Minely Pérez     Promotora        Licey, Tamboril,
                                                          Santiago, Villa
                                                          González y
                                                          Navarrete

                     13 Yudith Francisco Promotora        Santiago, San
                                                          José de las
                                                          Matas

                     14 Ashley de Jesus  Promotora        Duarte

                     15 Lucitania        Promotora        Gran Santo
                        Paredez                           Domingo

                     16 Vacante          Por definir      Por definir

                     17 Vacante          Por definir      Por definir

                     18 Vacante          Por definir      Por definir

                     19 Vacante          Por definir      Por definir
  ------------------------------------------------------------------------

**Importante:** algunas zonas son descripciones regionales y no nombres
administrativos precisos. No asignar provincias, municipios o sectores
por suposición. Marcar los territorios ambiguos para revisión gerencial.

No inventar residencias, teléfonos, vehículos, precios de combustible,
rendimientos, tarifas de comida ni hoteles. Esos datos se completarán
mediante formularios o importación autorizada.

------------------------------------------------------------------------

## 7. EXPERIENCIA DE USUARIO Y DISEÑO

La interfaz debe sentirse como un módulo nativo de FERSUAZ.NET.

Requisitos:

-   Reutilizar identidad visual, logotipo, tipografía, colores,
    navegación y componentes existentes.
-   Diseño profesional, moderno y gerencial.
-   Responsive para escritorio, tablet y móvil.
-   Menú lateral o navegación consistente con la plataforma.
-   Tablas con búsqueda, filtros, ordenamiento y paginación.
-   Formularios claros con validaciones.
-   Confirmaciones antes de acciones sensibles.
-   Estados de carga, error, éxito y ausencia de datos.
-   Formularios con etiquetas visibles y mensajes de error
    comprensibles.
-   Accesibilidad básica: contraste, teclado, etiquetas y foco.
-   No usar datos de demostración como si fueran reales.
-   No incluir botones decorativos sin acción funcional.
-   No recortar contenido ni generar desplazamientos horizontales
    innecesarios en pantallas habituales.

### Navegación sugerida

-   Resumen gerencial
-   Representantes
-   Geografía nacional
-   Establecimientos médicos
-   Territorios y asignaciones
-   Vehículos
-   Rutas y mapas
-   Calendario de visitas
-   Gastos y combustible
-   Viajes y hoteles
-   Presupuestos de viáticos
-   Liquidaciones
-   Reportes
-   Configuración

Adaptar esta navegación a la arquitectura real de FERSUAZ.NET.

------------------------------------------------------------------------

## 8. ROLES Y PERMISOS

Primero descubrir el sistema de roles y permisos que ya utiliza
FERSUAZ.NET. Integrarse con él; no crear un sistema de autenticación
paralelo.

Como referencia funcional:

-   **Administrador:** configuración integral, usuarios y permisos.
-   **Gerencia:** consulta nacional, asignaciones, presupuestos y
    autorizaciones.
-   **Supervisor:** consulta y seguimiento de los representantes bajo su
    responsabilidad.
-   **Representante:** consulta su territorio, cronograma, rutas y
    viáticos; reporta visitas y gastos.
-   **Finanzas:** presupuestos, desembolsos, comprobantes y
    liquidaciones.

Aplicar autorización en backend, no solamente ocultar botones en
frontend.

Restringir datos personales, residencias y datos financieros según el
rol.

Registrar auditoría de cambios relevantes: quién hizo qué, cuándo y cuál
era el valor anterior y nuevo.

------------------------------------------------------------------------

## 9. MODELO DE DATOS PROPUESTO

Antes de crear tablas, comparar este modelo con la base existente y
reutilizar entidades compatibles.

Entidades sugeridas:

-   `representatives`
-   `representative_positions`
-   `representative_residences`
-   `geographic_provinces`
-   `geographic_municipalities`
-   `geographic_municipal_districts`
-   `geographic_localities`
-   `medical_facilities`
-   `medical_facility_categories`
-   `medical_facility_levels`
-   `territory_assignments`
-   `vehicles`
-   `vehicle_assignments`
-   `vehicle_efficiency_history`
-   `fuel_prices`
-   `visit_frequency_rules`
-   `visit_schedules`
-   `visits`
-   `routes`
-   `route_segments`
-   `travel_requests`
-   `hotel_stays`
-   `expense_policies`
-   `per_diem_budgets`
-   `per_diem_disbursements`
-   `expense_reports`
-   `expense_items`
-   `expense_attachments`
-   `settlements`
-   `approvals`
-   `audit_logs`
-   `data_sources`

Usar claves foráneas, índices, restricciones, fechas y estados
consistentes. Evitar duplicar datos que ya existan en FERSUAZ.NET.

Definir una estrategia de migración reversible. No ejecutar migraciones
destructivas ni borrar datos existentes.

------------------------------------------------------------------------

## 10. INTEGRACIONES EXTERNAS

Identificar qué integraciones ya tiene FERSUAZ.NET.

Si no existe un proveedor geográfico, diseñar una capa de servicio que
permita integrar un proveedor de mapas y rutas autorizado.

Requisitos:

-   Geocodificación de residencias y establecimientos.
-   Cálculo de rutas por carretera.
-   Distancias y tiempos estimados.
-   Mapa con marcadores.
-   Optimización de paradas, si el proveedor lo soporta.
-   Manejo de errores, límites y costos.
-   Caché de resultados cuando los términos del proveedor lo permitan.
-   Protección de claves API en servidor.

No elegir ni contratar automáticamente un proveedor. Documentar
alternativas y solicitar las credenciales necesarias al administrador
del proyecto.

Para datos médicos, priorizar fuentes oficiales dominicanas y documentar
las fuentes utilizadas. Cada importación debe registrar procedencia y
fecha.

------------------------------------------------------------------------

## 11. SEGURIDAD, PRIVACIDAD Y AUDITORÍA

-   Validar entradas en frontend y backend.
-   Usar consultas parametrizadas u ORM seguro.
-   Proteger contra XSS, CSRF, SQL injection y acceso no autorizado.
-   Aplicar controles de sesión y autenticación existentes.
-   Restringir acceso a domicilios, teléfonos y datos financieros.
-   No colocar secretos en repositorios ni en código cliente.
-   Validar tipo y tamaño de archivos adjuntos.
-   Registrar eventos críticos.
-   Evitar borrado irreversible de información financiera.
-   Realizar copias de seguridad según las prácticas del proyecto.
-   No utilizar datos personales reales en ambientes de prueba sin
    autorización.

------------------------------------------------------------------------

## 12. CRITERIOS DE ACEPTACIÓN

El módulo no se considerará terminado hasta demostrar lo siguiente:

1.  Se integra en FERSUAZ.NET sin romper los módulos existentes.
2.  Respeta la autenticación y permisos actuales.
3.  Permite administrar los 19 espacios de representantes, incluyendo
    vacantes.
4.  Permite registrar residencias y utilizarlas como origen de rutas.
5.  Permite administrar la estructura geográfica nacional.
6.  Permite importar, validar y consultar establecimientos médicos.
7.  Permite asignar territorios y centros a representantes.
8.  Permite registrar vehículos propios y asignados.
9.  Calcula combustible con kilómetros, rendimiento y precio vigente.
10. Permite configurar dos visitas mensuales como valor inicial y
    cambiar la frecuencia.
11. Construye calendarios de 21 días laborales configurables.
12. Calcula rutas con distancias por carretera cuando el proveedor esté
    conectado.
13. Distingue valores estimados de valores reales.
14. Permite definir si el representante viaja y si requiere hospedaje.
15. Calcula noches y costos de hotel.
16. Calcula alimentación y otros gastos configurables.
17. Genera presupuestos individuales y consolidados.
18. Registra anticipos, gastos, comprobantes y liquidaciones.
19. Mantiene salario separado de viáticos.
20. Genera reportes con filtros y exportación cuando esté disponible.
21. Registra auditoría de cambios importantes.
22. Tiene estados vacíos claros cuando faltan datos.
23. Incluye pruebas automatizadas para cálculos y permisos.
24. Incluye documentación de instalación, configuración y uso.

------------------------------------------------------------------------

## 13. PRUEBAS MÍNIMAS DE CÁLCULO

Crear pruebas unitarias para fórmulas y casos límite.

Ejemplo de combustible:

-   Kilómetros planificados: 2,100 km.
-   Rendimiento: 35 km/galón.
-   Precio: RD\$250 por galón.
-   Galones estimados: 60.
-   Costo estimado: RD\$15,000.

Ejemplo de alimentación:

-   Tarifa diaria: RD\$500.
-   Días elegibles: 21.
-   Total: RD\$10,500.

Ejemplo de hospedaje:

-   Noches autorizadas: 3.
-   Tarifa por noche: RD\$2,500.
-   Total: RD\$7,500.

Ejemplo de presupuesto:

-   Combustible: RD\$15,000.
-   Alimentación: RD\$10,500.
-   Hospedaje: RD\$7,500.
-   Peajes: RD\$2,000.
-   Otros: RD\$1,000.
-   Total: RD\$36,000.

Estos son datos de prueba, no valores predeterminados reales. Las
pruebas deben verificar redondeos, datos vacíos, cero kilómetros,
rendimiento inválido, precios negativos, fechas incorrectas y gastos
duplicados.

------------------------------------------------------------------------

## 14. PLAN DE IMPLEMENTACIÓN POR ETAPAS

No desarrollar todo de golpe. Trabajar por fases y entregar resultados
verificables.

### Fase 0 -- Auditoría técnica

-   Inspeccionar repositorio.
-   Identificar stack, base de datos, autenticación y permisos.
-   Identificar patrones visuales.
-   Preparar mapa de integración.
-   Enumerar riesgos y archivos que se modificarán.

**Entrega:** diagnóstico y plan técnico. No alterar módulos existentes.

### Fase 1 -- Estructura y representantes

-   Crear entrada del módulo y navegación.
-   Crear dashboard inicial con estados vacíos.
-   Crear fichas de representantes.
-   Cargar los 19 espacios iniciales.
-   Configurar residencias y vehículos.

**Entrega:** módulo integrado con datos de representantes.

### Fase 2 -- Geografía y directorio médico

-   Estructura nacional.
-   Importación de datos.
-   Directorio de establecimientos.
-   Validación, deduplicación y fuentes.
-   Asignación territorial.

**Entrega:** base geográfica y directorio consultable, con cobertura
documentada.

### Fase 3 -- Visitas y rutas

-   Frecuencias.
-   Calendario de 21 días.
-   Rutas y tramos.
-   Mapas y distancias.
-   Estimados y recorridos reales.

**Entrega:** cronograma operativo por representante.

### Fase 4 -- Presupuesto y viáticos

-   Combustible.
-   Alimentación.
-   Hoteles.
-   Peajes y otros.
-   Solicitudes y aprobaciones.
-   Desembolsos y liquidaciones.

**Entrega:** presupuesto y liquidación individual y consolidada.

### Fase 5 -- Reportes, seguridad y puesta en producción

-   Reportes.
-   Pruebas.
-   Auditoría.
-   Revisión de permisos.
-   Documentación.
-   Plan de despliegue y reversión.

**Entrega:** módulo listo para aprobación y despliegue controlado.

------------------------------------------------------------------------

## 15. FORMATO DE ENTREGA DE CLAUDE

Al finalizar cada fase, informar:

1.  Qué se inspeccionó.
2.  Qué archivos se crearon.
3.  Qué archivos existentes se modificaron y por qué.
4.  Qué tablas o migraciones se añadieron.
5.  Qué endpoints o servicios se integraron.
6.  Qué pruebas se ejecutaron y sus resultados.
7.  Qué queda pendiente.
8.  Cómo probar la funcionalidad.
9.  Cómo revertir los cambios si fuera necesario.

No declarar una funcionalidad como terminada si utiliza datos simulados,
endpoints inexistentes o integraciones no conectadas.

Separar claramente:

-   Funcionalidad implementada.
-   Funcionalidad pendiente de credenciales.
-   Funcionalidad que requiere datos externos.
-   Funcionalidad que requiere validación gerencial.

------------------------------------------------------------------------

## 16. PRIMERA ORDEN DE TRABAJO

Comienza ahora por la **Fase 0: Auditoría técnica del proyecto
FERSUAZ.NET**.

No empieces creando archivos ni modificando módulos existentes.

Primero inspecciona el repositorio y entrega:

-   Arquitectura actual.
-   Tecnologías detectadas.
-   Sistema de autenticación y permisos.
-   Base de datos y entidades reutilizables.
-   Convenciones de interfaz.
-   Punto recomendado de integración.
-   Archivos que sería necesario crear o modificar.
-   Riesgos de compatibilidad.
-   Plan de implementación por fases.

Después de presentar ese diagnóstico, espera aprobación antes de
ejecutar cambios estructurales.

**Principio rector:** construir un módulo robusto, integrado, auditable
y escalable, respetando todo lo que ya está aprobado y funcionando en
FERSUAZ.NET.
