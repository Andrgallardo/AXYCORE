import type {
  DirectorAnalysisResponse,
  DirectorFocusMode,
  DirectorHealthStatus,
  ExecutiveCurrencyMode,
  ExecutivePeriodPreset,
} from '../../types/axycore';
import { formatTimestamp } from '../../utils/formatters';

export interface FocusModeMeta {
  id: DirectorFocusMode;
  label: string;
  shortLabel: string;
  description: string;
  defaultQuestion: string;
  quickPrompts: Array<{ label: string; question: string }>;
}

export const DIRECTOR_FOCUS_MODES: FocusModeMeta[] = [
  {
    id: 'INTEGRAL',
    label: 'Diagnóstico Integral',
    shortLabel: 'Integral',
    description: 'Visión ejecutiva 360° de cartera, originación, mora y liquidez.',
    defaultQuestion:
      'Realiza un diagnóstico ejecutivo integral sobre la operación del período seleccionado: cartera activa, desembolsos, recuperación aplicada, morosidad PAR, embudo de solicitudes y alertas activas.',
    quickPrompts: [
      {
        label: 'Salud integral del período',
        question:
          'Resume la salud ejecutiva del período: cartera activa DOP/USD, desembolsos, recuperación aplicada, PAR 30 y pendientes críticos.',
      },
      {
        label: 'Prioridades para Junta Directiva',
        question:
          'Prepara un briefing de Junta Directiva con los 3 principales riesgos verificados, 3 oportunidades y el plan de acción inmediato.',
      },
    ],
  },
  {
    id: 'RIESGO_MORA',
    label: 'Morosidad y Riesgo PAR',
    shortLabel: 'Riesgo PAR',
    description: 'Tramos PAR 1/30/60/90, top cuentas vencidas, concentración y Centinela.',
    defaultQuestion:
      'Audita los indicadores PAR 1, PAR 30, PAR 60 y PAR 90, identifica las cuentas en mora con mayor impacto, concentración de cartera, promesas incumplidas y alertas Centinela activas.',
    quickPrompts: [
      {
        label: 'Focos críticos de mora y PAR',
        question:
          'Evalúa PAR 1, PAR 30, PAR 60 y PAR 90, identifica el tramo más vulnerable y prioriza contención sobre las cuentas vencidas más grandes.',
      },
      {
        label: 'Concentración y alertas Centinela',
        question:
          'Analiza la concentración de saldo en los préstamos de mayor exposición y cruza ese riesgo con las alertas Centinela activas.',
      },
    ],
  },
  {
    id: 'ORIGINACION',
    label: 'Embudo y Originación',
    shortLabel: 'Originación',
    description: 'Solicitudes recibidas, tasa de aprobación y cuellos en Comité/Formalización.',
    defaultQuestion:
      'Analiza el embudo de solicitudes de crédito, la tasa de aprobación con su denominador real, los cuellos de botella entre Evaluación, Comité y Formalización, y el ticket promedio.',
    quickPrompts: [
      {
        label: 'Cuellos de botella del embudo',
        question:
          'Detecta en qué etapa del embudo (Evaluación, Comité, Formalización o Desembolso) se acumulan más solicitudes y qué acciones destraban la colocación.',
      },
      {
        label: 'Eficiencia de colocación',
        question:
          'Evalúa la tasa de aprobación, los desembolsos del período y la relación entre solicitudes recibidas y cartera nueva colocada.',
      },
    ],
  },
  {
    id: 'COBRANZA_FLUJO',
    label: 'Cobranza y Flujo',
    shortLabel: 'Cobranza',
    description: 'Recuperación capital/interés, exigibles hoy, validación de pagos y gestores.',
    defaultQuestion:
      'Evalúa la recuperación aplicada del período desglosando capital e intereses, cobros exigibles vs. confirmados hoy, pagos pendientes de validación, conciliación y productividad por gestor.',
    quickPrompts: [
      {
        label: 'Productividad por gestor',
        question:
          'Analiza la recuperación aplicada por gestor, el cumplimiento de cobros exigibles hoy y las brechas frente a promesas vigentes.',
      },
      {
        label: 'Control de pagos y conciliación',
        question:
          'Revisa pagos pendientes de validación, excepciones de conciliación abiertas y composición de capital vs. intereses recaudados.',
      },
    ],
  },
  {
    id: 'ESCENARIOS_STRESS',
    label: 'Escenarios y Stress-Test',
    shortLabel: 'Escenarios',
    description: 'Sensibilidad de mora, metas de recuperación e impacto en flujo sobre datos reales.',
    defaultQuestion:
      'Construye un análisis de escenarios y stress-test ejecutivo basado exclusivamente en las cifras reales actuales: impacto de contener las principales cuentas vencidas, efecto de promesas incumplidas y metas prudentes de recuperación.',
    quickPrompts: [
      {
        label: 'Plan de contención a 30 días',
        question:
          'Diseña un plan realista de contención de mora a 30 días partiendo de los saldos vencidos actuales y el inventario de promesas.',
      },
      {
        label: 'Sensibilidad de cartera en riesgo',
        question:
          'Evalúa el impacto en la cartera activa si las cuentas en tramos tempranos migran a PAR 30+ y qué acciones preventivas priorizar.',
      },
    ],
  },
];

export const PERIOD_OPTIONS: Array<{ value: ExecutivePeriodPreset; label: string }> = [
  { value: 'TODAY', label: 'Hoy' },
  { value: 'LAST_7D', label: '7 días' },
  { value: 'CURRENT_MONTH', label: 'Mes actual' },
  { value: 'LAST_30D', label: '30 días' },
  { value: 'LAST_90D', label: '90 días' },
  { value: 'CURRENT_YEAR', label: 'Año actual' },
];

export const CURRENCY_OPTIONS: Array<{ value: ExecutiveCurrencyMode; label: string }> = [
  { value: 'SEPARATED', label: 'Consolidado RD$' },
  { value: 'DOP', label: 'Solo DOP' },
  { value: 'USD', label: 'Solo USD' },
];

export const HEALTH_META: Record<
  DirectorHealthStatus,
  { label: string; badgeClass: string; borderClass: string }
> = {
  OPTIMA: {
    label: 'Salud Óptima',
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
    borderClass: 'border-emerald-500/35',
  },
  ESTABLE: {
    label: 'Operación Estable',
    badgeClass: 'bg-[#0066FF]/12 text-[#0052CC] dark:text-[#00D1FF] border-[#0066FF]/30',
    borderClass: 'border-[#0066FF]/25',
  },
  ATENCION: {
    label: 'Requiere Atención',
    badgeClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
    borderClass: 'border-amber-500/35',
  },
  CRITICA: {
    label: 'Riesgo Crítico',
    badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35',
    borderClass: 'border-rose-500/35',
  },
};

export const RISK_SEVERITY_META: Record<'CRITICA' | 'ALTA' | 'MEDIA', { label: string; className: string }> = {
  CRITICA: {
    label: 'Crítica',
    className: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  },
  ALTA: {
    label: 'Alta',
    className: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30',
  },
  MEDIA: {
    label: 'Media',
    className: 'bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF] border-[#0066FF]/25',
  },
};

export const ACTION_PRIORITY_META: Record<
  'INMEDIATA' | 'CORTO_PLAZO' | 'ESTRATEGICA',
  { label: string; className: string }
> = {
  INMEDIATA: {
    label: 'Acción Inmediata',
    className: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/30',
  },
  CORTO_PLAZO: {
    label: 'Corto Plazo',
    className: 'bg-amber-500/12 text-amber-800 dark:text-amber-300 border-amber-500/30',
  },
  ESTRATEGICA: {
    label: 'Estratégica',
    className: 'bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF] border-[#0066FF]/25',
  },
};

export function getFocusLabel(mode?: DirectorFocusMode): string {
  return DIRECTOR_FOCUS_MODES.find((m) => m.id === mode)?.shortLabel || 'Integral';
}

export function buildPlainTextBriefing(analysis: DirectorAnalysisResponse, orgName: string): string {
  const lines: string[] = [
    `AXYCORE DIRECTOR — DICTAMEN EJECUTIVO (${orgName})`,
    `Fecha: ${formatTimestamp(analysis.generatedAtIso)}`,
    analysis.periodLabel ? `Período: ${analysis.periodLabel}` : '',
    analysis.currencyScope ? `Moneda: ${analysis.currencyScope}` : '',
    analysis.healthStatus && HEALTH_META[analysis.healthStatus]
      ? `Semáforo Operativo: ${HEALTH_META[analysis.healthStatus].label}`
      : '',
    '',
    analysis.executiveHeadline ? `TITULAR: ${analysis.executiveHeadline}` : '',
    `RESUMEN EJECUTIVO:\n${analysis.executiveSummary}`,
    '',
  ];

  const keyMetrics = Array.isArray(analysis.keyMetricsCited) ? analysis.keyMetricsCited : [];
  if (keyMetrics.length > 0) {
    lines.push('INDICADORES CLAVE VERIFICADOS:');
    keyMetrics.forEach((m) =>
      lines.push(`- ${m.label}: ${m.value}${m.context ? ` (${m.context})` : ''}`)
    );
    lines.push('');
  }

  const verifiedObs = Array.isArray(analysis.verifiedObservations) ? analysis.verifiedObservations : [];
  if (verifiedObs.length > 0) {
    lines.push('OBSERVACIONES VERIFICADAS:');
    verifiedObs.forEach((o) => lines.push(`- ${o}`));
    lines.push('');
  }

  const risks = Array.isArray(analysis.priorityRisks) ? analysis.priorityRisks : [];
  if (risks.length > 0) {
    lines.push('MATRIZ DE RIESGOS PRIORIZADOS:');
    risks.forEach((r) =>
      lines.push(`- [${r.severity}] ${r.title} (${r.area}) — Evidencia: ${r.evidence}. Mitigación: ${r.mitigation}`)
    );
    lines.push('');
  }

  const opps = Array.isArray(analysis.strategicOpportunities) ? analysis.strategicOpportunities : [];
  if (opps.length > 0) {
    lines.push('OPORTUNIDADES ESTRATÉGICAS:');
    opps.forEach((o) =>
      lines.push(`- ${o.title}: ${o.detail} (Impacto: ${o.expectedImpact})`)
    );
    lines.push('');
  }

  const recActions = Array.isArray(analysis.recommendedActions) ? analysis.recommendedActions : [];
  if (recActions.length > 0) {
    lines.push('PLAN DE ACCIÓN RECOMENDADO (SUPERVISIÓN HUMANA):');
    recActions.forEach((a) =>
      lines.push(
        `- [${a.priority || 'CORTO_PLAZO'}] ${a.title}${a.ownerRole ? ` · Responsable: ${a.ownerRole}` : ''}: ${a.detail}`
      )
    );
    lines.push('');
  }

  lines.push('Nota de Gobernanza: AxyCore Director no ejecuta aprobaciones, desembolsos ni modificaciones automáticas de saldos.');
  return lines.filter((line) => line !== undefined).join('\n');
}

/**
 * Dynamically imports jsPDF on demand so PDF generation libraries never bloat
 * the initial Executive Dashboard or AxyCore Director bundle.
 */
export async function exportBriefingToPdf(
  analysis: DirectorAnalysisResponse,
  orgName: string,
  roleLabel: string
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 42;
  const maxWidth = pageWidth - margin * 2;
  let y = 44;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 48) {
      doc.addPage();
      y = 46;
    }
  };

  // Institutional header bar
  doc.setFillColor(4, 12, 30);
  doc.rect(0, 0, pageWidth, 88, 'F');
  doc.setFillColor(0, 184, 255);
  doc.rect(0, 86, pageWidth, 2.5, 'F');

  doc.setTextColor(0, 209, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('AXYCORE DIRECTOR · CENTRO DE INTELIGENCIA EJECUTIVA', margin, 30);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(orgName || 'AxyCore Financiera', margin, 52);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const metaLine = [
    `Generado: ${formatTimestamp(analysis.generatedAtIso)}`,
    analysis.periodLabel ? `Período: ${analysis.periodLabel}` : null,
    analysis.currencyScope ? `Moneda: ${analysis.currencyScope}` : null,
    `Alcance RBAC: ${roleLabel}`,
  ]
    .filter(Boolean)
    .join('  |  ');
  doc.text(metaLine.slice(0, 118), margin, 72);

  y = 112;

  const drawSectionTitle = (title: string) => {
    ensureSpace(34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(4, 27, 78);
    doc.text(title, margin, y);
    y += 6;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
  };

  const drawParagraph = (
    text: string,
    fontSize = 9.5,
    bold = false,
    color: [number, number, number] = [30, 41, 59]
  ) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(color[0], color[1], color[2]);
    const wrapped = doc.splitTextToSize(text, maxWidth);
    const lineHeight = fontSize * 1.42;
    for (const line of wrapped) {
      ensureSpace(lineHeight + 4);
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += 4;
  };

  if (analysis.healthStatus || analysis.executiveHeadline) {
    const statusLabel =
      analysis.healthStatus && HEALTH_META[analysis.healthStatus]
        ? HEALTH_META[analysis.healthStatus].label.toUpperCase()
        : 'DICTAMEN';
    drawParagraph(`[${statusLabel}]  ${analysis.executiveHeadline || 'Dictamen Ejecutivo'}`, 12, true, [4, 27, 78]);
  }

  drawSectionTitle('1. Resumen Ejecutivo Verificado');
  drawParagraph(analysis.executiveSummary, 9.8);

  const pdfKeyMetrics = Array.isArray(analysis.keyMetricsCited) ? analysis.keyMetricsCited : [];
  if (pdfKeyMetrics.length > 0) {
    drawSectionTitle('2. Indicadores Clave Citados');
    pdfKeyMetrics.forEach((m) => {
      drawParagraph(`• ${m.label}: ${m.value}${m.context ? ` — ${m.context}` : ''}`, 9.3);
    });
  }

  const pdfVerifiedObs = Array.isArray(analysis.verifiedObservations) ? analysis.verifiedObservations : [];
  if (pdfVerifiedObs.length > 0) {
    drawSectionTitle('3. Hechos Verificados en Cartera');
    pdfVerifiedObs.forEach((obs) => drawParagraph(`• ${obs}`, 9.3));
  }

  const pdfRisks = Array.isArray(analysis.priorityRisks) ? analysis.priorityRisks : [];
  if (pdfRisks.length > 0) {
    drawSectionTitle('4. Matriz de Riesgos Priorizados');
    pdfRisks.forEach((r) => {
      drawParagraph(`[${r.severity}] ${r.title} (${r.area})`, 9.5, true, [153, 27, 27]);
      if (r.evidence) drawParagraph(`Evidencia: ${r.evidence}`, 9);
      drawParagraph(`Mitigación: ${r.mitigation}`, 9);
    });
  }

  const pdfOpps = Array.isArray(analysis.strategicOpportunities) ? analysis.strategicOpportunities : [];
  if (pdfOpps.length > 0) {
    drawSectionTitle('5. Oportunidades Estratégicas');
    pdfOpps.forEach((o) => {
      drawParagraph(`• ${o.title} — ${o.detail} (Impacto esperado: ${o.expectedImpact})`, 9.3);
    });
  }

  const pdfActions = Array.isArray(analysis.recommendedActions) ? analysis.recommendedActions : [];
  if (pdfActions.length > 0) {
    drawSectionTitle('6. Plan de Acción Recomendado (Supervisión Humana)');
    pdfActions.forEach((a) => {
      drawParagraph(
        `[${a.priority || 'CORTO_PLAZO'}] ${a.title}${a.ownerRole ? ` · Responsable: ${a.ownerRole}` : ''}`,
        9.5,
        true,
        [15, 23, 42]
      );
      drawParagraph(a.detail, 9.1);
    });
  }

  const pdfInferences = Array.isArray(analysis.inferences) ? analysis.inferences : [];
  if (pdfInferences.length > 0) {
    drawSectionTitle('7. Inferencias Analíticas');
    pdfInferences.forEach((inf) => drawParagraph(`• ${inf}`, 9.2));
  }

  const pdfLimits = Array.isArray(analysis.dataLimitations) ? analysis.dataLimitations : [];
  if (pdfLimits.length > 0) {
    drawSectionTitle('8. Limitaciones y Gobernanza');
    pdfLimits.forEach((lim) => drawParagraph(`• ${lim}`, 9));
  }

  ensureSpace(26);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'AxyCore Director opera en modo lectura auditada. Nunca aprueba créditos, desembolsa fondos ni altera saldos automáticamente.',
    margin,
    pageHeight - 24
  );

  const safeDate = (analysis.generatedAtIso || new Date().toISOString()).slice(0, 10);
  doc.save(`AxyCore_Director_Dictamen_${safeDate}.pdf`);
}
