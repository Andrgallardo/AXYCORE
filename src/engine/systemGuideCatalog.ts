import type { NavSectionId, UserRole } from '../types/axycore';

export type GuideDomainCategory =
  | 'ALL'
  | 'INICIO_CONTROL'
  | 'CREDITO_CLIENTES'
  | 'COBROS_CONTACT'
  | 'CONTABILIDAD_DGII'
  | 'INTELIGENCIA_ADMIN';

export interface GuideModuleItem {
  sectionId: NavSectionId;
  title: string;
  summary: string;
  mechanism: string;
  outcome: string;
  tags: string[];
  comingSoon?: boolean;
}

export interface GuideFunctionalArea {
  id: string;
  order: string;
  title: string;
  subtitle: string;
  domain: Exclude<GuideDomainCategory, 'ALL'>;
  purpose: string;
  keyGuarantee: string;
  items: GuideModuleItem[];
}

export interface GuideWorkflowStep {
  stepNumber: string;
  title: string;
  sectionId: NavSectionId;
  participatingRoles: UserRole[];
  whatHappens: string;
  controlGate: string;
}

export interface GuideEndToEndFlow {
  id: string;
  title: string;
  subtitle: string;
  estimatedTouchpoints: string;
  steps: GuideWorkflowStep[];
}

export interface GuidePortalDefinition {
  id: 'corporate' | 'client' | 'axycore_admin';
  name: string;
  audience: string;
  purpose: string;
  capabilities: string[];
}

export interface GuideTechnicalPillar {
  id: string;
  title: string;
  scope: string;
  detail: string;
  relatedSection?: NavSectionId;
}

export const GUIDE_DOMAIN_LABELS: Record<GuideDomainCategory, string> = {
  ALL: 'Todas las áreas',
  INICIO_CONTROL: 'Inicio y Reportes',
  CREDITO_CLIENTES: 'Préstamos y Clientes',
  COBROS_CONTACT: 'Cobros y Contact Center',
  CONTABILIDAD_DGII: 'Contabilidad y DGII e-CF',
  INTELIGENCIA_ADMIN: 'Inteligencia y Administración',
};

export const SYSTEM_GUIDE_AREAS: GuideFunctionalArea[] = [
  {
    id: 'inicio',
    order: '01',
    title: 'Inicio y Gobierno SaaS',
    subtitle: 'Tablero ejecutivo configurable y administración multiempresa',
    domain: 'INICIO_CONTROL',
    purpose:
      'Centralizar la lectura en tiempo real de la cartera, colocación, morosidad y productividad, junto con el gobierno comercial de organizaciones.',
    keyGuarantee:
      'Datos aislados por organización (organizationId) y personalización del Dashboard por rol sin alterar métricas oficiales.',
    items: [
      {
        sectionId: 'dashboard',
        title: 'Dashboard Ejecutivo',
        summary:
          'Panel principal con granularidad Diario, Semanal, Mensual, Trimestral y Anual en DOP, USD o vista separada.',
        mechanism:
          'Motor de widgets configurables con arrastrar y soltar, comparativas contra el período anterior, alertas inteligentes y resumen de equipo.',
        outcome:
          'Visibilidad inmediata de colocación, recuperación, morosidad PAR y metas operativas.',
        tags: ['KPIs', 'DOP/USD', 'Widgets', 'Tablero'],
      },
      {
        sectionId: 'platform_control',
        title: 'AxyCore Platform Control',
        summary:
          'Consola SaaS exclusiva del Superadministrador para gestionar empresas clientes, planes comerciales, licencias y catálogo de 34 módulos.',
        mechanism:
          'Control de dependencias entre módulos, validación de límites de usuarios y almacenamiento, y conmutación entre los 3 portales.',
        outcome:
          'Gobierno multitenant escalable sin duplicar despliegues ni mezclar datos entre financieras.',
        tags: ['SaaS', 'Multiempresa', 'Licencias', 'Superadmin'],
      },
      {
        sectionId: 'system_guide',
        title: 'Guía de AxyCore',
        summary:
          'Mapa interactivo del sistema con inventario de funcionalidades, flujos operativos, matriz de roles y acceso directo a pantallas autorizadas.',
        mechanism:
          'Sincronizado en vivo con el catálogo de módulos, permisos RBAC de la sesión y licencias activas de la organización.',
        outcome:
          'Incorporación rápida de personal y demostración clara del alcance completo del sistema.',
        tags: ['Documentación', 'Mapa', 'Onboarding'],
      },
    ],
  },
  {
    id: 'prestamos',
    order: '02',
    title: 'Préstamos y Originación Crediticia',
    subtitle: 'Ciclo completo desde la simulación hasta el préstamo activo desembolsado',
    domain: 'CREDITO_CLIENTES',
    purpose:
      'Estandarizar la originación, evaluación cuantitativa, aprobación colegiada, formalización legal y desembolso idempotente.',
    keyGuarantee:
      'Segregación estricta de funciones: quien origina o evalúa no puede aprobar en Comité ni ejecutar el desembolso.',
    items: [
      {
        sectionId: 'new_application',
        title: 'Nueva Solicitud',
        summary:
          'Registro de solicitudes para personas físicas o jurídicas en DOP o USD con productos Personales y Empresariales.',
        mechanism:
          'Validación de duplicados por Cédula/RNC/Pasaporte, captura de ingresos, deudas declaradas, referencias y carga documental.',
        outcome:
          'Expediente estructurado listo para evaluación automática sin omisiones de campos críticos.',
        tags: ['Originación', 'Solicitud', 'Personal', 'Empresarial'],
      },
      {
        sectionId: 'loan_calculator',
        title: 'Calculadora de Préstamos',
        summary:
          'Simulador financiero integrado con las bandas y parámetros vigentes del Motor de Decisiones V2.',
        mechanism:
          'Soporta tasas estándar o Motor V2, frecuencias Diaria/Semanal/Quincenal/Mensual, Saldo Insoluto o Interés Fijo, modalidad solo interés y tasa de venta BCRD en vivo.',
        outcome:
          'Cotizaciones exactas de cuota, gastos de cierre y cronograma imprimible o exportable antes de originar.',
        tags: ['Simulador', 'BCRD', 'Amortización', 'Motor V2'],
      },
      {
        sectionId: 'applications',
        title: 'Solicitudes Recibidas',
        summary:
          'Bandeja central de seguimiento con detalle 360° lateral por expediente y trazabilidad de estados.',
        mechanism:
          'Filtra por etapa (Borrador, Recibida, En Evaluación, En Comité, Aprobada, Devuelta, Formalizada, Desembolsada) con validación previa en Firestore.',
        outcome:
          'Control operativo de tiempos de respuesta y cero expedientes perdidos entre departamentos.',
        tags: ['Bandeja', 'Estados', 'Expediente'],
      },
      {
        sectionId: 'decision_engine',
        title: 'Motor de Decisiones V2',
        summary:
          'Motor determinístico de 22 indicadores ponderados (0–100 pts) con sandbox de simulación y cola de pre-evaluación.',
        mechanism:
          'Calcula DTI, flujo disponible, relación cuota/ingreso y clasifica cada caso en 6 bandas de riesgo (Muy Bajo a Crítico) según políticas versionadas.',
        outcome:
          'Preofertas reproducibles, transparentes y libres de sesgos manuales en la originación.',
        tags: ['Scoring V2', 'DTI', 'Bandas', 'Sandbox'],
      },
      {
        sectionId: 'evaluation',
        title: 'Evaluación Crediticia',
        summary:
          'Mesa de trabajo para Analistas de Crédito y Oficiales de Riesgo con depuración de cifras verificadas.',
        mechanism:
          'Checklist de identidad, ingresos, deudas y referencias, lectura OCR documental, recálculo de Motor V2, informe técnico y dictamen independiente de Riesgo.',
        outcome:
          'Expediente auditado y sustentado antes de someterse a votación del Comité.',
        tags: ['Análisis', 'OCR', 'Dictamen', 'Riesgo'],
      },
      {
        sectionId: 'committee',
        title: 'Comité de Crédito',
        summary:
          'Instancia de resolución colegiada o individual regida por la matriz de facultades y monto aprobado.',
        mechanism:
          'Registra aprobaciones, aprobaciones condicionadas, devoluciones o rechazos inmutables respetando los límites de autoridad de cada miembro.',
        outcome:
          'Gobierno de crédito trazable con control automático de atribuciones por monto y banda.',
        tags: ['Comité', 'Aprobación', 'Facultades'],
      },
      {
        sectionId: 'formalization',
        title: 'Formalización',
        summary:
          'Control contractual y documental previo a liberar fondos de préstamos aprobados.',
        mechanism:
          'Verifica cumplimiento de condiciones del Comité, pagarés notariales, garantías y firma de contratos.',
        outcome:
          'Habilitación jurídica segura para pasar a la etapa de desembolso.',
        tags: ['Contratos', 'Pagaré', 'Legal'],
      },
      {
        sectionId: 'disbursements',
        title: 'Desembolso',
        summary:
          'Ejecución controlada e idempotente de entregas de fondos para solicitudes formalizadas.',
        mechanism:
          'Crea el registro oficial del préstamo activo, genera automáticamente todas las cuotas contractuales y evita dobles desembolsos.',
        outcome:
          'Inicio exacto del calendario de pagos con trazabilidad financiera y contable.',
        tags: ['Desembolso', 'Cuotas', 'Idempotencia'],
      },
      {
        sectionId: 'loans',
        title: 'Préstamos Activos',
        summary:
          'Consulta de cartera desembolsada con saldo de capital, estado de cuotas, historial y cierre/cancelación.',
        mechanism:
          'Permite inspeccionar la tabla de amortización real, pagos aplicados y emitir certificado de cancelación cuando el saldo llega a cero.',
        outcome:
          'Control completo del ciclo de vida de cada contrato activo y cancelado.',
        tags: ['Cartera', 'Amortización', 'Cancelación'],
      },
      {
        sectionId: 'credit_dashboard',
        title: 'Mapa de Riesgo y Originación',
        summary:
          'Analítica visual del embudo de originación y distribución de riesgo de solicitudes.',
        mechanism:
          'Cruza volumen por banda de riesgo, tasa de conversión por etapa y exposición por producto o moneda.',
        outcome:
          'Ajuste oportuno de apetito de riesgo y políticas comerciales.',
        tags: ['Mapa de Calor', 'Embudo', 'Riesgo'],
      },
    ],
  },
  {
    id: 'clientes',
    order: '03',
    title: 'Clientes y Expedientes Digitales',
    subtitle: 'Base única KYC de personas físicas, empresas y bóveda documental',
    domain: 'CREDITO_CLIENTES',
    purpose:
      'Mantener una ficha maestra unificada por cliente sin duplicidad de documentos de identidad y con soporte documental verificado.',
    keyGuarantee:
      'Prevención automática de clientes duplicados por organización mediante índice único de Cédula, Pasaporte o RNC.',
    items: [
      {
        sectionId: 'customers',
        title: 'Todos los Clientes',
        summary:
          'Directorio consolidado de solicitantes individuales y empresariales con búsqueda instantánea.',
        mechanism:
          'Consolida perfil demográfico, actividad económica, historial de solicitudes y préstamos vigentes.',
        outcome:
          'Visión única del cliente para atención comercial, análisis y recuperación.',
        tags: ['KYC', 'Personas', 'Empresas'],
      },
      {
        sectionId: 'customers_active',
        title: 'Clientes Activos',
        summary: 'Filtro operativo de clientes con operaciones activas o vigentes en la institución.',
        mechanism: 'Segmentación automática sobre el maestro de clientes según estado de cartera.',
        outcome: 'Seguimiento focalizado de la base productiva.',
        tags: ['Segmentación', 'Activos'],
      },
      {
        sectionId: 'customers_inactive',
        title: 'Clientes Inactivos',
        summary: 'Clientes sin operaciones vigentes disponibles para campañas de reactivación o consulta histórica.',
        mechanism: 'Clasificación automática preservando todo su historial crediticio y de pagos.',
        outcome: 'Trazabilidad histórica intacta sin contaminar métricas de cartera activa.',
        tags: ['Histórico', 'Inactivos'],
      },
      {
        sectionId: 'customers_update',
        title: 'Actualizar Datos de Clientes',
        summary:
          'Módulo dedicado para actualizar teléfonos, dirección, vivienda, ingresos y datos laborales o comerciales.',
        mechanism:
          'Registra modificaciones controladas con auditoría de usuario y fecha sobre el expediente maestro.',
        outcome:
          'Contactabilidad vigente para cobranza preventiva y reevaluaciones de crédito.',
        tags: ['Mantenimiento', 'Contacto', 'Auditoría'],
      },
      {
        sectionId: 'documents',
        title: 'Expedientes Digitales',
        summary:
          'Bóveda documental por cliente y solicitud con clasificación, estado de revisión y extracción OCR.',
        mechanism:
          'Permite validar u observar documentos y ejecutar análisis asistido sobre identificaciones y comprobantes.',
        outcome:
          'Respaldo digital auditable y reducción de errores manuales en verificación.',
        tags: ['Bóveda', 'OCR', 'Documentos'],
      },
    ],
  },
  {
    id: 'cartera',
    order: '04',
    title: 'Cobros y Recuperación de Cartera',
    subtitle: 'Colas por prioridad, ficha 360°, acuerdos, pagos y corte diario de mora',
    domain: 'COBROS_CONTACT',
    purpose:
      'Maximizar la recuperación temprana y judicial mediante colas priorizadas, seguimiento de promesas, aplicación contable exacta de pagos y automatización omnicanal.',
    keyGuarantee:
      'Separación entre quien reporta o gestiona un pago y quien lo verifica y aplica contablemente según prelación oficial.',
    items: [
      {
        sectionId: 'cobranza_portfolio',
        title: 'Clientes en Cobros (Ficha 360°)',
        summary:
          'Vista integral de cartera en cobro con DPD exactos, buckets PAR 1/7/30/60/90, saldos exigibles y acceso al cajón 360°.',
        mechanism:
          'Integra cuotas vencidas, historial de gestiones, promesas vigentes, alertas Centinela y cronograma completo en un solo panel.',
        outcome:
          'El gestor conoce todo el contexto del deudor antes de realizar el contacto.',
        tags: ['Ficha 360°', 'DPD', 'PAR', 'Cartera'],
      },
      {
        sectionId: 'cobranza_daily',
        title: 'Cobros del Día',
        summary: 'Cola priorizada de cuentas con cuotas exigibles hoy, promesas que vencen en la jornada o atraso temprano.',
        mechanism: 'Motor determinístico de priorización filtrado por gestor asignado cuando aplica.',
        outcome: 'Enfoque diario inmediato en el recaudo exigible de mayor probabilidad.',
        tags: ['Cola Diaria', 'Prioridad'],
      },
      {
        sectionId: 'cobranza_urgent',
        title: 'Cobros Urgentes',
        summary: 'Cuentas con deterioro acelerado, promesas incumplidas o mora intermedia que requieren acción inmediata.',
        mechanism: 'Escalado automático basado en días de atraso y señales de incumplimiento.',
        outcome: 'Contención oportuna antes de traspasar a mora crítica o legal.',
        tags: ['Urgente', 'Mora'],
      },
      {
        sectionId: 'cobranza_legal',
        title: 'Cobros en Legal',
        summary: 'Expedientes en etapa de cobranza judicial o pre-jurídica con saldo vencido crítico.',
        mechanism: 'Agrupa casos que superaron el umbral configurado en Parámetros de Cobranza.',
        outcome: 'Control diferenciado para recuperación legal y seguimiento de acuerdos.',
        tags: ['Legal', 'Judicial'],
      },
      {
        sectionId: 'cobranza_actions',
        title: 'Gestiones de Cobros',
        summary: 'Bitácora general de llamadas, mensajes, visitas y resultados de gestión sobre toda la cartera.',
        mechanism: 'Estandariza canales, resultados de contacto y próximo seguimiento comprometido.',
        outcome: 'Trazabilidad completa de la intensidad y efectividad de cobranza.',
        tags: ['Gestiones', 'Seguimiento'],
      },
      {
        sectionId: 'cobranza_agreements_today',
        title: 'Acuerdos del Día',
        summary: 'Acuerdos de pago con cuota o compromiso programado para la fecha actual.',
        mechanism: 'Cruce automático entre calendario de acuerdos y pagos confirmados.',
        outcome: 'Recordatorio y verificación puntual para evitar caídas de acuerdos.',
        tags: ['Acuerdos', 'Vencimiento Hoy'],
      },
      {
        sectionId: 'cobranza_agreements_broken',
        title: 'Acuerdos Incumplidos',
        summary: 'Listado automático de acuerdos de pago vencidos sin recaudo confirmado.',
        mechanism: 'Detección determinística que dispara seguimiento prioritario y alertas.',
        outcome: 'Reacción rápida ante ruptura de convenios reestructurados.',
        tags: ['Incumplidos', 'Alertas'],
      },
      {
        sectionId: 'cobranza_dashboard',
        title: 'Panel de Cobranza',
        summary: 'Resumen ejecutivo del módulo de cobranza con distribución por tramos de mora y tasas de recuperación.',
        mechanism: 'Consolida PAR 1/7/30/60/90, promesas activas y monto recaudado.',
        outcome: 'Lectura gerencial rápida de la salud de recuperación.',
        tags: ['KPIs Cobranza', 'PAR'],
      },
      {
        sectionId: 'cobranza_promises',
        title: 'Todos los Acuerdos y Promesas',
        summary: 'Repositorio completo de promesas de pago y planes de acuerdo formales vigentes, cumplidos o rotos.',
        mechanism: 'Permite crear acuerdos formales estructurados y monitorear su cumplimiento cuota a cuota.',
        outcome: 'Orden formal en negociaciones de pago con clientes en atraso.',
        tags: ['Promesas', 'Convenios'],
      },
      {
        sectionId: 'cobranza_payments',
        title: 'Pagos de Cobranza',
        summary: 'Recepción, verificación y aplicación de abonos con prelación configurable y opción de reverso auditado.',
        mechanism:
          'Soporta evidencia adjunta; al verificar/aplicar imputa Mora › Interés › Capital según política vigente.',
        outcome: 'Saldos exactos y cero pagos aplicados sin respaldo o autorización.',
        tags: ['Pagos', 'Prelación', 'Reversos'],
      },
      {
        sectionId: 'cobranza_bot',
        title: 'AxyRecovery Bot',
        summary: 'Orquestador de campañas preventivas, avisos de vencimiento y recordatorios de promesas multicanal.',
        mechanism: 'Reglas configurables por etapa de mora, plantilla de mensaje y programación de envíos.',
        outcome: 'Automatización de cobranza preventiva reduciendo carga operativa manual.',
        tags: ['Bot', 'Automatización', 'Campañas'],
      },
      {
        sectionId: 'cobranza_my_actions',
        title: 'Mis Gestiones',
        summary: 'Vista filtrada con las gestiones y tareas asignadas exclusivamente al usuario conectado.',
        mechanism: 'Filtra en tiempo real por collectorId del usuario autenticado.',
        outcome: 'Productividad enfocada para cada gestor individual.',
        tags: ['Gestor', 'Productividad'],
      },
      {
        sectionId: 'cobranza_agenda',
        title: 'Agenda de Seguimiento',
        summary: 'Calendario cronológico de compromisos de llamada, promesas y recordatorios próximos.',
        mechanism: 'Ordena automáticamente las tareas pendientes por fecha y urgencia.',
        outcome: 'Cumplimiento disciplinado de citas y seguimientos pactados.',
        tags: ['Agenda', 'Calendario'],
      },
      {
        sectionId: 'cobranza_unidentified',
        title: 'Pagos por Identificar',
        summary: 'Bandeja de excepciones bancarias o depósitos sin cliente o préstamo asignado.',
        mechanism: 'Aísla partidas conciliatorias pendientes hasta su vinculación o resolución formal.',
        outcome: 'Ningún depósito bancario queda sin rastreo ni se aplica al préstamo equivocado.',
        tags: ['Excepciones', 'Depósitos'],
      },
      {
        sectionId: 'cobranza_audit',
        title: 'Auditoría y Cierre Cobranza',
        summary: 'Ejecución de corte diario de mora (DPD/penalidades) y revisión de eventos de cobranza.',
        mechanism: 'Recálculo determinístico de días de atraso e intereses moratorios con bitácora.',
        outcome: 'Cierre diario consistente entre cartera operativa, tesorería y contabilidad.',
        tags: ['Corte Diario', 'Mora', 'Cierre'],
      },
    ],
  },
  {
    id: 'contact_center',
    order: '05',
    title: 'Contact Center',
    subtitle: 'Productividad de gestores, contactabilidad y cumplimiento de promesas',
    domain: 'COBROS_CONTACT',
    purpose:
      'Medir el desempeño operativo del equipo de gestión telefónica y omnicanal con indicadores objetivos por agente y período.',
    keyGuarantee:
      'Métricas calculadas directamente sobre gestiones registradas, promesas pactadas y pagos efectivamente aplicados.',
    items: [
      {
        sectionId: 'cobranza_contact_center',
        title: 'Contact Center KPIs',
        summary:
          'Tablero independiente de rendimiento con tasa de contactabilidad, promesas logradas, cumplimiento efectivo y ranking por gestor.',
        mechanism:
          'Cruza volumen de contactos efectivos contra promesas cumplidas y monto recuperado por usuario.',
        outcome:
          'Supervisión justa basada en recuperación real confirmada, no solo volumen de llamadas.',
        tags: ['Contactabilidad', 'KPIs', 'Gestores'],
      },
    ],
  },
  {
    id: 'operaciones',
    order: '06',
    title: 'Operaciones, Contabilidad y Facturación DGII',
    subtitle: 'Contabilidad de partida doble, conciliación bancaria y e-CF Ley 32-23',
    domain: 'CONTABILIDAD_DGII',
    purpose:
      'Integrar la operación financiera diaria (cobros, gastos, inversionistas) con libros contables formales, conciliación bancaria y facturación electrónica oficial ante la DGII.',
    keyGuarantee:
      'Validación XSD oficial antes de firmar XMLDSig y trazabilidad de cada comprobante fiscal e-NCF hacia asientos contables.',
    items: [
      {
        sectionId: 'accounting',
        title: 'Panel de Contabilidad',
        summary: 'Centro contable general con balanza resumida, estado de resultados del período y accesos a libros.',
        mechanism: 'Consolida automáticamente movimientos de desembolsos, pagos aplicados, gastos e impuestos.',
        outcome: 'Cierre financiero continuo sin re-digitación entre cartera y contabilidad.',
        tags: ['Contabilidad', 'Resumen', 'Balance'],
      },
      {
        sectionId: 'accounting_chart_of_accounts',
        title: 'Plan de Cuentas',
        summary: 'Catálogo contable jerárquico (Activo, Pasivo, Patrimonio, Ingresos, Costos y Gastos).',
        mechanism: 'Soporta cuentas configurables por organización para el mapeo automático de asientos.',
        outcome: 'Estructura contable adaptada a normativa financiera y fiscal local.',
        tags: ['Catálogo', 'Cuentas'],
      },
      {
        sectionId: 'accounting_journal_entries',
        title: 'Asientos Contables',
        summary: 'Registro y consulta de asientos de partida doble con cuadre estricto Débito = Crédito.',
        mechanism: 'Generación automática por eventos del sistema y captura manual supervisada.',
        outcome: 'Integridad contable verificada en cada movimiento financiero.',
        tags: ['Partida Doble', 'Asientos'],
      },
      {
        sectionId: 'accounting_daily_book',
        title: 'Libro Diario',
        summary: 'Registro cronológico completo de todos los asientos contabilizados.',
        mechanism: 'Filtros por rango de fechas, origen del asiento y exportación de respaldo.',
        outcome: 'Pista cronológica formal ante revisiones internas o auditorías.',
        tags: ['Libro Diario', 'Cronológico'],
      },
      {
        sectionId: 'accounting_general_ledger',
        title: 'Libro Mayor',
        summary: 'Saldos y movimientos acumulados por cada cuenta contable.',
        mechanism: 'Calcula saldo inicial, débitos, créditos y saldo final por cuenta del catálogo.',
        outcome: 'Control exacto de saldos contables para conciliación y cierre.',
        tags: ['Libro Mayor', 'Saldos'],
      },
      {
        sectionId: 'accounting_receivables',
        title: 'Cuentas por Cobrar',
        summary: 'Auxiliar contable de cartera de capital, intereses y comisiones exigibles por cobrar.',
        mechanism: 'Sincronizado con el estado real de préstamos desembolsados y pagos aplicados.',
        outcome: 'Conciliación directa entre auxiliar de cartera y contabilidad.',
        tags: ['CxC', 'Cartera'],
      },
      {
        sectionId: 'accounting_payables',
        title: 'Cuentas por Pagar',
        summary: 'Control de obligaciones con proveedores, acreedores e inversionistas pendientes de pago.',
        mechanism: 'Integra gastos operativos registrados y compromisos de fondeo.',
        outcome: 'Planificación precisa de egresos y tesorería.',
        tags: ['CxP', 'Obligaciones'],
      },
      {
        sectionId: 'accounting_taxes',
        title: 'Impuestos',
        summary: 'Control de ITBIS facturado/soportado, retenciones y obligaciones tributarias del período.',
        mechanism: 'Enlazado directamente con los comprobantes electrónicos emitidos y recibidos.',
        outcome: 'Preparación ordenada de declaraciones fiscales mensuales.',
        tags: ['ITBIS', 'Impuestos', 'Fiscal'],
      },
      {
        sectionId: 'accounting_payment_validation',
        title: 'Pagos para Validar',
        summary: 'Mesa de validación financiera para aprobar o rechazar comprobantes reportados por caja, gestores o clientes.',
        mechanism:
          'Permite inspeccionar evidencia adjunta y ejecutar la aplicación contable definitiva al préstamo.',
        outcome: 'Doble control tesorería–cartera antes de afectar saldos oficiales.',
        tags: ['Validación', 'Tesorería', 'Comprobantes'],
      },
      {
        sectionId: 'cobranza_reconciliation',
        title: 'Conciliación Bancaria',
        summary: 'Cruce entre extractos bancarios cargados y pagos registrados dentro del módulo de Contabilidad.',
        mechanism: 'Empareja referencias, montos y fechas identificando partidas en tránsito o excepciones.',
        outcome: 'Bancos cuadrados contra libros y pagos confirmados con respaldo bancario.',
        tags: ['Bancos', 'Extractos', 'Cruce'],
      },
      {
        sectionId: 'accounting_statements',
        title: 'Reportes Contables',
        summary: 'Estados Financieros formales: Balance General, Estado de Resultados y Balanza de Comprobación.',
        mechanism: 'Calculados en tiempo real sobre asientos contabilizados y exportables.',
        outcome: 'Información financiera lista para gerencia, junta e inversionistas.',
        tags: ['Balance General', 'Resultados', 'Balanza'],
      },
      {
        sectionId: 'ecf_dashboard',
        title: 'Facturación Electrónica DGII (Dashboard e-CF)',
        summary:
          'Subsistema completo dentro de Contabilidad conforme a la Ley 32-23 de República Dominicana.',
        mechanism:
          'Indicadores mensuales de e-CF emitidos, ITBIS, estados aceptados/rechazados/pendientes y disponibilidad de secuencias e-NCF.',
        outcome: 'Control fiscal centralizado multitenant sin salir de AxyCore.',
        tags: ['DGII', 'Ley 32-23', 'e-CF'],
      },
      {
        sectionId: 'ecf_emit',
        title: 'Emitir Factura Electrónica (Tipos 31–47)',
        summary:
          'Generador de comprobantes 31, 32, 33, 34, 41, 43, 44, 45, 46 y 47 con validación XSD previa a la firma digital.',
        mechanism:
          'Verifica habilitación de tipo de comprobante, asigna e-NCF, calcula ITBIS/descuentos, valida XML contra XSD DGII y firma con certificado.',
        outcome: 'Emisión fiscal sin errores de esquema ni duplicidad de secuencias.',
        tags: ['31', '32', 'XSD', 'XMLDSig'],
      },
      {
        sectionId: 'ecf_issued',
        title: 'Facturas Emitidas',
        summary: 'Repositorio de e-CF emitidos con descarga XML, representación impresa y emisión de notas de ajuste.',
        mechanism: 'Permite generar Notas de Crédito (34) o Débito (33) prellenadas desde cualquier factura original.',
        outcome: 'Gestión documental y fiscal ordenada para clientes y auditores.',
        tags: ['Emitidas', 'XML', 'e-NCF'],
      },
      {
        sectionId: 'ecf_received',
        title: 'Facturas Recibidas',
        summary: 'Recepción, validación técnica y aprobación comercial de e-CF emitidos por suplidores.',
        mechanism: 'Registra acuse de recibo y aprobación o rechazo comercial conforme al flujo DGII.',
        outcome: 'Respaldo válido de costos y créditos fiscales para formato 606.',
        tags: ['Recibidas', 'Suplidores', 'Aprobación Comercial'],
      },
      {
        sectionId: 'ecf_credit_notes',
        title: 'Notas de Crédito Electrónicas (34)',
        summary: 'Ajustes fiscales por devoluciones, descuentos posteriores o anulación parcial de e-CF.',
        mechanism: 'Referencia obligatoria al e-NCF modificado y ajuste automático de impuestos y cuentas.',
        outcome: 'Cumplimiento estricto en reversos o rebajas fiscales.',
        tags: ['Tipo 34', 'Crédito Fiscal'],
      },
      {
        sectionId: 'ecf_debit_notes',
        title: 'Notas de Débito Electrónicas (33)',
        summary: 'Cargos fiscales adicionales vinculados a comprobantes previamente emitidos.',
        mechanism: 'Validación de referencia original, recálculo de ITBIS y envío a DGII.',
        outcome: 'Trazabilidad completa de recargos o ajustes al alza.',
        tags: ['Tipo 33', 'Débito Fiscal'],
      },
      {
        sectionId: 'ecf_dgii_status',
        title: 'Consulta de Estado DGII',
        summary: 'Seguimiento por TrackID de comprobantes pendientes, aceptados, aceptados condicionales o rechazados.',
        mechanism: 'Consulta el endpoint de estado DGII sin simular respuestas oficiales.',
        outcome: 'Resolución ágil de comprobantes en tránsito o con observaciones.',
        tags: ['TrackID', 'Estados DGII'],
      },
      {
        sectionId: 'ecf_void',
        title: 'Anulaciones e-NCF',
        summary: 'Anulación controlada de secuencias no utilizadas o comprobantes según reglas tributarias.',
        mechanism: 'Genera registro de anulación de rangos e inhabilita reutilización indebida.',
        outcome: 'Integridad continua de secuencias autorizadas.',
        tags: ['Anulaciones', 'Secuencias'],
      },
      {
        sectionId: 'ecf_customers',
        title: 'Clientes y Receptores Fiscales',
        summary: 'Catálogo de receptores con RNC o Cédula, razón social y dirección fiscal.',
        mechanism: 'Reutiliza clientes de AxyCore o registra receptores comerciales adicionales.',
        outcome: 'Emisión ágil sin errores de identificación tributaria.',
        tags: ['Receptores', 'RNC'],
      },
      {
        sectionId: 'ecf_products',
        title: 'Productos y Servicios Fiscales',
        summary: 'Catálogo de bienes, servicios e intereses con configuración de tasa ITBIS o exención.',
        mechanism: 'Estandariza unidades, precios base y tratamiento impositivo en facturas.',
        outcome: 'Cálculo uniforme de impuestos por línea de factura.',
        tags: ['Catálogo', 'ITBIS'],
      },
      {
        sectionId: 'ecf_sequences',
        title: 'Secuencias e-NCF',
        summary: 'Administración de rangos autorizados por tipo de comprobante, fecha de vencimiento y alertas de agotamiento.',
        mechanism: 'Control atómico de consecutivo e-NCF por empresa emisora.',
        outcome: 'Cero colisiones ni emisión con secuencias vencidas.',
        tags: ['e-NCF', 'Rangos'],
      },
      {
        sectionId: 'ecf_certificates',
        title: 'Certificados Digitales (.p12 / .pfx)',
        summary: 'Gestión segura de certificados de firma electrónica por entidad emisora.',
        mechanism: 'Control de vigencia, validación criptográfica en servidor y firma XMLDSig.',
        outcome: 'Autenticidad y no repudio de cada documento tributario.',
        tags: ['Certificado', 'Firma Digital', 'XMLDSig'],
      },
      {
        sectionId: 'ecf_config',
        title: 'Configuración DGII',
        summary: 'Parámetros fiscales por empresa: RNC emisor, razón social, tipos habilitados y endpoints DGII.',
        mechanism: 'Aislamiento multitenant para operar múltiples empresas desde la misma plataforma.',
        outcome: 'Cada entidad factura únicamente con los tipos e-CF autorizados para su RNC.',
        tags: ['RNC', 'Multiempresa', 'Configuración'],
      },
      {
        sectionId: 'ecf_sandbox',
        title: 'Ambiente de Pruebas DGII',
        summary: 'Entorno separado de certificación (Pre-Certificación / Pruebas) previo al paso a Producción.',
        mechanism: 'Ejecuta flujo real contra ambiente de pruebas verificando XML, XSD, firma y TrackID.',
        outcome: 'Certificación segura ante DGII sin afectar numeración de producción.',
        tags: ['Sandbox', 'Certificación'],
      },
      {
        sectionId: 'ecf_reports',
        title: 'Reportes Fiscales (606 / 607)',
        summary: 'Generación de resúmenes y reportes tributarios de ventas, compras, ITBIS y anulaciones.',
        mechanism: 'Consolida comprobantes emitidos y recibidos validados por período fiscal.',
        outcome: 'Cumplimiento rápido y verificable de envíos de formatos DGII.',
        tags: ['606', '607', 'Reportes DGII'],
      },
      {
        sectionId: 'ecf_audit',
        title: 'Auditoría y Trazabilidad e-CF',
        summary: 'Registro inmutable de emisiones, firmas, respuestas DGII, TrackIDs y anulaciones.',
        mechanism: 'Bitácora cronológica por usuario, fecha, documento y hash XML.',
        outcome: 'Evidencia fiscal completa ante inspecciones tributarias.',
        tags: ['Trazabilidad', 'Auditoría Fiscal'],
      },
      {
        sectionId: 'register_payment',
        title: 'Registrar Pagos',
        summary: 'Pantalla rápida de caja y ventanilla para reportar cobros recibidos con evidencia.',
        mechanism: 'Envía el comprobante a cola de validación financiera preservando segregación contable.',
        outcome: 'Captura ágil en punto de atención sin demoras.',
        tags: ['Caja', 'Ventanilla', 'Recibo'],
      },
      {
        sectionId: 'register_expense',
        title: 'Registrar Gastos',
        summary: 'Control de gastos operativos con flujo de aprobación y enlace contable.',
        mechanism: 'Registra categoría, proveedor, comprobante y estado de aprobación.',
        outcome: 'Control disciplinado del gasto operativo institucional.',
        tags: ['Egresos', 'Gastos'],
      },
      {
        sectionId: 'register_investor',
        title: 'Registrar Inversionistas',
        summary: 'Gestión de inversionistas, aportes de capital, rendimiento pactado y vencimientos.',
        mechanism: 'Lleva control de fuentes de fondeo de la cartera crediticia.',
        outcome: 'Transparencia sobre pasivos financieros y costos de fondeo.',
        tags: ['Fondeo', 'Inversionistas'],
      },
    ],
  },
  {
    id: 'reportes',
    order: '07',
    title: 'Reportes y Analítica',
    subtitle: 'Exportación ejecutiva, cartera por antigüedad y métricas de recuperación',
    domain: 'INICIO_CONTROL',
    purpose:
      'Entregar reportes listos para gerencia, comité, auditoría y cumplimiento en formatos estructurados.',
    keyGuarantee:
      'Cifras calculadas directamente desde registros reales en Firestore respetando alcance por rol.',
    items: [
      {
        sectionId: 'reports',
        title: 'Reportes y Analítica',
        summary: 'Centro general de reportes de colocación, cartera, bandas de riesgo y exportación PDF/CSV.',
        mechanism: 'Filtros dinámicos por fecha, producto, moneda y estado de operación.',
        outcome: 'Insumos confiables para juntas directivas y toma de decisiones.',
        tags: ['PDF', 'CSV', 'Colocación'],
      },
      {
        sectionId: 'cobranza_reports',
        title: 'Reportes de Cobranza',
        summary: 'Desglose especializado de recuperación, antigüedad PAR, promesas y rendimiento de cobro.',
        mechanism: 'Consolida cuentas en mora, pagos verificados y efectividad de gestiones.',
        outcome: 'Evaluación precisa de estrategias de recuperación por tramo.',
        tags: ['PAR', 'Recuperación', 'Cobranza'],
      },
    ],
  },
  {
    id: 'inteligencia',
    order: '08',
    title: 'Suite de Inteligencia y Decisiones',
    subtitle: 'IA ejecutiva, detección temprana, proyección de flujo y laboratorio ALTERA',
    domain: 'INTELIGENCIA_ADMIN',
    purpose:
      'Pasar de reportes reactivos a decisiones predictivas y prescriptivas mediante inteligencia artificial controlada y motores determinísticos.',
    keyGuarantee:
      'Ningún módulo de inteligencia ejecuta cambios automáticos sobre contratos o pagos sin revisión y aprobación humana autorizada.',
    items: [
      {
        sectionId: 'director',
        title: 'AxyCore Director',
        summary: 'Analista ejecutivo con IA conectado al contexto real de cartera, originación y morosidad.',
        mechanism: 'Genera diagnósticos estratégicos y responde preguntas complejas sobre datos vivos de la empresa.',
        outcome: 'Resúmenes ejecutivos instantáneos con hallazgos accionables.',
        tags: ['IA', 'Estrategia', 'Diagnóstico'],
      },
      {
        sectionId: 'bela',
        title: 'Asistente Bela',
        summary: 'Asistente financiera virtual accesible en todo momento desde el widget flotante o menú.',
        mechanism: 'Consulta datos autorizados de la sesión, presenta hechos verificados y sugiere accesos directos seguros.',
        outcome: 'Soporte operativo inmediato para cualquier usuario según sus permisos.',
        tags: ['Asistente IA', 'Copiloto', 'Ayuda'],
      },
      {
        sectionId: 'intelligence_dashboard',
        title: 'Inteligencia de Motor',
        summary: 'Monitoreo estadístico del Motor de Decisiones V2 y comportamiento de aprobaciones.',
        mechanism: 'Analiza distribución de puntajes, tasas de preoferta y causales frecuentes de rechazo o observación.',
        outcome: 'Calibración continua de políticas crediticias basada en datos reales.',
        tags: ['Motor V2', 'Estadística'],
      },
      {
        sectionId: 'cobranza_sentinel',
        title: 'Centinela',
        summary: 'Motor de vigilancia de anomalías operativas, promesas rotas reiteradas y alertas tempranas.',
        mechanism: 'Evalúa patrones de riesgo y dispara alertas activas con acceso directo desde la barra superior.',
        outcome: 'Detección temprana de fraude, desvíos operativos o deterioro súbito.',
        tags: ['Alertas', 'Anomalías', 'Fraude'],
      },
      {
        sectionId: 'cobranza_anticipate',
        title: 'Anticípate',
        summary: 'Proyección determinística de flujo de caja esperado y escenarios de mora a 30, 60 y 90 días.',
        mechanism: 'Calcula recaudación proyectada ponderando vencimientos contractuales y comportamiento de pago.',
        outcome: 'Planeación anticipada de liquidez y cobertura de riesgo.',
        tags: ['Flujo 30/60/90d', 'Liquidez', 'Proyección'],
      },
      {
        sectionId: 'intelligence_altera',
        title: 'ALTERA · Laboratorio de Decisiones Inteligentes',
        summary:
          'Ingeniería crediticia adaptativa: Gemelo Digital Crediticio, ADN Financiero, Motor de Universos Alternativos y Plan B Preventivo.',
        mechanism:
          'Simula abonos extraordinarios, cambios de fecha de pago, reestructuraciones y reducciones temporales mostrando impacto financiero exacto frente al escenario actual, con aprobación humana obligatoria.',
        outcome:
          'Mejor recuperación de cartera con decisiones simuladas y trazables sin alterar contratos reales durante el análisis.',
        tags: ['Gemelo Digital', 'ADN Financiero', 'Universos Alternativos', 'Plan B'],
      },
      {
        sectionId: 'regula',
        title: 'AxyCore REGULA · Cumplimiento, Riesgos y Control',
        summary:
          'Centro de inteligencia regulatoria, cumplimiento normativo dominicano, PLAFTPADM (Ley 155-17), matriz de riesgos 5×5, control interno, auditoría, evidencias, incidentes, planes de acción y REGULA AI.',
        mechanism:
          'Centraliza normativas, obligaciones, expedientes KYC/DDC, controles, hallazgos y planes correctivos con validación humana obligatoria, bitácora inmutable y reportes ejecutivos.',
        outcome:
          'Gobierno institucional verificable, trazabilidad de evidencias y respuesta preventiva ante brechas regulatorias.',
        tags: ['Cumplimiento', 'PLAFTPADM', 'Riesgos 5×5', 'Auditoría', 'REGULA AI'],
      },
      {
        sectionId: 'system_sitemap',
        title: 'Mapa del Sistema',
        summary:
          'Visualización interactiva de la arquitectura completa de AxyCore con dominios, flujos de datos y acceso directo a cada pantalla.',
        mechanism:
          'Construye en tiempo real el grafo de los 9 dominios, 13 flujos inter-módulo, volúmenes vivos y permisos RBAC/licencia de la sesión.',
        outcome:
          'Navegación directa a cualquier sección y comprensión inmediata de cómo se conectan originación, cobros, contabilidad, DGII e inteligencia.',
        tags: ['Arquitectura', 'Sitemap', 'Flujos', 'Navegación'],
      },
      {
        sectionId: 'intelligence_impulsa',
        title: 'Impulsa — Motor Inteligente de Crecimiento Crediticio',
        summary:
          'Detecta oportunidades reales de renovación anticipada, crecimiento crediticio, recuperación de clientes inactivos, venta cruzada y refinanciamiento responsable.',
        mechanism:
          'Analiza clientes, préstamos, cuotas, pagos, capacidad de pago, políticas vigentes y alertas Centinela; gestiona 14 estados CRM y convierte directamente a solicitudes evaluadas por Motor V2.',
        outcome:
          'Mayor colocación crediticia responsable, retención de mejores pagadores y trazabilidad comercial hasta desembolso.',
        tags: ['Crecimiento', 'Renovación', 'CRM Comercial', 'IA'],
      },
    ],
  },
  {
    id: 'administracion',
    order: '09',
    title: 'Administración, Políticas y Auditoría',
    subtitle: 'Roles RBAC, parámetros crediticios y de cobranza, asignación y bitácora inmutable',
    domain: 'INTELIGENCIA_ADMIN',
    purpose:
      'Configurar las reglas del negocio sin programar código: políticas de crédito, cobranza, usuarios, seguridad y trazabilidad completa.',
    keyGuarantee:
      'Versionamiento de políticas (crediticias y de cobranza) y registro inmutable de cada cambio crítico en la bitácora de auditoría.',
    items: [
      {
        sectionId: 'admin_users',
        title: 'Usuarios',
        summary: 'Alta, invitación por correo, activación/desactivación y asignación de rol por colaborador.',
        mechanism: 'Controlado contra el límite de usuarios del plan comercial contratado.',
        outcome: 'Gestión segura de accesos internos con trazabilidad individual.',
        tags: ['Equipo', 'Invitaciones'],
      },
      {
        sectionId: 'admin_roles',
        title: 'Roles y Permisos (15 Perfiles RBAC)',
        summary: 'Matriz transparente de los 15 roles del sistema y sus 43 permisos operativos.',
        mechanism: 'Aplica separación de funciones en originación, comité, pagos, DGII e inteligencia.',
        outcome: 'Cero conflictos de interés y mínimo privilegio garantizado.',
        tags: ['RBAC', 'Permisos', 'SoD'],
      },
      {
        sectionId: 'policies',
        title: 'Parámetros Crediticios',
        summary: 'Versionamiento de reglas globales de Motor V2, pesos de indicadores y límites DTI.',
        mechanism: 'Permite probar nuevas políticas antes de activarlas en producción.',
        outcome: 'Gobierno flexible del apetito de riesgo institucional.',
        tags: ['Políticas', 'Motor V2'],
      },
      {
        sectionId: 'admin_risk_bands',
        title: 'Bandas de Riesgo y Tasas',
        summary: 'Definición de rangos de puntaje y tasas de interés/comisiones asociadas a cada banda.',
        mechanism: 'Se integra directamente con la Calculadora de Préstamos y el Motor V2.',
        outcome: 'Precios consistentes ajustados al riesgo real del solicitante.',
        tags: ['Tasas', 'Bandas'],
      },
      {
        sectionId: 'admin_product_limits',
        title: 'Límites de Productos',
        summary: 'Montos mínimos/máximos, plazos permitidos y reglas por producto DOP/USD.',
        mechanism: 'Valida automáticamente solicitudes y reestructuraciones en origen.',
        outcome: 'Contención automática de operaciones fuera de política.',
        tags: ['Productos', 'Topes'],
      },
      {
        sectionId: 'admin_approval_matrix',
        title: 'Facultades de Aprobación',
        summary: 'Límites de monto y riesgo autorizados por rol o miembro de Comité.',
        mechanism: 'Bloquea decisiones que excedan la atribución asignada al usuario.',
        outcome: 'Control jerárquico automático sobre aprobaciones de alto monto.',
        tags: ['Atribuciones', 'Comité'],
      },
      {
        sectionId: 'admin_workflow',
        title: 'Flujo de Aprobación',
        summary: 'Reglas de escalamiento, condiciones previas y transiciones válidas del expediente.',
        mechanism: 'Define los requisitos obligatorios entre Evaluación, Riesgo, Comité y Formalización.',
        outcome: 'Disciplina de proceso en toda la organización.',
        tags: ['Workflow', 'Etapas'],
      },
      {
        sectionId: 'cobranza_assignment',
        title: 'Asignación de Cartera',
        summary: 'Distribución y reasignación de cuentas en cobranza entre gestores y supervisores.',
        mechanism: 'Balanceo de carga operativa y actualización inmediata de colas individuales.',
        outcome: 'Responsabilidad clara sobre cada préstamo en recuperación.',
        tags: ['Asignación', 'Gestores'],
      },
      {
        sectionId: 'cobranza_params',
        title: 'Parámetros de Cobranza',
        summary: 'Configuración de orden de imputación (Mora › Interés › Capital), días de gracia, umbrales legales y tasas de mora.',
        mechanism: 'Políticas versionadas aplicadas por el motor de pagos y cierre diario.',
        outcome: 'Reglas de recuperación uniformes y verificables.',
        tags: ['Imputación', 'Mora', 'Parámetros'],
      },
      {
        sectionId: 'admin_settings',
        title: 'Configuración Institucional',
        summary: 'Datos generales de la entidad financiera, moneda base, marca y parámetros operativos.',
        mechanism: 'Personaliza el espacio corporativo manteniendo compatibilidad multitenant.',
        outcome: 'Identidad institucional reflejada en reportes, contratos y portales.',
        tags: ['Institución', 'Marca'],
      },
      {
        sectionId: 'audit',
        title: 'Auditoría General',
        summary: 'Bitácora cronológica inmutable de eventos críticos en crédito, pagos, políticas y seguridad.',
        mechanism: 'Registra actor, rol, fecha/hora, entidad afectada y resumen de cambios sin permitir borrado.',
        outcome: 'Cumplimiento regulatorio y revisión forense inmediata.',
        tags: ['Bitácora', 'Inmutable', 'Cumplimiento'],
      },
    ],
  },
];

export const SYSTEM_GUIDE_FLOWS: GuideEndToEndFlow[] = [
  {
    id: 'origination_to_disbursement',
    title: '01. Originación hasta Desembolso del Préstamo',
    subtitle: 'Del simulador o solicitud hasta la creación de cuotas contractuales',
    estimatedTouchpoints: '7 etapas controladas',
    steps: [
      {
        stepNumber: '01',
        title: 'Simulación con Parámetros Reales',
        sectionId: 'loan_calculator',
        participatingRoles: ['BUSINESS_OFFICER', 'CREDIT_ANALYST', 'EXTERNAL_CLIENT', 'ADMIN'],
        whatHappens:
          'Se calcula cuota, gastos y tabla de amortización con tasa estándar o directamente con las bandas del Motor V2 y tasa BCRD.',
        controlGate: 'Consistencia entre tasa simulada, moneda DOP/USD y límites de producto vigentes.',
      },
      {
        stepNumber: '02',
        title: 'Captura de Solicitud y Documentos',
        sectionId: 'new_application',
        participatingRoles: ['BUSINESS_OFFICER', 'EXTERNAL_CLIENT', 'ADMIN'],
        whatHappens:
          'Se registra el solicitante (verificando duplicidad por Cédula/RNC), ingresos, deudas y expedientes digitales iniciales.',
        controlGate: 'Validación de completitud mínima en Firestore antes de pasar a análisis.',
      },
      {
        stepNumber: '03',
        title: 'Evaluación Automática en Motor V2',
        sectionId: 'decision_engine',
        participatingRoles: ['CREDIT_ANALYST', 'RISK_OFFICER', 'ADMIN'],
        whatHappens:
          'El motor evalúa 22 indicadores ponderados (0–100 pts), calcula DTI y asigna banda de riesgo con preoferta.',
        controlGate: 'Cálculo determinístico trazable; bloquea expedientes sin datos suficientes.',
      },
      {
        stepNumber: '04',
        title: 'Depuración Analítica y Dictamen de Riesgo',
        sectionId: 'evaluation',
        participatingRoles: ['CREDIT_ANALYST', 'RISK_OFFICER', 'ADMIN'],
        whatHappens:
          'El analista verifica documentos (con soporte OCR), depura ingresos/gastos reales y el Oficial de Riesgo emite dictamen independiente.',
        controlGate: 'Checklist obligatorio y segregación entre Analista y Oficial de Riesgo.',
      },
      {
        stepNumber: '05',
        title: 'Resolución en Comité de Crédito',
        sectionId: 'committee',
        participatingRoles: ['COMMITTEE_MEMBER', 'ADMIN'],
        whatHappens:
          'Se aprueba, condiciona, devuelve o rechaza el expediente según la matriz de facultades.',
        controlGate: 'El usuario que originó o evaluó el caso no puede aprobarlo.',
      },
      {
        stepNumber: '06',
        title: 'Formalización Legal',
        sectionId: 'formalization',
        participatingRoles: ['FORMALIZATION', 'ADMIN'],
        whatHappens:
          'Validación de contratos, pagarés notariales, garantías y cumplimiento de condiciones previas.',
        controlGate: 'Solo solicitudes aprobadas pueden formalizarse.',
      },
      {
        stepNumber: '07',
        title: 'Desembolso e Inicio de Cartera Activa',
        sectionId: 'disbursements',
        participatingRoles: ['OPERATIONS', 'FINANCE', 'ADMIN'],
        whatHappens:
          'Se ejecuta el desembolso idempotente, nace el préstamo activo y se generan las cuotas contractuales.',
        controlGate: 'Prevención de doble desembolso y enlace directo a Préstamos Activos y Contabilidad.',
      },
    ],
  },
  {
    id: 'collections_to_reconciliation',
    title: '02. Cobranza, Pagos y Conciliación Bancaria',
    subtitle: 'Gestión de mora, promesas, verificación contable y cierre diario',
    estimatedTouchpoints: '6 etapas controladas',
    steps: [
      {
        stepNumber: '01',
        title: 'Priorización Diaria de Cartera',
        sectionId: 'cobranza_daily',
        participatingRoles: ['COLLECTION_AGENT', 'SUPERVISOR', 'COLLECTION_COORDINATOR'],
        whatHappens:
          'Los gestores atienden colas del día, urgentes o legales apoyados en la Ficha 360° de cada préstamo.',
        controlGate: 'Asignación segmentada por cartera y visibilidad de DPD/PAR exactos.',
      },
      {
        stepNumber: '02',
        title: 'Registro de Gestiones, Promesas y Bot',
        sectionId: 'cobranza_actions',
        participatingRoles: ['COLLECTION_AGENT', 'SUPERVISOR', 'COLLECTION_COORDINATOR'],
        whatHappens:
          'Se documenta cada contacto, se pactan promesas o acuerdos y AxyRecovery Bot ejecuta recordatorios preventivos.',
        controlGate: 'Detección automática de promesas o acuerdos incumplidos.',
      },
      {
        stepNumber: '03',
        title: 'Reporte de Pago con Comprobante',
        sectionId: 'register_payment',
        participatingRoles: ['CASHIER', 'COLLECTION_AGENT', 'EXTERNAL_CLIENT', 'FINANCE'],
        whatHappens:
          'Caja, gestores o el cliente desde su portal reportan el abono adjuntando comprobante digital.',
        controlGate: 'El pago entra en estado pendiente de verificación sin alterar saldos todavía.',
      },
      {
        stepNumber: '04',
        title: 'Validación y Aplicación por Prelación',
        sectionId: 'accounting_payment_validation',
        participatingRoles: ['FINANCE', 'ADMIN'],
        whatHappens:
          'Finanzas valida el comprobante y aplica el pago siguiendo el orden oficial (Mora › Interés › Capital).',
        controlGate: 'Segregación entre quien reporta y quien aplica; reversos solo con permiso especial auditado.',
      },
      {
        stepNumber: '05',
        title: 'Conciliación Bancaria',
        sectionId: 'cobranza_reconciliation',
        participatingRoles: ['FINANCE', 'COLLECTION_COORDINATOR', 'ADMIN'],
        whatHappens:
          'Cruce de extractos bancarios contra pagos aplicados y aislamiento de depósitos en Pagos por Identificar.',
        controlGate: 'Evita duplicidades y cuadra bancos contra auxiliar de pagos.',
      },
      {
        stepNumber: '06',
        title: 'Corte Diario y Métricas Contact Center',
        sectionId: 'cobranza_audit',
        participatingRoles: ['COLLECTION_COORDINATOR', 'SUPERVISOR', 'MANAGEMENT', 'AUDITOR'],
        whatHappens:
          'Actualización de DPD/mora del día y lectura de efectividad de gestores en Contact Center KPIs.',
        controlGate: 'Bitácora inmutable de cierres y eventos.',
      },
    ],
  },
  {
    id: 'accounting_and_dgii',
    title: '03. Ciclo Contable y Facturación Electrónica DGII (Ley 32-23)',
    subtitle: 'Emisión e-CF validada por XSD, firma digital y registro contable integrado',
    estimatedTouchpoints: '6 etapas controladas',
    steps: [
      {
        stepNumber: '01',
        title: 'Configuración Fiscal, Secuencias e-NCF y Certificado',
        sectionId: 'ecf_config',
        participatingRoles: ['FINANCE', 'ADMIN'],
        whatHappens:
          'Se configuran RNC emisor, tipos e-CF autorizados, secuencias e-NCF vigentes y certificado digital (.p12/.pfx).',
        controlGate: 'Bloquea emisión de tipos no autorizados o con secuencias agotadas/vencidas.',
      },
      {
        stepNumber: '02',
        title: 'Validación en Ambiente de Pruebas DGII',
        sectionId: 'ecf_sandbox',
        participatingRoles: ['FINANCE', 'OPERATIONS', 'ADMIN'],
        whatHappens:
          'Pruebas de certificación sobre XML, firma digital XMLDSig y comunicación real en ambiente de pruebas.',
        controlGate: 'Separación estricta entre ambiente de Pruebas y Producción.',
      },
      {
        stepNumber: '03',
        title: 'Emisión de Comprobantes Electrónicos (31–47)',
        sectionId: 'ecf_emit',
        participatingRoles: ['FINANCE', 'OPERATIONS', 'ADMIN'],
        whatHappens:
          'Generación del documento XML e-CF, validación automática contra esquema XSD oficial de DGII, firma digital y envío.',
        controlGate: 'No se firma ni envía ningún comprobante que falle validación XSD.',
      },
      {
        stepNumber: '04',
        title: 'Consulta de Estado TrackID y Notas 33/34',
        sectionId: 'ecf_dgii_status',
        participatingRoles: ['FINANCE', 'OPERATIONS', 'MANAGEMENT', 'ADMIN'],
        whatHappens:
          'Seguimiento de respuestas DGII, recepción de facturas de suplidores (e-CF recibidos) y emisión de Notas de Crédito/Débito.',
        controlGate: 'Trazabilidad completa sin simular respuestas oficiales.',
      },
      {
        stepNumber: '05',
        title: 'Asientos Automáticos, Libros y Conciliación',
        sectionId: 'accounting_journal_entries',
        participatingRoles: ['FINANCE', 'OPERATIONS', 'ADMIN'],
        whatHappens:
          'Registro en Asientos Contables (partida doble), Libro Diario, Libro Mayor, CxC, CxP e Impuestos.',
        controlGate: 'Validación de cuadre Débito = Crédito en cada póliza.',
      },
      {
        stepNumber: '06',
        title: 'Reportes Fiscales (606/607) y Estados Financieros',
        sectionId: 'ecf_reports',
        participatingRoles: ['FINANCE', 'MANAGEMENT', 'AUDITOR', 'ADMIN'],
        whatHappens:
          'Consolidación de reportes tributarios, Balance General, Estado de Resultados y Auditoría e-CF.',
        controlGate: 'Bitácora fiscal inmutable lista para inspección.',
      },
    ],
  },
  {
    id: 'altera_intelligence_cycle',
    title: '04. Inteligencia Predictiva y Prescriptiva con ALTERA + Suite IA',
    subtitle: 'Del Gemelo Digital y Universos Alternativos a intervenciones aprobadas por humanos',
    estimatedTouchpoints: '5 etapas controladas',
    steps: [
      {
        stepNumber: '01',
        title: 'Diagnóstico Ejecutivo y Alertas Tempranas',
        sectionId: 'director',
        participatingRoles: ['MANAGEMENT', 'RISK_OFFICER', 'SUPERVISOR', 'ADMIN'],
        whatHappens:
          'AxyCore Director, Centinela y Anticípate detectan concentración de riesgo, anomalías y proyección de flujo a 30/60/90 días.',
        controlGate: 'Lectura 100% basada en datos reales de la organización activa.',
      },
      {
        stepNumber: '02',
        title: 'Gemelo Digital Crediticio y ADN Financiero',
        sectionId: 'intelligence_altera',
        participatingRoles: ['CREDIT_ANALYST', 'RISK_OFFICER', 'COLLECTION_COORDINATOR', 'MANAGEMENT'],
        whatHappens:
          'ALTERA construye el perfil dinámico de cada préstamo y cliente (puntualidad, deterioro, capacidad y refinanciamientos).',
        controlGate: 'No inventa ingresos ni datos externos inexistentes.',
      },
      {
        stepNumber: '03',
        title: 'Simulación en Motor de Universos Alternativos',
        sectionId: 'intelligence_altera',
        participatingRoles: ['CREDIT_ANALYST', 'RISK_OFFICER', 'COLLECTION_COORDINATOR', 'ADMIN'],
        whatHappens:
          'Se prueban escenarios combinados (abono extraordinario, cambio de fecha, reestructuración, alivio temporal) frente al escenario actual.',
        controlGate: 'Simulación 100% no destructiva; valida límites de política institucional.',
      },
      {
        stepNumber: '04',
        title: 'Plan B Preventivo y Propuesta a Comité/Supervisión',
        sectionId: 'intelligence_altera',
        participatingRoles: ['RISK_OFFICER', 'SUPERVISOR', 'COLLECTION_COORDINATOR', 'MANAGEMENT'],
        whatHappens:
          'Las señales tempranas y simulaciones favorables se convierten en recomendaciones formales pendientes de revisión humana.',
        controlGate: 'Requiere aprobación explícita de rol facultado antes de aplicarse.',
      },
      {
        stepNumber: '05',
        title: 'Seguimiento de Impacto Real y Retroalimentación',
        sectionId: 'intelligence_altera',
        participatingRoles: ['RISK_OFFICER', 'COLLECTION_COORDINATOR', 'MANAGEMENT', 'AUDITOR'],
        whatHappens:
          'Se compara la proyección simulada contra el desempeño efectivo del crédito para calibrar políticas ALTERA.',
        controlGate: 'Auditor puede inspeccionar en modo estricto de solo lectura.',
      },
    ],
  },
];

export const SYSTEM_GUIDE_PORTALS: GuidePortalDefinition[] = [
  {
    id: 'corporate',
    name: 'Portal Corporativo',
    audience: 'Equipo interno de cada entidad financiera (14 roles internos)',
    purpose:
      'Operación integral diaria de originación, evaluación, comité, desembolsos, clientes, cobranza, contabilidad, DGII e inteligencia.',
    capabilities: [
      'Menú lateral adaptado dinámicamente al rol RBAC y módulos contratados de la empresa.',
      'Búsqueda global instantánea (Ctrl/⌘ + K) sobre clientes, solicitudes, préstamos 360°, pagos, documentos y módulos.',
      'Notificaciones en tiempo real de comité, promesas incumplidas y alertas Centinela.',
      'Tema claro/oscuro persistente, asistente Bela contextual y soporte PWA offline.',
    ],
  },
  {
    id: 'client',
    name: 'Portal de Clientes',
    audience: 'Clientes externos autenticados (rol EXTERNAL_CLIENT)',
    purpose:
      'Autoservicio transparente para que el solicitante consulte sus préstamos, calendario de cuotas y gestione solicitudes o reportes de pago.',
    capabilities: [
      'Consulta en línea de préstamos vigentes, saldo de capital y próximo vencimiento.',
      'Reporte de pagos realizados adjuntando foto o PDF del comprobante bancario.',
      'Calculadora de Préstamos integrada y creación de nuevas solicitudes o renovaciones.',
      'Aislamiento estricto: el cliente solo accede a sus propios registros.',
    ],
  },
  {
    id: 'axycore_admin',
    name: 'AxyCore Platform Control (SaaS)',
    audience: 'Superadministrador propietario de la plataforma AxyCore',
    purpose:
      'Gobierno central multitenant para incorporar nuevas financieras, asignar planes comerciales, gestionar licencias y habilitar los 34 módulos.',
    capabilities: [
      'Alta de nuevas organizaciones con código de acceso, RNC, plan y límites.',
      'Activación/desactivación modular validando dependencias técnicas en tiempo real.',
      'Control de licencias (Activa, Próxima a Vencer, Vencida, Suspendida) y membresías multi-empresa.',
      'Consola consolidada de uso y auditoría transversal de la plataforma.',
    ],
  },
];

export const SYSTEM_TECHNICAL_PILLARS: GuideTechnicalPillar[] = [
  {
    id: 'multitenant',
    title: 'Arquitectura Multiempresa Aislada',
    scope: 'Firestore + Reglas de Seguridad + Motor Multi-Tenant',
    detail:
      'Cada entidad financiera opera en su propio tenant con datos segregados por organizationId, planes comerciales y control de licencias por módulo.',
    relatedSection: 'platform_control',
  },
  {
    id: 'motor_v2',
    title: 'Motor Determinístico V2 (22 Indicadores)',
    scope: 'Originación + Calculadora + Evaluación',
    detail:
      'Calcula puntaje ponderado (0–100), DTI, flujo disponible y bandas de precio sin caja negra, permitiendo reproducir y explicar cada resultado.',
    relatedSection: 'decision_engine',
  },
  {
    id: 'rbac_sod',
    title: '15 Roles RBAC y Segregación de Funciones',
    scope: 'Crédito + Pagos + DGII + ALTERA',
    detail:
      '43 permisos granulares evitan conflictos de interés entre originar, evaluar, aprobar en comité, desembolsar, reportar pagos y aplicarlos.',
    relatedSection: 'admin_roles',
  },
  {
    id: 'dgii_law',
    title: 'Cumplimiento Tributario DGII · Ley 32-23',
    scope: 'Contabilidad + e-CF + XMLDSig + XSD',
    detail:
      'Valida la estructura XML contra esquemas XSD oficiales antes de firmar con certificado digital .p12/.pfx, controlando secuencias e-NCF y trazabilidad.',
    relatedSection: 'ecf_dashboard',
  },
  {
    id: 'security_bio',
    title: 'Autenticación Verificada, Biometría WebAuthn y Auditoría',
    scope: 'Seguridad de Sesión y Cumplimiento',
    detail:
      'Exige verificación de correo, ofrece bloqueo rápido con Face ID / Huella / Passkey del dispositivo y registra bitácoras inmutables de eventos.',
    relatedSection: 'audit',
  },
  {
    id: 'ux_pwa',
    title: 'PWA Instalable, Búsqueda ⌘K y Tema Dual',
    scope: 'Experiencia Operativa',
    detail:
      'Instalable como aplicación de escritorio/móvil con indicador offline, comandos rápidos con teclado y tema claro/oscuro persistente en localStorage.',
    relatedSection: 'dashboard',
  },
];

export function filterSystemGuideAreas(params: {
  areas?: GuideFunctionalArea[];
  query: string;
  domain: GuideDomainCategory;
}): GuideFunctionalArea[] {
  const { areas = SYSTEM_GUIDE_AREAS, query, domain } = params;
  const q = query.trim().toLowerCase();

  return areas
    .filter((area) => domain === 'ALL' || area.domain === domain)
    .map((area) => {
      if (!q) return area;
      const areaMatches =
        area.title.toLowerCase().includes(q) ||
        area.subtitle.toLowerCase().includes(q) ||
        area.purpose.toLowerCase().includes(q);
      if (areaMatches) return area;

      const matchedItems = area.items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          item.mechanism.toLowerCase().includes(q) ||
          item.outcome.toLowerCase().includes(q) ||
          item.tags.some((t) => t.toLowerCase().includes(q))
      );
      return { ...area, items: matchedItems };
    })
    .filter((area) => area.items.length > 0);
}

export function computeGuideAccessSummary(params: {
  areas?: GuideFunctionalArea[];
  canAccessSection: (sectionId: NavSectionId) => boolean;
  isSectionLicensed?: (sectionId: NavSectionId) => boolean;
}): {
  totalAreas: number;
  totalScreens: number;
  accessibleScreens: number;
  restrictedByRoleOrLicense: number;
} {
  const {
    areas = SYSTEM_GUIDE_AREAS,
    canAccessSection,
    isSectionLicensed = () => true,
  } = params;

  const allItems = areas.flatMap((a) => a.items);
  let accessible = 0;
  for (const item of allItems) {
    if (canAccessSection(item.sectionId) && isSectionLicensed(item.sectionId)) {
      accessible += 1;
    }
  }
  return {
    totalAreas: areas.length,
    totalScreens: allItems.length,
    accessibleScreens: accessible,
    restrictedByRoleOrLicense: Math.max(0, allItems.length - accessible),
  };
}
