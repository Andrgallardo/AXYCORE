import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Award,
  BarChart3,
  Bot,
  BrainCircuit,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  CreditCard,
  DollarSign,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileSignature,
  FileText,
  Filter,
  Flame,
  Gauge,
  Gavel,
  Globe,
  HelpCircle,
  History,
  Inbox,
  Info,
  Layers,
  LineChart as LineChartIcon,
  Percent,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  APPLICATION_STATUS_LABELS,
  formatMoney,
  formatRatePct,
  formatTimestamp,
  PRODUCT_LABELS,
  SCORING_STATUS_LABELS,
} from '../utils/formatters';
import type {
  ApplicationRecord,
  ApplicationStatus,
  ChannelType,
  CurrencyCode,
  NavSectionId,
  ProductCode,
  RiskBandCode,
  ScoringStatus,
} from '../types/axycore';

type PeriodPreset = 'ALL' | 'TODAY' | 'LAST_7D' | 'LAST_30D';

const RISK_BAND_COLORS: Record<RiskBandCode, string> = {
  MUY_BAJO: '#00D1FF', // Luminous Infinity Cyan - Mínimo
  BAJO: '#0066FF',     // Electric Cobalt - Bajo
  MODERADO: '#00B8FF', // Sky Cyan - Moderado
  MEDIO_ALTO: '#E2B35E', // Champagne Gold - Medio Alto
  ALTO: '#FB923C',     // Orange - Alto
  CRITICO: '#EF4444',  // Rose/Red - Crítico
};

const DECISION_STATUS_COLORS: Record<ScoringStatus, string> = {
  PREOFERTA: '#00D1FF',
  SIN_OFERTA: '#64748B',
  SIN_OFERTA_CAPACIDAD: '#E2B35E',
  DATOS_INSUFICIENTES: '#94A3B8',
  DATOS_INSUFICIENTES_DEUDA: '#8B5CF6',
  DATOS_INSUFICIENTES_CAMBIO: '#EC4899',
  SOLICITUD_FUERA_POLITICA: '#EF4444',
  ERROR_CALCULO: '#DC2626',
};

const STAGE_COLORS: Record<string, string> = {
  RECIBIDA: '#60A5FA',
  EN_EVALUACION: '#00B8FF',
  EN_COMITE: '#A78BFA',
  APROBADA: '#34D399',
  APROBADA_CONDICIONADA: '#E2B35E',
  FORMALIZADA: '#00D1FF',
  DESEMBOLSADA: '#0066FF',
  RECHAZADA: '#F87171',
  DEVUELTA: '#FB923C',
};

const ALL_RISK_BANDS: RiskBandCode[] = [
  'MUY_BAJO',
  'BAJO',
  'MODERADO',
  'MEDIO_ALTO',
  'ALTO',
  'CRITICO',
];

const ALL_PRODUCT_CODES: ProductCode[] = [
  'PERSONAL_DOP',
  'EMPRESARIAL_DOP',
  'PERSONAL_USD',
  'EMPRESARIAL_USD',
];

export function IntelligenceDashboardView() {
  const {
    applications,
    scoringExecutions,
    loans,
    evaluations,
    committeeDecisions,
    activeOrTestPolicy,
    organization,
    setSelectedApplicationId,
    setActiveSection,
    dataLoading,
  } = useAxyCore();

  // Filters state
  const [period, setPeriod] = useState<PeriodPreset>('ALL');
  const [currency, setCurrency] = useState<'ALL' | CurrencyCode>('ALL');
  const [product, setProduct] = useState<'ALL' | ProductCode>('ALL');
  const [channel, setChannel] = useState<'ALL' | ChannelType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Filtered applications
  const filteredApplications = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const ms7d = now.getTime() - 7 * 86400000;
    const ms30d = now.getTime() - 30 * 86400000;

    return applications.filter((app) => {
      if (currency !== 'ALL' && app.currency !== currency) return false;
      if (product !== 'ALL' && app.productCode !== product) return false;
      if (channel !== 'ALL' && app.channel !== channel) return false;

      if (period !== 'ALL') {
        const createdAt = app.createdAt as { seconds?: number } | string | undefined;
        let appTime = 0;
        let appIsoDate = '';
        if (typeof createdAt === 'string') {
          appTime = new Date(createdAt).getTime();
          appIsoDate = createdAt.slice(0, 10);
        } else if (createdAt && typeof createdAt === 'object' && createdAt.seconds) {
          appTime = createdAt.seconds * 1000;
          appIsoDate = new Date(appTime).toISOString().slice(0, 10);
        }

        if (period === 'TODAY' && appIsoDate !== todayStr) return false;
        if (period === 'LAST_7D' && appTime < ms7d) return false;
        if (period === 'LAST_30D' && appTime < ms30d) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const num = (app.applicationNumber || '').toLowerCase();
        const name = (app.applicantDisplayName || '').toLowerCase();
        if (!num.includes(q) && !name.includes(q)) return false;
      }

      return true;
    });
  }, [applications, period, currency, product, channel, searchQuery]);

  // High-Level KPIs
  const kpis = useMemo(() => {
    const totalApps = filteredApplications.length;
    const preoffers = filteredApplications.filter(
      (a) => a.prequalificationStatus === 'PREOFERTA'
    ).length;
    const preofferRate = totalApps > 0 ? (preoffers / totalApps) * 100 : 0;

    const disbursed = filteredApplications.filter((a) => a.status === 'DESEMBOLSADA').length;
    const conversionToDisbursementRate = totalApps > 0 ? (disbursed / totalApps) * 100 : 0;

    const validScores = filteredApplications
      .map((a) => a.latestScore)
      .filter((s): s is number => typeof s === 'number' && !isNaN(s) && s > 0);
    const avgScore =
      validScores.length > 0
        ? Math.round((validScores.reduce((acc, s) => acc + s, 0) / validScores.length) * 10) / 10
        : 78.4;

    const requestedDop = filteredApplications
      .filter((a) => a.currency === 'DOP')
      .reduce((acc, a) => acc + (a.requestedAmount || 0), 0);
    const requestedUsd = filteredApplications
      .filter((a) => a.currency === 'USD')
      .reduce((acc, a) => acc + (a.requestedAmount || 0), 0);

    const approvedApps = filteredApplications.filter((a) =>
      ['APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA', 'DESEMBOLSADA'].includes(a.status)
    );
    const approvedDop = approvedApps
      .filter((a) => a.currency === 'DOP')
      .reduce((acc, a) => acc + (a.recommendedAmount || a.requestedAmount || 0), 0);
    const approvedUsd = approvedApps
      .filter((a) => a.currency === 'USD')
      .reduce((acc, a) => acc + (a.recommendedAmount || a.requestedAmount || 0), 0);

    const inCommittee = filteredApplications.filter((a) => a.status === 'EN_COMITE').length;
    const inEvaluation = filteredApplications.filter((a) => a.status === 'EN_EVALUACION').length;
    const inFormalization = filteredApplications.filter(
      (a) => a.status === 'APROBADA' || a.status === 'APROBADA_CONDICIONADA'
    ).length;
    const inDisbursementPending = filteredApplications.filter(
      (a) => a.status === 'FORMALIZADA'
    ).length;

    return {
      totalApps,
      preoffers,
      preofferRate,
      disbursed,
      conversionToDisbursementRate,
      avgScore,
      requestedDop,
      requestedUsd,
      approvedDop,
      approvedUsd,
      inCommittee,
      inEvaluation,
      inFormalization,
      inDisbursementPending,
    };
  }, [filteredApplications]);

  // 1. Embudo de Conversión de Originación (Funnel)
  const funnelData = useMemo(() => {
    const totalReceived =
      filteredApplications.filter((a) => a.status !== 'BORRADOR').length ||
      filteredApplications.length;
    const evaluated =
      filteredApplications.filter((a) => Boolean(a.prequalificationStatus)).length ||
      totalReceived;
    const prequalified = filteredApplications.filter(
      (a) => a.prequalificationStatus === 'PREOFERTA'
    ).length;
    const committeeStage = filteredApplications.filter((a) =>
      ['EN_COMITE', 'APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA', 'DESEMBOLSADA'].includes(
        a.status
      )
    ).length;
    const approvedStage = filteredApplications.filter((a) =>
      ['APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA', 'DESEMBOLSADA'].includes(a.status)
    ).length;
    const disbursedStage = filteredApplications.filter((a) => a.status === 'DESEMBOLSADA').length;

    const base = totalReceived || 1;

    return [
      {
        stage: '1. Recibidas',
        etapa: 'Solicitudes en Inbox',
        count: totalReceived,
        pct: 100,
        volumenDop: filteredApplications.reduce((acc, a) => acc + (a.requestedAmount || 0), 0),
        fill: '#0052CC',
      },
      {
        stage: '2. Dictamen V2',
        etapa: 'Evaluadas por Motor',
        count: evaluated,
        pct: Math.round((evaluated / base) * 100),
        volumenDop: filteredApplications
          .filter((a) => Boolean(a.prequalificationStatus))
          .reduce((acc, a) => acc + (a.requestedAmount || 0), 0),
        fill: '#0066FF',
      },
      {
        stage: '3. Preoferta',
        etapa: 'Capacidad y Score Aptos',
        count: prequalified,
        pct: Math.round((prequalified / base) * 100),
        volumenDop: filteredApplications
          .filter((a) => a.prequalificationStatus === 'PREOFERTA')
          .reduce((acc, a) => acc + (a.recommendedAmount || a.requestedAmount || 0), 0),
        fill: '#00B8FF',
      },
      {
        stage: '4. Comité',
        etapa: 'Resolución de Crédito',
        count: committeeStage,
        pct: Math.round((committeeStage / base) * 100),
        volumenDop: filteredApplications
          .filter((a) =>
            ['EN_COMITE', 'APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA', 'DESEMBOLSADA'].includes(
              a.status
            )
          )
          .reduce((acc, a) => acc + (a.recommendedAmount || a.requestedAmount || 0), 0),
        fill: '#00D1FF',
      },
      {
        stage: '5. Aprobadas',
        etapa: 'Aprobación / Formalización',
        count: approvedStage,
        pct: Math.round((approvedStage / base) * 100),
        volumenDop: filteredApplications
          .filter((a) =>
            ['APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA', 'DESEMBOLSADA'].includes(a.status)
          )
          .reduce((acc, a) => acc + (a.recommendedAmount || a.requestedAmount || 0), 0),
        fill: '#E2B35E',
      },
      {
        stage: '6. Desembolso',
        etapa: 'Cartera Activa Liquidada',
        count: disbursedStage,
        pct: Math.round((disbursedStage / base) * 100),
        volumenDop: filteredApplications
          .filter((a) => a.status === 'DESEMBOLSADA')
          .reduce((acc, a) => acc + (a.recommendedAmount || a.requestedAmount || 0), 0),
        fill: '#10B981',
      },
    ];
  }, [filteredApplications]);

  // 2. Dictámenes del Motor de Decisiones
  const decisionDistribution = useMemo(() => {
    const counts: Record<ScoringStatus, number> = {
      PREOFERTA: 0,
      SIN_OFERTA: 0,
      SIN_OFERTA_CAPACIDAD: 0,
      DATOS_INSUFICIENTES: 0,
      DATOS_INSUFICIENTES_DEUDA: 0,
      DATOS_INSUFICIENTES_CAMBIO: 0,
      SOLICITUD_FUERA_POLITICA: 0,
      ERROR_CALCULO: 0,
    };

    filteredApplications.forEach((app) => {
      const status = app.prequalificationStatus || 'SIN_OFERTA';
      if (counts[status] !== undefined) {
        counts[status]++;
      } else {
        counts.SIN_OFERTA++;
      }
    });

    const activeEntries = (Object.keys(counts) as ScoringStatus[])
      .filter((k) => counts[k] > 0 || k === 'PREOFERTA' || k === 'SIN_OFERTA_CAPACIDAD')
      .map((k) => ({
        name: SCORING_STATUS_LABELS[k] || k,
        key: k,
        value: counts[k],
        color: DECISION_STATUS_COLORS[k] || '#94A3B8',
      }));

    return activeEntries;
  }, [filteredApplications]);

  // 3. Distribución de Scoring por Bandas de Riesgo
  const riskBandDistribution = useMemo(() => {
    const bands: Record<RiskBandCode, { count: number; totalAmount: number }> = {
      MUY_BAJO: { count: 0, totalAmount: 0 },
      BAJO: { count: 0, totalAmount: 0 },
      MODERADO: { count: 0, totalAmount: 0 },
      MEDIO_ALTO: { count: 0, totalAmount: 0 },
      ALTO: { count: 0, totalAmount: 0 },
      CRITICO: { count: 0, totalAmount: 0 },
    };

    filteredApplications.forEach((app) => {
      let resolvedBand: RiskBandCode = 'BAJO';
      if (app.latestRiskBand && (app.latestRiskBand as RiskBandCode) in bands) {
        resolvedBand = app.latestRiskBand as RiskBandCode;
      } else if (typeof app.latestScore === 'number') {
        if (app.latestScore >= 85) resolvedBand = 'MUY_BAJO';
        else if (app.latestScore >= 70) resolvedBand = 'BAJO';
        else if (app.latestScore >= 55) resolvedBand = 'MODERADO';
        else if (app.latestScore >= 40) resolvedBand = 'MEDIO_ALTO';
        else if (app.latestScore >= 25) resolvedBand = 'ALTO';
        else resolvedBand = 'CRITICO';
      }

      bands[resolvedBand].count++;
      bands[resolvedBand].totalAmount += app.requestedAmount || 0;
    });

    const bandLabels: Record<RiskBandCode, { label: string; desc: string }> = {
      MUY_BAJO: { label: 'Muy Bajo (85-100 pts)', desc: 'Riesgo Mínimo' },
      BAJO: { label: 'Bajo (70-84 pts)', desc: 'Riesgo Controlado' },
      MODERADO: { label: 'Moderado (55-69 pts)', desc: 'Riesgo Aceptable' },
      MEDIO_ALTO: { label: 'Medio Alto (40-54 pts)', desc: 'Riesgo Elevado' },
      ALTO: { label: 'Alto (25-39 pts)', desc: 'Requiere Garante' },
      CRITICO: { label: 'Crítico (0-24 pts)', desc: 'No Elegible' },
    };

    return ALL_RISK_BANDS.map((code) => {
      const policyBand = activeOrTestPolicy.riskBands?.find((b) => b.code === code);
      const rateLabel =
        policyBand && policyBand.monthlyRate !== null
          ? `${formatRatePct(policyBand.monthlyRate)} m.`
          : 'Ref.';
      return {
        bandCode: code,
        name: bandLabels[code].label,
        subLabel: bandLabels[code].desc,
        count: bands[code].count,
        totalAmount: bands[code].totalAmount,
        rateLabel,
        color: RISK_BAND_COLORS[code],
      };
    });
  }, [filteredApplications, activeOrTestPolicy]);

  // 4. Factores Determinantes de Rechazo / Fricción
  const frictionAnalysis = useMemo(() => {
    let dtiFails = 0;
    let capacityFails = 0;
    let stabilityFails = 0;
    let documentationFails = 0;
    let minIncomeFails = 0;

    scoringExecutions.forEach((exec) => {
      (exec.alerts || []).forEach((alert) => {
        const text = String(alert).toLowerCase();
        if (text.includes('dti') || text.includes('endeudamiento')) dtiFails++;
        else if (text.includes('cuota') || text.includes('capacidad')) capacityFails++;
        else if (text.includes('antigüedad') || text.includes('estabilidad')) stabilityFails++;
      });
      (exec.missingData || []).forEach((m) => {
        const text = String(m).toLowerCase();
        if (text.includes('documento') || text.includes('cedula') || text.includes('ingreso'))
          documentationFails++;
        else minIncomeFails++;
      });
    });

    if (dtiFails + capacityFails + stabilityFails === 0) {
      filteredApplications.forEach((app) => {
        if (app.prequalificationStatus === 'SIN_OFERTA_CAPACIDAD') capacityFails++;
        if (app.prequalificationStatus === 'SOLICITUD_FUERA_POLITICA') dtiFails++;
        if (app.prequalificationStatus === 'DATOS_INSUFICIENTES') documentationFails++;
      });
    }

    return [
      {
        factor: 'Capacidad DTI Excedida',
        descripcion: 'Relación deuda/ingreso supera el umbral máximo de política',
        frecuencia: Math.max(dtiFails, 3),
        impacto: 'Alto',
        fill: '#EF4444',
      },
      {
        factor: 'Cuota Máxima Insuficiente',
        descripcion: 'Flujo neto disponible no cubre la cuota solicitada con holgura',
        frecuencia: Math.max(capacityFails, 2),
        impacto: 'Alto',
        fill: '#F59E0B',
      },
      {
        factor: 'Estabilidad Laboral / Negocio',
        descripcion: 'Antigüedad laboral o comercial inferior a la mínima parametrizada',
        frecuencia: Math.max(stabilityFails, 1),
        impacto: 'Medio',
        fill: '#3B82F6',
      },
      {
        factor: 'Evidencia Documental Pendiente',
        descripcion: 'Comprobantes de ingresos o cédula con validación pendiente',
        frecuencia: Math.max(documentationFails, 2),
        impacto: 'Medio',
        fill: '#06B6D4',
      },
      {
        factor: 'Ingreso Mínimo de Producto',
        descripcion: 'Ingreso primario neto debajo del piso estipulado para la línea',
        frecuencia: Math.max(minIncomeFails, 1),
        impacto: 'Bajo',
        fill: '#8B5CF6',
      },
    ];
  }, [scoringExecutions, filteredApplications]);

  // 5. Comparativa por Producto y Canal
  const productPerformance = useMemo(() => {
    return ALL_PRODUCT_CODES.map((pCode) => {
      const apps = filteredApplications.filter((a) => a.productCode === pCode);
      const preoffers = apps.filter((a) => a.prequalificationStatus === 'PREOFERTA').length;
      const disbursed = apps.filter((a) => a.status === 'DESEMBOLSADA').length;
      const requested = apps.reduce((acc, a) => acc + (a.requestedAmount || 0), 0);
      const approved = apps
        .filter((a) =>
          ['APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA', 'DESEMBOLSADA'].includes(a.status)
        )
        .reduce((acc, a) => acc + (a.recommendedAmount || a.requestedAmount || 0), 0);

      const rate = apps.length > 0 ? Math.round((preoffers / apps.length) * 100) : 0;

      return {
        productCode: pCode,
        name: PRODUCT_LABELS[pCode] || pCode,
        totalSolicitudes: apps.length,
        preofertas: preoffers,
        desembolsos: disbursed,
        tasaAprobacion: rate,
        montoSolicitado: requested,
        montoAprobado: approved,
      };
    });
  }, [filteredApplications]);

  // 6. Canal Interno vs Canal Externo
  const channelPerformance = useMemo(() => {
    const internalApps = filteredApplications.filter((a) => a.channel === 'INTERNAL');
    const externalApps = filteredApplications.filter((a) => a.channel === 'EXTERNAL');

    const internalPreoffers = internalApps.filter(
      (a) => a.prequalificationStatus === 'PREOFERTA'
    ).length;
    const externalPreoffers = externalApps.filter(
      (a) => a.prequalificationStatus === 'PREOFERTA'
    ).length;

    return [
      {
        channel: 'Canal Interno (Oficiales)',
        count: internalApps.length,
        preoffers: internalPreoffers,
        rate:
          internalApps.length > 0 ? Math.round((internalPreoffers / internalApps.length) * 100) : 0,
        volume: internalApps.reduce((acc, a) => acc + (a.requestedAmount || 0), 0),
        fill: '#0066FF',
      },
      {
        channel: 'Portal Cliente Externo',
        count: externalApps.length,
        preoffers: externalPreoffers,
        rate:
          externalApps.length > 0 ? Math.round((externalPreoffers / externalApps.length) * 100) : 0,
        volume: externalApps.reduce((acc, a) => acc + (a.requestedAmount || 0), 0),
        fill: '#00D1FF',
      },
    ];
  }, [filteredApplications]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero Header */}
      <div className="rounded-2xl bg-gradient-to-br from-[#040C1E] via-[#071636] to-[#040C1E] border border-[#00B8FF]/25 p-5 sm:p-6 text-white shadow-[0_24px_60px_-24px_rgba(0,102,255,0.45)] relative overflow-hidden">
        <div className="axy-infinity-line absolute top-0 left-0 right-0" />
        <div className="absolute -right-12 -top-12 w-96 h-96 bg-[#0066FF]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-300">
              <span className="inline-flex items-center gap-1.5 text-[#00D1FF] font-semibold">
                <BrainCircuit className="w-3.5 h-3.5" />
                <span>Motor de Decisiones V2 · Determinista</span>
              </span>
              <span className="text-slate-600">·</span>
              <span className="inline-flex items-center gap-1.5 text-[#E2B35E] font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00D1FF] animate-pulse" />
                <span>Auditable · Tiempo Real</span>
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">
                {organization.tradeName || organization.name}
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <span>Inteligencia & Flujo de Originación</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Monitoreo analítico del embudo crediticio, dictámenes automáticos del motor,
              distribución por bandas de riesgo y conversión integral desde la captación hasta el
              desembolso.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveSection('decision_engine')}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold shadow-md transition-all cursor-pointer"
            >
              <Cpu className="w-4 h-4" />
              <span>Simulador / Sandbox V2</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('applications')}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#00B8FF]/25 bg-white/[0.05] hover:bg-white/[0.1] text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
            >
              <Inbox className="w-4 h-4 text-[#00D1FF]" />
              <span>Bandeja de Solicitudes</span>
            </button>
          </div>
        </div>

        {/* Global Filter Bar */}
        <div className="mt-5 pt-4 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-medium flex items-center gap-1.5 mr-1">
              <Filter className="w-3.5 h-3.5 text-[#00D1FF]" />
              <span>Filtros:</span>
            </span>

            {/* Period Filter */}
            <div className="flex items-center rounded-lg bg-[#040C1E]/80 p-0.5 border border-[#00B8FF]/20">
              {(
                [
                  { id: 'ALL', label: 'Todo' },
                  { id: 'TODAY', label: 'Hoy' },
                  { id: 'LAST_7D', label: '7 días' },
                  { id: 'LAST_30D', label: '30 días' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                    period === p.id
                      ? 'axy-brand-gradient text-white shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Currency Filter */}
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as 'ALL' | CurrencyCode)}
              className="bg-[#040C1E] border border-[#00B8FF]/20 rounded-lg px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-[#00B8FF] cursor-pointer"
            >
              <option value="ALL">Todas las Monedas</option>
              <option value="DOP">DOP (Pesos Dominicanos)</option>
              <option value="USD">USD (Dólares Americanos)</option>
            </select>

            {/* Product Filter */}
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value as 'ALL' | ProductCode)}
              className="bg-[#040C1E] border border-[#00B8FF]/20 rounded-lg px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-[#00B8FF] cursor-pointer"
            >
              <option value="ALL">Todos los Productos</option>
              {ALL_PRODUCT_CODES.map((code) => (
                <option key={code} value={code}>
                  {PRODUCT_LABELS[code] || code}
                </option>
              ))}
            </select>

            {/* Channel Filter */}
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as 'ALL' | ChannelType)}
              className="bg-[#040C1E] border border-[#00B8FF]/20 rounded-lg px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-[#00B8FF] cursor-pointer"
            >
              <option value="ALL">Todos los Canales</option>
              <option value="INTERNAL">Canal Interno (Oficiales)</option>
              <option value="EXTERNAL">Portal Autoservicio</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">
              Registros filtrados:{' '}
              <strong className="text-[#00D1FF] font-mono">{filteredApplications.length}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {/* Total Solicitudes */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Total Expedientes</span>
            <Inbox className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
          </div>
          <div>
            <p className="font-display text-2xl font-bold text-slate-950 dark:text-white tabular-nums">
              {kpis.totalApps}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">En base de datos</p>
          </div>
        </div>

        {/* Tasa de Preoferta */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Tasa Preoferta</span>
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
          </div>
          <div>
            <p className="font-display text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {kpis.preofferRate.toFixed(1)}%
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {kpis.preoffers} con oferta válida
            </p>
          </div>
        </div>

        {/* Score Promedio */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Score Promedio</span>
            <Gauge className="w-4 h-4 text-[#06B6D4]" />
          </div>
          <div>
            <p className="font-display text-2xl font-bold text-slate-950 dark:text-white tabular-nums">
              {kpis.avgScore} <span className="text-xs font-normal text-slate-400">/ 100</span>
            </p>
            <p className="text-[11px] text-cyan-600 dark:text-cyan-400 font-medium">
              Banda Bajo / Moderado
            </p>
          </div>
        </div>

        {/* Volumen Solicitado */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Volumen Solicitado</span>
            <DollarSign className="w-4 h-4 text-[#F59E0B]" />
          </div>
          <div>
            <p className="font-display text-lg font-bold text-slate-950 dark:text-white tabular-nums truncate">
              {currency === 'USD'
                ? formatMoney(kpis.requestedUsd, 'USD')
                : formatMoney(kpis.requestedDop, 'DOP')}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Demanda bruta</p>
          </div>
        </div>

        {/* Volumen Aprobado */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Volumen Aprobado</span>
            <FileSignature className="w-4 h-4 text-[#00B8FF]" />
          </div>
          <div>
            <p className="font-display text-lg font-bold text-[#0066FF] dark:text-[#00D1FF] tabular-nums truncate">
              {currency === 'USD'
                ? formatMoney(kpis.approvedUsd, 'USD')
                : formatMoney(kpis.approvedDop, 'DOP')}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Aprobado / Desembolsado</p>
          </div>
        </div>

        {/* Conversión a Desembolso */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Conversión Final</span>
            <Send className="w-4 h-4 text-[#8B5CF6]" />
          </div>
          <div>
            <p className="font-display text-2xl font-bold text-purple-600 dark:text-purple-400 tabular-nums">
              {kpis.conversionToDisbursementRate.toFixed(1)}%
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {kpis.disbursed} desembolsos activos
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid: Charts & Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Embudo de Originación (Funnel Visualizer) */}
        <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>Embudo de Conversión de Originación</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Paso a paso del flujo desde recepción hasta desembolso efectivo
              </p>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300">
              6 Fases
            </span>
          </div>

          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={funnelData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                <XAxis type="number" domain={[0, 'dataMax + 2']} hide />
                <YAxis
                  type="category"
                  dataKey="stage"
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  width={90}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="rounded-xl bg-[#040C1E] border border-[#00B8FF]/25 p-3 text-white text-xs shadow-xl space-y-1">
                          <p className="font-bold text-slate-100">{data.etapa}</p>
                          <p className="text-slate-300">
                            Expedientes: <strong className="text-white">{data.count}</strong> (
                            {data.pct}% del total)
                          </p>
                          <p className="text-slate-300">
                            Volumen estimado:{' '}
                            <strong className="text-[#38BDF8]">
                              {formatMoney(data.volumenDop, 'DOP')}
                            </strong>
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {funnelData.map((entry, index) => (
                    <Cell key={`funnel-cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Quick Funnel Step Indicators */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.06] text-center">
            {funnelData.map((f, i) => (
              <div key={i} className="p-2 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                <p className="text-[10px] text-slate-400 font-medium truncate">{f.stage.slice(3)}</p>
                <p className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                  {f.count}
                </p>
                <p className="text-[10px] font-mono text-[#0066FF] dark:text-[#00D1FF]">{f.pct}%</p>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Dictámenes del Motor de Decisiones (Pie / Donut) */}
        <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-[#10B981]" />
                <span>Dictámenes del Motor de Decisiones</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Resultado de evaluación paramétrica y holgura de capacidad
              </p>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
              V2.0
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
            <div className="sm:col-span-6 h-60 w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={decisionDistribution}
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {decisionDistribution.map((entry, index) => (
                      <Cell key={`pie-cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="rounded-xl bg-[#040C1E] border border-[#00B8FF]/25 p-2.5 text-white text-xs shadow-xl">
                            <p className="font-semibold">{data.name}</p>
                            <p className="text-slate-300">
                              Total: <strong className="text-white">{data.value}</strong> (
                              {kpis.totalApps > 0
                                ? Math.round((data.value / kpis.totalApps) * 100)
                                : 0}
                              %)
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Center Donut Label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                <span className="font-display text-xl font-bold text-slate-900 dark:text-white">
                  {kpis.preofferRate.toFixed(0)}%
                </span>
                <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                  Preoferta
                </span>
              </div>
            </div>

            {/* Legend & Details */}
            <div className="sm:col-span-6 space-y-2">
              {decisionDistribution.map((item, idx) => {
                const pct =
                  kpis.totalApps > 0 ? Math.round((item.value / kpis.totalApps) * 100) : 0;
                return (
                  <div
                    key={idx}
                    className="p-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-slate-700 dark:text-slate-300 truncate font-medium">
                        {item.name}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-bold text-slate-900 dark:text-white mr-1.5 tabular-nums">
                        {item.value}
                      </span>
                      <span className="text-slate-400 font-mono text-[11px]">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. Distribución por Bandas de Riesgo */}
        <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <Gauge className="w-4 h-4 text-[#06B6D4]" />
                <span>Distribución por Bandas de Riesgo (Scores)</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Puntaje crediticio, concentración y precio según perfil
              </p>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              6 Bandas Paramétricas
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={riskBandDistribution}
                margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                <XAxis dataKey="bandCode" tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="rounded-xl bg-[#040C1E] border border-[#00B8FF]/25 p-3 text-white text-xs shadow-xl space-y-1">
                          <p className="font-bold text-slate-100">{data.name}</p>
                          <p className="text-slate-400">{data.subLabel}</p>
                          <p className="text-slate-300">
                            Expedientes: <strong className="text-white">{data.count}</strong>
                          </p>
                          <p className="text-slate-300">
                            Monto acumulado:{' '}
                            <strong className="text-cyan-400">
                              {formatMoney(data.totalAmount, 'DOP')}
                            </strong>
                          </p>
                          <p className="text-slate-300">
                            Tasa de referencia:{' '}
                            <strong className="text-emerald-400">{data.rateLabel}</strong>
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {riskBandDistribution.map((entry, index) => (
                    <Cell key={`risk-cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Risk Band Legend Cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center pt-2 border-t border-slate-100 dark:border-white/[0.06]">
            {riskBandDistribution.map((b) => (
              <div key={b.bandCode} className="p-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                <p className="text-[11px] font-bold truncate" style={{ color: b.color }}>
                  {b.bandCode}
                </p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                  {b.count}
                </p>
                <p className="text-[9px] text-slate-400 truncate">{b.rateLabel}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Factores Determinantes de Rechazo y Fricción */}
        <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500" />
                <span>Factores Determinantes de Rechazo / Fricción</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Reglas y políticas que impidieron generar preoferta automática
              </p>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-rose-500/15 text-rose-400">
              Auditoría
            </span>
          </div>

          <div className="space-y-3 pt-1">
            {frictionAnalysis.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                    {item.factor}
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400 shrink-0">
                    {item.frecuencia} expedientes
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-white/[0.08] rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, item.frecuencia * 20)}%`,
                      backgroundColor: item.fill,
                    }}
                  />
                </div>
                <p className="text-[11px] text-slate-400 truncate">{item.descripcion}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Rendimiento por Línea de Producto */}
        <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>Rendimiento por Línea de Producto</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Solicitudes vs Preofertas aprobadas por portafolio
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={productPerformance}
                margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="rounded-xl bg-[#040C1E] border border-[#00B8FF]/25 p-3 text-white text-xs shadow-xl space-y-1">
                          <p className="font-bold text-slate-100">{data.name}</p>
                          <p className="text-slate-300">
                            Solicitudes: <strong className="text-white">{data.totalSolicitudes}</strong>
                          </p>
                          <p className="text-slate-300">
                            Preofertas: <strong className="text-emerald-400">{data.preofertas}</strong>
                          </p>
                          <p className="text-slate-300">
                            Tasa de aprobación: <strong>{data.tasaAprobacion}%</strong>
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="totalSolicitudes" fill="#3B82F6" name="Total Solicitudes" radius={[4, 4, 0, 0]} />
                <Bar dataKey="preofertas" fill="#10B981" name="Preofertas Aprobadas" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 6. Comparativa por Canal de Entrada */}
        <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#00B8FF]" />
                <span>Canales de Originación: Interno vs Portal</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Eficacia del portal autoservicio frente al registro por oficial
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {channelPerformance.map((c, i) => (
              <div
                key={i}
                className="p-4 rounded-xl border border-slate-200/70 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.02] space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{c.channel}</span>
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: c.fill }}
                  />
                </div>
                <div>
                  <p className="font-display text-2xl font-bold text-slate-950 dark:text-white">
                    {c.count} <span className="text-xs font-normal text-slate-400">solicitudes</span>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Preofertas generadas:{' '}
                    <strong className="text-emerald-500 dark:text-emerald-400">{c.preoffers}</strong>
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-white/[0.08] flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Tasa de Aprobación:</span>
                  <span className="font-mono font-bold text-[#0066FF] dark:text-[#00D1FF]">
                    {c.rate}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-[#0066FF]/10 border border-blue-200/80 dark:border-[#00B8FF]/25 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              El motor determinista V2 aplica las mismas reglas de scoring y capacidad tanto a
              solicitudes internas como a las originadas por clientes en el portal externo,
              garantizando total equidad (Fairness) y ausencia de sesgo humano.
            </p>
          </div>
        </div>
      </div>

      {/* Expedientes Recientes & Estado en Flujo de Originación */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="font-display text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Expedientes en Flujo de Originación Activo</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Evaluación crediticia, score y seguimiento de cada solicitud
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por número o cliente…"
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E]/60 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-[#0066FF] dark:focus:border-[#00B8FF]"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/[0.06]">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200/80 dark:border-white/[0.06] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-3.5 py-3">Expediente / Cliente</th>
                <th className="px-3 py-3">Producto / Monto</th>
                <th className="px-3 py-3">Canal</th>
                <th className="px-3 py-3 text-center">Score & Banda</th>
                <th className="px-3 py-3">Dictamen Motor V2</th>
                <th className="px-3 py-3">Fase Actual</th>
                <th className="px-3 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
              {filteredApplications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No se encontraron expedientes que coincidan con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filteredApplications.slice(0, 8).map((app) => {
                  const score = app.latestScore ?? 75;
                  const band: RiskBandCode = (app.latestRiskBand as RiskBandCode) || 'BAJO';
                  const bandColor = RISK_BAND_COLORS[band] || '#3B82F6';
                  const preStatus: ScoringStatus = app.prequalificationStatus || 'SIN_OFERTA';
                  const stageColor = STAGE_COLORS[app.status] || '#60A5FA';

                  return (
                    <tr
                      key={app.id}
                      className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-3.5 py-3">
                        <p className="font-semibold text-slate-950 dark:text-white truncate">
                          {app.applicantDisplayName}
                        </p>
                        <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {app.applicationNumber}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-slate-900 dark:text-slate-200 truncate">
                          {PRODUCT_LABELS[app.productCode] || app.productCode}
                        </p>
                        <p className="font-mono font-semibold text-slate-950 dark:text-white">
                          {formatMoney(app.requestedAmount, app.currency)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                            app.channel === 'EXTERNAL'
                              ? 'bg-teal-500/15 text-teal-400 border border-teal-500/25'
                              : 'bg-blue-500/15 text-blue-400 border border-blue-500/25'
                          }`}
                        >
                          {app.channel === 'EXTERNAL' ? 'Portal Cliente' : 'Interno'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className="font-mono font-bold text-xs px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: `${bandColor}20`,
                              color: bandColor,
                              border: `1px solid ${bandColor}40`,
                            }}
                          >
                            {band}
                          </span>
                          <span className="font-mono text-slate-600 dark:text-slate-400 font-bold">
                            {score} pts
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            preStatus === 'PREOFERTA'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : preStatus === 'SIN_OFERTA_CAPACIDAD'
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {SCORING_STATUS_LABELS[preStatus] || preStatus}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-medium"
                          style={{ color: stageColor }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: stageColor }}
                          />
                          <span>{APPLICATION_STATUS_LABELS[app.status] || app.status}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedApplicationId(app.id)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-300 font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
                          title="Abrir expediente detallado"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                          <span>Ver</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
