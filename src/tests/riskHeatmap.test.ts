import { describe, expect, it } from 'vitest';
import {
  buildRiskHeatmapMatrix,
  resolveCustomerProfile,
  resolveGeoZone,
} from '../engine/riskHeatmap';
import type { ApplicationRecord, CustomerRecord, LoanRecord } from '../types/axycore';

describe('Risk Heatmap & Originación Resilience Engine', () => {
  it('resolves geographic zones safely without crashing on null, undefined, or non-string fields', () => {
    expect(resolveGeoZone(null, 'PROVINCE')).toBe('Sin provincia');
    expect(resolveGeoZone(undefined, 'MUNICIPALITY')).toBe('Sin municipio');

    // Customer with dirty non-string fields
    const dirtyCustomer = {
      id: 'cust_1',
      municipality: 12345 as unknown as string,
      province: null as unknown as string,
    } as unknown as CustomerRecord;

    expect(resolveGeoZone(dirtyCustomer, 'PROVINCE')).toBe('Sin provincia');
    expect(resolveGeoZone(dirtyCustomer, 'MUNICIPALITY')).toBe('Sin municipio');

    // Customer with valid strings
    const validCustomer: CustomerRecord = {
      id: 'cust_2',
      organizationId: 'org_main',
      documentType: 'CEDULA',
      documentNumber: '00100000001',
      documentKey: 'CEDULA_00100000001',
      firstName: 'Juan',
      lastName: 'Pérez',
      phone: '8095551234',
      createdBy: 'user_1',
      province: 'Santo Domingo',
      municipality: 'Santo Domingo Este',
      createdAt: { seconds: 1700000000 } as any,
      updatedAt: { seconds: 1700000000 } as any,
    };

    expect(resolveGeoZone(validCustomer, 'PROVINCE')).toBe('Santo Domingo');
    expect(resolveGeoZone(validCustomer, 'MUNICIPALITY')).toBe('Santo Domingo Este');
  });

  it('resolves customer profiles safely across all dimensions', () => {
    const dummyApp = {
      id: 'app_1',
      productCode: 'PERSONAL_DOP',
    } as unknown as ApplicationRecord;

    expect(resolveCustomerProfile(dummyApp, null, 'PRODUCT')).toBe('Personal DOP');

    // Unknown productCode or missing productCode returns clean fallback string
    const appWithoutProduct = {
      id: 'app_2',
    } as unknown as ApplicationRecord;
    expect(resolveCustomerProfile(appWithoutProduct, null, 'PRODUCT')).toBe('Personal DOP');

    // Housing tenure
    expect(resolveCustomerProfile(dummyApp, null, 'HOUSING_TENURE')).toBe('No Declarada');
    expect(
      resolveCustomerProfile(
        dummyApp,
        { housingType: 'PROPIA' } as unknown as CustomerRecord,
        'HOUSING_TENURE'
      )
    ).toBe('Vivienda Propia');

    // Income segment
    expect(
      resolveCustomerProfile(
        { applicantType: 'BUSINESS' } as unknown as ApplicationRecord,
        null,
        'INCOME_SEGMENT'
      )
    ).toBe('Empresarial / PyME');
    expect(
      resolveCustomerProfile(
        {
          applicantType: 'INDIVIDUAL',
          financialData: { incomeSourceType: 'FIJA_RECURRENTE' },
        } as unknown as ApplicationRecord,
        null,
        'INCOME_SEGMENT'
      )
    ).toBe('Asalariado Fijo');
  });

  it('builds a resilient heatmap matrix even with empty inputs, dirty records, or null policy', () => {
    const emptyResult = buildRiskHeatmapMatrix({
      applications: [],
      customers: [],
      loans: [],
      policy: null,
      geoGranularity: 'PROVINCE',
      profileDimension: 'PRODUCT',
      metricMode: 'RISK_INDEX',
    });

    expect(emptyResult.totalCount).toBe(0);
    expect(emptyResult.totalExposureDop).toBe(0);
    expect(Array.isArray(emptyResult.cells)).toBe(true);
    expect(emptyResult.profiles.length).toBeGreaterThan(0);

    // With realistic dirty applications
    const dirtyApps: ApplicationRecord[] = [
      {
        id: 'app_1',
        organizationId: 'org_main',
        customerId: 'cust_1',
        productCode: 'PERSONAL_DOP',
        currency: 'DOP',
        requestedAmount: 150000,
        status: 'APROBADA',
        latestRiskBand: 'BAJO',
        latestScore: 85,
        channel: 'INTERNAL',
        applicantType: 'INDIVIDUAL',
        createdAt: { seconds: 1700000000 } as any,
        updatedAt: { seconds: 1700000000 } as any,
      } as unknown as ApplicationRecord,
      {
        id: 'app_2',
        organizationId: 'org_main',
        customerId: 'cust_2',
        productCode: 'EMPRESARIAL_USD',
        currency: 'USD',
        requestedAmount: 'NaN' as unknown as number, // dirty amount
        status: 'RECHAZADA',
        latestRiskBand: 'CRITICO',
        latestScore: null as unknown as number,
        channel: 'EXTERNAL',
        applicantType: 'BUSINESS',
        createdAt: { seconds: 1700000000 } as any,
        updatedAt: { seconds: 1700000000 } as any,
      } as unknown as ApplicationRecord,
    ];

    const customers: CustomerRecord[] = [
      {
        id: 'cust_1',
        province: 'Distrito Nacional',
        municipality: 'Santo Domingo',
      } as unknown as CustomerRecord,
    ];

    const loans: LoanRecord[] = [];

    const matrix = buildRiskHeatmapMatrix({
      applications: dirtyApps,
      customers,
      loans,
      policy: null, // tests fallback dopPerUsd = 60
      geoGranularity: 'PROVINCE',
      profileDimension: 'PRODUCT',
      metricMode: 'HIGH_RISK_PCT',
    });

    expect(matrix.totalCount).toBe(2);
    expect(matrix.totalHighRiskCount).toBe(1);
    expect(matrix.overallHighRiskPct).toBe(50);
    expect(matrix.zones).toContain('Distrito Nacional');
    expect(matrix.zones).toContain('Sin provincia');
    expect(matrix.cells.length).toBeGreaterThan(0);
  });
});
