import type {
  ApplicationRecord,
  CreditPolicyRecord,
  CustomerRecord,
  LoanRecord,
  RiskBandCode,
} from '../types/axycore';

export type GeoGranularity = 'PROVINCE' | 'MUNICIPALITY';
export type ProfileDimension = 'INCOME_SEGMENT' | 'HOUSING_TENURE' | 'PRODUCT';
export type HeatmapMetricMode = 'RISK_INDEX' | 'HIGH_RISK_PCT' | 'EXPOSURE_SHARE';

export interface RiskHeatmapItem {
  application: ApplicationRecord;
  customer: CustomerRecord | null;
  linkedLoan: LoanRecord | null;
  zone: string;
  profile: string;
  score: number | null;
  riskBand: RiskBandCode | string;
  isHighRisk: boolean;
  exposureDop: number;
}

export interface RiskHeatmapCell {
  zone: string;
  profile: string;
  count: number;
  highRiskCount: number;
  highRiskPct: number;
  avgScore: number | null;
  riskIndex: number;
  exposureDop: number;
  exposureSharePct: number;
  metricValue: number;
  dominantBand: string;
  items: RiskHeatmapItem[];
}

export interface RiskHeatmapMatrix {
  zones: string[];
  profiles: string[];
  cells: RiskHeatmapCell[];
  maxMetricValue: number;
  totalCount: number;
  totalHighRiskCount: number;
  overallHighRiskPct: number;
  totalExposureDop: number;
  topConcentrationCell: RiskHeatmapCell | null;
}

const HIGH_RISK_BANDS = new Set<string>(['MEDIO_ALTO', 'ALTO', 'CRITICO']);

const PROFILE_ORDER: Record<ProfileDimension, string[]> = {
  INCOME_SEGMENT: [
    'Asalariado Fijo',
    'Mixto / Independiente',
    'Empresarial / PyME',
    'Ingreso Irregular',
    'Sin Fuente Clasificada',
  ],
  HOUSING_TENURE: [
    'Vivienda Propia',
    'Vivienda Alquilada',
    'Vivienda Familiar',
    'Otra Tenencia',
    'No Declarada',
  ],
  PRODUCT: ['Personal DOP', 'Empresarial DOP', 'Personal USD', 'Empresarial USD'],
};

const BAND_LABEL_SHORT: Record<string, string> = {
  MUY_BAJO: 'Muy Bajo',
  BAJO: 'Bajo',
  MODERADO: 'Moderado',
  MEDIO_ALTO: 'Medio-Alto',
  ALTO: 'Alto',
  CRITICO: 'Crítico',
};

export function resolveGeoZone(
  customer: CustomerRecord | null | undefined,
  granularity: GeoGranularity
): string {
  if (!customer) {
    return granularity === 'PROVINCE' ? 'Sin provincia' : 'Sin municipio';
  }
  const m = typeof customer.municipality === 'string' ? customer.municipality.trim() : '';
  const p = typeof customer.province === 'string' ? customer.province.trim() : '';

  if (granularity === 'MUNICIPALITY') {
    if (m) return m;
    return p ? `${p} (s/m)` : 'Sin municipio';
  }
  if (p) return p;
  return m || 'Sin provincia';
}

export function resolveCustomerProfile(
  app: ApplicationRecord,
  customer: CustomerRecord | null | undefined,
  dimension: ProfileDimension
): string {
  if (dimension === 'PRODUCT') {
    const code = typeof app?.productCode === 'string' ? app.productCode.trim() : '';
    switch (code) {
      case 'PERSONAL_DOP':
        return 'Personal DOP';
      case 'EMPRESARIAL_DOP':
        return 'Empresarial DOP';
      case 'PERSONAL_USD':
        return 'Personal USD';
      case 'EMPRESARIAL_USD':
        return 'Empresarial USD';
      default:
        return code || 'Personal DOP';
    }
  }

  if (dimension === 'HOUSING_TENURE') {
    switch (customer?.housingType) {
      case 'PROPIA':
        return 'Vivienda Propia';
      case 'ALQUILADA':
        return 'Vivienda Alquilada';
      case 'FAMILIAR':
        return 'Vivienda Familiar';
      case 'OTRA':
        return 'Otra Tenencia';
      default:
        return 'No Declarada';
    }
  }

  // INCOME_SEGMENT
  if (app?.applicantType === 'BUSINESS') {
    return 'Empresarial / PyME';
  }
  const sourceType =
    app?.verifiedFinancialData?.incomeSourceType ?? app?.financialData?.incomeSourceType;
  switch (sourceType) {
    case 'FIJA_RECURRENTE':
      return 'Asalariado Fijo';
    case 'MIXTA_RECURRENTE':
      return 'Mixto / Independiente';
    case 'IRREGULAR':
      return 'Ingreso Irregular';
    default:
      return 'Sin Fuente Clasificada';
  }
}

export function buildRiskHeatmapMatrix(params: {
  applications?: ApplicationRecord[] | null;
  customers?: CustomerRecord[] | null;
  loans?: LoanRecord[] | null;
  policy?: CreditPolicyRecord | null;
  geoGranularity: GeoGranularity;
  profileDimension: ProfileDimension;
  metricMode: HeatmapMetricMode;
}): RiskHeatmapMatrix {
  const safeApps = Array.isArray(params.applications) ? params.applications : [];
  const safeCustomers = Array.isArray(params.customers) ? params.customers : [];
  const safeLoans = Array.isArray(params.loans) ? params.loans : [];
  const { policy, geoGranularity, profileDimension, metricMode } = params;

  const dopPerUsd =
    policy?.exchangeRateConfig?.dopPerUsd && policy.exchangeRateConfig.dopPerUsd > 0
      ? policy.exchangeRateConfig.dopPerUsd
      : 60;
  const customerMap = new Map<string, CustomerRecord>();
  safeCustomers.forEach((c) => {
    if (c && c.id) customerMap.set(c.id, c);
  });

  const loanByAppMap = new Map<string, LoanRecord>();
  safeLoans.forEach((l) => {
    if (l && l.applicationId) loanByAppMap.set(l.applicationId, l);
  });

  const items: RiskHeatmapItem[] = safeApps.map((app) => {
    const customer = (app?.customerId ? customerMap.get(app.customerId) : null) ?? null;
    const linkedLoan = (app?.id ? loanByAppMap.get(app.id) : null) ?? null;
    const zone = resolveGeoZone(customer, geoGranularity);
    const profile = resolveCustomerProfile(app, customer, profileDimension) || 'General';

    const nativeAmount = Number(app?.recommendedAmount ?? app?.requestedAmount ?? 0) || 0;
    const exposureDop =
      app?.currency === 'USD' ? nativeAmount * dopPerUsd : nativeAmount;

    const riskBand = (app?.latestRiskBand as string) || 'MODERADO';
    const score =
      typeof app?.latestScore === 'number' && !Number.isNaN(app.latestScore)
        ? app.latestScore
        : null;
    const isHighRisk =
      HIGH_RISK_BANDS.has(riskBand) ||
      app?.status === 'RECHAZADA' ||
      linkedLoan?.status === 'VENCIDO';

    return {
      application: app,
      customer,
      linkedLoan,
      zone,
      profile,
      score,
      riskBand,
      isHighRisk,
      exposureDop,
    };
  });

  const totalCount = items.length;
  const totalHighRiskCount = items.filter((it) => it.isHighRisk).length;
  const overallHighRiskPct =
    totalCount > 0 ? Number(((totalHighRiskCount / totalCount) * 100).toFixed(1)) : 0;
  const totalExposureDop = items.reduce((s, it) => s + it.exposureDop, 0);

  // Collect observed zones and profiles
  const zoneStats = new Map<string, { count: number; highRisk: number; exposure: number }>();
  const observedProfiles = new Set<string>();

  items.forEach((it) => {
    if (it.profile) observedProfiles.add(it.profile);
    const prev = zoneStats.get(it.zone) ?? { count: 0, highRisk: 0, exposure: 0 };
    prev.count += 1;
    if (it.isHighRisk) prev.highRisk += 1;
    prev.exposure += it.exposureDop;
    zoneStats.set(it.zone, prev);
  });

  const zones = Array.from(zoneStats.entries())
    .sort((a, b) => {
      if (b[1].highRisk !== a[1].highRisk) return b[1].highRisk - a[1].highRisk;
      if (b[1].exposure !== a[1].exposure) return b[1].exposure - a[1].exposure;
      return b[1].count - a[1].count;
    })
    .map(([z]) => z);

  const preferredOrder = PROFILE_ORDER[profileDimension] || [];
  const profiles = preferredOrder.filter((p) => p && observedProfiles.has(p));
  observedProfiles.forEach((p) => {
    if (p && !profiles.includes(p)) profiles.push(p);
  });
  if (profiles.length === 0) {
    profiles.push(...preferredOrder);
  }

  // Group items by cell key
  const grouped = new Map<string, RiskHeatmapItem[]>();
  items.forEach((it) => {
    const key = `${it.zone}:::${it.profile}`;
    const list = grouped.get(key) ?? [];
    list.push(it);
    grouped.set(key, list);
  });

  const cells: RiskHeatmapCell[] = [];
  let maxMetricValue = 0;
  let topConcentrationCell: RiskHeatmapCell | null = null;

  zones.forEach((zone) => {
    profiles.forEach((profile) => {
      const cellItems = grouped.get(`${zone}:::${profile}`) ?? [];
      const count = cellItems.length;
      const highRiskCount = cellItems.filter((it) => it.isHighRisk).length;
      const highRiskPct =
        count > 0 ? Number(((highRiskCount / count) * 100).toFixed(1)) : 0;

      const scored = cellItems.filter((it) => it.score !== null);
      const avgScore =
        scored.length > 0
          ? Number(
              (
                scored.reduce((s, it) => s + (it.score ?? 0), 0) / scored.length
              ).toFixed(1)
            )
          : null;

      const scoreRisk =
        avgScore !== null ? Math.max(0, Math.min(100, 100 - avgScore)) : 50;
      const riskIndex =
        count > 0 ? Math.round(0.65 * scoreRisk + 0.35 * highRiskPct) : 0;

      const exposureDop = cellItems.reduce((s, it) => s + it.exposureDop, 0);
      const exposureSharePct =
        totalExposureDop > 0
          ? Number(((exposureDop / totalExposureDop) * 100).toFixed(1))
          : 0;

      const bandCounts = new Map<string, number>();
      cellItems.forEach((it) => {
        bandCounts.set(it.riskBand, (bandCounts.get(it.riskBand) ?? 0) + 1);
      });
      let dominantBandCode = '—';
      let maxBandCount = 0;
      bandCounts.forEach((c, code) => {
        if (c > maxBandCount) {
          maxBandCount = c;
          dominantBandCode = code;
        }
      });
      const dominantBand = BAND_LABEL_SHORT[dominantBandCode] ?? dominantBandCode;

      const metricValue =
        count === 0
          ? 0
          : metricMode === 'RISK_INDEX'
          ? riskIndex
          : metricMode === 'HIGH_RISK_PCT'
          ? highRiskPct
          : exposureSharePct;

      const cell: RiskHeatmapCell = {
        zone,
        profile,
        count,
        highRiskCount,
        highRiskPct,
        avgScore,
        riskIndex,
        exposureDop,
        exposureSharePct,
        metricValue,
        dominantBand,
        items: cellItems,
      };

      cells.push(cell);

      if (count > 0) {
        if (metricValue > maxMetricValue) {
          maxMetricValue = metricValue;
        }
        if (
          !topConcentrationCell ||
          metricValue > topConcentrationCell.metricValue ||
          (metricValue === topConcentrationCell.metricValue &&
            exposureDop > topConcentrationCell.exposureDop)
        ) {
          topConcentrationCell = cell;
        }
      }
    });
  });

  return {
    zones,
    profiles,
    cells,
    maxMetricValue: maxMetricValue > 0 ? maxMetricValue : 100,
    totalCount,
    totalHighRiskCount,
    overallHighRiskPct,
    totalExposureDop,
    topConcentrationCell,
  };
}
