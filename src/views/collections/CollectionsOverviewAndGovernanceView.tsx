import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Award,
  BarChart3,
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  Sliders,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  buildAnticipateProjections,
  computeContactCenterKpis,
  computeParAndPortfolioMetrics,
  reconstructAccountsAtCutoffDate,
  validateLoanCancellationEligibility,
} from '../../engine/collections/botAndSentinelEngine';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  getSantoDomingoTodayIso,
} from '../../engine/collections/delinquencyEngine';
import {
  executeFormalLoanClosureTransaction,
  saveCollectionPolicyVersion,
} from '../../services/collectionsStore';
import type {
  CollectionPolicyVersionRecord,
  PaymentComponentKey,
  ProductCode,
} from '../../types/axycore';
import { formatMoney, formatTimestamp, PRODUCT_LABELS } from '../../utils/formatters';
import { exportReportToCsv, exportReportToPdf } from '../../utils/reportExporter';

interface ReportDefinition {
  id: string;
  title: string;
  subtitle: string;
}

const COBRANZA_20_REPORTS: ReportDefinition[] = [
  { id: 'REP_01_CARTERA_TOTAL', title: '01. Cartera Total Activa por Moneda', subtitle: 'Saldo capital, DPD y etapa separado DOP/USD' },
  { id: 'REP_02_CARTERA_VENCIDA', title: '02. Cartera Vencida por Tramo y Moneda', subtitle: 'Desglose 1-5, 6-15, 16-30, 31-60, 61-90 y 90+' },
  { id: 'REP_03_PAR_HIST', title: '03. Indicadores PAR 1 / 30 / 60 / 90', subtitle: 'Exposición sobre saldo capital a fecha de corte' },
  { id: 'REP_04_PROMESAS', title: '04. Promesas Cumplidas vs Incumplidas', subtitle: 'Efectividad verificada exclusivamente con pagos APLICADOS' },
  { id: 'REP_05_GESTORES', title: '05. Efectividad y Recuperación por Gestor', subtitle: 'Productividad individual, contactabilidad y recuperado' },
  { id: 'REP_06_PAGOS_APLICADOS', title: '06. Pagos Aplicados vs Reportados Pendientes', subtitle: 'Control de conciliación e ingresos reales' },
  { id: 'REP_07_REVERSOS', title: '07. Auditoría de Reversos Autorizados', subtitle: 'Reversos ejecutados y justificación obligatoria' },
  { id: 'REP_08_EXCEPCIONES_BANCO', title: '08. Excepciones Bancarias y Pagos por Identificar', subtitle: 'Movimientos bancarios sin emparejamiento automático' },
  { id: 'REP_09_RECUPERACION_CANAL', title: '09. Recuperación por Canal de Pago', subtitle: 'Transferencia, depósito, caja, tarjeta y link' },
  { id: 'REP_10_PROVINCIA', title: '10. Exposición y Mora por Provincia', subtitle: 'Concentración geográfica de cartera vencida' },
  { id: 'REP_11_PRODUCTO', title: '11. Desempeño por Producto Crediticio', subtitle: 'Banca Personal vs Empresarial (DOP/USD)' },
  { id: 'REP_12_REESTRUCTURACIONES', title: '12. Acuerdos y Reestructuraciones', subtitle: 'Estado de propuestas, aprobaciones y cumplimiento' },
  { id: 'REP_13_CENTINELA', title: '13. Alertas Centinela y Riesgos Operativos', subtitle: '13 reglas de monitoreo continuo y tiempos de atención' },
  { id: 'REP_14_RECLAMACIONES', title: '14. Reclamaciones y Casos Especiales', subtitle: 'Disputas abiertas, pausas del Bot y resoluciones' },
  { id: 'REP_15_BOT_CUMPLIMIENTO', title: '15. Auditoría AxyRecovery Bot y Opt-Out', subtitle: 'Mensajes entregados, bloqueos y consentimientos' },
  { id: 'REP_16_ANTIGUEDAD', title: '16. Antigüedad de Saldos (Aging Detail)', subtitle: 'Capital e interés vencido por cuenta' },
  { id: 'REP_17_ANTICIPATE', title: '17. Proyecciones Anticípate 30 / 60 / 90 Días', subtitle: 'Flujo contractual esperado y escenario de estrés' },
  { id: 'REP_18_SNAPSHOTS', title: '18. Cortes Históricos Diarios Guardados', subtitle: 'Instantáneas reproducibles de cierre diario' },
  { id: 'REP_19_CANCELADOS', title: '19. Préstamos Cerrados y Cancelados', subtitle: 'Certificados emitidos y liquidación total' },
  { id: 'REP_20_AUDITORIA_COBRO', title: '20. Bitácora Integral de Auditoría Cobranza', subtitle: 'Trazabilidad completa de eventos críticos' },
];

export function CollectionsOverviewAndGovernanceView({
  mode,
}: {
  mode: 'dashboard' | 'anticipate' | 'reports' | 'params' | 'audit';
}) {
  const {
    userProfile,
    organization,
    darkMode,
    customers,
    loans,
    loanInstallments,
    collectionAccounts,
    collectionActions,
    paymentPromises,
    paymentAgreements,
    payments,
    paymentReversals,
    reconciliationExceptions,
    riskAlerts,
    customerDisputes,
    messageEvents,
    collectionPolicies,
    activeCollectionPolicy,
    collectionDailySnapshots,
    auditLogs,
    setActiveSection,
    setSelectedCollectionLoanId,
    runDailyCollectionsSync,
    rbac,
  } = useAxyCore();

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [cutoffDate, setCutoffDate] = useState(getSantoDomingoTodayIso());
  const [chartCurrency, setChartCurrency] = useState<'DOP' | 'USD'>('DOP');
  const [selectedReportId, setSelectedReportId] = useState(COBRANZA_20_REPORTS[0].id);
  const [reportCatalogSearch, setReportCatalogSearch] = useState('');
  const [reportRowSearch, setReportRowSearch] = useState('');

  // Versioned Policy Draft
  const [policyDraft, setPolicyDraft] = useState<CollectionPolicyVersionRecord>(() =>
    JSON.parse(JSON.stringify(activeCollectionPolicy))
  );
  const [newPolVersion, setNewPolVersion] = useState('');

  const todayIso = getSantoDomingoTodayIso();

  const effectiveAccounts = useMemo(() => {
    if (cutoffDate === todayIso && collectionAccounts.length > 0) {
      return collectionAccounts;
    }
    return reconstructAccountsAtCutoffDate({
      loans,
      installments: loanInstallments,
      payments,
      cutoffDateIso: cutoffDate,
      policy: activeCollectionPolicy,
    });
  }, [cutoffDate, todayIso, collectionAccounts, loans, loanInstallments, payments, activeCollectionPolicy]);

  const parMetrics = useMemo(
    () => computeParAndPortfolioMetrics(effectiveAccounts),
    [effectiveAccounts]
  );

  const projections = useMemo(
    () =>
      buildAnticipateProjections({
        loans,
        installments: loanInstallments,
        accounts: effectiveAccounts,
        asOfDateIso: cutoffDate,
      }),
    [loans, loanInstallments, effectiveAccounts, cutoffDate]
  );

  const contactKpis = useMemo(
    () =>
      computeContactCenterKpis({
        accounts: effectiveAccounts,
        actions: collectionActions,
        promises: paymentPromises,
        payments,
      }),
    [effectiveAccounts, collectionActions, paymentPromises, payments]
  );

  const agingChartData = useMemo(() => {
    const metrics = parMetrics[chartCurrency];
    const labels: Array<[string, string]> = [
      ['AL_DIA', 'Al Día'],
      ['1_5', '1–5d'],
      ['6_15', '6–15d'],
      ['16_30', '16–30d'],
      ['31_60', '31–60d'],
      ['61_90', '61–90d'],
      ['90_MAS', '90+d'],
    ];
    return labels.map(([key, label]) => {
      const b = metrics.buckets[key] ?? { count: 0, principalBalance: 0, overdueAmount: 0 };
      return {
        bucketKey: key,
        bucketLabel: label,
        count: b.count,
        principalBalance: b.principalBalance,
        overdueAmount: b.overdueAmount,
      };
    });
  }, [parMetrics, chartCurrency]);

  const anticipateChartData = useMemo(
    () =>
      projections.map((p) => ({
        horizonLabel: `${p.horizonDays} días`,
        installmentsCount: p.installmentsCount,
        contractual: chartCurrency === 'DOP' ? p.scheduledDueDop : p.scheduledDueUsd,
        expectedBase: chartCurrency === 'DOP' ? p.expectedBaseDop : p.expectedBaseUsd,
        expectedStress: chartCurrency === 'DOP' ? p.expectedStressDop : p.expectedStressUsd,
      })),
    [projections, chartCurrency]
  );

  const axisTickColor = darkMode ? '#94a3b8' : '#64748b';
  const gridStroke = darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)';
  const compactCurrency = (val: number) => {
    const prefix = chartCurrency === 'USD' ? 'US$' : 'RD$';
    if (Math.abs(val) >= 1_000_000) return `${prefix}${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${prefix}${(val / 1_000).toFixed(0)}k`;
    return `${prefix}${val.toFixed(0)}`;
  };

  const collectionsAuditLogs = useMemo(
    () =>
      auditLogs.filter((l) =>
        [
          'PAYMENT_REPORTED_PENDING_VERIFICATION',
          'PAYMENT_VERIFIED_AND_APPLIED',
          'PAYMENT_REJECTED',
          'PAYMENT_REVERSED',
          'COLLECTION_ACTION_LOGGED',
          'COLLECTION_ACTION_CORRECTED',
          'COLLECTION_PORTFOLIO_ASSIGNED',
          'COLLECTION_POLICY_VERSION_SAVED',
          'BANK_STATEMENT_IMPORTED',
          'PAYMENT_AGREEMENT_DECIDED',
          'LOAN_FORMALLY_CANCELLED',
        ].includes(l.eventType)
      ),
    [auditLogs]
  );

  const reportTable = useMemo<{ columns: string[]; rows: Array<Array<string | number>> }>(() => {
    const loanById = new Map(loans.map((l) => [l.id, l]));
    const customerById = new Map(customers.map((c) => [c.id, c]));

    switch (selectedReportId) {
      case 'REP_02_CARTERA_VENCIDA': {
        const bucketOrder: Array<[string, string]> = [
          ['AL_DIA', 'Al Día (0 DPD)'],
          ['1_5', '1–5 días'],
          ['6_15', '6–15 días'],
          ['16_30', '16–30 días'],
          ['31_60', '31–60 días'],
          ['61_90', '61–90 días'],
          ['90_MAS', '90+ días'],
        ];
        const rows: Array<Array<string | number>> = [];
        for (const cur of ['DOP', 'USD'] as const) {
          const m = parMetrics[cur];
          for (const [bKey, bLabel] of bucketOrder) {
            const b = m.buckets[bKey] ?? { count: 0, principalBalance: 0, overdueAmount: 0 };
            const pct =
              m.totalOutstandingPrincipal > 0
                ? ((b.principalBalance / m.totalOutstandingPrincipal) * 100).toFixed(2)
                : '0.00';
            rows.push([
              cur,
              bLabel,
              b.count,
              Math.round(b.principalBalance * 100) / 100,
              Math.round(b.overdueAmount * 100) / 100,
              `${pct}%`,
            ]);
          }
        }
        return {
          columns: ['Moneda', 'Tramo DPD', 'Cuentas', 'Saldo Capital', 'Monto Vencido', '% Cartera'],
          rows,
        };
      }
      case 'REP_03_PAR_HIST':
        return {
          columns: ['Moneda', 'Préstamos Activos', 'Saldo Capital', 'PAR 1%', 'PAR 30%', 'PAR 60%', 'PAR 90%'],
          rows: [
            ['DOP', parMetrics.DOP.activeLoansCount, parMetrics.DOP.totalOutstandingPrincipal, `${parMetrics.DOP.par1Pct}%`, `${parMetrics.DOP.par30Pct}%`, `${parMetrics.DOP.par60Pct}%`, `${parMetrics.DOP.par90Pct}%`],
            ['USD', parMetrics.USD.activeLoansCount, parMetrics.USD.totalOutstandingPrincipal, `${parMetrics.USD.par1Pct}%`, `${parMetrics.USD.par30Pct}%`, `${parMetrics.USD.par60Pct}%`, `${parMetrics.USD.par90Pct}%`],
          ],
        };
      case 'REP_04_PROMESAS':
        return {
          columns: ['Préstamo', 'Cliente', 'Moneda', 'Fecha', 'Prometido', 'Aplicado Verificado', 'Estado'],
          rows: paymentPromises.map((p) => [
            p.loanNumber,
            p.customerName,
            p.currency,
            p.promisedDate,
            p.promisedAmount,
            p.fulfilledAmount,
            p.status,
          ]),
        };
      case 'REP_05_GESTORES':
        return {
          columns: ['Gestor', 'Cuentas', 'Gestiones', 'Contactos Efect.', 'Promesas Cumpl.', 'Recuperado DOP', 'Recuperado USD'],
          rows: contactKpis.collectorBreakdown.map((c) => [
            c.collectorName,
            c.assignedAccounts,
            c.actionsCount,
            c.effectiveContactsCount,
            `${c.promisesFulfilledCount}/${c.promisesCount}`,
            c.recoveredAppliedDop,
            c.recoveredAppliedUsd,
          ]),
        };
      case 'REP_06_PAGOS_APLICADOS':
        return {
          columns: ['Fecha', 'Préstamo', 'Referencia', 'Moneda', 'Monto', 'Canal', 'Estado'],
          rows: payments.map((p) => [
            p.paymentDate,
            p.loanNumber,
            p.referenceNumber,
            p.currency,
            p.amount,
            p.method,
            p.status,
          ]),
        };
      case 'REP_07_REVERSOS':
        return {
          columns: ['Préstamo', 'Moneda', 'Monto Revertido', 'Motivo', 'Autorizado Por'],
          rows: paymentReversals.map((r) => [
            r.loanNumber,
            r.currency,
            r.reversedAmount,
            r.reason,
            r.authorizedByName,
          ]),
        };
      case 'REP_08_EXCEPCIONES_BANCO':
        return {
          columns: ['Tipo Excepción', 'ID Extracto', 'Detalle', 'Estado', 'Resuelto Por', 'Notas'],
          rows: reconciliationExceptions.map((ex) => [
            ex.exceptionType,
            ex.bankTransactionId,
            ex.detail,
            ex.status,
            ex.resolvedBy || 'Pendiente',
            ex.resolutionNotes || '—',
          ]),
        };
      case 'REP_09_RECUPERACION_CANAL': {
        const channelStats = new Map<
          string,
          { count: number; totalDop: number; totalUsd: number }
        >();
        for (const p of payments) {
          if (p.status !== 'APLICADO') continue;
          const prev = channelStats.get(p.method) ?? { count: 0, totalDop: 0, totalUsd: 0 };
          prev.count += 1;
          if (p.currency === 'DOP') prev.totalDop += p.amount;
          if (p.currency === 'USD') prev.totalUsd += p.amount;
          channelStats.set(p.method, prev);
        }
        return {
          columns: ['Canal de Pago', 'Pagos Aplicados', 'Recuperado DOP', 'Recuperado USD'],
          rows: Array.from(channelStats.entries()).map(([method, st]) => [
            method,
            st.count,
            Math.round(st.totalDop * 100) / 100,
            Math.round(st.totalUsd * 100) / 100,
          ]),
        };
      }
      case 'REP_10_PROVINCIA': {
        const provMap = new Map<
          string,
          { province: string; currency: string; count: number; overdueCount: number; principal: number; overdueAmt: number }
        >();
        for (const acc of effectiveAccounts) {
          const cust = customerById.get(acc.customerId);
          const province = cust?.province?.trim() || 'Sin provincia';
          const key = `${province}__${acc.currency}`;
          const prev = provMap.get(key) ?? {
            province,
            currency: acc.currency,
            count: 0,
            overdueCount: 0,
            principal: 0,
            overdueAmt: 0,
          };
          prev.count += 1;
          if (acc.dpd > 0) prev.overdueCount += 1;
          prev.principal += acc.totalOutstandingPrincipal;
          prev.overdueAmt += acc.overdueTotalAmount;
          provMap.set(key, prev);
        }
        return {
          columns: ['Provincia', 'Moneda', 'Préstamos', 'En Mora', 'Saldo Capital', 'Monto Vencido'],
          rows: Array.from(provMap.values()).map((r) => [
            r.province,
            r.currency,
            r.count,
            r.overdueCount,
            Math.round(r.principal * 100) / 100,
            Math.round(r.overdueAmt * 100) / 100,
          ]),
        };
      }
      case 'REP_11_PRODUCTO': {
        const prodMap = new Map<
          ProductCode,
          { count: number; overdueCount: number; principal: number; overdueAmt: number }
        >();
        for (const acc of effectiveAccounts) {
          const loan = loanById.get(acc.loanId);
          const prod = loan?.productCode ?? (acc.currency === 'USD' ? 'PERSONAL_USD' : 'PERSONAL_DOP');
          const prev = prodMap.get(prod) ?? { count: 0, overdueCount: 0, principal: 0, overdueAmt: 0 };
          prev.count += 1;
          if (acc.dpd > 0) prev.overdueCount += 1;
          prev.principal += acc.totalOutstandingPrincipal;
          prev.overdueAmt += acc.overdueTotalAmount;
          prodMap.set(prod, prev);
        }
        return {
          columns: ['Producto Crediticio', 'Moneda', 'Cuentas', 'En Mora', 'Saldo Capital', 'Monto Vencido'],
          rows: Array.from(prodMap.entries()).map(([prod, st]) => [
            PRODUCT_LABELS[prod],
            prod.endsWith('USD') ? 'USD' : 'DOP',
            st.count,
            st.overdueCount,
            Math.round(st.principal * 100) / 100,
            Math.round(st.overdueAmt * 100) / 100,
          ]),
        };
      }
      case 'REP_12_REESTRUCTURACIONES':
        return {
          columns: ['Préstamo', 'Cliente', 'Tipo', 'Moneda', 'Monto Acordado', 'Cuotas', 'Primer Venc.', 'Estado'],
          rows: paymentAgreements.map((ag) => [
            ag.loanNumber,
            ag.customerName,
            ag.agreementType,
            ag.currency,
            ag.totalAgreedAmount,
            ag.installmentCount,
            ag.firstDueDate,
            ag.status,
          ]),
        };
      case 'REP_13_CENTINELA':
        return {
          columns: ['Préstamo', 'Regla', 'Severidad', 'Título', 'Indicador', 'Estado'],
          rows: riskAlerts.map((a) => [
            a.loanNumber,
            a.ruleCode,
            a.severity,
            a.title,
            a.metricValue,
            a.status,
          ]),
        };
      case 'REP_14_RECLAMACIONES':
        return {
          columns: ['Préstamo', 'Cliente', 'Tipo Disputa', 'Pausa Bot', 'Estado', 'Descripción'],
          rows: customerDisputes.map((d) => [
            d.loanNumber,
            d.customerName,
            d.disputeType,
            d.pauseAutomatedMessages ? 'Sí' : 'No',
            d.status,
            d.description,
          ]),
        };
      case 'REP_15_BOT_CUMPLIMIENTO':
        return {
          columns: ['Préstamo', 'Canal', 'Dirección', 'Destinatario', 'Consentimiento', 'Estado Entrega', 'Bloqueo'],
          rows: messageEvents.map((m) => [
            m.loanNumber,
            m.channel,
            m.direction,
            m.recipientMasked,
            m.consentVerified ? 'Verificado' : 'Sin consent.',
            m.deliveryStatus,
            m.blockReason || '—',
          ]),
        };
      case 'REP_16_ANTIGUEDAD':
        return {
          columns: ['Préstamo', 'Cliente', 'Moneda', 'DPD', 'Capital Vencido', 'Interés Vencido', 'Mora Acumulada', 'Total Vencido'],
          rows: effectiveAccounts.map((a) => [
            a.loanNumber,
            a.applicantDisplayName,
            a.currency,
            a.dpd,
            a.overduePrincipal,
            a.overdueInterest,
            a.overdueLateFee,
            a.overdueTotalAmount,
          ]),
        };
      case 'REP_17_ANTICIPATE':
        return {
          columns: ['Horizonte', 'Cuotas', 'Contractual DOP', 'Base DOP', 'Estrés DOP', 'Contractual USD', 'Base USD'],
          rows: projections.map((pr) => [
            `${pr.horizonDays} días`,
            pr.installmentsCount,
            pr.scheduledDueDop,
            pr.expectedBaseDop,
            pr.expectedStressDop,
            pr.scheduledDueUsd,
            pr.expectedBaseUsd,
          ]),
        };
      case 'REP_18_SNAPSHOTS':
        return {
          columns: ['Fecha Corte', 'Política', 'Activos', 'En Mora', 'Saldo DOP', 'PAR 30 DOP', 'Saldo USD', 'PAR 30 USD'],
          rows: collectionDailySnapshots.map((s) => [
            s.cutoffDate,
            s.policyVersion,
            s.totalActiveLoans,
            s.overdueLoansCount,
            s.principalBalanceDop,
            `${s.par30Dop}%`,
            s.principalBalanceUsd,
            `${s.par30Usd}%`,
          ]),
        };
      case 'REP_19_CANCELADOS':
        return {
          columns: ['Préstamo', 'Cliente', 'Moneda', 'Capital Original', 'Certificado', 'Estado'],
          rows: loans
            .filter((l) => l.status === 'CANCELADO' || l.status === 'PAGADO')
            .map((l) => [
              l.loanNumber,
              l.applicantDisplayName,
              l.currency,
              l.totalFinancedPrincipal,
              l.closureCertificateNumber || 'Pendiente emisión',
              l.status,
            ]),
        };
      case 'REP_20_AUDITORIA_COBRO':
        return {
          columns: ['Evento', 'Acción', 'Transición', 'Usuario', 'Rol', 'Fecha'],
          rows: collectionsAuditLogs.map((l) => [
            l.eventType,
            l.action,
            `${l.previousState || '—'} → ${l.newState || '—'}`,
            l.userEmail || l.userId,
            l.userRole || '—',
            formatTimestamp(l.timestamp),
          ]),
        };
      case 'REP_01_CARTERA_TOTAL':
      default:
        return {
          columns: ['Préstamo', 'Cliente', 'Moneda', 'DPD', 'Tramo', 'Etapa', 'Saldo Capital', 'Vencido', 'Gestor'],
          rows: effectiveAccounts.map((a) => [
            a.loanNumber,
            a.applicantDisplayName,
            a.currency,
            a.dpd,
            a.bucket,
            a.stage,
            a.totalOutstandingPrincipal,
            a.overdueTotalAmount,
            a.assignedCollectorName || 'Sin asignar',
          ]),
        };
    }
  }, [
    selectedReportId,
    parMetrics,
    paymentPromises,
    contactKpis,
    payments,
    paymentReversals,
    reconciliationExceptions,
    paymentAgreements,
    riskAlerts,
    customerDisputes,
    messageEvents,
    collectionDailySnapshots,
    collectionsAuditLogs,
    projections,
    loans,
    customers,
    effectiveAccounts,
  ]);

  const activeReportMeta =
    COBRANZA_20_REPORTS.find((r) => r.id === selectedReportId) ?? COBRANZA_20_REPORTS[0];

  const filteredCatalogReports = useMemo(() => {
    const q = reportCatalogSearch.trim().toLowerCase();
    if (!q) return COBRANZA_20_REPORTS;
    return COBRANZA_20_REPORTS.filter(
      (r) => r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q)
    );
  }, [reportCatalogSearch]);

  const visibleReportRows = useMemo(() => {
    const q = reportRowSearch.trim().toLowerCase();
    if (!q) return reportTable.rows;
    return reportTable.rows.filter((row) =>
      row.some((cell) => String(cell ?? '').toLowerCase().includes(q))
    );
  }, [reportTable.rows, reportRowSearch]);

  const handleExport = (format: 'csv' | 'pdf' | 'xls') => {
    const payload = {
      reportId: activeReportMeta.id,
      reportTitle: activeReportMeta.title,
      reportSubtitle: activeReportMeta.subtitle,
      organizationName: organization.name,
      organizationTaxId: organization.taxId,
      primaryColor: organization.primaryColor,
      policyVersion: activeCollectionPolicy.version,
      filtersSummary: `Fecha de corte: ${cutoffDate} (America/Santo_Domingo) · DOP y USD separados`,
      generatedBy: userProfile?.displayName || 'AxyCore',
      columns: reportTable.columns,
      rows: visibleReportRows,
      financialSummary: {
        totalSubmitted: parMetrics.DOP.activeLoansCount + parMetrics.USD.activeLoansCount,
        approvedCount: loans.filter((l) => l.status === 'ACTIVO').length,
        rejectedCount: parMetrics.DOP.overdueLoansCount + parMetrics.USD.overdueLoansCount,
        approvalRatePct: parMetrics.DOP.par30Pct,
        averageScore: null,
        requestedDop: parMetrics.DOP.overdueInstallmentsAmount,
        requestedUsd: parMetrics.USD.overdueInstallmentsAmount,
        approvedDop: contactKpis.recoveredAppliedDop,
        approvedUsd: contactKpis.recoveredAppliedUsd,
        disbursedDop: parMetrics.DOP.totalOutstandingPrincipal,
        disbursedUsd: parMetrics.USD.totalOutstandingPrincipal,
        activePrincipalDop: parMetrics.DOP.totalOutstandingPrincipal,
        activePrincipalUsd: parMetrics.USD.totalOutstandingPrincipal,
      },
    };
    if (format === 'xls') {
      const esc = (v: unknown) =>
        String(v ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      const headerRow = `<Row>${reportTable.columns
        .map((c) => `<Cell><Data ss:Type="String">${esc(c)}</Data></Cell>`)
        .join('')}</Row>`;
      const bodyRows = visibleReportRows
        .map(
          (r) =>
            `<Row>${r
              .map((cell) => {
                const isNum = typeof cell === 'number' && Number.isFinite(cell);
                return `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${esc(cell)}</Data></Cell>`;
              })
              .join('')}</Row>`
        )
        .join('');
      const xml = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n <Worksheet ss:Name="CobranzaAxyCore">\n  <Table>${headerRow}${bodyRows}</Table>\n </Worksheet>\n</Workbook>`;
      const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AxyCore_${activeReportMeta.id}_${cutoffDate}.xls`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFeedback({ type: 'ok', msg: `Hoja Excel (.xls) descargada para ${activeReportMeta.title}.` });
      return;
    }
    const file = format === 'csv' ? exportReportToCsv(payload) : exportReportToPdf(payload);
    setFeedback({ type: 'ok', msg: `Archivo generado correctamente: ${file}` });
  };

  const moveImputation = (index: number, dir: -1 | 1) => {
    const next = [...policyDraft.imputationOrder];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPolicyDraft({ ...policyDraft, imputationOrder: next });
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div className="space-y-1">
          {mode === 'reports' && (
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#0066FF] dark:text-[#00D1FF]">
              Módulo Reportes · Reportes de Cobranza
            </p>
          )}
          <h2 className="font-display text-2xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
            {(mode === 'dashboard' || mode === 'anticipate') && (
              <Activity className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />
            )}
            {mode === 'params' && <Sliders className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />}
            {mode === 'audit' && <ShieldCheck className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />}
            {mode === 'anticipate'
              ? 'Anticípate 30 / 60 / 90 Días — Proyección Predictiva de Flujos y Estrés'
              : mode === 'dashboard'
              ? 'Dashboard Ejecutivo de Cobranza y Anticípate 30/60/90d'
              : mode === 'reports'
              ? 'Reportes de Cobranza (20 Informes)'
              : mode === 'params'
              ? 'Parámetros Versionados de Cobranza e Imputación'
              : 'Auditoría de Cobranza y Cierre Formal de Préstamos'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Cifras separadas estrictamente por moneda (DOP vs USD) y calculadas en zona horaria America/Santo_Domingo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'reports' && rbac.canAccessSection('reports') && (
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/80 dark:border-[#00B8FF]/20 mr-1">
              <button
                type="button"
                onClick={() => setActiveSection('reports')}
                className="px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                Reportes y Analítica
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('cobranza_reports')}
                className="px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                Reportes de Cobranza (20)
              </button>
            </div>
          )}

          {(mode === 'dashboard' || mode === 'anticipate' || mode === 'reports') && (
            <div className="flex items-center gap-2 bg-white dark:bg-[#08132B] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20">
              <span className="text-slate-500 dark:text-slate-400">Corte:</span>
              <input
                type="date"
                value={cutoffDate}
                onChange={(e) => setCutoffDate(e.target.value)}
                className="font-mono bg-transparent outline-none text-slate-900 dark:text-white"
              />
            </div>
          )}
          {mode === 'reports' && (
            <>
              <button
                type="button"
                onClick={() => handleExport('pdf')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                Exportar PDF
              </button>
              <button
                type="button"
                onClick={() => handleExport('csv')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                Exportar CSV
              </button>
              <button
                type="button"
                onClick={() => handleExport('xls')}
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
            </>
          )}
          {(mode === 'dashboard' || mode === 'anticipate') && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await runDailyCollectionsSync({ asOfDateIso: cutoffDate, saveSnapshot: true });
                setFeedback({
                  type: 'ok',
                  msg: `Corte diario guardado (${cutoffDate}): ${res.syncedLoans} préstamos sincronizados, ${res.newAlerts} alertas, ${res.newTasks} tareas.`,
                });
                setBusy(false);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Ejecutar Corte Diario y Snapshot
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {(mode === 'dashboard' || mode === 'anticipate') && (
        <div className="space-y-6">
          {/* Separate DOP & USD KPI panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {([parMetrics.DOP, parMetrics.USD] as const).map((m) => (
              <div
                key={m.currency}
                className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                    Cartera en {m.currency === 'DOP' ? 'Pesos Dominicanos (DOP)' : 'Dólares Estadounidenses (USD)'}
                  </h3>
                  <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                    {m.activeLoansCount} activos · {m.overdueLoansCount} en mora
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">
                      Saldo Capital Vigente
                    </p>
                    <p className="font-mono tabular-nums text-xl font-bold text-slate-950 dark:text-white mt-1">
                      {formatMoney(m.totalOutstandingPrincipal, m.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">
                      Monto Vencido Exigible
                    </p>
                    <p className="font-mono tabular-nums text-xl font-bold text-rose-700 dark:text-rose-400 mt-1">
                      {formatMoney(m.overdueInstallmentsAmount, m.currency)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-200/80 dark:border-white/[0.08] font-mono tabular-nums">
                  <div>
                    <p className="text-[10px] font-sans uppercase tracking-wider text-slate-500 dark:text-slate-400">PAR 1</p>
                    <p className="font-bold text-sm mt-0.5 text-slate-950 dark:text-white">{m.par1Pct}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-sans uppercase tracking-wider text-slate-500 dark:text-slate-400">PAR 30</p>
                    <p className="font-bold text-sm mt-0.5 text-slate-950 dark:text-white">{m.par30Pct}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-sans uppercase tracking-wider text-slate-500 dark:text-slate-400">PAR 60</p>
                    <p className="font-bold text-sm mt-0.5 text-slate-950 dark:text-white">{m.par60Pct}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-sans uppercase tracking-wider text-slate-500 dark:text-slate-400">PAR 90</p>
                    <p className="font-bold text-sm mt-0.5 text-slate-950 dark:text-white">{m.par90Pct}%</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Interactive Recharts Analytics Row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Aging Bucket Distribution Chart */}
            <div className="lg:col-span-7 p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF] shrink-0" />
                    <span>Distribución de Cartera y Mora por Tramo DPD ({chartCurrency})</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Exposición de saldo capital y monto vencido por antigüedad de atraso
                  </p>
                </div>
                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 dark:bg-[#040C1E]/60 border border-slate-200/60 dark:border-[#00B8FF]/15">
                  {(['DOP', 'USD'] as const).map((cur) => (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => setChartCurrency(cur)}
                      className={`px-2.5 py-1 rounded-lg font-mono font-semibold transition-all cursor-pointer ${
                        chartCurrency === cur
                          ? 'bg-white dark:bg-[#0E1D40] text-[#0052CC] dark:text-[#00D1FF] shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                      }`}
                    >
                      {cur}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingChartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis
                      dataKey="bucketLabel"
                      tick={{ fill: axisTickColor, fontSize: 11 }}
                      axisLine={{ stroke: gridStroke }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: axisTickColor, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={compactCurrency}
                    />
                    <Tooltip
                      cursor={{ fill: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.03)' }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload as (typeof agingChartData)[number] | undefined;
                        if (!row) return null;
                        return (
                          <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#00B8FF]/25 shadow-md text-xs space-y-1 font-mono tabular-nums">
                            <p className="font-sans font-semibold text-slate-950 dark:text-white">
                              Tramo {label} ({row.count} préstamos)
                            </p>
                            <p className="text-[#0066FF] dark:text-[#00D1FF]">
                              Saldo Capital: {formatMoney(row.principalBalance, chartCurrency)}
                            </p>
                            <p className="text-rose-700 dark:text-rose-400">
                              Monto Vencido: {formatMoney(row.overdueAmount, chartCurrency)}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar
                      dataKey="principalBalance"
                      name={`Saldo Capital (${chartCurrency})`}
                      fill="#0066FF"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={36}
                    />
                    <Bar
                      dataKey="overdueAmount"
                      name={`Monto Vencido (${chartCurrency})`}
                      fill="#EF4444"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={36}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Anticípate 30/60/90 Visual Chart */}
            <div className="lg:col-span-5 p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#00B8FF] shrink-0" />
                  <span>Flujo Esperado Anticípate ({chartCurrency})</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Contractual vs. Esperado Base vs. Escenario Estrés (30 / 60 / 90d)
                </p>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={anticipateChartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis
                      dataKey="horizonLabel"
                      tick={{ fill: axisTickColor, fontSize: 11 }}
                      axisLine={{ stroke: gridStroke }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: axisTickColor, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={compactCurrency}
                    />
                    <Tooltip
                      cursor={{ fill: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.03)' }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload as (typeof anticipateChartData)[number] | undefined;
                        if (!row) return null;
                        return (
                          <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#00B8FF]/25 shadow-md text-xs space-y-1 font-mono tabular-nums">
                            <p className="font-sans font-semibold text-slate-950 dark:text-white">
                              Horizonte {label} ({row.installmentsCount} cuotas)
                            </p>
                            <p className="text-[#0066FF] dark:text-[#00D1FF]">
                              Contractual: {formatMoney(row.contractual, chartCurrency)}
                            </p>
                            <p className="text-[#00B8FF]">
                              Base: {formatMoney(row.expectedBase, chartCurrency)}
                            </p>
                            <p className="text-[#E2B35E]">
                              Estrés: {formatMoney(row.expectedStress, chartCurrency)}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="contractual" name="Contractual" fill="#0066FF" radius={[4, 4, 0, 0]} maxBarSize={26} />
                    <Bar dataKey="expectedBase" name="Esperado Base" fill="#00B8FF" radius={[4, 4, 0, 0]} maxBarSize={26} />
                    <Bar dataKey="expectedStress" name="Estrés" fill="#E2B35E" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Anticípate 30 / 60 / 90 Projections Detail Cards */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
            <h3 className="font-display text-sm font-bold flex items-center gap-2 text-slate-950 dark:text-white">
              <TrendingUp className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
              Anticípate 30 / 60 / 90 Días (Flujos Proyectados desde Cuotas Reales)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {projections.map((p) => (
                <div
                  key={p.horizonDays}
                  className="p-4 rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.02] space-y-2"
                >
                  <div className="flex justify-between font-bold text-slate-950 dark:text-white">
                    <span>Horizonte {p.horizonDays} días</span>
                    <span className="font-mono text-slate-500">{p.installmentsCount} cuotas</span>
                  </div>
                  <div className="space-y-1 font-mono tabular-nums">
                    <p>Contractual DOP: <strong>{formatMoney(p.scheduledDueDop, 'DOP')}</strong></p>
                    <p className="text-emerald-700 dark:text-emerald-400">
                      Esperado Base DOP: {formatMoney(p.expectedBaseDop, 'DOP')}
                    </p>
                    <p className="text-amber-700 dark:text-amber-400">
                      Escenario Estrés DOP: {formatMoney(p.expectedStressDop, 'DOP')}
                    </p>
                    <p className="pt-1.5 border-t border-slate-200/80 dark:border-white/[0.08]">
                      Contractual USD: <strong>{formatMoney(p.scheduledDueUsd, 'USD')}</strong>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === 'reports' && (
        <div className="space-y-6">
          {/* Collections Report KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Cartera Vigente
              </p>
              <p className="font-display text-xl font-bold font-mono tabular-nums text-slate-950 dark:text-white mt-1">
                {formatMoney(parMetrics.DOP.totalOutstandingPrincipal, 'DOP')}
              </p>
              <p className="text-xs font-mono tabular-nums text-[#0066FF] dark:text-[#00D1FF] mt-0.5">
                {formatMoney(parMetrics.USD.totalOutstandingPrincipal, 'USD')}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Monto Vencido Exigible
              </p>
              <p className="font-display text-xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400 mt-1">
                {formatMoney(parMetrics.DOP.overdueInstallmentsAmount, 'DOP')}
              </p>
              <p className="text-xs font-mono tabular-nums text-rose-500/80 dark:text-rose-300 mt-0.5">
                {formatMoney(parMetrics.USD.overdueInstallmentsAmount, 'USD')}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Indicador PAR 30
              </p>
              <p className="font-display text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-[#E2B35E] mt-1">
                {parMetrics.DOP.par30Pct}% <span className="text-xs font-normal text-slate-400">DOP</span>
              </p>
              <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                {parMetrics.USD.par30Pct}% USD · {parMetrics.DOP.overdueLoansCount + parMetrics.USD.overdueLoansCount} en mora
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Recuperado Aplicado
              </p>
              <p className="font-display text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                {formatMoney(contactKpis.recoveredAppliedDop, 'DOP')}
              </p>
              <p className="text-xs font-mono tabular-nums text-emerald-600/80 dark:text-emerald-300 mt-0.5">
                {formatMoney(contactKpis.recoveredAppliedUsd, 'USD')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Searchable Catalog of 20 Collection Reports */}
            <div className="lg:col-span-4 space-y-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={reportCatalogSearch}
                  onChange={(e) => setReportCatalogSearch(e.target.value)}
                  placeholder="Buscar entre los 20 informes de cobranza..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200/85 dark:border-[#00B8FF]/18 bg-white dark:bg-[#08132B] text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
                {filteredCatalogReports.map((r) => {
                  const active = selectedReportId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedReportId(r.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer ${
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
            </div>

            {/* Active Report Table */}
            <div className="lg:col-span-8 space-y-4">
              <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center shrink-0">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                      {activeReportMeta.title}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {activeReportMeta.subtitle} · Corte: {cutoffDate} ·{' '}
                      <span className="font-mono tabular-nums">{visibleReportRows.length}</span> filas
                    </p>
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={reportRowSearch}
                    onChange={(e) => setReportRowSearch(e.target.value)}
                    placeholder="Filtrar registros..."
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white w-48"
                  />
                </div>
              </div>

              <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
                <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-[#040C1E]">
                      <tr className="border-b border-slate-200/80 dark:border-white/10 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {reportTable.columns.map((c) => (
                          <th key={c} className="py-3 px-3 font-semibold whitespace-nowrap">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-mono tabular-nums">
                      {visibleReportRows.map((row, idx) => (
                        <tr
                          key={idx}
                          className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors"
                        >
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="py-2.5 px-3 whitespace-nowrap text-slate-800 dark:text-slate-200"
                            >
                              {typeof cell === 'number' ? cell.toLocaleString('en-US') : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {visibleReportRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={reportTable.columns.length}
                            className="py-10 text-center text-slate-500 dark:text-slate-400 font-sans"
                          >
                            Sin registros para esta fecha de corte ({cutoffDate}) y filtros.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {collectionDailySnapshots.length > 0 && (
                <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 space-y-2">
                  <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                    Instantáneas Históricas Guardadas ({collectionDailySnapshots.length})
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {collectionDailySnapshots.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setCutoffDate(s.cutoffDate)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/20 font-mono cursor-pointer hover:bg-slate-50 dark:hover:bg-[#040C1E] text-slate-700 dark:text-slate-200"
                      >
                        {s.cutoffDate} · PAR30 DOP {s.par30Dop}% / USD {s.par30Usd}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {mode === 'params' && (
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold">
              Política de Cobranza Versionada ({policyDraft.version})
            </h3>
            <span className="font-mono text-slate-500">
              Versiones registradas: {collectionPolicies.length}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block mb-1 text-slate-500">Días de Gracia Mora</label>
              <input
                type="number"
                value={policyDraft.graceDays}
                onChange={(e) => setPolicyDraft({ ...policyDraft, graceDays: Number(e.target.value) })}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 text-slate-500">Tasa de Mora Mensual (%)</label>
              <input
                type="number"
                step="0.1"
                value={policyDraft.lateFeeRateMonthlyPct}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, lateFeeRateMonthlyPct: Number(e.target.value) })
                }
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 text-slate-500">Contactos Máx./Día</label>
              <input
                type="number"
                value={policyDraft.maxDailyContactsPerLoan}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, maxDailyContactsPerLoan: Number(e.target.value) })
                }
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 text-slate-500">Bot Máx./Semana</label>
              <input
                type="number"
                value={policyDraft.maxWeeklyBotMessagesPerLoan}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, maxWeeklyBotMessagesPerLoan: Number(e.target.value) })
                }
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-semibold">Orden Configurable de Imputación de Pagos</p>
            <div className="flex flex-wrap gap-2">
              {policyDraft.imputationOrder.map((comp, i) => (
                <div
                  key={comp}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                >
                  <span>{i + 1}. {comp}</span>
                  <button type="button" onClick={() => moveImputation(i, -1)} className="cursor-pointer">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => moveImputation(i, 1)} className="cursor-pointer">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={policyDraft.autoApplyExactBankMatch}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, autoApplyExactBankMatch: e.target.checked })
                }
              />
              Auto-aplicar coincidencias bancarias EXACTAS en conciliación
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={policyDraft.allowedContactHours.allowSundays}
                onChange={(e) =>
                  setPolicyDraft({
                    ...policyDraft,
                    allowedContactHours: {
                      ...policyDraft.allowedContactHours,
                      allowSundays: e.target.checked,
                    },
                  })
                }
              />
              Permitir contactos los domingos
            </label>
          </div>

          {rbac.hasPermission('MANAGE_COLLECTION_POLICIES') && userProfile && (
            <div className="flex flex-wrap gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <input
                value={newPolVersion}
                onChange={(e) => setNewPolVersion(e.target.value)}
                placeholder="Nueva versión (ej. cobranza-v1.1)"
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const version = newPolVersion.trim() || `cobranza-v1.${collectionPolicies.length + 1}`;
                  await saveCollectionPolicyVersion({
                    policy: {
                      ...policyDraft,
                      id: `col_pol_${Date.now().toString().slice(-6)}`,
                      organizationId: userProfile.organizationId,
                      version,
                      status: 'ACTIVA',
                    },
                    previousActivePolicyId: activeCollectionPolicy.id,
                    user: userProfile,
                  });
                  setNewPolVersion('');
                  setFeedback({
                    type: 'ok',
                    msg: `Nueva política de cobranza ${version} activada con registro en auditoría.`,
                  });
                  setBusy(false);
                }}
                className="px-4 py-2 rounded-lg bg-sky-700 text-white font-semibold cursor-pointer"
              >
                Guardar y Activar Nueva Versión
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'audit' && (
        <div className="space-y-6">
          {/* Formal Loan Closure Queue */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <h3 className="font-display text-sm font-bold flex items-center gap-2">
              <Award className="w-4 h-4 text-sky-600" />
              Control de Cierre y Cancelación Formal de Préstamos
            </h3>
            <div className="space-y-2">
              {loans.map((l) => {
                const check = validateLoanCancellationEligibility({
                  loan: l,
                  installments: loanInstallments.filter((i) => i.loanId === l.id),
                  payments: payments.filter((p) => p.loanId === l.id),
                  disputes: customerDisputes.filter((d) => d.loanId === l.id),
                  exceptions: reconciliationExceptions,
                });
                if (!check.allowed && l.status !== 'CANCELADO' && l.currentPrincipalBalance > 0) return null;
                return (
                  <div
                    key={l.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-mono font-bold">{l.loanNumber}</span> · {l.applicantDisplayName} ·{' '}
                      <span className="font-semibold">{l.status}</span>
                      {!check.allowed && l.status !== 'CANCELADO' && (
                        <p className="text-rose-700 dark:text-rose-400">{check.reasons.join(' | ')}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedCollectionLoanId(l.id)}
                        className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer"
                      >
                        Ver Ficha 360°
                      </button>
                      {check.allowed && rbac.hasPermission('CLOSE_CANCEL_LOAN') && userProfile && (
                        <button
                          type="button"
                          onClick={async () => {
                            const cert = await executeFormalLoanClosureTransaction({
                              loan: l,
                              installments: loanInstallments.filter((i) => i.loanId === l.id),
                              payments: payments.filter((p) => p.loanId === l.id),
                              disputes: customerDisputes.filter((d) => d.loanId === l.id),
                              exceptions: reconciliationExceptions,
                              user: userProfile,
                            });
                            setFeedback({ type: 'ok', msg: `Préstamo cancelado formalmente: ${cert}` });
                          }}
                          className="px-3 py-1 rounded bg-emerald-700 text-white font-semibold cursor-pointer"
                        >
                          Emitir Cierre Formal
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold">
                Bitácora Inmutable de Auditoría Cobranza ({collectionsAuditLogs.length})
              </h3>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <th className="py-2.5 px-4">Fecha / Evento</th>
                  <th className="py-2.5 px-3">Acción</th>
                  <th className="py-2.5 px-3">Estado Anterior → Nuevo</th>
                  <th className="py-2.5 px-3">Usuario / Rol</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {collectionsAuditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 px-4">
                      <p className="font-mono font-semibold">{log.eventType}</p>
                      <p className="text-slate-500 font-mono">{formatTimestamp(log.timestamp)}</p>
                    </td>
                    <td className="py-2 px-3">
                      <p>{log.action}</p>
                      {log.justification && <p className="text-slate-500">{log.justification}</p>}
                    </td>
                    <td className="py-2 px-3 font-mono">
                      {log.previousState || '—'} → {log.newState || '—'}
                    </td>
                    <td className="py-2 px-3">
                      <p>{log.userEmail}</p>
                      <p className="text-slate-500 font-mono">{log.userRole}</p>
                    </td>
                  </tr>
                ))}
                {collectionsAuditLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      Aún no existen eventos de auditoría de cobranza registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
