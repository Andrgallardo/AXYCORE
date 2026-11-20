import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  computeRegulaDashboardKpis,
  REGULA_INCIDENT_TYPE_LABELS,
  REGULA_REPORT_CATALOG,
  REGULA_RISK_CATEGORY_LABELS,
} from './regulaEngine';
import type {
  RegulaReportCode,
  RegulaReportFilters,
  RegulaWorkspaceData,
} from '../types/regula';

export interface RegulaReportDataset {
  code: RegulaReportCode;
  title: string;
  subtitle: string;
  generatedAtIso: string;
  organizationName: string;
  generatedByName: string;
  appliedFiltersSummary: string;
  dataSources: string[];
  summaryLines: string[];
  columns: string[];
  rows: string[][];
}

function matchesCommonFilters(
  item: {
    branch?: string;
    department?: string;
    processArea?: string;
    auditedArea?: string;
    responsibleName?: string;
    ownerName?: string;
    assignedToName?: string;
    category?: string;
    status?: string;
    dueDate?: string;
    occurredAt?: string;
    evaluationDate?: string;
    residualLevel?: string;
    severity?: string;
    criticality?: string;
  },
  filters: RegulaReportFilters
): boolean {
  if (filters.branch && (item.branch || '').toLowerCase() !== filters.branch.toLowerCase()) {
    return false;
  }
  const area = item.department || item.processArea || item.auditedArea || '';
  if (filters.department && !area.toLowerCase().includes(filters.department.toLowerCase())) {
    return false;
  }
  const resp = item.responsibleName || item.ownerName || item.assignedToName || '';
  if (filters.responsible && !resp.toLowerCase().includes(filters.responsible.toLowerCase())) {
    return false;
  }
  if (filters.category && !(item.category || '').toLowerCase().includes(filters.category.toLowerCase())) {
    return false;
  }
  if (filters.status && (item.status || '').toUpperCase() !== filters.status.toUpperCase()) {
    return false;
  }
  const riskOrSev = item.residualLevel || item.severity || item.criticality || '';
  if (filters.riskLevel && riskOrSev.toUpperCase() !== filters.riskLevel.toUpperCase()) {
    return false;
  }
  const dateVal = (item.dueDate || item.occurredAt || item.evaluationDate || '').slice(0, 10);
  if (filters.dateFrom && dateVal && dateVal < filters.dateFrom) return false;
  if (filters.dateTo && dateVal && dateVal > filters.dateTo) return false;
  return true;
}

export function buildRegulaReportDataset(params: {
  reportCode: RegulaReportCode;
  data: RegulaWorkspaceData;
  filters: RegulaReportFilters;
  organizationName: string;
  generatedByName: string;
  todayIso: string;
}): RegulaReportDataset {
  const { reportCode, data, filters, organizationName, generatedByName, todayIso } = params;
  const meta = REGULA_REPORT_CATALOG.find((r) => r.code === reportCode);
  const kpis = computeRegulaDashboardKpis(data, todayIso);
  const generatedAtIso = new Date().toISOString();

  const filterParts: string[] = [];
  if (filters.branch) filterParts.push(`Sucursal: ${filters.branch}`);
  if (filters.department) filterParts.push(`Área: ${filters.department}`);
  if (filters.responsible) filterParts.push(`Responsable: ${filters.responsible}`);
  if (filters.dateFrom || filters.dateTo) {
    filterParts.push(`Período: ${filters.dateFrom || 'Inicio'} a ${filters.dateTo || 'Actual'}`);
  }
  if (filters.category) filterParts.push(`Categoría: ${filters.category}`);
  if (filters.riskLevel) filterParts.push(`Nivel: ${filters.riskLevel}`);
  if (filters.status) filterParts.push(`Estado: ${filters.status}`);

  const base: Omit<RegulaReportDataset, 'summaryLines' | 'columns' | 'rows' | 'dataSources'> = {
    code: reportCode,
    title: meta?.title || reportCode,
    subtitle: meta?.description || 'Reporte institucional de AxyCore REGULA',
    generatedAtIso,
    organizationName,
    generatedByName,
    appliedFiltersSummary: filterParts.length > 0 ? filterParts.join(' · ') : 'Sin filtros restrictivos (alcance institucional completo)',
  };

  switch (reportCode) {
    case 'CUMPLIMIENTO_GENERAL': {
      const list = data.obligaciones.filter((o) => !o.deletedAt && matchesCommonFilters(o, filters));
      return {
        ...base,
        dataSources: ['regula_obligaciones', 'regula_normativas'],
        summaryLines: [
          `Índice General de Cumplimiento: ${kpis.generalComplianceIndexPct !== null ? `${kpis.generalComplianceIndexPct}%` : 'Sin obligaciones aplicables'}`,
          `Obligaciones listadas: ${list.length} · Cumplidas: ${list.filter((o) => o.status === 'CUMPLIDA').length} · Vencidas: ${list.filter((o) => o.status === 'VENCIDA').length}`,
        ],
        columns: ['Código', 'Obligación', 'Regulador', 'Área', 'Responsable', 'Frecuencia', 'Vencimiento', 'Criticidad', 'Estado', '%'],
        rows: list.map((o) => [
          o.code, o.title, o.regulator, o.department, o.responsibleName, o.frequency, o.dueDate || '—', o.criticality, o.status, `${o.compliancePct}%`,
        ]),
      };
    }

    case 'OBLIGACIONES_VENCIDAS_PROXIMAS': {
      const list = data.obligaciones
        .filter((o) => !o.deletedAt && o.status !== 'CUMPLIDA' && o.status !== 'NO_APLICABLE' && matchesCommonFilters(o, filters))
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      return {
        ...base,
        dataSources: ['regula_obligaciones'],
        summaryLines: [
          `Obligaciones vencidas: ${kpis.overdueObligationsCount} · Próximas a vencer (≤30d): ${kpis.upcomingObligationsCount}`,
        ],
        columns: ['Código', 'Obligación', 'Regulador', 'Vencimiento', 'Responsable', 'Área', 'Criticidad', 'Estado', 'Evidencias'],
        rows: list.map((o) => [
          o.code, o.title, o.regulator, o.dueDate || '—', o.responsibleName, o.department, o.criticality, o.status, String(o.linkedEvidenceIds?.length || 0),
        ]),
      };
    }

    case 'MATRIZ_APLICABILIDAD': {
      const list = data.aplicabilidad.filter((a) => !a.deletedAt && matchesCommonFilters({ status: a.approvalStatus }, filters));
      return {
        ...base,
        dataSources: ['regula_aplicabilidad', 'regula_normativas'],
        summaryLines: [
          `Evaluaciones de aplicabilidad: ${list.length} · Aprobadas: ${list.filter((a) => a.approvalStatus === 'APROBADA').length}`,
        ],
        columns: ['Normativa', 'Tipo Entidad', 'Supervisor', 'Jurisdicción', 'Decisión', 'Aprobación', 'Justificación'],
        rows: list.map((a) => [
          `${a.normativaCode} · ${a.normativaTitle}`, a.entityType, a.supervisor, a.jurisdiction, a.decision, a.approvalStatus, a.justification,
        ]),
      };
    }

    case 'MATRIZ_RIESGOS': {
      const list = data.riesgos.filter((r) => !r.deletedAt && matchesCommonFilters(r, filters));
      return {
        ...base,
        dataSources: ['regula_matriz_riesgos', 'regula_controles'],
        summaryLines: [
          `Riesgos registrados: ${list.length} · Críticos: ${list.filter((r) => r.residualLevel === 'CRITICO').length} · Altos: ${list.filter((r) => r.residualLevel === 'ALTO').length}`,
          `Exposición Institucional Residual: ${kpis.institutionalRiskExposureScore !== null ? `${kpis.institutionalRiskExposureScore}/100` : 'Sin evaluar'}`,
        ],
        columns: ['Código', 'Riesgo', 'Categoría', 'Área', 'Dueño', 'Inherente', 'Residual', 'Nivel', 'Tratamiento', 'Estado'],
        rows: list.map((r) => [
          r.code,
          r.name,
          REGULA_RISK_CATEGORY_LABELS[r.category] || r.category,
          r.processArea,
          r.ownerName,
          `${r.inherentScore} (${r.inherentProbability}×${r.inherentImpact})`,
          `${r.residualScore} (${r.residualProbability}×${r.residualImpact})`,
          r.residualLevel,
          r.treatmentStrategy,
          r.status,
        ]),
      };
    }

    case 'MAPA_CALOR_RIESGOS': {
      const list = data.riesgos.filter((r) => !r.deletedAt && r.status !== 'CERRADO' && matchesCommonFilters(r, filters));
      return {
        ...base,
        dataSources: ['regula_matriz_riesgos'],
        summaryLines: [
          `Distribución 5×5 de ${list.length} riesgos activos (coordenadas Probabilidad × Impacto).`,
        ],
        columns: ['Código', 'Riesgo', 'Categoría', 'Prob. Inh.', 'Imp. Inh.', 'Score Inh.', 'Prob. Res.', 'Imp. Res.', 'Score Res.', 'Zona Residual'],
        rows: list.map((r) => [
          r.code, r.name, r.category, String(r.inherentProbability), String(r.inherentImpact), String(r.inherentScore),
          String(r.residualProbability), String(r.residualImpact), String(r.residualScore), r.residualLevel,
        ]),
      };
    }

    case 'CONTROLES_EFECTIVIDAD': {
      const list = data.controles.filter((c) => !c.deletedAt && matchesCommonFilters(c, filters));
      return {
        ...base,
        dataSources: ['regula_controles', 'regula_pruebas_control'],
        summaryLines: [
          `Controles registrados: ${list.length} · Efectividad promedio: ${kpis.controlEffectivenessPct !== null ? `${kpis.controlEffectivenessPct}%` : 'Sin pruebas'}`,
          `Debilidades abiertas: ${list.filter((c) => c.weaknessIdentified).length}`,
        ],
        columns: ['Código', 'Control', 'Naturaleza', 'Automatización', 'Área', 'Responsable', 'Última Prueba', 'Efectividad', 'Debilidad'],
        rows: list.map((c) => [
          c.code, c.name, c.nature, c.automation, c.department, c.ownerName, c.lastTestedDate || 'Pendiente', c.effectiveness, c.weaknessIdentified ? 'Sí' : 'No',
        ]),
      };
    }

    case 'AUDITORIAS_HALLAZGOS': {
      const list = data.hallazgos.filter((h) => !h.deletedAt && matchesCommonFilters(h, filters));
      return {
        ...base,
        dataSources: ['regula_auditorias', 'regula_hallazgos'],
        summaryLines: [
          `Auditorías registradas: ${data.auditorias.filter((a) => !a.deletedAt).length} · Hallazgos listados: ${list.length} · Abiertos: ${list.filter((h) => h.status !== 'CERRADO').length}`,
        ],
        columns: ['Código', 'Auditoría', 'Hallazgo', 'Área', 'Severidad', 'Responsable', 'Vencimiento', 'Estado', 'Reaperturas'],
        rows: list.map((h) => [
          h.code, h.auditoriaCode, h.title, h.auditedArea, h.severity, h.responsibleName, h.dueDate || '—', h.status, String(h.reopenCount || 0),
        ]),
      };
    }

    case 'PLANES_ACCION_ESTADO': {
      const list = data.planesAccion.filter((p) => !p.deletedAt && matchesCommonFilters(p, filters));
      return {
        ...base,
        dataSources: ['regula_planes_accion', 'regula_actividades'],
        summaryLines: [
          `Planes listados: ${list.length} · Activos: ${kpis.activeActionPlansCount} · Vencidos: ${kpis.overdueActionPlansCount} · Cerrados con verificación: ${list.filter((p) => p.status === 'CERRADA').length}`,
        ],
        columns: ['Código', 'Plan de Acción', 'Tipo', 'Origen', 'Área', 'Responsable', 'Vencimiento', 'Avance', 'Verificado', 'Estado'],
        rows: list.map((p) => [
          p.code, p.title, p.actionType, p.originType, p.department, p.responsibleName, p.dueDate || '—', `${p.progressPct}%`, p.effectivenessVerified ? 'Sí' : 'No', p.status,
        ]),
      };
    }

    case 'INCIDENTES_PERDIDAS': {
      const list = data.incidentes.filter((i) => !i.deletedAt && matchesCommonFilters(i, filters));
      const totalEstimated = list.reduce((s, i) => s + (i.estimatedLossAmount || 0), 0);
      const totalActual = list.reduce((s, i) => s + (i.actualLossAmount || 0), 0);
      return {
        ...base,
        dataSources: ['regula_incidentes'],
        summaryLines: [
          `Incidentes registrados: ${list.length} · Abiertos: ${list.filter((i) => i.status !== 'CERRADO').length}`,
          `Pérdida estimada acumulada: ${totalEstimated.toLocaleString('es-DO')} · Pérdida real acumulada: ${totalActual.toLocaleString('es-DO')}`,
        ],
        columns: ['Código', 'Incidente', 'Tipo', 'Fecha', 'Área', 'Severidad', 'Estado', 'Pérdida Est.', 'Pérdida Real', 'Moneda'],
        rows: list.map((i) => [
          i.code, i.title, REGULA_INCIDENT_TYPE_LABELS[i.incidentType] || i.incidentType, i.occurredAt, i.department, i.severity, i.status,
          String(i.estimatedLossAmount || 0), String(i.actualLossAmount || 0), i.currency,
        ]),
      };
    }

    case 'CUMPLIMIENTO_PLAFTPADM': {
      const list = data.kyc.filter((k) => !k.deletedAt && matchesCommonFilters({ status: k.kycStatus, responsibleName: k.reviewerName }, filters));
      return {
        ...base,
        dataSources: ['regula_kyc', 'regula_debida_diligencia', 'regula_beneficiarios_finales', 'regula_perfiles_riesgo'],
        summaryLines: [
          `Fichas KYC: ${list.length} · PEP: ${list.filter((k) => k.isPep).length} · Debidas Diligencias: ${data.debidaDiligencia.filter((d) => !d.deletedAt).length} · Beneficiarios Finales: ${data.beneficiariosFinales.filter((b) => !b.deletedAt).length}`,
        ],
        columns: ['Cliente', 'Documento', 'Tipo', 'Actividad', 'PEP', 'Estado KYC', 'Última Rev.', 'Próxima Rev.', 'Revisor'],
        rows: list.map((k) => [
          k.clientName, k.documentNumber, k.clientType, k.economicActivity, k.isPep ? 'Sí' : 'No', k.kycStatus, k.lastReviewDate, k.nextReviewDate, k.reviewerName,
        ]),
      };
    }

    case 'ALERTAS_CASOS_INVESTIGACION': {
      const casos = data.casosPlaft.filter((c) => !c.deletedAt && matchesCommonFilters(c, filters));
      return {
        ...base,
        dataSources: ['regula_casos_plaft', 'regula_alertas'],
        summaryLines: [
          `Casos PLAFTPADM: ${casos.length} · Activos: ${kpis.plaftActiveAlertsCount} · Alertas del sistema: ${data.alertas.filter((a) => !a.deletedAt && a.status === 'ACTIVA').length}`,
        ],
        columns: ['Código', 'Cliente', 'Origen', 'Título', 'Severidad', 'Estado', 'Asignado', 'Revisión Reporte Ext.', 'Apertura'],
        rows: casos.map((c) => [
          c.code, c.clientName, c.alertOrigin, c.title, c.severity, c.status, c.assignedToName, c.requiresExternalReportReview ? 'Sí (Revisión Humana)' : 'No', c.openedDate,
        ]),
      };
    }

    case 'DOCUMENTOS_VENCIDOS_PENDIENTES': {
      const docs = data.documentos.filter((d) => !d.deletedAt && matchesCommonFilters(d, filters));
      return {
        ...base,
        dataSources: ['regula_documentos', 'regula_evidencias'],
        summaryLines: [
          `Documentos institucionales: ${docs.length} · Evidencias registradas: ${data.evidencias.filter((e) => !e.deletedAt).length} · Vencidos/Pendientes: ${kpis.expiredOrPendingDocumentsCount}`,
        ],
        columns: ['Código', 'Título', 'Tipo', 'Área', 'Versión', 'Vigencia', 'Confidencial', 'Estado', 'Responsable'],
        rows: docs.map((d) => [
          d.code, d.title, d.docType, d.department, d.version, d.expiryDate || 'Sin vencimiento', d.confidential ? 'Sí' : 'No', d.status, d.ownerName,
        ]),
      };
    }

    case 'CAPACITACION_COBERTURA': {
      const caps = data.capacitaciones.filter((c) => !c.deletedAt);
      return {
        ...base,
        dataSources: ['regula_capacitaciones', 'regula_participantes', 'regula_evaluaciones_capacitacion'],
        summaryLines: [
          `Capacitaciones planificadas/realizadas: ${caps.length} · Participantes: ${data.participantes.filter((p) => !p.deletedAt).length} · Cobertura global: ${kpis.trainingCoveragePct !== null ? `${kpis.trainingCoveragePct}%` : 'Sin meta'}`,
        ],
        columns: ['Código', 'Capacitación', 'Tema', 'Año', 'Fecha', 'Modalidad', 'Meta', 'Asistieron', 'Certificados', 'Estado'],
        rows: caps.map((c) => {
          const parts = data.participantes.filter((p) => !p.deletedAt && p.capacitacionId === c.id);
          return [
            c.code, c.title, c.topic, String(c.planYear), c.scheduledDate, c.modality, String(c.targetAudienceCount),
            String(parts.filter((p) => p.attendanceStatus === 'ASISTIO').length),
            String(parts.filter((p) => p.certified).length),
            c.status,
          ];
        }),
      };
    }

    case 'TRAZABILIDAD_AUDITORIA_REGULA': {
      const logs = data.historial.slice(0, 200);
      return {
        ...base,
        dataSources: ['regula_historial', 'regula_aprobaciones', 'regula_ai_consultas'],
        summaryLines: [
          `Eventos de bitácora: ${data.historial.length} · Aprobaciones formales: ${data.aprobaciones.length} · Consultas REGULA AI: ${data.aiConsultas.length}`,
        ],
        columns: ['Fecha / Hora', 'Entidad', 'Código/ID', 'Acción', 'Usuario', 'Rol', 'Detalle'],
        rows: logs.map((l) => [
          l.timestampIso, l.entityType, l.entityCode || l.entityId, l.action, l.actorName, l.actorRole, l.newSummary || '—',
        ]),
      };
    }

    case 'INFORME_EJECUTIVO_DIRECCION':
    case 'INFORME_COMITE_RIESGOS':
    case 'INFORME_COMITE_CUMPLIMIENTO':
    case 'INFORME_COMITE_AUDITORIA': {
      return {
        ...base,
        dataSources: [
          'regula_obligaciones', 'regula_matriz_riesgos', 'regula_controles',
          'regula_auditorias', 'regula_hallazgos', 'regula_planes_accion',
          'regula_incidentes', 'regula_casos_plaft', 'regula_capacitaciones',
        ],
        summaryLines: [
          `Índice de Cumplimiento: ${kpis.generalComplianceIndexPct !== null ? `${kpis.generalComplianceIndexPct}%` : 'Sin datos'} · Exposición Residual de Riesgo: ${kpis.institutionalRiskExposureScore !== null ? `${kpis.institutionalRiskExposureScore}/100` : 'Sin datos'}`,
          `Efectividad de Controles: ${kpis.controlEffectivenessPct !== null ? `${kpis.controlEffectivenessPct}%` : 'Sin pruebas'} · Cobertura Capacitación: ${kpis.trainingCoveragePct !== null ? `${kpis.trainingCoveragePct}%` : 'Sin meta'}`,
        ],
        columns: ['Indicador Institucional', 'Valor Real', 'Observación / Umbral'],
        rows: [
          ['Índice General de Cumplimiento', kpis.generalComplianceIndexPct !== null ? `${kpis.generalComplianceIndexPct}%` : 'Sin datos', `${kpis.fulfilledObligationsCount} de ${kpis.applicableObligationsCount} obligaciones aplicables cumplidas`],
          ['Obligaciones Vencidas', String(kpis.overdueObligationsCount), `${kpis.upcomingObligationsCount} próximas a vencer en ≤30 días`],
          ['Riesgos Activos (Críticos / Altos)', `${kpis.activeRisksCount} (${kpis.criticalRisksCount} Críticos / ${kpis.highRisksCount} Altos)`, `Índice de exposición residual: ${kpis.institutionalRiskExposureScore ?? 'N/A'}`],
          ['Controles Evaluados / Efectividad', `${kpis.evaluatedControlsCount} (${kpis.controlEffectivenessPct !== null ? `${kpis.controlEffectivenessPct}%` : 'N/A'})`, 'Basado en resultados de pruebas de control registradas'],
          ['Hallazgos de Auditoría Abiertos', String(kpis.openFindingsCount), `${kpis.criticalFindingsCount} hallazgo(s) crítico(s) abiertos`],
          ['Planes de Acción Activos / Vencidos', `${kpis.activeActionPlansCount} / ${kpis.overdueActionPlansCount}`, 'Cierre sujeto a verificación de efectividad y aprobación'],
          ['Incidentes de Riesgo Abiertos', String(kpis.openIncidentsCount), 'Eventos en investigación o análisis de causa raíz'],
          ['Alertas / Casos PLAFTPADM Activos', String(kpis.plaftActiveAlertsCount), 'Requieren resolución y aprobación humana'],
          ['Documentos y Evidencias Vencidos/Pendientes', String(kpis.expiredOrPendingDocumentsCount), 'Políticas, manuales y evidencias con vigencia expirada'],
          ['Cobertura de Capacitación', kpis.trainingCoveragePct !== null ? `${kpis.trainingCoveragePct}%` : 'Sin datos', 'Personal capacitado frente a audiencia objetivo'],
        ],
      };
    }
  }
}

export function exportRegulaReportToPdf(dataset: RegulaReportDataset): void {
  const doc = new jsPDF({ orientation: dataset.columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFillColor(4, 12, 30);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 68, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(`AxyCore REGULA — ${dataset.title}`, 36, 30);
  doc.setFontSize(9);
  doc.setTextColor(180, 215, 255);
  doc.text(
    `${dataset.organizationName} · Emitido: ${dataset.generatedAtIso.replace('T', ' ').slice(0, 19)} UTC · Usuario: ${dataset.generatedByName}`,
    36,
    48
  );

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(9);
  let y = 86;
  doc.text(`Filtros aplicados: ${dataset.appliedFiltersSummary}`, 36, y);
  y += 14;
  doc.text(`Fuentes de datos: ${dataset.dataSources.join(', ')}`, 36, y);
  y += 16;

  for (const line of dataset.summaryLines) {
    doc.setFontSize(9.5);
    doc.text(`• ${line}`, 36, y);
    y += 14;
  }

  autoTable(doc, {
    startY: y + 6,
    head: [dataset.columns],
    body: dataset.rows.length > 0 ? dataset.rows : [['Sin registros que coincidan con los filtros aplicados.', ...Array(Math.max(0, dataset.columns.length - 1)).fill('')]],
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [4, 27, 78], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 251] },
    margin: { left: 36, right: 36 },
  });

  doc.save(`AxyCore_REGULA_${dataset.code}_${dataset.generatedAtIso.slice(0, 10)}.pdf`);
}

export function exportRegulaReportToCsv(dataset: RegulaReportDataset): void {
  const escapeCsv = (val: string) => {
    const safe = String(val ?? '').replace(/"/g, '""');
    return /[",\n\r]/.test(safe) ? `"${safe}"` : safe;
  };
  const headerMeta = [
    ['AxyCore REGULA', dataset.title],
    ['Organización', dataset.organizationName],
    ['Emitido por', dataset.generatedByName],
    ['Fecha de emisión', dataset.generatedAtIso],
    ['Filtros aplicados', dataset.appliedFiltersSummary],
    ['Fuentes de datos', dataset.dataSources.join(' | ')],
    [],
  ];
  const lines = [
    ...headerMeta.map((row) => row.map(escapeCsv).join(',')),
    dataset.columns.map(escapeCsv).join(','),
    ...dataset.rows.map((row) => row.map(escapeCsv).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `AxyCore_REGULA_${dataset.code}_${dataset.generatedAtIso.slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
