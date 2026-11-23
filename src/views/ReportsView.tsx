import React, { useMemo, useState } from 'react';
import { BarChart3, Download, FileSpreadsheet, FileText, Printer, RefreshCw, Search } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { computeRenewalExecutiveMetrics } from '../engine/renewalEngine';
import {
  APPLICATION_STATUS_LABELS,
  formatMoney,
  formatRatePct,
  formatTimestamp,
  PRODUCT_LABELS,
  RENEWAL_MODALITY_LABELS,
  RENEWAL_STATUS_LABELS,
  SCORING_STATUS_LABELS,
} from '../utils/formatters';
import {
  exportReportToCsv,
  exportReportToPdf,
  type FinancialPerformanceSummary,
} from '../utils/reportExporter';
import type { ProductCode } from '../types/axycore';

type ReportId =
  | 'R00_DESEMPENO_FINANCIERO'
  | 'R01_SOLICITUDES'
  | 'R02_PRECALIFICACION'
  | 'R03_EVALUACION'
  | 'R04_COMITE'
  | 'R05_FORMALIZACIONES'
  | 'R06_DESEMBOLSOS'
  | 'R07_TASAS_MONTOS'
  | 'R08_USUARIOS_PRODUCTIVIDAD'
  | 'R09_AUDITORIA'
  | 'R10_INDICADORES_V2'
  | 'R11_RENOVACIONES';

const REPORT_LIST: Array<{ id: ReportId; title: string; subtitle: string }> = [
  {
    id: 'R00_DESEMPENO_FINANCIERO',
    title: '0. Desempeño Financiero y Crediticio',
    subtitle: 'Consolidado por producto y moneda: tasas de aprobación, montos y cartera activa',
  },
  { id: 'R01_SOLICITUDES', title: '1. Solicitudes por Canal y Estado', subtitle: 'Embudo de originación interna y externa' },
  { id: 'R02_PRECALIFICACION', title: '2. Precalificación Automática V2', subtitle: 'Resultados, bandas y ofertas emitidas por Motor V2' },
  { id: 'R03_EVALUACION', title: '3. Evaluación Crediticia', subtitle: 'Verificación analítica y dictámenes recomendados' },
  { id: 'R04_COMITE', title: '4. Decisiones de Comité', subtitle: 'Resoluciones inmutables, facultades y condiciones' },
  { id: 'R05_FORMALIZACIONES', title: '5. Formalizaciones', subtitle: 'Contratos, pagarés, gastos y neto a desembolsar' },
  { id: 'R06_DESEMBOLSOS', title: '6. Desembolsos Confirmados', subtitle: 'Medios de pago, cuentas enmascaradas y referencias' },
  { id: 'R07_TASAS_MONTOS', title: '7. Tasas, Montos y Plazos', subtitle: 'Condiciones financieras colocadas por producto' },
  { id: 'R08_USUARIOS_PRODUCTIVIDAD', title: '8. Usuarios y Productividad', subtitle: 'Volumen operativo por originador, analista y comité' },
  { id: 'R09_AUDITORIA', title: '9. Auditoría Operativa', subtitle: 'Bitácora consolidada de eventos críticos' },
  { id: 'R10_INDICADORES_V2', title: '10. Análisis de 22 Indicadores V2', subtitle: 'Promedio de puntos obtenidos por indicador en ejecuciones' },
  {
    id: 'R11_RENOVACIONES',
    title: '11. Renovaciones y Reenganches',
    subtitle: 'Monto bruto renovado, saldo liquidado anterior, descuentos y dinero neto nuevo entregado',
  },
];

const APPROVED_STATUSES = new Set([
  'APROBADA',
  'APROBADA_CONDICIONADA',
  'FORMALIZADA',
  'DESEMBOLSADA',
]);

function extractIsoDate(ts: unknown): string {
  if (!ts) return '';
  if (typeof ts === 'string') return ts.slice(0, 10);
  if (typeof ts === 'object' && ts !== null) {
    if ('toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
      return (ts as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
    }
    if ('seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
      return new Date((ts as { seconds: number }).seconds * 1000).toISOString().slice(0, 10);
    }
  }
  return '';
}

function escapeXml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function ReportsView() {
  const {
    applications,
    scoringExecutions,
    evaluations,
    committeeDecisions,
    formalizations,
    disbursements,
    loans,
    creditRenewals,
    auditLogs,
    organization,
    activeOrTestPolicy,
    userProfile,
    rbac,
    setActiveSection,
  } = useAxyCore();

  const [reportId, setReportId] = useState<ReportId>('R00_DESEMPENO_FINANCIERO');
  const [filterCurrency, setFilterCurrency] = useState<'ALL' | 'DOP' | 'USD'>('ALL');
  const [filterProduct, setFilterProduct] = useState<'ALL' | ProductCode>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [exportFeedback, setExportFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null
  );

  const appById = useMemo(() => {
    return new Map(applications.map((a) => [a.id, a]));
  }, [applications]);

  const matchesDateRange = (ts: unknown) => {
    if (!dateFrom && !dateTo) return true;
    const iso = extractIsoDate(ts);
    if (!iso) return true;
    if (dateFrom && iso < dateFrom) return false;
    if (dateTo && iso > dateTo) return false;
    return true;
  };

  const filteredApps = useMemo(() => {
    return applications.filter((a) => {
      if (filterCurrency !== 'ALL' && a.currency !== filterCurrency) return false;
      if (filterProduct !== 'ALL' && a.productCode !== filterProduct) return false;
      if (!matchesDateRange(a.createdAt)) return false;
      return true;
    });
  }, [applications, filterCurrency, filterProduct, dateFrom, dateTo]);

  const filteredLoans = useMemo(() => {
    return loans.filter((l) => {
      if (filterCurrency !== 'ALL' && l.currency !== filterCurrency) return false;
      if (filterProduct !== 'ALL' && l.productCode !== filterProduct) return false;
      if (dateFrom && l.disbursementDate < dateFrom) return false;
      if (dateTo && l.disbursementDate > dateTo) return false;
      return true;
    });
  }, [loans, filterCurrency, filterProduct, dateFrom, dateTo]);

  const filteredRenewals = useMemo(() => {
    return creditRenewals.filter((r) => {
      if (filterCurrency !== 'ALL' && r.originCurrency !== filterCurrency) return false;
      if (filterProduct !== 'ALL' && r.originProductCode !== filterProduct) return false;
      const refDate = r.disbursedAt?.slice(0, 10) || r.liquidationDate || extractIsoDate(r.createdAt);
      if (dateFrom && refDate && refDate < dateFrom) return false;
      if (dateTo && refDate && refDate > dateTo) return false;
      return true;
    });
  }, [creditRenewals, filterCurrency, filterProduct, dateFrom, dateTo]);

  const renewalMetrics = useMemo(
    () =>
      computeRenewalExecutiveMetrics({
        renewals: creditRenewals,
        disbursements,
        currency: filterCurrency,
        productFilter: filterProduct,
        dateFrom,
        dateTo,
      }),
    [creditRenewals, disbursements, filterCurrency, filterProduct, dateFrom, dateTo]
  );

  const renewalMoneyCurrency = filterCurrency === 'USD' ? 'USD' : 'DOP';

  const financialSummary = useMemo<FinancialPerformanceSummary>(() => {
    const submitted = filteredApps.filter((a) => a.status !== 'BORRADOR');
    const approved = submitted.filter((a) => APPROVED_STATUSES.has(a.status));
    const rejected = submitted.filter((a) => a.status === 'RECHAZADA');
    const decided = approved.length + rejected.length;
    const approvalRatePct = decided > 0 ? (approved.length / decided) * 100 : 0;

    const scored = submitted.filter(
      (a) => a.latestScore !== null && a.latestScore !== undefined
    );
    const averageScore =
      scored.length > 0
        ? scored.reduce((s, a) => s + Number(a.latestScore ?? 0), 0) / scored.length
        : null;

    const requestedDop = submitted
      .filter((a) => a.currency === 'DOP')
      .reduce((s, a) => s + a.requestedAmount, 0);
    const requestedUsd = submitted
      .filter((a) => a.currency === 'USD')
      .reduce((s, a) => s + a.requestedAmount, 0);

    const approvedDop = approved
      .filter((a) => a.currency === 'DOP')
      .reduce((s, a) => s + (a.recommendedAmount ?? a.requestedAmount), 0);
    const approvedUsd = approved
      .filter((a) => a.currency === 'USD')
      .reduce((s, a) => s + (a.recommendedAmount ?? a.requestedAmount), 0);

    const disbursedDop = filteredLoans
      .filter((l) => l.currency === 'DOP')
      .reduce((s, l) => s + l.totalFinancedPrincipal, 0);
    const disbursedUsd = filteredLoans
      .filter((l) => l.currency === 'USD')
      .reduce((s, l) => s + l.totalFinancedPrincipal, 0);

    const activePrincipalDop = filteredLoans
      .filter((l) => l.currency === 'DOP' && (l.status === 'ACTIVO' || l.status === 'VENCIDO'))
      .reduce((s, l) => s + l.currentPrincipalBalance, 0);
    const activePrincipalUsd = filteredLoans
      .filter((l) => l.currency === 'USD' && (l.status === 'ACTIVO' || l.status === 'VENCIDO'))
      .reduce((s, l) => s + l.currentPrincipalBalance, 0);

    return {
      totalSubmitted: submitted.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      approvalRatePct,
      averageScore,
      requestedDop,
      requestedUsd,
      approvedDop,
      approvedUsd,
      disbursedDop,
      disbursedUsd,
      activePrincipalDop,
      activePrincipalUsd,
    };
  }, [filteredApps, filteredLoans]);

  const dataset = useMemo((): { columns: string[]; rows: Array<Array<string | number>> } => {
    switch (reportId) {
      case 'R00_DESEMPENO_FINANCIERO': {
        const products: ProductCode[] = [
          'PERSONAL_DOP',
          'EMPRESARIAL_DOP',
          'PERSONAL_USD',
          'EMPRESARIAL_USD',
        ].filter((pk) => filterProduct === 'ALL' || pk === filterProduct) as ProductCode[];

        return {
          columns: [
            'Producto',
            'Moneda',
            'Solicitudes',
            'Aprobadas',
            'Rechazadas',
            'Tasa Aprob. (%)',
            'Score Prom. V2',
            'Solicitado',
            'Aprobado / Rec.',
            'Desembolsado',
            'Saldo Activo',
          ],
          rows: products.map((pk) => {
            const pApps = filteredApps.filter(
              (a) => a.productCode === pk && a.status !== 'BORRADOR'
            );
            const pApproved = pApps.filter((a) => APPROVED_STATUSES.has(a.status));
            const pRejected = pApps.filter((a) => a.status === 'RECHAZADA');
            const pDecided = pApproved.length + pRejected.length;
            const pRate = pDecided > 0 ? ((pApproved.length / pDecided) * 100).toFixed(1) : '0.0';
            const pScored = pApps.filter(
              (a) => a.latestScore !== null && a.latestScore !== undefined
            );
            const pAvgScore =
              pScored.length > 0
                ? (
                    pScored.reduce((s, a) => s + Number(a.latestScore ?? 0), 0) / pScored.length
                  ).toFixed(1)
                : '—';
            const reqSum = pApps.reduce((s, a) => s + a.requestedAmount, 0);
            const appSum = pApproved.reduce(
              (s, a) => s + (a.recommendedAmount ?? a.requestedAmount),
              0
            );
            const pLoans = filteredLoans.filter((l) => l.productCode === pk);
            const disbSum = pLoans.reduce((s, l) => s + l.totalFinancedPrincipal, 0);
            const activeBal = pLoans
              .filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO')
              .reduce((s, l) => s + l.currentPrincipalBalance, 0);
            const curr = pk.endsWith('USD') ? 'USD' : 'DOP';

            return [
              PRODUCT_LABELS[pk],
              curr,
              pApps.length,
              pApproved.length,
              pRejected.length,
              `${pRate}%`,
              pAvgScore,
              reqSum,
              appSum,
              disbSum,
              activeBal,
            ];
          }),
        };
      }

      case 'R01_SOLICITUDES':
        return {
          columns: [
            'Solicitud',
            'Canal',
            'Cliente',
            'Producto',
            'Moneda',
            'Monto Solicitado',
            'Plazo (m)',
            'Estado',
            'Score',
            'Fecha',
          ],
          rows: filteredApps.map((a) => [
            a.applicationNumber,
            a.channel,
            a.applicantDisplayName,
            PRODUCT_LABELS[a.productCode],
            a.currency,
            a.requestedAmount,
            a.requestedTermMonths,
            APPLICATION_STATUS_LABELS[a.status],
            a.latestScore ?? '—',
            formatTimestamp(a.createdAt),
          ]),
        };

      case 'R02_PRECALIFICACION':
        return {
          columns: [
            'Ejecución',
            'Solicitud',
            'Política',
            'Disparador',
            'Score',
            'Banda',
            'Estado Motor',
            'Monto Recom.',
            'Tasa Mensual',
            'Plazo',
          ],
          rows: scoringExecutions
            .filter((s) => {
              const app = appById.get(s.applicationId);
              if (!app) return true;
              if (filterCurrency !== 'ALL' && app.currency !== filterCurrency) return false;
              if (filterProduct !== 'ALL' && app.productCode !== filterProduct) return false;
              if (!matchesDateRange(s.executedAt)) return false;
              return true;
            })
            .map((s) => [
              s.id,
              appById.get(s.applicationId)?.applicationNumber || s.applicationId,
              `${s.policyVersion} (${s.policyStatus})`,
              s.executionTrigger,
              s.totalScore,
              s.riskBand.label,
              SCORING_STATUS_LABELS[s.status] || s.status,
              s.recommendedAmount,
              formatRatePct(s.recommendedRateMonthly),
              s.recommendedTermMonths,
            ]),
        };

      case 'R03_EVALUACION':
        return {
          columns: [
            'Evaluación',
            'Solicitud',
            'Analista',
            'Dictamen',
            'Monto Recom.',
            'Tasa',
            'Identidad/Ingresos',
            'Estado',
            'Actualizado',
          ],
          rows: evaluations
            .filter((e) => {
              const app = appById.get(e.applicationId);
              if (app) {
                if (filterCurrency !== 'ALL' && app.currency !== filterCurrency) return false;
                if (filterProduct !== 'ALL' && app.productCode !== filterProduct) return false;
              }
              return matchesDateRange(e.updatedAt);
            })
            .map((e) => [
              e.id,
              appById.get(e.applicationId)?.applicationNumber || e.applicationId,
              e.analystName,
              e.recommendedDecision,
              e.recommendedAmount ?? '—',
              formatRatePct(e.recommendedRateMonthly),
              `${e.identityVerified ? 'ID OK' : 'ID Pend'} / ${e.incomeVerified ? 'Ing OK' : 'Ing Pend'}`,
              e.status,
              formatTimestamp(e.updatedAt),
            ]),
        };

      case 'R04_COMITE':
        return {
          columns: [
            'Decisión ID',
            'Solicitud',
            'Resolución',
            'Monto Aprobado',
            'Tasa Mensual',
            'Plazo',
            'Decidido Por',
            'Facultad Usada',
            'Fecha',
          ],
          rows: committeeDecisions
            .filter((d) => {
              const app = appById.get(d.applicationId);
              if (app) {
                if (filterCurrency !== 'ALL' && app.currency !== filterCurrency) return false;
                if (filterProduct !== 'ALL' && app.productCode !== filterProduct) return false;
              }
              return matchesDateRange(d.decidedAt);
            })
            .map((d) => [
              d.id,
              appById.get(d.applicationId)?.applicationNumber || d.applicationId,
              d.decision,
              d.approvedAmount ?? '—',
              formatRatePct(d.approvedRateMonthly),
              d.approvedTermMonths ?? '—',
              `${d.decidedByName} (${d.decidedByRole})`,
              d.authorityUsed,
              formatTimestamp(d.decidedAt),
            ]),
        };

      case 'R05_FORMALIZACIONES':
        return {
          columns: [
            'Formalización',
            'Solicitud',
            'Capital Aprob.',
            'Gastos Fin.',
            'Total Financiado',
            'Neto Desembolso',
            'Estado',
            'Primer Pago',
          ],
          rows: formalizations
            .filter((f) => {
              const app = appById.get(f.applicationId);
              if (app) {
                if (filterCurrency !== 'ALL' && app.currency !== filterCurrency) return false;
                if (filterProduct !== 'ALL' && app.productCode !== filterProduct) return false;
              }
              return true;
            })
            .map((f) => [
              f.id,
              appById.get(f.applicationId)?.applicationNumber || f.applicationId,
              f.approvedCapital,
              f.financedExpenses,
              f.totalFinanced,
              f.netDisbursementAmount,
              f.status,
              f.firstPaymentDate,
            ]),
        };

      case 'R06_DESEMBOLSOS':
        return {
          columns: [
            'N.º Desembolso',
            'Préstamo',
            'Fecha',
            'Medio',
            'Banco',
            'Cuenta Destino',
            'Referencia',
            'Neto Entregado',
            'Responsable',
          ],
          rows: disbursements
            .filter((d) => {
              if (dateFrom && d.disbursementDate < dateFrom) return false;
              if (dateTo && d.disbursementDate > dateTo) return false;
              const app = appById.get(d.applicationId);
              if (app) {
                if (filterCurrency !== 'ALL' && app.currency !== filterCurrency) return false;
                if (filterProduct !== 'ALL' && app.productCode !== filterProduct) return false;
              }
              return true;
            })
            .map((d) => [
              d.disbursementNumber,
              d.loanId,
              d.disbursementDate,
              d.paymentMethod,
              d.financialEntity,
              d.destinationAccountMasked,
              d.referenceNumber,
              d.netDeliveredAmount,
              d.responsibleUserName || d.responsibleUserId,
            ]),
        };

      case 'R07_TASAS_MONTOS':
        return {
          columns: [
            'N.º Préstamo',
            'Cliente',
            'Producto',
            'Moneda',
            'Principal Financiado',
            'Tasa Mensual',
            'Plazo',
            'Frecuencia',
            'Total Contractual',
          ],
          rows: filteredLoans.map((l) => [
            l.loanNumber,
            l.applicantDisplayName,
            PRODUCT_LABELS[l.productCode],
            l.currency,
            l.totalFinancedPrincipal,
            formatRatePct(l.contractualRateMonthly),
            l.termMonths,
            l.frequency,
            l.totalContractualPayable,
          ]),
        };

      case 'R08_USUARIOS_PRODUCTIVIDAD': {
        const stats = new Map<string, { role: string; count: number; lastAction: string }>();
        for (const a of filteredApps) {
          const key = a.createdByName || a.createdBy;
          const prev = stats.get(key) || { role: 'Originador', count: 0, lastAction: a.applicationNumber };
          stats.set(key, { role: prev.role, count: prev.count + 1, lastAction: a.applicationNumber });
        }
        for (const e of evaluations) {
          const prev = stats.get(e.analystName) || { role: 'Analista', count: 0, lastAction: e.recommendedDecision };
          stats.set(e.analystName, { role: 'Analista de Crédito', count: prev.count + 1, lastAction: e.recommendedDecision });
        }
        for (const c of committeeDecisions) {
          const prev = stats.get(c.decidedByName) || { role: c.decidedByRole, count: 0, lastAction: c.decision };
          stats.set(c.decidedByName, { role: c.decidedByRole, count: prev.count + 1, lastAction: c.decision });
        }
        return {
          columns: ['Usuario', 'Rol Operativo', 'Operaciones Registradas', 'Última Referencia'],
          rows: Array.from(stats.entries()).map(([u, s]) => [u, s.role, s.count, s.lastAction]),
        };
      }

      case 'R09_AUDITORIA':
        return {
          columns: ['Evento', 'Entidad', 'ID Entidad', 'Acción', 'Transacción', 'Usuario', 'Rol', 'Fecha'],
          rows: auditLogs
            .filter((l) => matchesDateRange(l.timestamp))
            .slice(0, 200)
            .map((l) => [
              l.eventType,
              l.entityType,
              l.entityId,
              l.action,
              l.transactionId,
              l.userEmail || l.userId,
              l.userRole || '—',
              formatTimestamp(l.timestamp),
            ]),
        };

      case 'R10_INDICADORES_V2': {
        const agg = new Map<number, { name: string; max: number; sum: number; count: number }>();
        for (const exec of scoringExecutions) {
          const app = appById.get(exec.applicationId);
          if (app) {
            if (filterCurrency !== 'ALL' && app.currency !== filterCurrency) continue;
            if (filterProduct !== 'ALL' && app.productCode !== filterProduct) continue;
          }
          for (const ind of exec.indicatorDetails || []) {
            const cur = agg.get(ind.number) || { name: ind.name, max: ind.maxPoints, sum: 0, count: 0 };
            cur.sum += ind.awardedPoints;
            cur.count += 1;
            agg.set(ind.number, cur);
          }
        }
        return {
          columns: ['N.º', 'Indicador Motor V2', 'Puntaje Máximo', 'Ejecuciones', 'Promedio Obtenido', 'Efectividad (%)'],
          rows: Array.from(agg.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([num, d]) => {
              const avg = d.count > 0 ? d.sum / d.count : 0;
              const pct = d.max > 0 ? (avg / d.max) * 100 : 0;
              return [num, d.name, d.max, d.count, avg.toFixed(2), `${pct.toFixed(1)}%`];
            }),
        };
      }

      case 'R11_RENOVACIONES': {
        return {
          columns: [
            'N.º Renovación',
            'Cliente',
            'Modalidad',
            'Producto',
            'Moneda',
            'Préstamo Anterior',
            'Préstamo Nuevo',
            'Estado',
            'Monto Bruto Renovado',
            'Saldo Liquidado Anterior',
            'Otros Descuentos',
            'Dinero Neto Entregado',
            'Oficial',
            'Fecha',
          ],
          rows: filteredRenewals.map((r) => {
            const isDisbursed = r.status === 'DESEMBOLSADA';
            const grossAmt = isDisbursed
              ? r.approvedAmount ?? r.requestedAmount
              : r.approvedAmount ?? r.requestedAmount;
            const payoffAmt = isDisbursed
              ? r.settledPayoffAmount ?? r.payoffSnapshot.totalPayoffAmount
              : r.payoffSnapshot.totalPayoffAmount;
            const otherDisc = isDisbursed ? r.otherDeductionsAmount ?? 0 : 0;
            const netAmt = isDisbursed
              ? r.netDisbursementAmount ?? Math.max(0, grossAmt - payoffAmt - otherDisc)
              : Math.max(0, grossAmt - payoffAmt - otherDisc);
            return [
              r.renewalNumber,
              r.customerName,
              RENEWAL_MODALITY_LABELS[r.modality] || r.modality,
              PRODUCT_LABELS[r.originProductCode] || r.originProductCode,
              r.originCurrency,
              r.originLoanNumber,
              r.targetLoanNumber || 'Pendiente',
              RENEWAL_STATUS_LABELS[r.status] || r.status,
              grossAmt,
              payoffAmt,
              otherDisc,
              netAmt,
              r.initiatedByName || r.initiatedBy,
              r.disbursedAt?.slice(0, 10) || r.liquidationDate || formatTimestamp(r.createdAt),
            ];
          }),
        };
      }
    }
  }, [
    reportId,
    filteredApps,
    filteredLoans,
    filteredRenewals,
    scoringExecutions,
    evaluations,
    committeeDecisions,
    formalizations,
    disbursements,
    auditLogs,
    appById,
    filterCurrency,
    filterProduct,
    dateFrom,
    dateTo,
  ]);

  const activeMeta = REPORT_LIST.find((r) => r.id === reportId) || REPORT_LIST[0];

  const visibleRows = useMemo(() => {
    const q = rowSearch.trim().toLowerCase();
    if (!q) return dataset.rows;
    return dataset.rows.filter((row) =>
      row.some((cell) => String(cell ?? '').toLowerCase().includes(q))
    );
  }, [dataset.rows, rowSearch]);

  const filtersSummaryText = useMemo(() => {
    const parts: string[] = [];
    parts.push(filterCurrency === 'ALL' ? 'Moneda: DOP y USD' : `Moneda: ${filterCurrency}`);
    parts.push(
      filterProduct === 'ALL' ? 'Producto: Todos' : `Producto: ${PRODUCT_LABELS[filterProduct]}`
    );
    if (dateFrom || dateTo) {
      parts.push(`Período: ${dateFrom || 'Inicio'} a ${dateTo || 'Hoy'}`);
    }
    if (rowSearch.trim()) {
      parts.push(`Búsqueda: "${rowSearch.trim()}"`);
    }
    return parts.join(' · ');
  }, [filterCurrency, filterProduct, dateFrom, dateTo, rowSearch]);

  const buildPayload = () => ({
    reportId,
    reportTitle: activeMeta.title,
    reportSubtitle: activeMeta.subtitle,
    organizationName: organization.name,
    organizationTaxId: organization.taxId || organization.rnc,
    organizationPhone: organization.phone,
    primaryColor: organization.primaryColor,
    policyVersion: `${activeOrTestPolicy.version} (${activeOrTestPolicy.status})`,
    filtersSummary: filtersSummaryText,
    generatedBy: userProfile?.displayName || userProfile?.email || 'Usuario AxyCore',
    columns: dataset.columns,
    rows: visibleRows,
    financialSummary,
  });

  const handleExportCsv = () => {
    try {
      const fileName = exportReportToCsv(buildPayload());
      setExportFeedback({
        type: 'ok',
        msg: `Archivo CSV "${fileName}" descargado con ${visibleRows.length} registros y resumen financiero.`,
      });
    } catch (err) {
      setExportFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error generando el archivo CSV.',
      });
    }
  };

  const handleExportPdf = () => {
    try {
      const fileName = exportReportToPdf(buildPayload());
      setExportFeedback({
        type: 'ok',
        msg: `Documento PDF "${fileName}" generado con resumen financiero y ${visibleRows.length} filas.`,
      });
    } catch (err) {
      setExportFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error generando el documento PDF.',
      });
    }
  };

  const handleExportExcel = () => {
    const headerRow = `<Row>${dataset.columns
      .map((c) => `<Cell><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`)
      .join('')}</Row>`;
    const bodyRows = visibleRows
      .map(
        (r) =>
          `<Row>${r
            .map((cell) => {
              const isNum = typeof cell === 'number' && Number.isFinite(cell);
              return `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escapeXml(cell)}</Data></Cell>`;
            })
            .join('')}</Row>`
      )
      .join('');

    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="ReporteAxyCore">
  <Table>${headerRow}${bodyRows}</Table>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AxyCore_${reportId}_${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportFeedback({
      type: 'ok',
      msg: `Hoja Excel (.xls) descargada para ${activeMeta.title}.`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#0066FF] dark:text-[#00D1FF]">
            Módulo Reportes · Reportes y Analítica
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            Reportes y Analítica Financiera
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Reportería crediticia y operativa en tiempo real con exportación a PDF, CSV (UTF-8), Excel (.xls) e impresión institucional.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {rbac.canAccessSection('cobranza_reports') && (
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/80 dark:border-[#00B8FF]/20 mr-1">
              <button
                type="button"
                onClick={() => setActiveSection('reports')}
                className="px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                Reportes y Analítica
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('cobranza_reports')}
                className="px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                Reportes de Cobranza (20)
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            Exportar PDF
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Excel (.xls)
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-900 dark:bg-[#040C1E] text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir
          </button>
        </div>
      </div>

      {exportFeedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium ${
            exportFeedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
          }`}
        >
          {exportFeedback.msg}
        </div>
      )}

      {/* Financial & Credit Performance Snapshot */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Desempeño de Aprobación
          </p>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
            {financialSummary.approvalRatePct.toFixed(1)}%
          </p>
          <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
            {financialSummary.approvedCount} apr. · {financialSummary.rejectedCount} rech. · Score prom:{' '}
            {financialSummary.averageScore !== null
              ? `${financialSummary.averageScore.toFixed(1)}/100`
              : '—'}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Volumen Solicitado
          </p>
          <p className="font-display text-xl font-bold font-mono tabular-nums text-slate-950 dark:text-white mt-1">
            {formatMoney(financialSummary.requestedDop, 'DOP')}
          </p>
          <p className="text-xs font-mono tabular-nums text-[#0066FF] dark:text-[#00D1FF] mt-0.5">
            {formatMoney(financialSummary.requestedUsd, 'USD')}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Volumen Aprobado
          </p>
          <p className="font-display text-xl font-bold font-mono tabular-nums text-[#0066FF] dark:text-[#00D1FF] mt-1">
            {formatMoney(financialSummary.approvedDop, 'DOP')}
          </p>
          <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
            {formatMoney(financialSummary.approvedUsd, 'USD')}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Desembolsado y Cartera Activa
          </p>
          <p className="font-display text-xl font-bold font-mono tabular-nums text-slate-950 dark:text-white mt-1">
            {formatMoney(financialSummary.disbursedDop, 'DOP')}
          </p>
          <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
            {formatMoney(financialSummary.disbursedUsd, 'USD')} · Activo:{' '}
            {formatMoney(financialSummary.activePrincipalDop, 'DOP')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 space-y-1.5">
          {REPORT_LIST.map((r) => {
            const active = reportId === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setReportId(r.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                  active
                    ? 'border-[#0066FF] dark:border-[#00B8FF]/60 bg-[#0066FF]/[0.07] dark:bg-[#00B8FF]/12'
                    : 'border-slate-200/85 dark:border-[#00B8FF]/15 bg-white dark:bg-[#08132B] hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                }`}
              >
                <p
                  className={`font-semibold text-xs ${
                    active ? 'text-[#0052CC] dark:text-[#00D1FF]' : 'text-slate-950 dark:text-white'
                  }`}
                >
                  {r.title}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{r.subtitle}</p>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-8 space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center shrink-0">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-sm text-slate-950 dark:text-white">
                    {activeMeta.title}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {organization.name} · <span className="font-mono tabular-nums">{visibleRows.length}</span> registros visibles
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <div className="relative lg:col-span-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={rowSearch}
                  onChange={(e) => setRowSearch(e.target.value)}
                  placeholder="Filtrar filas..."
                  aria-label="Filtrar filas del reporte"
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                />
              </div>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="Fecha desde"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="Fecha hasta"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
              />
              <select
                value={filterCurrency}
                onChange={(e) => setFilterCurrency(e.target.value as 'ALL' | 'DOP' | 'USD')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
              >
                <option value="ALL">Todas las monedas</option>
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
              </select>
              <select
                value={filterProduct}
                onChange={(e) => setFilterProduct(e.target.value as 'ALL' | ProductCode)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
              >
                <option value="ALL">Todos los productos</option>
                <option value="PERSONAL_DOP">Personal DOP</option>
                <option value="EMPRESARIAL_DOP">Empresarial DOP</option>
                <option value="PERSONAL_USD">Personal USD</option>
                <option value="EMPRESARIAL_USD">Empresarial USD</option>
              </select>
            </div>
          </div>

          {reportId === 'R11_RENOVACIONES' && (
            <div className="space-y-4">
              {/* Explicit Financial Separation (Never mixing Gross vs Payoff vs Net New Cash) */}
              <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-indigo-200/80 dark:border-indigo-500/25 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                    <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                      Indicadores Gerenciales de Renovaciones (Separación Contable Obligatoria)
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {filterCurrency === 'ALL'
                      ? 'Consolidado nominal (filtre por DOP o USD para totales por divisa)'
                      : `Moneda: ${filterCurrency}`}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Monto Bruto Renovado
                    </p>
                    <p className="font-display text-lg font-bold font-mono tabular-nums text-slate-950 dark:text-white mt-1">
                      {formatMoney(renewalMetrics.grossRenewedAmount, renewalMoneyCurrency)}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Capital bruto desembolsado en renovaciones
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-500/25">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      Saldo Liquidado Anterior
                    </p>
                    <p className="font-display text-lg font-bold font-mono tabular-nums text-amber-900 dark:text-amber-200 mt-1">
                      -{formatMoney(renewalMetrics.totalPriorPayoffSettled, renewalMoneyCurrency)}
                    </p>
                    <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                      Cancelación automática de préstamos previos
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Otros Descuentos Autorizados
                    </p>
                    <p className="font-display text-lg font-bold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-1">
                      -{formatMoney(renewalMetrics.totalOtherDiscounts, renewalMoneyCurrency)}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Gastos de cierre y deducciones descontadas
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/25 border border-emerald-300/80 dark:border-emerald-500/30">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      Dinero Neto Nuevo Entregado
                    </p>
                    <p className="font-display text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">
                      {formatMoney(renewalMetrics.totalNetNewCashDelivered, renewalMoneyCurrency)}
                    </p>
                    <p className="text-[11px] font-mono text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
                      Prom. neto: {formatMoney(renewalMetrics.averageNetDisbursement, renewalMoneyCurrency)}
                    </p>
                  </div>
                </div>

                {/* Pipeline Counts (All 7 Status KPIs) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
                  {[
                    { label: 'Iniciadas', value: renewalMetrics.totalInitiated, tone: 'text-slate-900 dark:text-white' },
                    { label: 'En Evaluación', value: renewalMetrics.totalInEvaluation, tone: 'text-sky-700 dark:text-sky-300' },
                    { label: 'Pend. Comité', value: renewalMetrics.totalPendingCommittee, tone: 'text-amber-700 dark:text-amber-300' },
                    { label: 'Aprobadas', value: renewalMetrics.totalApproved, tone: 'text-[#0066FF] dark:text-[#00D1FF]' },
                    { label: 'Pend. Desembolso', value: renewalMetrics.totalPendingDisbursement, tone: 'text-indigo-700 dark:text-indigo-300' },
                    { label: 'Desembolsadas', value: renewalMetrics.totalDisbursed, tone: 'text-emerald-700 dark:text-emerald-400' },
                    { label: 'Rechazadas', value: renewalMetrics.totalRejected, tone: 'text-rose-700 dark:text-rose-400' },
                  ].map((kpi) => (
                    <div
                      key={kpi.label}
                      className="p-2.5 rounded-xl bg-slate-50/90 dark:bg-[#040C1E] border border-slate-200/75 dark:border-white/10 text-center"
                    >
                      <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{kpi.label}</p>
                      <p className={`font-display text-base font-bold font-mono tabular-nums mt-0.5 ${kpi.tone}`}>
                        {kpi.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Modality Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10 space-y-1">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Modalidad A — Mismas Condiciones (Directo a Comité)
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                      Iniciadas: <strong>{renewalMetrics.modalityBreakdown.mismasCondicionesCount}</strong> · Desembolsadas:{' '}
                      <strong>{renewalMetrics.modalityBreakdown.mismasCondicionesDisbursed}</strong>
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                      Bruto: <strong>{formatMoney(renewalMetrics.modalityBreakdown.mismasCondicionesGross, renewalMoneyCurrency)}</strong> · Neto:{' '}
                      <strong className="text-emerald-700 dark:text-emerald-400">
                        {formatMoney(renewalMetrics.modalityBreakdown.mismasCondicionesNet, renewalMoneyCurrency)}
                      </strong>
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10 space-y-1">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Modalidad B — Aumento o Modificación (Con Evaluación)
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                      Iniciadas: <strong>{renewalMetrics.modalityBreakdown.aumentoCount}</strong> · Desembolsadas:{' '}
                      <strong>{renewalMetrics.modalityBreakdown.aumentoDisbursed}</strong>
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                      Bruto: <strong>{formatMoney(renewalMetrics.modalityBreakdown.aumentoGross, renewalMoneyCurrency)}</strong> · Neto:{' '}
                      <strong className="text-emerald-700 dark:text-emerald-400">
                        {formatMoney(renewalMetrics.modalityBreakdown.aumentoNet, renewalMoneyCurrency)}
                      </strong>
                    </p>
                  </div>
                </div>
              </div>

              {/* Breakdown Tables: By Product, Officer, and Period */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 text-xs">
                <div className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-200/80 dark:border-white/10 font-semibold text-slate-900 dark:text-white">
                    Por Producto
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50 dark:bg-[#040C1E] text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2 px-3">Producto</th>
                          <th className="py-2 px-2 text-right">Des.</th>
                          <th className="py-2 px-2 text-right">Bruto</th>
                          <th className="py-2 px-3 text-right">Neto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-mono tabular-nums">
                        {renewalMetrics.byProduct.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-4 text-center font-sans text-slate-500">
                              Sin registros
                            </td>
                          </tr>
                        ) : (
                          renewalMetrics.byProduct.map((g) => (
                            <tr key={g.key}>
                              <td className="py-2 px-3 font-sans font-medium text-slate-800 dark:text-slate-200">
                                {PRODUCT_LABELS[g.key as ProductCode] || g.label}
                              </td>
                              <td className="py-2 px-2 text-right">
                                {g.disbursedCount}/{g.count}
                              </td>
                              <td className="py-2 px-2 text-right">{g.grossRenewed.toLocaleString('en-US')}</td>
                              <td className="py-2 px-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                                {g.netNewCash.toLocaleString('en-US')}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-200/80 dark:border-white/10 font-semibold text-slate-900 dark:text-white">
                    Por Oficial de Negocios
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50 dark:bg-[#040C1E] text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2 px-3">Oficial</th>
                          <th className="py-2 px-2 text-right">Des.</th>
                          <th className="py-2 px-2 text-right">Bruto</th>
                          <th className="py-2 px-3 text-right">Neto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-mono tabular-nums">
                        {renewalMetrics.byOfficer.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-4 text-center font-sans text-slate-500">
                              Sin registros
                            </td>
                          </tr>
                        ) : (
                          renewalMetrics.byOfficer.map((g) => (
                            <tr key={g.key}>
                              <td className="py-2 px-3 font-sans font-medium text-slate-800 dark:text-slate-200 truncate max-w-[140px]">
                                {g.label}
                              </td>
                              <td className="py-2 px-2 text-right">
                                {g.disbursedCount}/{g.count}
                              </td>
                              <td className="py-2 px-2 text-right">{g.grossRenewed.toLocaleString('en-US')}</td>
                              <td className="py-2 px-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                                {g.netNewCash.toLocaleString('en-US')}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-200/80 dark:border-white/10 font-semibold text-slate-900 dark:text-white">
                    Por Período (YYYY-MM)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50 dark:bg-[#040C1E] text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2 px-3">Período</th>
                          <th className="py-2 px-2 text-right">Bruto</th>
                          <th className="py-2 px-2 text-right">Liquidado</th>
                          <th className="py-2 px-3 text-right">Neto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-mono tabular-nums">
                        {renewalMetrics.byPeriod.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-4 text-center font-sans text-slate-500">
                              Sin registros
                            </td>
                          </tr>
                        ) : (
                          renewalMetrics.byPeriod.map((p) => (
                            <tr key={p.period}>
                              <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                                {p.period}
                              </td>
                              <td className="py-2 px-2 text-right">{p.grossRenewed.toLocaleString('en-US')}</td>
                              <td className="py-2 px-2 text-right text-amber-700 dark:text-amber-300">
                                {p.payoffSettled.toLocaleString('en-US')}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                                {p.netNewCash.toLocaleString('en-US')}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-[#040C1E]">
                  <tr className="border-b border-slate-200/80 dark:border-white/10 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {dataset.columns.map((c) => (
                      <th key={c} className="py-3 px-3 font-semibold whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5 tabular-nums">
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={dataset.columns.length} className="py-10 text-center text-slate-500 dark:text-slate-400">
                        Sin datos registrados para este reporte y filtros.
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors"
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className="py-2.5 px-3 whitespace-nowrap text-slate-800 dark:text-slate-200"
                          >
                            {typeof cell === 'number' ? cell.toLocaleString('en-US') : cell}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
